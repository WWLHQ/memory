// TC-003.2~TC-003.11 校验规则 R1-R10（对应 AC-003.1/AC-003.4/AC-003.5/AC-003.6/AC-003.7/AC-003.8）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOnboard } from '../validators.js';

// 一个"全绿"基线卡片
const okCard = {
  tenantManual: false,
  mcpTools: {
    recall_memory: { project_id: 'p1', scene: 'default', mode: null },
    write_memory: { project_id: 'p1' },
    get_user_preferences: { user_id: 'u1' },
  },
  channels: { webhook: true, apiPull: true },
  apiKeyPlaintext: null,
  circuit: 'CLOSED',
  status: 'CONFIGURED',
  tested: true,
  requestId: 'req_abc',
  oneClick: { enabled: true, defaultReadOnly: true, p2Write: false, p2Confirm: false, bindRevocable: true },
  discover: { enabled: true, crossMachine: false },
};

function viol(card) {
  const r = validateOnboard(card);
  return r.violations.filter((v) => !v.ok).map((v) => v.rule);
}

test('基线卡片全绿（R1-R10 均通过）', () => {
  const r = validateOnboard(okCard);
  assert.equal(r.ok, true);
  assert.deepEqual(viol(okCard), []);
});

test('R1 手填租户 → 失败', () => {
  assert.deepEqual(viol({ ...okCard, tenantManual: true }), ['R1']);
});

test('R2 缺 project_id → 失败', () => {
  const c = { ...okCard, mcpTools: { ...okCard.mcpTools, recall_memory: { scene: 'default', mode: null } } };
  assert.deepEqual(viol(c), ['R2']);
});

test('R3 scene=critical + mode=minimal → 失败', () => {
  const c = { ...okCard, mcpTools: { ...okCard.mcpTools, recall_memory: { project_id: 'p1', scene: 'critical', mode: 'minimal' } } };
  assert.deepEqual(viol(c), ['R3']);
});

test('R4 双通道全关 → 失败', () => {
  assert.deepEqual(viol({ ...okCard, channels: { webhook: false, apiPull: false } }), ['R4']);
});

test('R5 明文密钥回显 → 失败', () => {
  assert.deepEqual(viol({ ...okCard, apiKeyPlaintext: 'sk-xxxx' }), ['R5']);
});

test('R6 熔断 OPEN 但状态非 DEGRADED → 失败', () => {
  assert.deepEqual(viol({ ...okCard, circuit: 'OPEN', status: 'CONNECTED' }), ['R6']);
});

test('R7 测试但未记 request_id → 失败', () => {
  assert.deepEqual(viol({ ...okCard, tested: true, requestId: null }), ['R7']);
});

test('R8 一键非只读召回 / P2 写未确认 → 失败', () => {
  assert.deepEqual(viol({ ...okCard, oneClick: { ...okCard.oneClick, defaultReadOnly: false } }), ['R8']);
  const c2 = { ...okCard, oneClick: { ...okCard.oneClick, p2Write: true, p2Confirm: false } };
  assert.deepEqual(viol(c2), ['R8']);
});

test('R9 自动绑定不可撤销 → 失败', () => {
  assert.deepEqual(viol({ ...okCard, oneClick: { ...okCard.oneClick, bindRevocable: false } }), ['R9']);
});

test('R10 跨机器发现 → 失败', () => {
  assert.deepEqual(viol({ ...okCard, discover: { enabled: true, crossMachine: true } }), ['R10']);
});
