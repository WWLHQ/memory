// 批次62 UI 开关 · B：应用内置 LLM 网关（OpenAI-compatible 反向代理）。
// 与 tools/recall-gateway.mjs（独立 CLI 版）共用 src/core/memagent/recallPrelude.ts 的**同一份**拼装规则，
// 避免两份注入逻辑漂移。区别只在本模块由主进程按需启停、可运行时切换，且不再依赖外部 node 脚本。
//
// 链路：客户端 base_url → 127.0.0.1:<port> → [取最后一条 user 文本 → 8204 MCP 强制召回]
//       → 改写 messages[0].system（prelude 置顶）→ 转发上游 LLM；响应流式 pipe 原样回传。
// 安全：令牌只发 loopback；客户端自己的上游 Authorization 透传但绝不打印/落盘；
//       MCP 故障 / 超时 / 坏 JSON 一律 fail-open 原样转发，绝不阻断对话。
import { createServer, request as httpRequest, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  parseMcpRpcBody, extractRecallHits, buildRecallPrelude,
  lastUserQuery, injectSystemPrelude, MAX_QUERY_CHARS,
} from '../core/memagent/recallPrelude.ts';
import { recallHardBaseUrl, validRecallUpstream } from '../shared/recallHardConfig.ts';

const DEFAULT_MCP_URL = 'http://127.0.0.1:8204/mcp';
const DEFAULT_TIMEOUT_MS = 2500;
const CHAT_PATH_RE = /^\/(?:v1\/)?chat\/completions\/?$/;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface RecallGatewayOptions {
  port: number;
  upstream: string;
  mcpUrl?: string;
  mcpToken?: string;
  timeoutMs?: number;
  /** 测试注入：替换真实的 8204 召回（返回 MCP tools/call 的原始响应文本） */
  recallRaw?: (query: string) => Promise<string | null>;
}

export interface RecallGatewayHandle {
  port: number;
  upstream: string;
  baseUrl: string;
  stop: () => Promise<void>;
}

function defaultTokenFile(): string {
  const appdata = process.env.APPDATA || process.env.LOCALAPPDATA;
  if (appdata) return join(appdata, 'MultiAgent Memory', 'mcp-token.txt');
  return join(homedir(), '.config', 'multiagent-memory', 'mcp-token.txt');
}

export function isLoopback(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch { return false; }
}

/** 纯函数：把 prelude 注入请求体。供单测与主进程共用，不依赖网络。 */
export function rewriteRequest<T extends { messages?: unknown }>(body: T, prelude: string | null): { body: T; injected: boolean } {
  if (!prelude || !body || typeof body !== 'object' || !Array.isArray(body.messages)) {
    return { body, injected: false };
  }
  const messages = body.messages as Parameters<typeof injectSystemPrelude>[0];
  const next = injectSystemPrelude(messages, prelude);
  const injected = JSON.stringify(next) !== JSON.stringify(messages);
  return { body: { ...body, messages: next } as T, injected };
}

async function rpc(url: string, token: string, payload: unknown, sid: string | undefined, timeoutMs: number): Promise<{ sid: string; raw: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${token}`,
    'x-memagent-client': 'recall-gateway-inproc',
  };
  if (sid) headers['Mcp-Session-Id'] = sid;
  const res = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`mcp http ${res.status}`);
  return { sid: res.headers.get('Mcp-Session-Id') ?? '', raw: await res.text() };
}

/** 召回 → prelude；任何失败返回 null（fail-open），绝不抛到转发主链路。 */
export async function fetchPrelude(query: string, opts: RecallGatewayOptions): Promise<string | null> {
  try {
    const q = (query || '').trim().slice(0, MAX_QUERY_CHARS);
    if (!q) return null;
    if (opts.recallRaw) {
      const raw = await opts.recallRaw(q);
      return raw ? buildRecallPrelude(extractRecallHits(parseMcpRpcBody(raw))) : null;
    }
    const url = opts.mcpUrl || process.env.MEMAGENT_MCP_URL || DEFAULT_MCP_URL;
    if (!isLoopback(url)) return null;
    const token = opts.mcpToken ?? (await readFile(defaultTokenFile(), 'utf8')).trim();
    if (!token) return null;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const init = await rpc(url, token, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-06-18', capabilities: {},
        clientInfo: { name: 'recall-gateway-inproc', version: '1.0' },
      },
    }, undefined, timeoutMs);
    const recall = await rpc(url, token, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'recall_memory', arguments: { query: q, top_k: 5, scene: 'task_start' } },
    }, init.sid, timeoutMs);
    const parsed = parseMcpRpcBody(recall.raw);
    if (!parsed) return null;
    return buildRecallPrelude(extractRecallHits(parsed));
  } catch {
    return null;
  }
}

async function readBody(req: IncomingMessage): Promise<{ text: string; json: Record<string, unknown> | null }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = c as Buffer;
    size += b.length;
    if (size > MAX_BODY_BYTES) throw new Error('body too large');
    chunks.push(b);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try { return { text, json: text ? JSON.parse(text) as Record<string, unknown> : null }; }
  catch { return { text, json: null }; }
}

function forward(req: IncomingMessage, res: ServerResponse, upstream: string, bodyText: string | undefined): void {
  let target: URL;
  try { target = new URL(req.url || '/', upstream); }
  catch { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"bad upstream"}'); return; }
  const client = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const outHeaders: Record<string, string | string[]> = { ...req.headers } as Record<string, string | string[]>;
  // 上游密钥原样透传，但绝不打印 / 落盘；删掉这几项让上游返回未压缩流，便于流式透传。
  delete outHeaders.host;
  delete outHeaders['content-length'];
  delete outHeaders['accept-encoding'];
  if (bodyText !== undefined) outHeaders['content-length'] = String(Buffer.byteLength(bodyText));
  const proxy = client(target, { method: req.method, headers: outHeaders }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res); // 流式原样透传（SSE 不缓冲、不改写）
  });
  proxy.on('error', () => {
    if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"gateway upstream failure"}'); }
    else res.destroy();
  });
  proxy.setTimeout(120000, () => proxy.destroy(new Error('upstream timeout')));
  if (bodyText !== undefined) proxy.write(bodyText);
  proxy.end();
}

export async function startRecallGateway(opts: RecallGatewayOptions): Promise<RecallGatewayHandle> {
  if (!validRecallUpstream(opts.upstream)) throw new Error('上游地址必须是 http/https 绝对地址');
  const server: Server = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      const isChat = req.method === 'POST' && CHAT_PATH_RE.test(pathname);
      let bodyText: string | undefined;
      try {
        const { text, json } = await readBody(req);
        bodyText = text;
        if (isChat && json && Array.isArray(json.messages)) {
          const prelude = await fetchPrelude(lastUserQuery(json.messages), opts);
          const out = rewriteRequest(json, prelude);
          if (out.injected) bodyText = JSON.stringify(out.body);
        }
      } catch {
        // 坏 JSON / 超长 / 召回异常：fail-open，用原始 body 原样转发
      }
      forward(req, res, opts.upstream, bodyText);
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return {
    port: opts.port,
    upstream: opts.upstream,
    baseUrl: recallHardBaseUrl(opts.port),
    stop: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}
