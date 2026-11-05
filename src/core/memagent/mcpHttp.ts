// 标准 MCP（Model Context Protocol）streamable-http 服务器
// DSH 的 dsh-mcp-client 用标准 MCP 协议（initialize / tools/list / tools/call）连接，
// 而不是我们私有 TCP JSON-RPC。本端点暴露标准 MCP HTTP（POST /mcp，JSON 响应）。
// 复用 MemAgent 内核（storage 共享主进程 FileStorage），四个工具：
//   recall_memory / write_memory / list_projects / get_user_preferences
// 批次11/12/13：initialize 下发 MCP_INSTRUCTIONS（关键词触发召回 + 回显提示）；recall 结果末块加回显约束；
//         结果块顺序 = [display.line, 完整 JSON, display.markdown（四段折叠）, 展示要求]；
//         另附 structuredContent（含背景/省量/金额/折叠明细）。
import { createServer as httpCreateServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMemAgent } from './agent.ts';
import { InMemoryStorage } from './storage.ts';
import { JsVectorBackend } from './vector.ts';
import { FakeLlmProvider } from './llm.ts';
import { ulid } from './ulid.ts';
import { assertMcpToken, tokenEquals, tokenFromHeaders, DEFAULT_MCP_ACCOUNT, projectInScope, type McpAccount } from './mcpAuth.ts';
import { MCP_INSTRUCTIONS, MCP_TOOLS } from './mcpSchema.ts';
import { runListProjectsTool, runRecallTool, type RecallDisplayMode } from './mcpRecall.ts';
import { RecallDetailTickets } from './recallDetailTickets.ts';
import { buildRecallDetailExpiredPage } from './recallInsight.ts';
import { rejectUntrustedHost } from '../../shared/localOrigin.ts';
import type { StorageBackend, Pref, L0Port } from './types.ts';
import { CATEGORIES, isCategory } from './types.ts';

const PROTOCOL_VERSION = '2025-06-18';

/** 会话上限（防无限增长；超出后淘汰最早建立的会话） */
const MAX_CLIENT_SESSIONS = 256;

/** 截断/压平调用方标识，避免把超长头写进审计 */
export function normalizeClientLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** initialize.params.clientInfo → "name/version"（MCP 客户端自报，最可信） */
export function clientFromInitialize(params: Record<string, unknown>): string | undefined {
  const info = params.clientInfo;
  if (!info || typeof info !== 'object') return undefined;
  const name = (info as { name?: unknown }).name;
  const version = (info as { version?: unknown }).version;
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const label = `${name}${typeof version === 'string' && version.trim() ? `/${version.trim()}` : ''}`;
  return normalizeClientLabel(label);
}

/** User-Agent 兜底识别（客户端不维护会话时仍能区分主流 Agent；识别不出 → unknown） */
export function clientFromUserAgent(ua: string | undefined): string {
  if (!ua) return 'unknown';
  const low = ua.toLowerCase();
  const known: Array<[string, string]> = [
    ['qoder', 'Qoder'], ['claude', 'Claude Code'], ['codex', 'Codex'], ['cursor', 'Cursor'],
    ['gemini', 'Gemini CLI'], ['qwen', 'Qwen Code'], ['trae', 'Trae'], ['workbuddy', 'WorkBuddy'],
    ['zcode', 'Zcode'], ['deepseek', 'DeepSeek Harness'],
  ];
  const hit = known.find(([pattern]) => low.includes(pattern));
  return hit ? `${hit[1]} (UA)` : 'unknown';
}

/**
 * 批次41-S（方案 A）：UA 是否「有辨识度」——能否据它把「同 UA 最近一次 initialize 的自报名」
 * 归给当前这次调用。通用运行时 UA 一律判否：Node/Electron 的 fetch 默认发字面量 `node`，
 * curl、Python-urllib 等也是多客户端共用的运行时标识，凭它们归并身份会把甲客户端的调用
 * 记成乙客户端的自报名（本机 2026-11-04 实测串号，见 AGENTS §9 批次41-S）。
 * 命中下方前缀/相等即判否；含可识别厂商词（见 `clientFromUserAgent`）的一律判是。
 */
export function isIdentifiableUserAgent(ua: string | undefined): boolean {
  if (!ua) return false;
  const low = ua.trim().toLowerCase();
  if (!low) return false;
  // 明确无辨识度的通用运行时 UA：不相等/不前缀命中即视为有辨识度
  if (low === 'node') return false;
  const genericPrefixes = ['curl/', 'python-urllib/', 'wget/', 'go-http-client/', 'okhttp/', 'java/', 'axios/'];
  if (genericPrefixes.some((p) => low.startsWith(p))) return false;
  // 能认出具体客户端的 UA（含厂商词）保留；其余未知 UA 不作跨请求归并依据（fail-safe）
  return clientFromUserAgent(low) !== 'unknown';
}

/**
 * 批次41-S（方案 B）：自报名是否「已知客户端产品」——首段命中下表即认。
 * 用途：允许「UA 是通用运行时串（如 Electron 主进程发出的 `node`）、且不回传 `Mcp-Session-Id`」
 * 的**合法客户端**凭其在 `initialize` 里的自报名保住身份（否则会被 41-S 方案 A 一律降为 `unknown`，
 * 连带丢掉气泡内联折叠档——用户口径「能内联就内联，做不到才用 HTML 页兜底」）。
 * 与方案 A 的区别只在「信什么」：A 只信有辨识度的 UA；B 额外信**已知产品名**这一类自报名。
 * 任意/探测名（`verify-41r` 这种不在表里的）仍判否——既不覆盖别人的记录，也不会被归并出来。
 * 残留（诚实声明）：同一条通用 UA 键上，若已登记某已知产品，则后续「不带会话头、同 UA」的调用
 * 会被归并成那个产品（本机主要就是 Qoder 宿主一家用 `node`，风险有限；彻底消除需客户端回传会话头，属方案 C）。
 */
const TRUSTED_CLIENT_SELF_IDS = new Set([
  'qoder', 'qoder-cn', 'qoder-desktop-mcp-host', 'claude', 'claude-code', 'codex', 'cursor',
  'gemini', 'gemini-cli', 'qwen', 'qwen-code', 'trae', 'trae-cn', 'workbuddy',
  'zcode', 'deepseek', 'deepseek-harness', 'dsh-mcp-client',
]);
export function isTrustedClientSelfName(client: string | undefined): boolean {
  if (!client) return false;
  const seg = client.split('/')[0].trim().toLowerCase();
  return TRUSTED_CLIENT_SELF_IDS.has(seg);
}

/** 批次41-X：显式身份请求头名。一键接入会把本客户端的规范 id 写进这个头，
 *  于是每次调用都自带身份，不再依赖「同 UA 最近一次 initialize 的自报名」归并（41-S 方案 B 的残留串号）。 */
export const MCP_CLIENT_HEADER = 'x-memagent-client';

/** 允许进字符集之外的头值一律不采信（防把控制字符/超长串写进审计）。 */
const CLIENT_HEADER_VALUE_RE = /^[A-Za-z0-9 ._:/@+-]{1,64}$/;

/**
 * 批次41-X（方案 C）：从显式身份头取调用方身份。
 * 与 UA 归并的区别：这是**每次请求自己声明**的，不共用任何键，因此不存在「甲的调用记成乙」。
 * 仍是自报（不是鉴权，鉴权归令牌）：它只影响「这次调用记在谁名下 + 给哪一档展示格式」，
 * 冒充它拿不到额外数据。取不到/非法值 → undefined，交回原有 会话头 → UA → UA 识别 链，绝不因此拒服务。
 */
export function clientFromExplicitHeader(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const label = normalizeClientLabel(value);
  if (!label || !CLIENT_HEADER_VALUE_RE.test(label)) return undefined;
  return label;
}


export interface McpHttpOptions {
  storage?: StorageBackend;
  /** L0 写密钥端口（主进程 L0Vault）；缺省 → 写入诚实报 E_L0_LOCKED */
  l0?: L0Port;
  port?: number;
  host?: string;
  /** 必填：访问令牌（Authorization: Bearer / x-mcp-token） */
  token: string;
  /** 会话租户（客户端不得越过该 user_id）；缺省本机单用户 */
  account?: McpAccount;
  /** 请求体上限（字节），缺省 1 MiB */
  maxBodyBytes?: number;
  /**
   * 批次33-C：明细页访问回调（供主进程落一条动作日志，只给命中/未命中，不含 id 与正文）。
   * 缺省不记——内核/审计里没有明细正文，页面内容也绝不写进数据根。
   */
  onViewDetail?: (outcome: 'ok' | 'miss') => void;
}

export interface McpHttpHandle {
  /** 监听就绪后的实际端口（port:0 时由系统分配） */
  ready: Promise<number>;
  stop: () => void;
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** 结果末块：模型未必读 initialize.instructions，这里再要求一次展示方式。
 *  文案按本次实际下发的档位（批次32-C），与 display.markdown 严格一致：
 *  HTML 折叠版（实测渲染过 <details> 的 Qoder）/ 纯 Markdown 四小节（detail=true 主动要明细）/
 *  一行摘要 + 展开指引（其余客户端默认档，DSH 实测只渲染 Markdown 且 HTML 标签原样露出）。 */
export function recallEchoNote(mode: RecallDisplayMode): string {
  const keep = '数字与金额不得改写、省略或补全。';
  if (mode === 'html-details') {
    return '【展示要求】优先把上一条 display.markdown 整段（<details> 四段：项目背景/命中记忆/Token/省钱与费用，可逐段收起展开）原样输出到最终回答末尾；若客户端不渲染 HTML，则改为单独一行原样输出 display.line（以 🧠 Memory 开头的提示行）。两种方式都不得改写、省略或补全其中的 token 数与金额。';
  }
  if (mode === 'markdown-full') {
    return `【展示要求】本次是 detail=true 的明细返回：把上一条 display.markdown 整段（纯 Markdown 四个小节：项目背景/命中记忆/Token/省钱与费用）原样输出到最终回答末尾，不要给回答添加任何 HTML 标签。${keep}`;
  }
  return '【展示要求】本次按「默认收起 + 点击展开」下发：把上一条 display.markdown 整段原样输出到最终回答末尾'
    + '（两行 🧠 Memory 摘要 + 一行「▶ 展开本次召回明细」的 Markdown 链接），链接的 URL 必须逐字保留——用户点它才在本机明细页里看四段明细。'
    + '禁止自行补写命中条目、项目背景、Token 或费用明细，禁止把链接改写成纯文本/HTML 标签或自己编造 URL，也禁止替用户预先展开（不要因为觉得『这样更完整』而调用 detail=true）。'
    + '只有用户在聊天里明确要看明细时，才用同一个 query 再调用 recall_memory 并置 detail=true，然后原样输出那次返回的 display.markdown。'
    + '若客户端连 Markdown 链接都渲染不了（链接只是纯文本），照原样输出即可，不要改写摘要。'
    + `数字与金额不得改写、省略或补全。`;
}

/** 启动标准 MCP streamable-http 服务器 */
export function runMcpHttpServer(opts: McpHttpOptions): McpHttpHandle {
  const { port = 8204, host = '127.0.0.1', maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = opts;
  const token = assertMcpToken(opts.token);
  const account = opts.account ?? DEFAULT_MCP_ACCOUNT;
  const storage = opts.storage ?? new InMemoryStorage();
  const ma = createMemAgent({
    form: 'desktop',
    account,
    // 显式 stub 装配点：MCP HTTP 写入只落 L1
    llm: new FakeLlmProvider(),
    vector: new JsVectorBackend(),
    storage,
    l0: opts.l0,
  });

  /** 会话 → 调用方（批次15：initialize.clientInfo 自报）；客户端不维护会话时用 UA 兜底 */
  const clientBySession = new Map<string, string>();
  /** UA → 最近一次 initialize 的调用方（部分客户端每次请求不带 Mcp-Session-Id） */
  const clientByUa = new Map<string, string>();
  /**
   * 批次33-C：默认收起档的一次性明细页票据（id → 已渲染 HTML）。
   * 只在内存里，30 分钟过期、上限 200 条；不落数据根、不进审计，明细正文不外泄到 URL。
   */
  const detailTickets = new RecallDetailTickets<string>();
  /** 实际监听端口（port:0 时由系统分配）——明细页基址与 Host 校验都以它为准 */
  let servedPort = port;
  const detailBase = () => `http://${host}:${servedPort}`;
  const remember = (map: Map<string, string>, key: string, value: string) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > MAX_CLIENT_SESSIONS) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  };

  /** 执行单个 MCP 工具调用（tools/call 的参数 name + arguments）；text = 供聊天窗口回显的提示行 */
  async function callTool(name: string, args: Record<string, unknown>, client: string): Promise<{ result: unknown; text?: string }> {
    switch (name) {
      case 'recall_memory': {
        const out = await runRecallTool(ma, storage, args, undefined, client, account.scope_project_ids, {
          tickets: detailTickets, base: detailBase(),
        });
        return { result: out.payload, text: out.text };
      }
      case 'list_projects':
        return { result: await runListProjectsTool(storage, account.scope_project_ids) };
      case 'write_memory': {
        const p = args;
        if (!p.content || typeof p.content !== 'string') throw new Error('write_memory.content 必填');
        if (!p.project_id || typeof p.project_id !== 'string') throw new Error('write_memory.project_id 必填');
        // 令牌项目作用域（批次26-B P1-10）：'*' 全放行；否则只能写显式列出的项目
        if (!projectInScope(account.scope_project_ids, p.project_id)) {
          throw new Error(`当前 MCP 令牌作用域不含项目 ${p.project_id}（scope 校验，批次26-B P1-10）`);
        }
        // 租户闭包：客户端只能以会话身份写入，禁止冒用其它 user_id
        if (p.user_id !== undefined && String(p.user_id) !== account.user_id) {
          throw new Error('write_memory.user_id 与会话租户不一致（禁止跨租户写入）');
        }
        const category = p.category ?? 'pitfall';
        if (!isCategory(category)) {
          throw new Error(`write_memory.category 非法：${String(category)}（允许：${CATEGORIES.join('/')}）`);
        }
        // A5（§7.1）：来源 agent 必须显式标识，禁止依赖默认 'mcp'
        const sa = typeof p.source_agent === 'string' ? p.source_agent.trim().toLowerCase() : '';
        if (!sa || sa === 'mcp') {
          throw new Error('write_memory.source_agent 必填且须显式标识来源 agent（禁止依赖默认 mcp，命名见 §7.1）');
        }
        return {
          result: await ma.write({
            content: p.content,
            category,
            project_id: p.project_id,
            user_id: account.user_id,
            session_id: p.session_id ? String(p.session_id) : undefined,
            source_agent: sa,
          }),
        };
      }
      case 'get_user_preferences': {
        const p = args;
        if (!p.user_id || typeof p.user_id !== 'string') throw new Error('get_user_preferences.user_id 必填');
        // 租户闭包：只能读会话身份自己的偏好
        if (String(p.user_id) !== account.user_id) {
          throw new Error('get_user_preferences.user_id 与会话租户不一致（禁止跨租户读取）');
        }
        const out: Pref[] = await ma.getPrefs(account.user_id);
        // structuredContent 必须是 JSON 对象（MCP 规范），数组统一包一层 items
        return { result: { items: out } };
      }
      default:
        throw new Error(`未知工具 ${name}`);
    }
  }

  /** 处理一个 JSON-RPC 请求对象（MCP 单请求/单响应；不支持批量） */
  async function handleRpc(req: Record<string, unknown>, client: string): Promise<Record<string, unknown>> {
    const method = String(req.method ?? '');
    const id = ('id' in req ? (req.id as number | string | null | undefined) : null) ?? null;
    const params = (req.params && typeof req.params === 'object' ? req.params : {}) as Record<string, unknown>;
    const base = { jsonrpc: '2.0', id };

    switch (method) {
      case 'initialize':
        return {
          ...base,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'memagent-mcp', version: '1.0.0' },
            // 批次11：MCP 指令下发（关键词触发召回 + 原样回显 display.line + 不编造金额）
            instructions: MCP_INSTRUCTIONS,
          },
        };
      case 'notifications/initialized':
      case 'notifications/cancelled':
        // 通知无响应（JSON-RPC spec：notification 不回包）
        return { jsonrpc: '2.0', id: null, result: {} };
      case 'tools/list':
        return { ...base, result: { tools: MCP_TOOLS } };
      case 'tools/call': {
        const name = String(params.name ?? '');
        const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
        try {
          const out = await callTool(name, args, client);
          // recall 首块 = 提示行（兼容纯文本客户端），随后完整 JSON、折叠明细（批次13）；同时给 structuredContent。
          // 批次12：模型常忽略 initialize.instructions → 结果末块再给一次展示方式硬约束（Qoder 实测必需）。
          const markdown = (out.result as { display?: { markdown?: string } }).display?.markdown;
          const displayMode = ((out.result as { display?: { mode?: RecallDisplayMode } }).display?.mode) ?? 'markdown-compact';
          const content = out.text
            ? [
                { type: 'text', text: out.text },
                { type: 'text', text: JSON.stringify(out.result, null, 2) },
                { type: 'text', text: markdown ?? out.text },
                { type: 'text', text: recallEchoNote(displayMode) },
              ]
            : [{ type: 'text', text: JSON.stringify(out.result, null, 2) }];
          return {
            ...base,
            result: {
              content,
              structuredContent: out.result,
              isError: false,
            },
          };
        } catch (e) {
          return {
            ...base,
            result: {
              content: [{ type: 'text', text: `错误：${String((e as Error)?.message ?? e)}` }],
              isError: true,
            },
          };
        }
      }
      case 'ping':
        return { ...base, result: {} };
      default:
        return { ...base, error: { code: -32601, message: `method not found: ${method}` } };
    }
  }

  const server = httpCreateServer((req: IncomingMessage, res: ServerResponse) => {
    // MCP 是机器对机器协议：带 Origin 的请求来自浏览器上下文，一律拒绝（防任意网页驱动记忆库）
    if (req.headers.origin !== undefined) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'origin_not_allowed' } }));
      return;
    }
    // 只处理 POST /mcp（精确路径，`/mcpanything` 不再命中）
    const path = (req.url ?? '/').split('?')[0];

    // 批次33-C：GET /recall/<id> = 聊天里「▶ 展开本次召回明细」链接指向的一次性明细页。
    // 为什么可以不带令牌：MCP 令牌是机器级凭据，绝不下进聊天窗口/URL；此处改由 22 字符随机 id + 30 分钟过期把守，
    // 页面只回显这一次召回已经算好的数字（无新查询能力），并按 Host 绑定拒绝 DNS rebinding。
    if (req.method === 'GET' && (path === '/recall' || path.startsWith('/recall/'))) {
      if (rejectUntrustedHost(req, res, [servedPort])) return;
      const id = path.slice('/recall/'.length);
      const html = /^[A-Za-z0-9_-]{16,32}$/.test(id) ? detailTickets.take(id) : null;
      res.writeHead(html ? 200 : 404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; frame-ancestors 'none'; form-action 'none'",
      });
      res.end(html ?? buildRecallDetailExpiredPage());
      if (opts.onViewDetail) opts.onViewDetail(html ? 'ok' : 'miss');
      return;
    }

    if (req.method !== 'POST' || path !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (!tokenEquals(tokenFromHeaders(req.headers), token)) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized: 缺少或无效的 MCP token' } }));
      return;
    }

    let body = '';
    let size = 0;
    let rejected = false;
    req.on('data', (c: Buffer) => {
      if (rejected) return;
      size += c.length;
      if (size > maxBodyBytes) {
        rejected = true;
        // 不销毁连接（保留 keep-alive 语义），继续消费剩余数据但不再累积
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'payload_too_large' } }));
        return;
      }
      body += c.toString('utf8');
    });
    req.on('end', () => {
      if (rejected) return;
      void (async () => {
        try {
          const payload = JSON.parse(body) as Record<string, unknown>;
          const method = String(payload.method ?? '');
          const params = (payload.params && typeof payload.params === 'object' ? payload.params : {}) as Record<string, unknown>;
          const uaHeader = req.headers['user-agent'];
          const ua = typeof uaHeader === 'string' ? uaHeader : undefined;
          const sidHeader = req.headers['mcp-session-id'];
          const incomingSid = typeof sidHeader === 'string' ? sidHeader : '';
          // 批次41-X（方案 C）：显式身份头优先——一键接入写进配置的 X-Memagent-Client 每次请求都带，
          // 不共用 UA/会话这类「别人也会命中」的键，从根上消除 41-S 的跨客户端串号。
          const declaredClient = clientFromExplicitHeader(req.headers[MCP_CLIENT_HEADER]);
          // 批次15：initialize 时登记调用方并以 Mcp-Session-Id 关联后续 tools/call；
          // 客户端不带会话头时退化为「同 UA 最近一次 initialize」，再退化到 UA 识别。
          if (method === 'initialize') {
            const sid = ulid();
            const selfId = declaredClient ?? clientFromInitialize(params);
            if (selfId) {
              remember(clientBySession, sid, selfId);
              // 批次41-S（方案 B）：有辨识度 UA 才登记；或自报名本身是**已知客户端产品**也登记——
              // 让 Qoder 宿主这类「UA=`node`、不带会话头、但自报 qoder-desktop-mcp-host」的合法客户端
              // 保住气泡折叠档。任意/探测名（不在已知表里）仍不登记，从源头堵住被它抢注。
              // 批次41-X：显式带了身份头的客户端每次请求都自带身份，这条归并路径对它已无意义，
              // 所以不再按它的值去占通用 UA 那条键（那是 41-S 残留串号的来源）。
              const byUa = !declaredClient && ua
                && (isIdentifiableUserAgent(ua) || isTrustedClientSelfName(selfId));
              if (byUa) remember(clientByUa, ua, selfId);
            }
            res.setHeader('Mcp-Session-Id', sid);
          }
          // 取值顺序（批次41-X 起）：显式身份头 → 会话头 → （有辨识度 UA，或该 UA 上登记的自报名是已知产品）
          // 同 UA 最近一次 initialize → UA 识别。通用 UA 上若没登记过已知产品，仍落到 unknown。
          const uaCached = ua ? clientByUa.get(ua) : undefined;
          const client = declaredClient
            ?? clientBySession.get(incomingSid)
            ?? (ua && (isIdentifiableUserAgent(ua) || isTrustedClientSelfName(uaCached)) ? uaCached : undefined)
            ?? clientFromUserAgent(ua);

          const rpcResp = await handleRpc(payload, client);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(rpcResp));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `parse error: ${String((e as Error)?.message ?? e)}` } }));
        }
      })();
    });
  });

  let resolveReady!: (port: number) => void;
  let rejectReady!: (err: Error) => void;
  const ready = new Promise<number>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  server.listen(port, host, () => {
    const addr = server.address();
    const actual = addr && typeof addr === 'object' ? addr.port : port;
    servedPort = actual;
    console.log(`[mcp-http] 监听 http://${host}:${actual}/mcp（标准 MCP streamable-http，需 token）`
      + `；明细页 GET http://${host}:${actual}/recall/<一次性 id>（随机 id + 30 分钟过期，无需令牌）`);
    resolveReady(actual);
  });
  server.on('error', (err) => {
    console.error('[mcp-http] 启动失败', err.message);
    rejectReady(err);
  });
  return { ready, stop: () => { server.close(); } };
}
