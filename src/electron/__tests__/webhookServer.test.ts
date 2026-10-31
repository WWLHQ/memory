// Webhook HTTP 服务测试（批次26-A P0-4）：真实端口 0 起服务，覆盖 正常 / 拒绝（无令牌/坏令牌/坏来源/超大 body）/ 边界（status 脱敏与 n 钳制 / hash 未命中 / 404）。
import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { createWebhookHttpServer } from '../webhookServer.ts';
import type { WebhookServer, IngestResult, IngestEvent } from '../../core/memagent/webhook.ts';

const TOKEN = 'a'.repeat(64);
const ORIGINS = new Set(['http://127.0.0.1:5180']);

function fakeWebhook(over: Partial<WebhookServer> = {}): WebhookServer {
  const sample: IngestResult = {
    ok: true, dedup: 'new', hash: 'h1', mem_id: 'm1',
    l2_preview: 'L2 机密摘要正文——绝不能出现在 status/hash 响应',
    refined_by: 'stub', ts: '2026-10-31T08:00:00.000Z',
  };
  const recent = [sample];
  return {
    ingest: over.ingest ?? (async (e: IngestEvent) => ({ ...sample, hash: `h-${e.content?.length ?? 0}` })),
    recentStatus: over.recentStatus ?? (() => recent),
    lookupByHash: over.lookupByHash ?? ((h: string) => (h === 'h1' ? sample : undefined)),
  } as WebhookServer;
}

let server: Server | undefined;
afterEach(() => new Promise<void>((res) => {
  if (!server) { res(); return; }
  server.close(() => { server = undefined; res(); });
}));

function start(wh: WebhookServer, onLog?: (a: string, d: Record<string, unknown>) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    server = createWebhookHttpServer({ token: TOKEN, webhook: wh, trustedOrigins: ORIGINS, onLog });
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      if (typeof addr === 'object' && addr) resolve(addr.port);
      else reject(new Error('no port'));
    });
    server.on('error', reject);
  });
}

function call(port: number, path: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: body !== undefined ? 'POST' : 'GET', headers }, (r) => {
      let text = '';
      r.on('data', (c) => { text += c; });
      r.on('end', () => resolve({ status: r.statusCode ?? 0, text }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('createWebhookHttpServer · 令牌闸门（批次26-A P0-4）', () => {
  it('无令牌 + 无 Origin（curl/本机进程场景）→ 401，ingest 不被调用', async () => {
    const wh = fakeWebhook();
    const ingest = vi.fn(wh.ingest);
    wh.ingest = ingest as typeof wh.ingest;
    const port = await start(wh);
    const r = await call(port, '/ingest', { 'Content-Type': 'application/json' }, JSON.stringify({ content: 'x' }));
    expect(r.status).toBe(401);
    expect(JSON.parse(r.text).error).toContain('令牌');
    expect(ingest).not.toHaveBeenCalled();
  });

  it('错误令牌 → 401', async () => {
    const port = await start(fakeWebhook());
    const r = await call(port, '/ingest', { 'x-mcp-token': 'b'.repeat(64) }, JSON.stringify({ content: 'x' }));
    expect(r.status).toBe(401);
  });

  it('受信 Origin 但无令牌 → 401（Origin 合法不豁免令牌）', async () => {
    const port = await start(fakeWebhook());
    const r = await call(port, '/ingest/status', { Origin: 'http://127.0.0.1:5180' });
    expect(r.status).toBe(401);
  });

  it('不受信 Origin → 403（原闸门保留）', async () => {
    const port = await start(fakeWebhook());
    const r = await call(port, '/ingest/status', { Origin: 'http://evil.example:80', 'x-mcp-token': TOKEN });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.text).error).toBe('origin_not_allowed');
  });

  it('正确令牌（Bearer）POST /ingest → 200 真实结果', async () => {
    const port = await start(fakeWebhook());
    const r = await call(port, '/ingest', { Authorization: `Bearer ${TOKEN}` }, JSON.stringify({ content: 'hello' }));
    expect(r.status).toBe(200);
    const j = JSON.parse(r.text) as IngestResult;
    expect(j.ok).toBe(true);
    expect(j.mem_id).toBe('m1');
  });

  it('body 超 1 MiB → 413，ingest 不被调用', async () => {
    const wh = fakeWebhook();
    const ingest = vi.fn(wh.ingest);
    wh.ingest = ingest as typeof wh.ingest;
    const port = await start(wh);
    const r = await call(port, '/ingest', { 'x-mcp-token': TOKEN }, JSON.stringify({ content: 'x'.repeat(1024 * 1024 + 10) }));
    expect(r.status).toBe(413);
    expect(JSON.parse(r.text).error).toContain('1 MiB');
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('createWebhookHttpServer · status/hash 只回 id 与状态', () => {
  it('GET /ingest/status → 不含 l2_preview，保留 mem_id/dedup/hash', async () => {
    const port = await start(fakeWebhook());
    const r = await call(port, '/ingest/status?n=5', { 'x-mcp-token': TOKEN });
    expect(r.status).toBe(200);
    const j = JSON.parse(r.text) as { items: IngestResult[] };
    expect(j.items).toHaveLength(1);
    expect(JSON.stringify(j.items)).not.toContain('l2_preview');
    expect(JSON.stringify(j.items)).not.toContain('L2 机密摘要正文');
    expect(j.items[0].mem_id).toBe('m1');
    expect(j.items[0].dedup).toBe('new');
  });

  it('GET /ingest/hash → 命中时脱敏返回；未命中 found=false', async () => {
    const port = await start(fakeWebhook());
    const hit = await call(port, '/ingest/hash?=h1', { 'x-mcp-token': TOKEN });
    expect(hit.status).toBe(200);
    const hj = JSON.parse(hit.text) as { found: boolean; result?: IngestResult };
    expect(hj.found).toBe(true);
    expect(JSON.stringify(hj)).not.toContain('L2 机密摘要正文');
    expect(hj.result?.mem_id).toBe('m1');

    const miss = await call(port, '/ingest/hash?=nope', { 'x-mcp-token': TOKEN });
    const mj = JSON.parse(miss.text) as { found: boolean; result?: unknown };
    expect(mj.found).toBe(false);
    expect(mj.result).toBeUndefined();
  });

  it('status n 钳制 1..100', async () => {
    const seen: number[] = [];
    const wh = fakeWebhook({ recentStatus: (n?: number) => { seen.push(n ?? -1); return []; } });
    const port = await start(wh);
    await call(port, '/ingest/status?n=99999', { 'x-mcp-token': TOKEN });
    await call(port, '/ingest/status?n=0', { 'x-mcp-token': TOKEN });
    expect(seen).toEqual([100, 1]);
  });

  it('未知路径 → 404；拒绝事件走 onLog（不含令牌）', async () => {
    const logs: [string, Record<string, unknown>][] = [];
    const port = await start(fakeWebhook(), (a, d) => logs.push([a, d]));
    const nf = await call(port, '/other', { 'x-mcp-token': TOKEN });
    expect(nf.status).toBe(404);
    const r = await call(port, '/ingest/status');
    expect(r.status).toBe(401);
    expect(logs.some(([a]) => a === 'token_rejected')).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });
});
