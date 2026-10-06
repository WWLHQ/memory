// TC-003.1 状态机流转（对应 AC-003.3）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentStatus, transition } from '../stateMachine.js';

test('ONBOARD --CONFIGURE--> CONFIGURED', () => {
  assert.equal(transition(AgentStatus.ONBOARD, 'CONFIGURE'), AgentStatus.CONFIGURED);
});

test('CONFIGURED --TEST_PASS--> CONNECTED', () => {
  assert.equal(transition(AgentStatus.CONFIGURED, 'TEST_PASS'), AgentStatus.CONNECTED);
});

test('CONFIGURED --TEST_FAIL--> DEGRADED', () => {
  assert.equal(transition(AgentStatus.CONFIGURED, 'TEST_FAIL'), AgentStatus.DEGRADED);
});

test('CIRCUIT_OPEN 强制降级（从任意态）', () => {
  assert.equal(transition(AgentStatus.CONNECTED, 'CIRCUIT_OPEN'), AgentStatus.DEGRADED);
  assert.equal(transition(AgentStatus.ONBOARD, 'CIRCUIT_OPEN'), AgentStatus.DEGRADED);
});

test('CIRCUIT_CLOSE 恢复 DEGRADED --> CONNECTED', () => {
  assert.equal(transition(AgentStatus.DEGRADED, 'CIRCUIT_CLOSE'), AgentStatus.CONNECTED);
});

test('未知事件为幂等 no-op', () => {
  assert.equal(transition(AgentStatus.ONBOARD, 'NOPE'), AgentStatus.ONBOARD);
});
