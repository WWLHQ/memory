// TC-003 集成（T11）：卡片 → 校验 → 状态机 → 审计 链路（对应 AC-003 全段）
import assert from 'node:assert/strict';
import { AgentOnboardService } from '../service.ts';
import type { AgentCardInput, Priority } from '../../types/agentOnboard.ts';

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

test('testConnect → CONNECTED + 记 request_id 审计（AC-003.3/AC-003.8/R7）', () => {
  const svc = new AgentOnboardService();
  svc.configure(validCard());
  const r = svc.testConnect('deepseek harness');
  assert.equal(r.card!.status, 'CONNECTED');
  assert.ok(r.requestId);
  const a = svc.getAudit().find((x) => x.action === 'test');
  assert.ok(a && a.requestId === r.requestId);
});

test('熔断 OPEN 测试 → DEGRADED（AC-003.3/AC-003.6/R5）', () => {
  const svc = new AgentOnboardService();
  svc.configure(validCard()); // 先正常配置（circuit CLOSED）
  svc.cards.get('deepseek harness')!.circuit = 'OPEN'; // 运行期主通道熔断
  const r = svc.testConnect('deepseek harness');
  assert.equal(r.card!.status, 'DEGRADED');
});

test('轮换 24h 宽限 / 吊销立即失效（AC-003.7/R6）', () => {
  const svc = new AgentOnboardService();
  svc.configure(validCard());
  svc.rotateKey('deepseek harness');
  const afterRotate = svc.cards.get('deepseek harness')!;
  assert.ok(afterRotate.keyGraceUntil! > Date.now());
  svc.revokeKey('deepseek harness');
  const afterRevoke = svc.cards.get('deepseek harness')!;
  assert.equal(afterRevoke.apiKeyPlaintext, null);
  assert.equal(afterRevoke.keyRevoked, true);
});

test('一键接入 3 个 Agent：默认只读召回 + 审计记端（AC-003.4/R8/R9/R10/19.11）', () => {
  const svc = new AgentOnboardService();
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
