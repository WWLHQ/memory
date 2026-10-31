// T14 验收：AgentOnboardClient 经 HTTP 调 T13 服务，全链路 + 审计持久化跨重启；非法配置返回 violations。
// 批次26 P0-5：客户端在拿到会话 id 时自动带 x-session-id 头（写端点后端强制校验）。
import assert from 'node:assert/strict';
import { createServer } from '../server.ts';
import { AgentOnboardClient } from '../client.ts';
import type { AgentProbe } from '../service.ts';
import type { TenantContext } from '../../types/home.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 测试注入真实探测（命中本机安装证据；server 默认探测会扫真机） */
const probeOk: AgentProbe = (names) =>
  new Map(names.map((n) => [n, { ok: true, reason: `命中「${n}」本机安装证据（测试注入）` }]));

/** 批次26：会话真源（admin）+ 客户端会话读取器 */
function adminSessions() {
  const adminSid = 'sid-admin';
  const sessions = new Map<string, TenantContext>([
    [adminSid, { enterprise_id: 'e1', team_id: 't1', user_id: 'admin-1', perspective: 'team', session_id: adminSid, role: 'admin' }],
  ]);
  return {
    adminSid,
    getSession: (sid: string | undefined) => (sid ? sessions.get(sid) ?? null : null),
    reader: () => adminSid,
  };
}

test('HTTP 客户端全链路 + 审计持久化跨重启', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ab-client-'));
  const dataFile = join(dir, 'a.json');
  const s = adminSessions();

  const s1 = await createServer({ port: 0, dataFile, probe: probeOk, getSession: s.getSession });
  const client = new AgentOnboardClient(s1.url, globalThis.fetch, s.reader);

  const cfg = await client.configure({ agent_name: 'A', priority: 'P0', accessMode: 'MCP', circuit: 'CLOSED', channels: { webhook: true, apiPull: true } });
  assert.equal(cfg.ok, true);

  const t = await client.testConnect('A');
  assert.equal(t.ok, true);
  assert.equal(t.card!.status, 'CONNECTED');

  const r = await client.rotateKey('A');
  assert.equal(r.ok, true);

  const disc = await client.oneClickOnboard(
    [{ name: 'B', priority: 'P1', signal: '本机进程' }, { name: 'C', priority: 'P2', signal: 'Webhook心跳' }],
    'desktop',
  );
  assert.equal(disc.ok, true);
  assert.equal(disc.cards.length, 2);

  const audit = await client.getAudit();
  assert.ok(audit.length >= 4, '审计应包含 configure/test/rotate/auto_bind*');

  // 本地镜像随响应更新，渲染层可直接读取
  assert.equal(client.cards.get('A')!.status, 'CONNECTED');
  assert.equal(client.cards.get('B')!.agent_name, 'B');

  const rb = await client.revokeBind('C');
  assert.equal(rb.ok, true);
  assert.equal(client.cards.has('C'), false);

  await s1.stop();

  // 重启：JSON 持久化恢复卡片 + 审计
  const s2 = await createServer({ port: 0, dataFile, probe: probeOk, getSession: s.getSession });
  const client2 = new AgentOnboardClient(s2.url, globalThis.fetch, s.reader);
  const audit2 = await client2.getAudit();
  assert.ok(audit2.length >= 4, '重启后审计仍在');
  // 卡片持久化：重启后 A 仍存在且可再次测通（状态仍为 CONNECTED）
  const t2 = await client2.testConnect('A');
  assert.equal(t2.ok, true, '重启后卡片 A 应仍存在');
  assert.equal(t2.card!.status, 'CONNECTED');
  await s2.stop();
});

test('fetch 调用不丢 this 绑定（浏览器 fetch 需 this=Window，否则 Illegal invocation）', async () => {
  // 模拟浏览器 Window.fetch：this 非 globalThis 即报 Illegal invocation
  function windowishFetch(this: unknown): Promise<{ ok: boolean; json: () => Promise<unknown> }> {
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    return Promise.resolve({ ok: true, json: async () => ({ ok: true, cards: [] }) });
  }
  const c = new AgentOnboardClient('http://example.test', windowishFetch as unknown as typeof globalThis.fetch);
  const cards = await c.getCards();
  assert.deepEqual(cards, []);
});

test('非法配置经 HTTP 返回 violations（与内存实现一致）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ab-client2-'));
  const dataFile = join(dir, 'b.json');
  const s = adminSessions();
  const srv = await createServer({ port: 0, dataFile, getSession: s.getSession });
  const client = new AgentOnboardClient(srv.url, globalThis.fetch, s.reader);

  const bad = await client.configure({ agent_name: 'X', tenantManual: true, priority: 'P0', circuit: 'CLOSED' }); // 违反 R1
  assert.equal(bad.ok, false);
  assert.ok(Array.isArray(bad.violations) && bad.violations.length > 0);
  await srv.stop();
});

test('批次26 P0-5：无会话客户端写操作被拒（401 文案透传），读不受影响', async () => {
  const s = adminSessions();
  const srv = await createServer({ port: 0, dataFile: join(mkdtempSync(join(tmpdir(), 'ab-client3-')), 'c.json'), probe: probeOk, getSession: s.getSession });
  const anon = new AgentOnboardClient(srv.url); // 不带会话读取器
  const r = await anon.testConnect('A');
  assert.equal(r.ok, false);
  assert.match(JSON.stringify(r), /需要登录/);
  const cards = await anon.getCards();
  assert.deepEqual(cards, []);
  await srv.stop();
});
