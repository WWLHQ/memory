// A29：内核账本 → 页面状态重建（租户隔离 / 重复发现合并 / 撤销回落 / 空账本诚实）
import { expect, test } from 'vitest';
import { InMemoryStorage } from '../../../core/memagent/storage.ts';
import type { UiAgentCard } from '../../../types/agentOnboard.ts';
import {
  loadAgentLedger, mergeLedgerIntoCards, rebuildAgentLedger, recordAgentAction,
} from '../ledger.ts';
import { makeCard } from '../cards.ts';

const e1 = { enterprise_id: 'e1', team_id: 't1', user_id: 'u1' };

test('A29 记录 → 账本重建：接入/测试/轮换/吊销逐条可回放', async () => {
  const s = new InMemoryStorage();
  await recordAgentAction(s, { action: 'agent_onboard', agent: 'Codex', tenant: e1, op: 'configure', result: 'ok', status: 'CONFIGURED', rev: 1 });
  await recordAgentAction(s, { action: 'agent_test', agent: 'Codex', tenant: e1, op: 'test', result: 'pass', status: 'CONNECTED', durationMs: 12, rev: 2 });
  await recordAgentAction(s, { action: 'agent_rotate', agent: 'Codex', tenant: e1, op: 'rotate', result: 'ok', keyTail: 'abcd', rev: 3 });

  const ledger = await loadAgentLedger(s, e1);
  expect(ledger.agents).toHaveLength(1);
  const a = ledger.agents[0];
  expect(a.name).toBe('Codex');
  expect(a.status).toBe('CONNECTED');
  expect(a.bound).toBe(true);
  expect(a.lastTest?.ok).toBe(true);
  expect(a.lastTest?.durationMs).toBe(12);
  expect(a.keyTail).toBe('abcd');
  expect(a.keyRevoked).toBe(false);
  expect(a.rev).toBe(3);
  expect(a.events).toBe(3);
});

test('A29 重复发现只累加 events，不产生第二个 Agent', async () => {
  const s = new InMemoryStorage();
  await recordAgentAction(s, { action: 'auto_bind', agent: 'Cursor', tenant: e1, op: 'create', result: 'pass', status: 'CONNECTED', rev: 1 });
  await recordAgentAction(s, { action: 'auto_bind', agent: '  cursor ', tenant: e1, op: 'duplicate_update', result: 'pass', status: 'CONNECTED', rev: 2 });
  const ledger = await loadAgentLedger(s, e1);
  expect(ledger.agents).toHaveLength(1);
  expect(ledger.agents[0].name).toBe('Cursor');
  expect(ledger.entries).toBe(2);
});

test('A29 租户隔离：只回放当前租户，跨租户不串读', async () => {
  const s = new InMemoryStorage();
  await recordAgentAction(s, { action: 'agent_onboard', agent: 'Codex', tenant: e1, result: 'ok', status: 'CONFIGURED', rev: 1 });
  await recordAgentAction(s, {
    action: 'agent_onboard', agent: 'Claude Code',
    tenant: { enterprise_id: 'e2', team_id: 't2' }, result: 'ok', status: 'CONFIGURED', rev: 1,
  });
  const only1 = await loadAgentLedger(s, e1);
  expect(only1.agents.map((a) => a.name)).toEqual(['Codex']);
  const only2 = await loadAgentLedger(s, { enterprise_id: 'e2', team_id: 't2' });
  expect(only2.agents.map((a) => a.name)).toEqual(['Claude Code']);
});

test('A29 版本冲突（result=rejected）不改变状态', () => {
  const records = [
    { request_id: 'r1', action: 'agent_onboard' as const, agent: 'Codex', ts: 1, detail: { enterprise_id: 'e1', team_id: 't1', status: 'CONNECTED', rev: 2 } },
    { request_id: 'r2', action: 'agent_onboard' as const, agent: 'Codex', ts: 2, detail: { enterprise_id: 'e1', team_id: 't1', result: 'rejected', status: 'CONFIGURED', rev: 3 } },
  ];
  const ledger = rebuildAgentLedger(records, e1);
  expect(ledger.agents).toHaveLength(1);
  expect(ledger.agents[0].status).toBe('CONNECTED');
  expect(ledger.agents[0].rev).toBe(2);
  expect(ledger.agents[0].events).toBe(1);
});

test('A29 页面合并：账本有本地无 → 补卡；重复不新增；撤销绑定回落「未接入」', () => {
  const base: UiAgentCard[] = [makeCard('Codex', undefined, 'connected'), makeCard('Cursor', undefined, 'connected')];
  const ledger = rebuildAgentLedger([
    { request_id: 'r1', action: 'agent_onboard', agent: 'codex', ts: 1, detail: { enterprise_id: 'e1', team_id: 't1', status: 'DEGRADED', rev: 5 } },
    { request_id: 'r2', action: 'agent_onboard', agent: 'DeepSeek Harness', ts: 2, detail: { enterprise_id: 'e1', team_id: 't1', status: 'CONNECTED', rev: 1 } },
    { request_id: 'r3', action: 'unbound', agent: 'Cursor', ts: 3, detail: { enterprise_id: 'e1', team_id: 't1', rev: 2 } },
  ], e1);
  const merged = mergeLedgerIntoCards(base, ledger);
  // Codex 更新、Cursor 保留、DeepSeek Harness 补一张
  expect(merged).toHaveLength(3);
  expect(merged.filter((c) => c.name.toLowerCase() === 'codex')).toHaveLength(1);
  expect(merged.find((c) => c.name === 'Codex')?.state).toBe('degraded');
  expect(merged.find((c) => c.name === 'Codex')?.rev).toBe(5);
  expect(merged.find((c) => c.name === 'Cursor')?.state).toBe('onboard');
  expect(merged.find((c) => c.name === 'DeepSeek Harness')?.state).toBe('connected');
});

test('A29 空账本 → 不新增任何卡片（诚实空态）', () => {
  const base = [makeCard('Codex')];
  const merged = mergeLedgerIntoCards(base, rebuildAgentLedger([], e1));
  expect(merged).toHaveLength(1);
  expect(merged[0].name).toBe('Codex');
});

test('A29 审计记录带 sync_scope/decay_exempt/resource_type=agent', async () => {
  const s = new InMemoryStorage();
  const rec = await recordAgentAction(s, { action: 'agent_test', agent: 'Codex', tenant: e1, result: 'fail', reason: 'not_probed' });
  expect(rec.detail.sync_scope).toBe('local-only');
  expect(rec.detail.decay_exempt).toBe(true);
  expect(rec.detail.resource_type).toBe('agent');
  expect(rec.detail.resource_id).toBe('Codex');
  expect(rec.agent).toBe('Codex');
  expect(rec.user_id).toBe('u1');
});
