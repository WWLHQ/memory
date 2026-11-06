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
import { assertMcpToken, DEFAULT_MCP_ACCOUNT, projectInScope, type McpAccount } from './mcpAuth.ts';
import { resolveAccountFor, type TokenStorePort } from './tokenStore.ts';
import type { MemberStorePort } from './memberStore.ts';
import { MCP_INSTRUCTIONS, MCP_TOOLS } from './mcpSchema.ts';
import { McpToolError, runListProjectsTool, runRecallTool } from './mcpRecall.ts';
import type { StorageBackend, Pref, L0Port, MemReq, WriteResult } from './types.ts';
import { CATEGORIES, isCategory } from './types.ts';
import { parseWriteKnobs } from './memories.ts';
import { isL0LockedError } from './errors.ts';
import { MemoryPendingStore, type PendingStore, type WriteKnobs } from './pendingWrites.ts';
import { runGetMemoryTool, runListMemoriesTool } from './mcpReadTools.ts';
import { deleteAllowed, runFeedbackTool, runManageMemoryTool } from './mcpManageTools.ts';
import { runGcReportTool } from './mcpGcTools.ts';
import { runCreateProjectTool, runMintTokenTool } from './mcpProjectTools.ts';

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
  constructor(account: McpAccount, storage?: StorageBackend, l0?: L0Port, pending?: PendingStore) {
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
      // 批次44-D4：跨 socket 共享同一 pending 队列，避免多连接各自暂存互不重放
      pending,
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
  /** 会话租户（客户端不得越过该 user_id）；缺省本机单用户。D6-4 起为**引导令牌**的账户；
   *  库令牌（tokenStore 签发）按各自记录解析账户。 */
  account?: McpAccount;
  /** D6-4 令牌代理：受限令牌库（缺省无库 = 仅引导令牌可用，现状行为不变） */
  tokenStore?: TokenStorePort;
  /** 批次45-B3：成员 API 密钥库（apk_）——鉴权链第三环；缺省未装配 = 仅引导/令牌库可用（现状不变） */
  memberStore?: MemberStorePort;
  /** 单行 JSON 上限（字节），缺省 1 MiB */
  maxLineBytes?: number;
  /** 批次44-D4：共享 pending 队列存储端口；缺省内存实现，桌面建议注入 FilePendingStore */
  pending?: PendingStore;
  /** 批次44-D5-2：是否放行 manage_memory(action=delete)；缺省读环境变量 MCP_ALLOW_DELETE=1 */
  allowDelete?: boolean;
}

export interface McpServerHandle {
  /** 监听就绪后的实际端口（port:0 时由系统分配） */
  ready: Promise<number>;
  stop: () => void;
}

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

interface SocketState {
  authed: boolean;
  /** D6-4：鉴权成功后按令牌解析出的会话账户（引导令牌 → 引导账户；库令牌 → 库账户） */
  account: McpAccount | null;
  session: Session | null;
  buffer: string;
}

export function runMcpServer(opts: McpOptions): McpServerHandle {
  const token = assertMcpToken(opts.token);
  const { port = 8202, maxLineBytes = DEFAULT_MAX_LINE_BYTES, account = DEFAULT_MCP_ACCOUNT } = opts;
  const sockets = new WeakMap<Socket, SocketState>();
  // 批次44-D4：所有 socket 共享一个 pending 队列（缺省内存；桌面可注入文件实现持久化）
  const sharedPending: PendingStore = opts.pending ?? new MemoryPendingStore();
  // 批次44-D5-2：delete 门禁在启动时定一次，两端同判据（显式注入 > 环境变量）
  const allowDelete = opts.allowDelete ?? deleteAllowed();

  function stateOf(socket: Socket): SocketState {
    let st = sockets.get(socket);
    if (!st) {
      st = { authed: false, account: null, session: null, buffer: '' };
      sockets.set(socket, st);
    }
    return st;
  }

  function sessionOf(socket: Socket): Session {
    const st = stateOf(socket);
    if (!st.session) {
      // D6-4：会话账户 = 鉴权时解析出的账户（st.account 已在鉴权点赋值，兜底引导账户防御）
      st.session = new Session(st.account ?? account, opts.storage, opts.l0, sharedPending);
    }
    return st.session;
  }

  async function handleRequest(socket: Socket, req: JsonRpcRequest): Promise<void> {
    try {
      const { method, params } = req;
      const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;

      // 鉴权：首个请求必须带 token（initialize/任意方法均可），之后该 socket 保持授权。
      // D6-4：令牌 → 账户按库解析（引导令牌 → 引导账户；库令牌 → 各自 scope/is_admin/user_id；
      // 未配置库时仅引导令牌可用 = 现状行为不变）。
      const st = stateOf(socket);
      if (!st.authed) {
        const resolved = resolveAccountFor(typeof p.token === 'string' ? p.token : undefined, {
          serverToken: token, store: opts.tokenStore, bootstrap: account, memberStore: opts.memberStore,
        });
        if (!resolved) {
          send(socket, jsonError(req.id, -32001, 'unauthorized: 缺少或无效的 MCP token'));
          return;
        }
        st.account = resolved;
        st.authed = true;
      }

      const sess = sessionOf(socket);
      const s = sess.ma;
      const sessionStorage = sess.storage;
      const acct = sess.account; // D6-4：会话账户（每 socket 各自，不再全局共享）
      const sessionUser = acct.user_id;

      switch (method) {
        // ── recall_memory ──────────────────────────────────────────────
        case 'recall_memory': {
          // 批次11：project_id 可省略（唯一项目自动定位）；返回背景/省量/金额提示
          const out = await runRecallTool(s, sessionStorage, p, undefined, undefined, acct);
          send(socket, ok(req.id, out.payload));
          return;
        }

        // ── list_projects ──────────────────────────────────────────────
        case 'list_projects': {
          send(socket, ok(req.id, await runListProjectsTool(sessionStorage, acct)));
          return;
        }

        // ── write_memory ───────────────────────────────────────────────
        case 'write_memory': {
          if (!p.project_id || typeof p.project_id !== 'string') {
            send(socket, jsonError(req.id, -32602, 'write_memory.project_id 必填（R2）'));
            return;
          }
          // 三池可见性门禁（D6-2）：shared 恒可见 / user 仅 owner 或 admin / archive 仅 admin / general 按令牌 scope 列表
          if (!projectInScope(acct, p.project_id)) {
            send(socket, jsonError(req.id, -32602, `当前 MCP 令牌作用域不含项目 ${p.project_id}（三池可见性校验，D6-2）`));
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
          // A4（§2.3）：扩展打分旋钮（可选；未传 → 记录不带该字段，scoreMemory 走默认 0.5）
          const { knobs, error: knobError } = parseWriteKnobs(p);
          if (knobError) {
            send(socket, jsonError(req.id, -32602, knobError));
            return;
          }
          const writeReq: MemReq & WriteKnobs = {
            content: p.content,
            category,
            project_id: p.project_id,
            user_id: sessionUser,
            session_id: p.session_id ? String(p.session_id) : undefined,
            source_agent: sa,
            ...knobs,
          };
          // A3 / 批次44-D4：L0 锁定时不丢——暂存 pending 队列，解锁后自动重放落库。
          // 诚实降级：绝不伪造 mem_id，也不把「未解锁」伪装成写入成功。
          let result: WriteResult;
          try {
            result = await s.write(writeReq);
          } catch (e) {
            if (!isL0LockedError(e)) throw e;
            const pending_id = await s.enqueuePending(writeReq);
            send(socket, ok(req.id, {
              status: 'pending',
              pending_id,
              reason: 'E_L0_LOCKED',
              message: 'L0 写密钥未解锁：本次写入已暂存 pending 队列，解锁后自动重放落库。这不是写入成功，请勿据此认为已落库。',
            }));
            return;
          }
          // 解锁后自动重放：本次写入成功（必然已解锁），顺带清空历史 pending 条目
          const replay = await s.flushPending();
          send(socket, ok(req.id, replay.flushed > 0 ? { ...result, replayed_pending: replay.flushed } : result));
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

        // ── get_write_status（批次44-D4：写前探锁 + 解锁态顺带重放） ──────
        case 'get_write_status': {
          send(socket, ok(req.id, await s.getWriteStatus()));
          return;
        }

        // ── list_memories / get_memory（批次44-D5-1：治理盘点 + 精确读） ──
        case 'list_memories': {
          send(socket, ok(req.id, await runListMemoriesTool(sessionStorage, p, acct)));
          return;
        }
        case 'get_memory': {
          send(socket, ok(req.id, await runGetMemoryTool(sessionStorage, p, acct)));
          return;
        }

        // ── feedback / manage_memory（批次44-D5-2：反馈与生命周期治理） ──
        case 'feedback': {
          send(socket, ok(req.id, await runFeedbackTool(s, sessionStorage, p, acct)));
          return;
        }
        case 'manage_memory': {
          send(socket, ok(req.id, await runManageMemoryTool(s, sessionStorage, p, acct, { allowDelete })));
          return;
        }
        // ── gc_report（批次44-D5-3：遗忘周期报告，默认只演算） ──
        case 'gc_report': {
          send(socket, ok(req.id, await runGcReportTool(s, p, acct)));
          return;
        }

        // ── create_project / mint_token（D6-5：管理员专属管理工具） ──
        case 'create_project': {
          send(socket, ok(req.id, await runCreateProjectTool(sessionStorage, p, acct)));
          return;
        }
        case 'mint_token': {
          send(socket, ok(req.id, await runMintTokenTool(opts.tokenStore, p, acct)));
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
