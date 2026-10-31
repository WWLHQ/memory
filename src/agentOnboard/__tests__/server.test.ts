// TC（接真实后端 · T13）：真实后端 HTTP 服务往返 + 持久化
// 批次26 P0-5：写端点要求真实会话（x-session-id；密钥类/删除需 admin），GET /audit 脱敏本机路径。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from '../server.ts';
import type { AgentProbe } from '../service.ts';
import type { TenantContext } from '../../types/home.ts';

/** 测试注入真实探测（命中本机安装证据；server 默认探测会扫真机，测试必须可复现） */
const probeOk: AgentProbe = (names) =>
  new Map(names.map((n) => [n, { ok: true, reason: `命中「${n}」本机安装证据（测试注入）` }]));

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

/** 批次26：会话门禁注入（fail-closed——server 无 getSession 时写端点一律 401） */
function fakeSessions() {
  const map = new Map<string, TenantContext>();
  const adminSid = 'sid-admin';
  const memberSid = 'sid-member';
  map.set(adminSid, { enterprise_id: 'e1', team_id: 't1', user_id: 'admin-1', perspective: 'team', session_id: adminSid, role: 'admin' });
  map.set(memberSid, { enterprise_id: 'e1', team_id: 't1', user_id: 'member-1', perspective: 'team', session_id: memberSid, role: 'member' });
  return {
    map, adminSid, memberSid,
    getSession: (sid: string | undefined) => (sid ? map.get(sid) ?? null : null),
  };
}

test('T13 端点往返 + 审计持久化跨重启（admin 会话）', async () => {
  const dataFile = tmpData();
  const s = fakeSessions();
  const h = await createServer({ port: 0, dataFile, probe: probeOk, getSession: s.getSession });
  const base = h.url;
  const auth = { 'content-type': 'application/json', 'x-session-id': s.adminSid };

  const cfg = await (await fetch(base + '/agents', {
    method: 'POST', headers: auth, body: JSON.stringify(VALID),
  })).json();
  assert.equal(cfg.ok, true);
  assert.equal(cfg.card.status, 'CONFIGURED');

  const t = await (await fetch(base + '/agents/a1/test', { method: 'POST', headers: auth })).json();
  assert.equal(t.ok, true);
  assert.equal(t.card.status, 'CONNECTED');
  assert.ok(t.requestId);

  const r = await (await fetch(base + '/agents/a1/rotate-key', { method: 'POST', headers: auth })).json();
  assert.equal(r.ok, true);
  // 真实密钥：mam_sk_<48 hex>；明文只在本次响应顶层一次性返回，卡片与磁盘都不得出现
  assert.match(r.key, /^mam_sk_[0-9a-f]{48}$/);
  const rotatedKey: string = r.key;
  assert.equal(r.card.apiKeyPlaintext, null);
  assert.equal(r.card.keyTail, rotatedKey.slice(-4));
  assert.match(r.card.keyHash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(r.card).includes(rotatedKey), '响应卡片不得回显明文');
  assert.ok(!readFileSync(dataFile, 'utf8').includes(rotatedKey), '密钥明文不得落盘');

  const au = await (await fetch(base + '/audit')).json();
  assert.ok(au.audit.length >= 3);
  const n = au.audit.length;

  // 重启服务，验证持久化
  await h.stop();
  const h2 = await createServer({ port: 0, dataFile, probe: probeOk, getSession: s.getSession });
  const au2 = await (await fetch(h2.url + '/audit')).json();
  assert.equal(au2.audit.length, n);
  // 重启后只恢复哈希/尾号，明文不可恢复
  const cards2 = await (await fetch(h2.url + '/agents')).json();
  assert.equal(cards2.cards[0].apiKeyPlaintext, null);
  assert.equal(cards2.cards[0].keyHash, r.card.keyHash);
  assert.equal(cards2.cards[0].keyTail, r.card.keyTail);
  const t2 = await (await fetch(h2.url + '/agents/a1/test', { method: 'POST', headers: auth })).json();
  assert.equal(t2.card.status, 'CONNECTED');
  await h2.stop();
});

test('批次2：旧账本明文密钥 → 启动即迁移 hash/tail 并清除磁盘明文', async () => {
  const dataFile = tmpData();
  const legacyKey = `mam_sk_${'a'.repeat(48)}`;
  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(dataFile, JSON.stringify({
    cards: { legacy: { ...VALID, agent_name: 'legacy', status: 'CONFIGURED', apiKeyPlaintext: legacyKey } },
    audit: [],
  }));

  const s = fakeSessions();
  const h = await createServer({ port: 0, dataFile, probe: probeOk, getSession: s.getSession });
  const cards = await (await fetch(h.url + '/agents')).json();
  assert.equal(cards.cards[0].apiKeyPlaintext, null);
  assert.match(cards.cards[0].keyHash, /^[0-9a-f]{64}$/);
  assert.equal(cards.cards[0].keyTail, legacyKey.slice(-4));
  assert.ok(!readFileSync(dataFile, 'utf8').includes(legacyKey), '启动即清除磁盘明文');
  await h.stop();
});

test('Phase C 验收：Agent 断开后经 HTTP 测通 → 不得 CONNECTED（DEGRADED + 真实原因）', async () => {
  let installed = true;
  const probe: AgentProbe = (names) => new Map(names.map((n) => [n, installed
    ? { ok: true, reason: `命中「${n}」本机安装证据（测试注入）` }
    : { ok: false, reason: `未检测到「${n}」的本机安装痕迹（CLI/安装目录/开始菜单/配置/注册表均未命中）` }]));
  const s = fakeSessions();
  const h = await createServer({ port: 0, dataFile: tmpData(), probe, getSession: s.getSession });
  const base = h.url;
  const auth = { 'x-session-id': s.adminSid };

  await fetch(base + '/agents', {
    method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(VALID),
  });
  const first = await (await fetch(base + '/agents/a1/test', { method: 'POST', headers: auth })).json();
  assert.equal(first.card.status, 'CONNECTED');

  installed = false; // 用户断开/卸载该 Agent
  const second = await (await fetch(base + '/agents/a1/test', { method: 'POST', headers: auth })).json();
  assert.equal(second.ok, false);
  assert.notEqual(second.card.status, 'CONNECTED');
  assert.equal(second.card.status, 'DEGRADED');
  assert.match(second.reason, /未检测到/);

  // 状态与失败原因随卡片落盘（GET /agents 如实回填，不回退成「已连通」）
  const cards = await (await fetch(base + '/agents')).json();
  assert.equal(cards.cards[0].status, 'DEGRADED');
  assert.match(cards.cards[0].lastTest.reason, /未检测到/);
  await h.stop();
});

test('T13 非法配置 → 422 + violations', async () => {
  const s = fakeSessions();
  const h = await createServer({ port: 0, dataFile: tmpData(), getSession: s.getSession });
  const res = await fetch(h.url + '/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': s.adminSid },
    body: JSON.stringify({ ...VALID, agent_name: 'bad', tenantManual: true }), // R1 违规
  });
  assert.equal(res.status, 422);
  const j = await res.json();
  assert.equal(j.ok, false);
  assert.ok(j.violations.some((v: { rule: string }) => v.rule === 'R1'));
  await h.stop();
});

test('批次26 P0-5：无会话写端点一律 401（fail-closed，含无 getSession 提供方）', async () => {
  // ① 有会话提供方但请求不带 x-session-id
  const s = fakeSessions();
  const h = await createServer({ port: 0, dataFile: tmpData(), probe: probeOk, getSession: s.getSession });
  const noAuth = await (await fetch(h.url + '/agents', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(VALID),
  })).json();
  assert.equal(noAuth.ok, false);
  assert.match(noAuth.error, /需要登录/);
  // 过期/伪造 sid 同样拒绝
  const forged = await (await fetch(h.url + '/agents', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': 'sid-forged' }, body: JSON.stringify(VALID),
  })).json();
  assert.equal(forged.ok, false);
  // ② 完全没有会话提供方（如独立测试/未知宿主）→ 全部写端点拒绝，绝不放行
  const h2 = await createServer({ port: 0, dataFile: tmpData(), probe: probeOk });
  const denied = await (await fetch(h2.url + '/agents/a1/test', { method: 'POST' })).json();
  assert.equal(denied.ok, false);
  assert.match(denied.error, /需要登录/);
  // GET 只读不受影响
  const read = await (await fetch(h2.url + '/agents')).json();
  assert.equal(read.ok, true);
  await h.stop();
  await h2.stop();
});

test('批次26 P0-5：member 可配置/测试，密钥轮换与撤销/删除需 admin（403）', async () => {
  const s = fakeSessions();
  const h = await createServer({ port: 0, dataFile: tmpData(), probe: probeOk, getSession: s.getSession });
  const base = h.url;
  // member 先建卡（member 允许配置）
  const cfg = await (await fetch(base + '/agents', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': s.memberSid }, body: JSON.stringify(VALID),
  })).json();
  assert.equal(cfg.ok, true);

  const memberRotate = await (await fetch(base + '/agents/a1/rotate-key', {
    method: 'POST', headers: { 'x-session-id': s.memberSid },
  })).json();
  assert.equal(memberRotate.ok, false);
  assert.match(memberRotate.error, /管理员/);
  const memberDel = await fetch(base + '/agents/a1', { method: 'DELETE', headers: { 'x-session-id': s.memberSid } });
  assert.equal(memberDel.status, 403);

  // admin 轮换可达服务、DELETE 可用
  const adminRotate = await (await fetch(base + '/agents/a1/rotate-key', {
    method: 'POST', headers: { 'x-session-id': s.adminSid },
  })).json();
  assert.equal(adminRotate.ok, true);
  const adminDel = await (await fetch(base + '/agents/a1', { method: 'DELETE', headers: { 'x-session-id': s.adminSid } })).json();
  assert.equal(adminDel.ok, true);
  await h.stop();
});

test('批次26 P0-5：GET /audit 脱敏本机安装路径（不泄露 Windows/Unix 用户目录）', async () => {
  const s = fakeSessions();
  const localReason = `命中本机安装证据：C:\\Users\\whoami\\AppData\\Local\\Programs\\agent\\bin，/home/whoami/.local/bin`;
  const probe: AgentProbe = (names) => new Map(names.map((n) => [n, { ok: true, reason: localReason }]));
  const h = await createServer({ port: 0, dataFile: tmpData(), probe, getSession: s.getSession });
  await fetch(h.url + '/agents', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': s.adminSid }, body: JSON.stringify(VALID),
  });
  await fetch(h.url + '/agents/a1/test', { method: 'POST', headers: { 'x-session-id': s.adminSid } });
  const au = await (await fetch(h.url + '/audit')).json();
  const raw = JSON.stringify(au);
  assert.ok(!raw.includes('C:\\Users'), '审计响应不得含 Windows 用户目录');
  assert.ok(!raw.includes('/home/whoami'), '审计响应不得含 Unix 用户目录');
  assert.ok(raw.includes('<本机路径>'), '命中路径应替换为占位符');
  await h.stop();
});
