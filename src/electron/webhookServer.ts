// Webhook HTTP 服务（批次26-A P0-4，从 main.ts 内联处理器抽出以便单测）：
// 信任边界 = MCP 同源令牌（userData/mcp-token.txt，Bearer/x-mcp-token）+ 受信页面 Origin 白名单
// + body 1 MiB 上限；/ingest/status 与 /ingest/hash 只回 id 与状态，绝不回 L2 正文。
// 旧实现只在「带 Origin 时」比对白名单 → 无 Origin 的本机任意进程可无限写记忆并读到精炼正文。
import { createServer, type Server, type ServerResponse } from 'node:http';
import { tokenEquals, tokenFromHeaders } from '../core/memagent/mcpAuth.ts';
import type { WebhookServer, IngestResult } from '../core/memagent/webhook.ts';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB，与 MCP HTTP 同规格
const MAX_STATUS_N = 100;

export interface WebhookServerOptions {
  /** 必填：MCP 访问令牌（与 8202/8204 同一真源 mcp-token.txt） */
  token: string;
  webhook: WebhookServer;
  /** 受信页面 Origin 白名单（带 Origin 的请求按此比对；无 Origin 一律要求令牌） */
  trustedOrigins: Set<string>;
  /** 拒绝/写盘等事件回调（main.ts 转 actionLog；绝不记令牌明文） */
  onLog?: (action: string, detail: Record<string, unknown>) => void;
}

/** status/hash 只回 id 与状态；l2_preview/正文一律剥掉 */
function sanitize(r: IngestResult): Record<string, unknown> {
  return {
    ok: r.ok,
    dedup: r.dedup,
    hash: r.hash,
    mem_id: r.mem_id,
    refined_by: r.refined_by,
    error: r.error,
    ts: r.ts,
  };
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function reject(opts: WebhookServerOptions, res: ServerResponse, action: string, detail: Record<string, unknown>, status: number, body: unknown): void {
  opts.onLog?.(action, detail);
  json(res, status, body);
}

export function createWebhookHttpServer(opts: WebhookServerOptions): Server {
  return createServer((req, res) => {
    const origin = req.headers.origin;
    // 同源闸门：带 Origin 且不在受信页面白名单 → 403（防任意网页 POST /ingest 写记忆）
    if (origin && !opts.trustedOrigins.has(origin)) {
      reject(opts, res, 'origin_rejected', { origin, method: req.method, path: (req.url ?? '/').split('?')[0] }, 403, { ok: false, error: 'origin_not_allowed' });
      return;
    }
    // 令牌闸门：无 Origin 也必须带令牌（本机任意进程不再是免检通道）
    if (!tokenEquals(tokenFromHeaders(req.headers), opts.token)) {
      reject(opts, res, 'token_rejected', { method: req.method, path: (req.url ?? '/').split('?')[0] }, 401, { ok: false, error: 'unauthorized: 缺少或无效的访问令牌（Bearer / x-mcp-token）' });
      return;
    }

    if (req.method === 'POST' && req.url === '/ingest') {
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      req.on('data', (c: Buffer) => {
        size += c.length;
        chunks.push(c);
        if (size > MAX_BODY_BYTES) {
          aborted = true;
          reject(opts, res, 'payload_too_large', { bytes: size }, 413, { ok: false, dedup: 'error', error: 'payload_too_large: 请求体超过 1 MiB 上限', ts: new Date().toISOString() });
          req.destroy();
        }
      });
      req.on('end', async () => {
        if (aborted) return;
        try {
          const event = JSON.parse(Buffer.concat(chunks).toString('utf8')) as import('../core/memagent/webhook.ts').IngestEvent;
          const r = await opts.webhook.ingest(event);
          // POST 响应回给「刚提交这条内容」的调用方，l2_preview 保留（调用方本就持有 L1 原文）
          json(res, r.ok ? 200 : 500, r);
        } catch (e) {
          json(res, 400, { ok: false, dedup: 'error', error: String((e as Error)?.message ?? e), ts: new Date().toISOString() });
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/ingest/status')) {
      const raw = Number(req.url.split('?')[1]?.split('=')[1] ?? '20');
      const n = Math.min(Math.max(Number.isFinite(raw) ? Math.floor(raw) : 20, 1), MAX_STATUS_N);
      json(res, 200, { ok: true, items: opts.webhook.recentStatus(n).map(sanitize) });
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/ingest/hash')) {
      const hash = req.url.split('?')[1]?.split('=')[1] ?? '';
      const hit = hash ? opts.webhook.lookupByHash(hash) : undefined;
      json(res, 200, { ok: true, found: !!hit, result: hit ? sanitize(hit) : undefined });
      return;
    }

    json(res, 404, { ok: false, error: 'not_found' });
  });
}
