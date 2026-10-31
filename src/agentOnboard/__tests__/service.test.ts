// TC-003 集成（T11）：卡片 → 校验 → 状态机 → 审计 链路（对应 AC-003 全段）
import assert from 'node:assert/strict';
import { AgentOnboardService, type AgentProbe } from '../service.ts';
import type { AgentCardInput, Priority } from '../../types/agentOnboard.ts';

/** 测试注入的真实探测：默认全部命中（本机安装证据由 fake 代表） */
const probeOk: AgentProbe = (names) =>
  new Map(names.map((n) => [n, { ok: true, reason: `命中「${n}」本机安装证据（测试注入）` }]));

function svcWith(probe: AgentProbe = probeOk) {
  return new AgentOnboardService(null, { probe });
}

function validCard(name = 'deepseek harness', priority: Priority = 'P0'): AgentCardInput {
  return {
    agent_name: name,
    priority,
    accessMode: 'MCP+Webhook',
    enterprise_id: 'e1',
    team_id: 't1',
    tenantManual: false,
    mcpTools: { recall_memory: { project_id: 'p1' }, write_memory: { project_id: 'p1' }, get_user_preferences: { user_id: 'u1' } },
    channels: { webhook: true, apiPull: true },
    apiKeyPlaintext: null,
    circuit: 'CLOSED',
  };
}

test('configure 校验通过 → CONFIGURED', () => {
  const svc = new AgentOnboardService();
  const r = svc.configure(validCard());
  assert.equal(r.ok, true);
  assert.equal(r.card!.status, 'CONFIGURED');
});

test('configure 触发 R2（缺 project_id）→ 返回 violations，不入库', () => {
  const svc = new AgentOnboardService();
  const bad = validCard();
  bad.mcpTools!.recall_memory = {} as { project_id: string }; // 缺 project_id
  const r = svc.configure(bad);
  assert.equal(r.ok, false);
  assert.deepEqual(r.violations!.filter((v) => !v.ok).map((v) => v.rule), ['R2']);
  assert.equal(svc.cards.has('deepseek harness'), false);
});

test('testConnect（真实探测通过）→ CONNECTED + 记 request_id 审计（AC-003.3/AC-003.8/R7）', () => {
  const svc = svcWith();
  svc.configure(validCard());
  const r = svc.testConnect('deepseek harness');
  assert.equal(r.card!.status, 'CONNECTED');
  assert.equal(r.ok, true);
  assert.ok(r.requestId);
  assert.equal(r.card!.lastTest!.ok, true);
  const a = svc.getAudit().find((x) => x.action === 'test');
  assert.ok(a && a.requestId === r.requestId && a.result === 'pass');
});

test('Phase C 验收：无真实探测注入 → 测试绝不报 CONNECTED（降级 + 可读原因）', () => {
  const svc = new AgentOnboardService();
  svc.configure(validCard());
  const r = svc.testConnect('deepseek harness');
  assert.equal(r.ok, false);
  assert.equal(r.card!.status, 'DEGRADED');
  assert.match(r.reason!, /not_probed/);
  assert.equal(r.card!.lastTest!.ok, false);
  const a = svc.getAudit().find((x) => x.action === 'test');
  assert.equal(a!.result, 'fail');
});

test('Phase C 验收：Agent 断开（探测失败）→ 已连通卡片回落 DEGRADED，不滞留 CONNECTED', () => {
  let reachable = true;
  const svc = new AgentOnboardService(null, {
    probe: (names) => new Map(names.map((n) => [n, reachable
      ? { ok: true, reason: `命中「${n}」本机安装证据` }
      : { ok: false, reason: `未检测到「${n}」的本机安装痕迹（CLI/安装目录/开始菜单/配置/注册表均未命中）` }])),
  });
  svc.configure(validCard());
  assert.equal(svc.testConnect('deepseek harness').card!.status, 'CONNECTED');

  reachable = false; // 用户卸载/断开该 Agent
  const r = svc.testConnect('deepseek harness');
  assert.equal(r.ok, false);
  assert.equal(r.card!.status, 'DEGRADED');
  assert.match(r.reason!, /未检测到/);
  assert.equal(r.card!.lastTest!.reason, r.reason);
});

test('熔断 OPEN 测试 → DEGRADED（AC-003.3/AC-003.6/R5）', () => {
  const svc = svcWith();
  svc.configure(validCard()); // 先正常配置（circuit CLOSED）
  svc.cards.get('deepseek harness')!.circuit = 'OPEN'; // 运行期主通道熔断
  const r = svc.testConnect('deepseek harness');
  assert.equal(r.card!.status, 'DEGRADED');
  assert.equal(r.ok, false);
});

test('轮换 24h 宽限 / 真实密钥一次性返回 / 卡片只存哈希+尾号 / 吊销立即失效（AC-003.7/R6）', () => {
  const svc = new AgentOnboardService(null, {
    keyHasher: (k) => `sha256:${k.length}:${k.slice(-4)}`, // 测试替身（生产用 node:crypto SHA-256）
  });
  svc.configure(validCard());
  const rotated = svc.rotateKey('deepseek harness');
  assert.equal(rotated.ok, true);
  // 明文只在本次响应顶层返回一次，卡片/持久化结构里绝不含明文
  assert.match(rotated.key!, /^mam_sk_[0-9a-f]{48}$/);
  const key1 = rotated.key!;
  const afterRotate = svc.cards.get('deepseek harness')!;
  assert.ok(afterRotate.keyGraceUntil! > Date.now());
  assert.equal(afterRotate.apiKeyPlaintext, null);
  assert.equal(afterRotate.keyTail, key1.slice(-4));
  assert.equal(afterRotate.keyHash, `sha256:${key1.length}:${key1.slice(-4)}`);
  assert.equal(afterRotate.keyRevoked, false);
  assert.ok(!JSON.stringify(afterRotate).includes(key1), '卡片不得持有密钥明文');

  const second = svc.rotateKey('deepseek harness');
  const key2 = second.key!;
  assert.notEqual(key2, key1);
  assert.equal(svc.cards.get('deepseek harness')!.apiKeyPlaintext, null);

  const audit = svc.getAudit().filter((x) => x.action === 'rotate');
  assert.equal(audit.length, 2);
  for (const a of audit) {
    assert.equal(typeof a.keyTail, 'string');
    assert.equal(String(a.keyTail).length, 4);
    assert.ok(!JSON.stringify(a).includes(key1) && !JSON.stringify(a).includes(key2), '审计不得落密钥明文');
  }

  svc.revokeKey('deepseek harness');
  const afterRevoke = svc.cards.get('deepseek harness')!;
  assert.equal(afterRevoke.apiKeyPlaintext, null);
  assert.equal(afterRevoke.keyHash, undefined);
  assert.equal(afterRevoke.keyRevoked, true);
});

test('一键接入 3 个 Agent：默认只读召回 + 审计记端（AC-003.4/R8/R9/R10/19.11）', () => {
  const svc = svcWith();
  svc.oneClickOnboard(
    [
      { name: 'deepseek harness', priority: 'P0', signal: 'MCP注册表' },
      { name: 'Claude Code', priority: 'P1', signal: '本机进程' },
      { name: 'Codex', priority: 'P2', signal: 'Webhook心跳' },
    ],
    'desktop',
  );
  assert.equal(svc.cards.size, 3);
  const codex = svc.cards.get('Codex')!;
  assert.equal(codex.oneClick!.defaultReadOnly, true); // R8 只读召回
  assert.equal(codex.oneClick!.p2Write, false); // P2 默认不开写（需确认）
  const bind = svc.getAudit().find((x) => x.action === 'auto_bind' && x.agent === 'Codex');
  assert.ok(bind && bind.form === 'desktop'); // 19.11 审计记端
});

test('撤销自动绑定 → unbound 审计且其余不受影响（R9）', () => {
  const svc = new AgentOnboardService();
  svc.oneClickOnboard([{ name: 'A', priority: 'P0', signal: 'x' }, { name: 'B', priority: 'P1', signal: 'y' }], 'desktop');
  svc.revokeBind('A');
  assert.equal(svc.cards.has('A'), false);
  assert.equal(svc.cards.has('B'), true);
  assert.ok(svc.getAudit().some((x) => x.action === 'unbound' && x.agent === 'A'));
});
