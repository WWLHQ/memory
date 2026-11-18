// MCP 端点实测探活（2026-11-18，用户要求「实测连通」列 + 循环检测）。
//
// 为什么需要它：接入页原来的 `state` 是**读配置文件推出来的**（条目在不在、令牌长得像不像），
// 它回答不了「这个客户端拿这份令牌，现在真能调到工具吗」。令牌轮换后 7 个客户端全 401，
// 页面照样全绿——2026-11-18 实测踩到（47eb2f… / 17f0a5… 均已失效，只有 WorkBuddy 那份是新令牌）。
// 本模块只做一件事：拿某份令牌真的 POST 一次 `tools/list`，用**HTTP 状态码**说话。
//
// 纯 node http、无 electron 依赖，便于单测（注入 now / 超时）。
import { request } from 'node:http';

export interface McpLiveProbe {
  /** 能不能调通：HTTP 200 且解析出工具列表 */
  ok: boolean;
  /** HTTP 状态码；网络层失败（拒绝连接/超时）为 0 */
  status: number;
  /** 解析出的工具数量（ok 时才有） */
  tools?: number;
  /** 失败原因（人话，UI 直接显示） */
  error?: string;
  /** 探测时间（epoch ms） */
  at: number;
}

/** 从 streamable-http 响应体里取工具数量：兼容纯 JSON 与 SSE（`data: {...}` 多行） */
export function parseToolsCount(raw: string): number | null {
  const tryParse = (s: string): number | null => {
    try {
      const j = JSON.parse(s) as { result?: { tools?: unknown[] }; error?: { message?: unknown } };
      if (Array.isArray(j.result?.tools)) return j.result.tools.length;
      if (j.error) return null;
      return null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw.trim());
  if (direct !== null) return direct;
  // SSE：逐行取 data: 负载
  for (const line of raw.split(/\r?\n/)) {
    const m = /^data:\s*(\{.*)$/.exec(line.trim());
    if (!m) continue;
    const n = tryParse(m[1]);
    if (n !== null) return n;
  }
  return null;
}

/** 从响应体里取错误信息（401/403 时服务端会回 `unauthorized: ...`） */
function extractError(raw: string): string | undefined {
  const m = /"message"\s*:\s*"([^"]{1,200})"/.exec(raw);
  if (m) return m[1];
  const t = raw.trim();
  return t ? t.slice(0, 120) : undefined;
}

export interface ProbeOptions {
  /** 单次探测超时（毫秒），默认 1500：接入页 12–30 秒轮询，不能把 UI 拖住 */
  timeoutMs?: number;
  now?: () => number;
}

/** 拿 token 真的调一次 tools/list，用状态码判定连通性 */
export function probeMcpEndpoint(
  endpoint: string, token: string, options: ProbeOptions = {},
): Promise<McpLiveProbe> {
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? 1500;
  const at = now();
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

  return new Promise<McpLiveProbe>((resolve) => {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      resolve({ ok: false, status: 0, error: `端点不是合法 URL：${endpoint}`, at });
      return;
    }
    let settled = false;
    const done = (r: McpLiveProbe): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const req = request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${token}`,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        // 防御：异常端点回大文件时不要吃满内存
        if (chunks.reduce((s, b) => s + b.length, 0) < 512 * 1024) chunks.push(c);
      });
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 0;
        const tools = parseToolsCount(raw);
        if (status === 200 && tools !== null) {
          done({ ok: true, status, tools, at });
          return;
        }
        done({
          ok: false, status,
          error: status === 200 ? '响应里没有工具列表（端点可能不是 MCP）' : extractError(raw) ?? `HTTP ${status}`,
          at,
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, status: 0, error: `超时 ${timeoutMs}ms（服务未响应）`, at });
    });
    req.on('error', (e) => {
      done({ ok: false, status: 0, error: `连接失败：${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`, at });
    });
    req.write(body);
    req.end();
  });
}

/** 探活结果挂在客户端行上的字段（只加这两个，不动已有七态语义） */
export interface LiveProbeFields {
  /** 拿**该客户端配置里的令牌**实测的结果；无稳定配置文件时为 undefined（不冒充「通了」） */
  live?: McpLiveProbe;
  /** 令牌与当前 mcp-token.txt 的关系：live=一致 / stale=配置里的令牌已失效 / unknown=读不到 */
  tokenState?: 'live' | 'stale' | 'unknown';
}

export interface LiveProbeTarget extends LiveProbeFields {
  id: string;
}

/**
 * 给每个客户端挂上实测结果：同一份令牌只探一次（多数客户端共用同一个令牌，7 个客户端≈1–2 次请求）。
 * 没有可读令牌（配置存应用内部/只能手工接入）→ 不探、不给 live，UI 如实显示「—」。
 */
export async function attachLiveProbe(
  clients: LiveProbeTarget[],
  resolveToken: (id: string) => string | null,
  options: { endpoint: string; currentToken?: string; timeoutMs?: number; now?: () => number } = { endpoint: '' },
): Promise<{ checked: number; failed: number; server?: McpLiveProbe }> {
  const cache = new Map<string, McpLiveProbe>();
  let checked = 0;
  let failed = 0;
  for (const c of clients) {
    const token = resolveToken(c.id);
    if (!token) { c.tokenState = 'unknown'; continue; }
    let live = cache.get(token);
    if (!live) {
      live = await probeMcpEndpoint(options.endpoint, token, {
        timeoutMs: options.timeoutMs, now: options.now,
      });
      cache.set(token, live);
    }
    c.live = live;
    c.tokenState = live.ok ? 'live' : live.status === 401 ? 'stale' : 'unknown';
    checked += 1;
    if (!live.ok) failed += 1;
  }
  const current = options.currentToken?.trim();
  const server = current ? cache.get(current) : undefined;
  return { checked, failed, ...(server ? { server } : {}) };
}
