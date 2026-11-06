// A29：接入状态真实持久 + 重复发现更新语义 + 租户归属 + 并发版本校验。
import assert from 'node:assert/strict';
import { AgentOnboardService, ONBOARD_DECAY_EXEMPT, ONBOARD_SYNC_SCOPE, type AuditEntry, type AuditStore, type AgentProbe } from '../service.ts';
import type { AgentCardInput, Priority } from '../../types/agentOnboard.ts';

const probeOk: AgentProbe = (names) =>
  new Map(names.map((n) => [n, { ok: true, reason: `命中「${n}」本机安装证据（测试注入）` }]));

/** 内存审计持久化（模拟 localStorage/JSON 文件；新实例 load 回来 = 重启不丢） */
function memoryStore(): AuditStore & { rows: AuditEntry[] } {
  const rows: AuditEntry[] = [];
  return {
    rows,
    load: () => [...rows],
    append: (e) => { rows.push(e); },
  };
}

function validCard(name = 'deepseek harness', priority: Priority = 'P0'): AgentCardInput {
  return {
    agent_name: name,
    priority,
    accessMode: 'MCP+Webhook',
    enterprise_id: 'e1',
    team_id: 't1',
    tenantManual: false,
    mcpTools: { recall_memory: { project_id: 'p1' }, write_memory: { project_id: 'p1' }, get_preferences: { user_id: 'u1' } },
    channels: { webhook: true, apiPull: true },
    apiKeyPlaintext: null,
    circuit: 'CLOSED',
  };
}

test('A29 审计真实持久：新实例从 store 回放，不再重启即丢', () => {
  const store = memoryStore();
  const svc = new AgentOnboardService(null, { probe: probeOk, auditStore: store });
  svc.configure(validCard());
  svc.testConnect('deepseek harness');
  assert.equal(svc.getAudit().length, 2);
  assert.equal(store.rows.length, 2);

  const revived = new AgentOnboardService(null, { probe: probeOk, auditStore: store });
  assert.equal(revived.getAudit().length, 2, '重启后审计必须仍在');
  assert.ok(revived.getAudit().some((e) => e.action === 'test'));
});

test('A29 每条接入审计带 sync_scope=local-only / decay_exempt=true（口径可查）', () => {
  const store = memoryStore();
  const svc = new AgentOnboardService(null, { probe: probeOk, auditStore: store });
  svc.configure(validCard());
  for (const e of store.rows) {
    assert.equal(e.sync_scope, ONBOARD_SYNC_SCOPE);
    assert.equal(e.decay_exempt, ONBOARD_DECAY_EXEMPT);
    assert.equal(e.sync_scope, 'local-only');
    assert.equal(e.decay_exempt, true);
  }
});

test('A29 重复配置（大小写/空白不同）只更新同一条，不刷出多条', () => {
  const svc = new AgentOnboardService(null, { probe: probeOk });
  const first = svc.configure(validCard('DeepSeek Harness'));
  const second = svc.configure(validCard('  deepseek harness '));
  assert.equal(first.ok && second.ok, true);
  assert.equal(svc.cards.size, 1, '同名归一化后只能有一张卡片');
  // 展示名保留首次登记写法
  assert.ok(svc.cards.has('DeepSeek Harness'));
  assert.equal(svc.cards.get('DeepSeek Harness')!.rev, 2, '重复写入 rev 递增');
});

test('A29 重复一键接入 = 更新同一条，保留已轮换密钥', () => {
  const svc = new AgentOnboardService(null, { probe: probeOk });
  svc.oneClickOnboard([{ name: 'Codex', priority: 'P2', signal: 'mcp' }]);
  const rotated = svc.rotateKey('Codex');
  assert.equal(rotated.ok, true);
  const keyTail = rotated.card!.keyTail;

  svc.oneClickOnboard([{ name: 'codex', priority: 'P2', signal: 'proc' }]);
  assert.equal(svc.cards.size, 1);
  const card = svc.cards.get('Codex')!;
  assert.equal(card.keyTail, keyTail, '再次发现不得抹掉已有密钥');
  assert.equal(card.rev, 3, 'create(1) → rotate(2) → duplicate_update(3)');
  const dup = svc.getAudit().filter((e) => e.action === 'auto_bind').at(-1)!;
  assert.equal(dup.op, 'duplicate_update');
});

test('A29 并发版本校验：expectedRev 不一致 → 拒绝并记 version_conflict', () => {
  const svc = new AgentOnboardService(null, { probe: probeOk });
  const created = svc.configure(validCard());
  assert.equal(created.card!.rev, 1);

  const stale = svc.configure({ ...validCard(), expectedRev: 1 });
  assert.equal(stale.ok, true, '版本一致允许写入');
  const conflict = svc.configure({ ...validCard(), expectedRev: 1 });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, 'version_conflict');
  assert.equal(conflict.rev, 2);
  const audit = svc.getAudit().filter((e) => e.result === 'rejected').at(-1)!;
  assert.equal(audit.reason, 'version_conflict');
  assert.equal(audit.expectedRev, 1);
  assert.equal(audit.rev, 2);
});

test('A29 撤销/轮换同样做版本校验；正确版本才生效', () => {
  const svc = new AgentOnboardService(null, { probe: probeOk });
  const c = svc.configure(validCard());
  assert.equal(c.card!.rev, 1);

  const badRotate = svc.rotateKey('deepseek harness', 99);
  assert.equal(badRotate.ok, false);
  assert.equal(badRotate.reason, 'version_conflict');

  const goodRotate = svc.rotateKey('deepseek harness', 1);
  assert.equal(goodRotate.ok, true);
  assert.equal(goodRotate.card!.rev, 2);

  const badUnbind = svc.revokeBind('deepseek harness', 1);
  assert.equal(badUnbind.ok, false);
  assert.equal(badUnbind.reason, 'version_conflict');

  const goodUnbind = svc.revokeBind('deepseek harness', 2);
  assert.equal(goodUnbind.ok, true);
  assert.equal(svc.cards.size, 0);
});

test('A29 租户归属：卡片与审计都带会话租户，切换租户后写入不串', () => {
  const store = memoryStore();
  const svc = new AgentOnboardService(null, { probe: probeOk, auditStore: store, tenant: { enterprise_id: 'e1', team_id: 't1' } });
  svc.configure(validCard('codex'));
  const card = svc.cards.get('codex')!;
  assert.equal(card.enterprise_id, 'e1');
  assert.equal(card.team_id, 't1');
  assert.equal(store.rows[0].enterprise_id, 'e1');
  assert.equal(store.rows[0].team_id, 't1');

  svc.setTenant({ enterprise_id: 'e2', team_id: 't2' });
  svc.configure(validCard('cursor'));
  const cursor = svc.cards.get('cursor')!;
  assert.equal(cursor.enterprise_id, 'e2');
  assert.equal(cursor.team_id, 't2');
});
