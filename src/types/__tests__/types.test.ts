// T1 验收（对应 CODING_SOP 第 5 步）：领域类型契约的运行时校验
import assert from 'node:assert/strict';
import { AgentStatus, PriorityBadge, CircuitState, assertShape, AgentCardShape, McpToolConfigShape, ChannelConfigShape, KeyMgmtShape } from '../agentOnboard.ts';
import type { AgentCardCandidate } from '../agentOnboard.ts';

test('AgentStatus 四态完整（§0 状态机）', () => {
  assert.deepEqual(Object.values(AgentStatus), ['ONBOARD', 'CONFIGURED', 'CONNECTED', 'DEGRADED']);
});

test('PriorityBadge 四档（19.2 打标）', () => {
  assert.ok(PriorityBadge.P0 && PriorityBadge.P1 && PriorityBadge.P2 && PriorityBadge.P3);
});

test('CircuitState 含 OPEN（熔断联动 R5/R6）', () => {
  assert.ok(CircuitState.OPEN);
});

test('契约常量齐全（MCP/通道/密钥形状）', () => {
  assert.deepEqual(AgentCardShape.required, ['agent_name', 'priority', 'status', 'circuit']);
  assert.deepEqual(McpToolConfigShape.tools, ['recall_memory', 'write_memory', 'get_user_preferences']);
  assert.deepEqual(ChannelConfigShape.required, ['webhook', 'apiPull']);
  assert.equal(KeyMgmtShape.desensitize, true);
  assert.equal(KeyMgmtShape.rotateGraceHours, 24);
});

test('assertShape 合法卡片通过', () => {
  const card: AgentCardCandidate = {
    agent_name: 'deepseek harness', priority: 'P0', status: 'CONFIGURED', circuit: 'CLOSED',
    mcpTools: { recall_memory: { project_id: 'p1' }, write_memory: { project_id: 'p1' } },
  };
  const r = assertShape(card);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test('assertShape 缺字段 / 坏枚举 / 缺 project_id 均失败', () => {
  assert.equal(assertShape({}).ok, false); // 缺 required
  const badEnum = assertShape({ priority: 'PX' as never });
  assert.ok(badEnum.violations.includes('bad priority PX'));
  const noPid = assertShape({
    agent_name: 'x', priority: 'P0', status: 'CONFIGURED', circuit: 'CLOSED',
    mcpTools: { recall_memory: {} }, // 缺 project_id
  });
  assert.ok(noPid.violations.some((s) => s.includes('R2')));
});
