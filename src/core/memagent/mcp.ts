// MCP Server（§19.5）：JSON-RPC 2.0 over TCP，暴露记忆工具，供 Agent 调用记忆助手。
// 运行在主进程内，复用现有 storage/agent/vector 实例，零额外依赖。
//
// 工具：recall_memory / write_memory / list_projects / get_preferences
// 批次11：initialize 下发 MCP_INSTRUCTIONS；recall 返回项目背景/省量/金额提示（与 HTTP 8204 共用 mcpSchema/mcpRecall）。
// 错误：JSON-RPC error 对象；不抛未捕获异常（stderr 作为兜底）。
import { createServer as createNetServer } from 'node:net';
import type { Socket } from 'node:net';
import { createMemAgent } from './agent.ts';
import { InMemoryStorage } from './storage.ts';
import { JsVectorBackend } from './vector.ts';
import { FakeLlmProvider } from './llm.ts';
import { assertMcpToken, tokenEquals, DEFAULT_MCP_ACCOUNT, projectInScope, type McpAccount } from './mcpAuth.ts';
import { MCP_INSTRUCTIONS, MCP_TOOLS } from './mcpSchema.ts';
import { McpToolError, runListProjectsTool, runRecallTool } from './mcpRecall.ts';
import type { StorageBackend, Pref, L0Port } from './types.ts';
import { CATEGORIES, isCategory } from './types.ts';

const VERSION = '2.0';

type RpcId = string | number | null | undefined;

type JsonRpcRequest = {
  jsonrpc: typeof VERSION;
  id?: RpcId;
  method: string;
  params?: unknown;
};

type JsonRpcResponse =
  | { jsonrpc: typeof VERSION; id: RpcId; result: unknown }
  | { jsonrpc: typeof VERSION; id: RpcId; error: { code: number; message: string; data?: unknown } };

function send(socket: Socket, msg: JsonRpcResponse): void {
  socket.write(JSON.stringify(msg) + '\n');
}

function jsonError(id: RpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: VERSION, id: id ?? null, error: { code, message, data } };
}

function ok(id: RpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: VERSION, id: id ?? null, result };
}

function parsePayload(raw: string): JsonRpcRequest {
  const o = JSON.parse(raw) as Record<string, unknown>;
  return {
    jsonrpc: VERSION,
    id: o.id as RpcId,
    method: String(o.method ?? ''),
    params: o.params,
  };
}

/** 会话状态（per-socket，防止复用旧内存） */
class Session {
  ma: ReturnType<typeof createMemAgent>;
  readonly account: McpAccount;
  readonly storage: StorageBackend;
  constructor(account: McpAccount, storage?: StorageBackend, l0?: L0Port) {
    this.account = account;
    this.storage = storage ?? new InMemoryStorage();
    this.ma = createMemAgent({
      form: 'desktop',
      account,
      // 显式 stub 装配点：MCP 写入只落 L1
      llm: new FakeLlmProvider(),
      vector: new JsVectorBackend(),
      storage: this.storage,
      l0,
    });
  }
}

export interface McpOptions {
  /** 注入已有 StorageBackend（如主进程共享的 FileStorage）；缺省用 InMemoryStorage */
  storage?: StorageBackend;
  /** L0 写密钥端口（主进程 L0Vault）；缺省 → 写入诚实报 E_L0_LOCKED */
  l0?: L0Port;
  /** 监听端口，缺省 8202；0 = 随机端口（测试） */
  port?: number;
  /** 必填：访问令牌（initialize / 任意请求的 params.token） */
  token: string;
  /** 会话租户（客户端不得越过该 user_id）；缺省本机单用户 */
  account?: McpAccount;
  /** 单行 JSON 上限（字节），缺省 1 MiB */
  maxLineBytes?: number;
}

export interface McpServerHandle {
  /** 监听就绪后的实际端口（port:0 时由系统分配） */
  ready: Promise<number>;
  stop: () => void;
}

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

interface SocketState {
  authed: boolean;
  session: Session | null;
  buffer: string;
}

export function runMcpServer(opts: McpOptions): McpServerHandle {
  const token = assertMcpToken(opts.token);
  const { port = 8202, maxLineBytes = DEFAULT_MAX_LINE_BYTES, account = DEFAULT_MCP_ACCOUNT } = opts;
  const sockets = new WeakMap<Socket, SocketState>();

  function stateOf(socket: Socket): SocketState {
    let st = sockets.get(socket);
    if (!st) {
      st = { authed: false, session: null, buffer: '' };
      sockets.set(socket, st);
    }
    return st;
  }

  function sessionOf(socket: Socket): Session {
    const st = stateOf(socket);
    if (!st.session) st.session = new Session(account, opts.storage, opts.l0);
    return st.session;
  }

  async function handleRequest(socket: Socket, req: JsonRpcRequest): Promise<void> {
    try {
      const { method, params } = req;
      const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;

      // 鉴权：首个请求必须带 token（initialize/任意方法均可），之后该 socket 保持授权
      const st = stateOf(socket);
      if (!st.authed) {
        if (!tokenEquals(typeof p.token === 'string' ? p.token : undefined, token)) {
          send(socket, jsonError(req.id, -32001, 'unauthorized: 缺少或无效的 MCP token'));
          return;
        }
        st.authed = true;
      }

      const sess = sessionOf(socket);
      const s = sess.ma;
      const sessionStorage = sess.storage;
      const sessionUser = account.user_id;

      switch (method) {
        // ── recall_memory ──────────────────────────────────────────────
        case 'recall_memory': {
          // 批次11：project_id 可省略（唯一项目自动定位）；返回背景/省量/金额提示
          const out = await runRecallTool(s, sessionStorage, p, undefined, undefined, account.scope_project_ids);
          send(socket, ok(req.id, out.payload));
          return;
        }

        // ── list_projects ──────────────────────────────────────────────
        case 'list_projects': {
          send(socket, ok(req.id, await runListProjectsTool(sessionStorage, account.scope_project_ids)));
          return;
        }

        // ── write_memory ───────────────────────────────────────────────
        case 'write_memory': {
          if (!p.project_id || typeof p.project_id !== 'string') {
            send(socket, jsonError(req.id, -32602, 'write_memory.project_id 必填（R2）'));
            return;
          }
          // 令牌项目作用域（批次26-B P1-10）：'*' 全放行；否则只能写显式列出的项目
          if (!projectInScope(account.scope_project_ids, p.project_id)) {
            send(socket, jsonError(req.id, -32602, `当前 MCP 令牌作用域不含项目 ${p.project_id}（scope 校验，批次26-B P1-10）`));
            return;
          }
          if (!p.content || typeof p.content !== 'string') {
            send(socket, jsonError(req.id, -32602, 'write_memory.content 必填且须为字符串'));
            return;
          }
          // 租户闭包：客户端只能以会话身份写入，禁止冒用其它 user_id
          if (p.user_id !== undefined && String(p.user_id) !== sessionUser) {
            send(socket, jsonError(req.id, -32602, 'write_memory.user_id 与会话租户不一致（禁止跨租户写入）'));
            return;
          }
          const category = p.category ?? 'pitfall';
          if (!isCategory(category)) {
            send(socket, jsonError(req.id, -32602, `write_memory.category 非法：${String(category)}（允许：${CATEGORIES.join('/')}）`));
            return;
          }
          // A5（§7.1）：来源 agent 必须显式标识，禁止依赖默认 'mcp'
          const sa = typeof p.source_agent === 'string' ? p.source_agent.trim().toLowerCase() : '';
          if (!sa || sa === 'mcp') {
            send(socket, jsonError(req.id, -32602, 'write_memory.source_agent 必填且须显式标识来源 agent（禁止依赖默认 mcp，命名见 §7.1）'));
            return;
          }
          const result = await s.write({
            content: p.content,
            category,
            project_id: p.project_id,
            user_id: sessionUser,
            session_id: p.session_id ? String(p.session_id) : undefined,
            source_agent: sa,
          });
          send(socket, ok(req.id, result));
          return;
        }

        // ── get_preferences ───────────────────────────────────────
        case 'get_preferences': {
          if (!p.user_id || typeof p.user_id !== 'string') {
            send(socket, jsonError(req.id, -32602, 'get_preferences.user_id 必填'));
            return;
          }
          // 租户闭包：只能读会话身份自己的偏好
          if (String(p.user_id) !== sessionUser) {
            send(socket, jsonError(req.id, -32602, 'get_preferences.user_id 与会话租户不一致（禁止跨租户读取）'));
            return;
          }
          const result: Pref[] = await s.getPrefs(sessionUser);
          send(socket, ok(req.id, result));
          return;
        }

        // ── standard JSON-RPC 2.0 ──────────────────────────────────────
        case 'initialize':
          send(socket, ok(req.id, {
            protocolVersion: VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'memagent-mcp', version: '1.0.0' },
            instructions: MCP_INSTRUCTIONS,
          }));
          break;

        case 'tools/list':
          send(socket, ok(req.id, { tools: MCP_TOOLS }));
          break;

        case 'tools/call': {
          const toolName = String(p.name ?? '');
          const toolParams = p.arguments;
          const fakeReq: JsonRpcRequest = { jsonrpc: VERSION, id: req.id, method: toolName, params: toolParams };
          await handleRequest(socket, fakeReq);
          return;
        }

        default:
          send(socket, jsonError(req.id, -32601, `未知方法: ${method}`));
      }
    } catch (e) {
      console.error('[mcp] handleError', e);
      // 参数/项目解析类错误 → -32602（与显式校验一致）；其余按 -32000
      const code = e instanceof McpToolError ? e.code : -32000;
      send(socket, jsonError(req.id ?? null, code, String((e as Error)?.message ?? e)));
    }
  }

  const server = createNetServer((socket: Socket) => {
    const st = stateOf(socket);
    socket.on('data', (chunk: Buffer) => {
      st.buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = st.buffer.indexOf('\n')) !== -1) {
        const line = st.buffer.slice(0, idx).trim();
        st.buffer = st.buffer.slice(idx + 1);
        if (!line) continue;
        // 单行上限：超限直接断开，防止无换行的大包把主进程内存吃满
        if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
          send(socket, jsonError(null, -32600, '消息过大（超出单行上限）'));
          socket.destroy();
          return;
        }
        try {
          const req = parsePayload(line);
          void handleRequest(socket, req);
        } catch (e) {
          console.error('[mcp] parseError', e, '|', line.slice(0, 200));
          send(socket, jsonError(null, -32700, '解析错误'));
        }
      }
      if (Buffer.byteLength(st.buffer, 'utf8') > maxLineBytes) {
        send(socket, jsonError(null, -32600, '消息过大（超出单行上限）'));
        socket.destroy();
      }
    });
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  let resolveReady!: (port: number) => void;
  let rejectReady!: (err: Error) => void;
  const ready = new Promise<number>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    const actual = addr && typeof addr === 'object' ? addr.port : port;
    console.log(`[mcp] 监听 127.0.0.1:${actual}（JSON-RPC over TCP，需 token）`);
    resolveReady(actual);
  });
  server.on('error', (err) => {
    console.error('[mcp] 启动失败', err.message);
    rejectReady(err);
  });

  return { ready, stop: () => { server.close(); } };
}
