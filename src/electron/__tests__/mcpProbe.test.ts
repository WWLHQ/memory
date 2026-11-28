// 实测连通（2026-11-18）的回归锁。
// 变异锚点：① parseToolsCount 把 SSE 分支删掉 → SSE 用例红；② attachLiveProbe 去掉同令牌去重 → 请求数 != 1；
// ③ probe 把 401 当成 ok → 「令牌过期」用例红。这三条正是「页面全绿但全 401」那类事故的判据。
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { attachLiveProbe, parseToolsCount, probeMcpEndpoint } from '../mcpProbe.ts';

describe('parseToolsCount', () => {
  it('纯 JSON 响应取 result.tools.length', () => {
    expect(parseToolsCount(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'a' }, { name: 'b' }] } }))).toBe(2);
  });

  it('streamable-http 的 SSE 响应（data: 行）同样能取到', () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"a"}]}}\n\n';
    expect(parseToolsCount(sse)).toBe(1);
  });

  it('错误响应 / 非 MCP 内容 → null（不把别的东西当工具列表）', () => {
    expect(parseToolsCount('{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"unauthorized"}}')).toBeNull();
    expect(parseToolsCount('<html>404</html>')).toBeNull();
    expect(parseToolsCount('')).toBeNull();
  });
});

describe('probeMcpEndpoint（真起一个本地 HTTP 服务打）', () => {
  let server: Server | null = null;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  });

  async function start(handler: (auth: string | undefined, res: import('node:http').ServerResponse) => void): Promise<string> {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => handler(req.headers.authorization, res));
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const addr = server!.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return `http://127.0.0.1:${port}/mcp`;
  }

  it('令牌有效 → ok=true，带工具数（HTTP 200）', async () => {
    const url = await start((auth, res) => {
      if (auth !== 'Bearer good') { res.writeHead(401); res.end('{"error":{"message":"unauthorized"}}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } }));
    });
    const r = await probeMcpEndpoint(url, 'good');
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.tools).toBe(3);
  });

  it('令牌过期 → ok=false、status=401、带服务端原话（这就是「配置里看着像、调起来不通」）', async () => {
    const url = await start((auth, res) => {
      if (auth !== 'Bearer good') { res.writeHead(401); res.end('{"error":{"message":"unauthorized: 缺少或无效的 MCP token"}}'); return; }
      res.writeHead(200); res.end('{}');
    });
    const r = await probeMcpEndpoint(url, 'stale-token');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.error).toContain('unauthorized');
  });

  it('服务没起 → ok=false、status=0，错误里带连接原因（不抛异常）', async () => {
    const r = await probeMcpEndpoint('http://127.0.0.1:1/mcp', 'x', { timeoutMs: 300 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(typeof r.error).toBe('string');
  });
});

describe('attachLiveProbe（按客户端挂实测结果）', () => {
  it('同一份令牌只探一次；过期令牌标 stale；无令牌标 unknown 且不给 live', async () => {
    let hits = 0;
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        hits += 1;
        const auth = req.headers.authorization ?? '';
        if (auth !== 'Bearer live-token') { res.writeHead(401); res.end('{"error":{"message":"unauthorized"}}'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'recall_memory' }] } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    const endpoint = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/mcp`;

    const clients = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] as Array<{ id: string; live?: unknown; tokenState?: string }>;
    const tokens: Record<string, string | null> = { a: 'live-token', b: 'live-token', c: 'stale-token', d: null };
    const r = await attachLiveProbe(clients as never, (id) => tokens[id] ?? null, {
      endpoint, currentToken: 'live-token',
    });
    expect(hits).toBe(2); // live-token 一次 + stale-token 一次，a/b 共用同一份不重复打
    expect(r.checked).toBe(3);
    expect(r.failed).toBe(1);
    expect(r.server?.ok).toBe(true);
    expect(clients[0].tokenState).toBe('live');
    expect(clients[2].tokenState).toBe('stale');
    expect(clients[3].tokenState).toBe('unknown');
    expect(clients[3].live).toBeUndefined();
    await new Promise<void>((res) => server.close(() => res()));
  });

  it('按令牌来源标口径：同令牌复用时各自 via 不互相覆盖（config / host / current）', async () => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'recall_memory' }, { name: 'write_memory' }] } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    const endpoint = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/mcp`;

    const clients = [{ id: 'cfg' }, { id: 'host' }, { id: 'manual' }] as Array<{ id: string; live?: unknown }>;
    const vias: Record<string, 'config' | 'host' | 'current'> = { cfg: 'config', host: 'host', manual: 'current' };
    await attachLiveProbe(
      clients as never,
      () => 'same-token',
      { endpoint, currentToken: 'same-token' },
      (id) => vias[id],
    );
    const seen = clients.map((c) => (c.live as { via?: string; tools?: number }));
    expect(seen.map((l) => l.via)).toEqual(['config', 'host', 'current']);
    expect(seen.every((l) => l.tools === 2)).toBe(true);
    await new Promise<void>((res) => server.close(() => res()));
  });
});
