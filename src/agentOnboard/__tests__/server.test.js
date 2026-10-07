// TC（接真实后端 · T13）：真实后端 HTTP 服务往返 + 持久化
// 零依赖：node:http 服务；node:test + fetch（Node 22 内置）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.js';

const VALID = {
  agent_name: 'a1',
  priority: 'P0',
  tenantManual: false,
  mcpTools: {
    recall_memory: { project_id: 'p1' },
    write_memory: { project_id: 'p1' },
    get_user_preferences: { user_id: 'u1' },
  },
  channels: { webhook: true, apiPull: true },
  apiKeyPlaintext: null,
  circuit: 'CLOSED',
};

function tmpData() {
  return join(mkdtempSync(join(tmpdir(), 'ab-')), 'agent-onboard.json');
}

test('T13 端点往返 + 审计持久化跨重启', async () => {
  const dataFile = tmpData();
  const h = await createServer({ port: 0, dataFile });
  const base = h.url;

  const cfg = await (await fetch(base + '/agents', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(VALID),
  })).json();
  assert.equal(cfg.ok, true);
  assert.equal(cfg.card.status, 'CONFIGURED');

  const t = await (await fetch(base + '/agents/a1/test', { method: 'POST' })).json();
  assert.equal(t.ok, true);
  assert.equal(t.card.status, 'CONNECTED');
  assert.ok(t.requestId);

  const r = await (await fetch(base + '/agents/a1/rotate-key', { method: 'POST' })).json();
  assert.equal(r.ok, true);

  const au = await (await fetch(base + '/audit')).json();
  assert.ok(au.audit.length >= 3);
  const n = au.audit.length;

  // 重启服务，验证持久化
  await h.stop();
  const h2 = await createServer({ port: 0, dataFile });
  const au2 = await (await fetch(h2.url + '/audit')).json();
  assert.equal(au2.audit.length, n);
  const t2 = await (await fetch(h2.url + '/agents/a1/test', { method: 'POST' })).json();
  assert.equal(t2.card.status, 'CONNECTED');
  await h2.stop();
});

test('T13 非法配置 → 422 + violations', async () => {
  const h = await createServer({ port: 0, dataFile: tmpData() });
  const res = await fetch(h.url + '/agents', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...VALID, agent_name: 'bad', tenantManual: true }), // R1 违规
  });
  assert.equal(res.status, 422);
  const j = await res.json();
  assert.equal(j.ok, false);
  assert.ok(j.violations.some((v) => v.rule === 'R1'));
  await h.stop();
});
