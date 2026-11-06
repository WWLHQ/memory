// 批次45-A2 存量租户归一回归：预览只读、只重盖 team_id/enterprise_id（user_id 与其余字段原样保留）、
// 墓碑不归一、受保护行照样归一但单列计数、缺管理员/缺备份/空目标拒绝且不改数据、
// 逐行 + 汇总审计成对、二次运行幂等、损坏行失败不中止整轮。
import { describe, expect, it } from 'vitest';
import { normalizeTenantFields, scanRowsForTenantNormalize } from '../tenantNormalize.ts';
import { InMemoryStorage } from '../storage.ts';
import type { Memory, StorageBackend } from '../types.ts';

const NOW = 1_800_000_000_000;
const TARGET = { team_id: 't1', enterprise_id: 'e1' };

function mem(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_tn_1',
    project_id: 'P1',
    user_id: 'u_legacy',
    enterprise_id: 'ent_local',
    team_id: 'team_local',
    category: 'fact',
    layer: 'L1',
    content: '存量混住行：页面旧身份写入的团队/企业值不是规范三元组。',
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 3,
    created_at: NOW - 1000,
    ...over,
  };
}

async function seeded(mems: Memory[]): Promise<StorageBackend> {
  const storage = new InMemoryStorage();
  for (const m of mems) await storage.putMemory(m);
  return storage;
}

const ok = {
  storage: null as unknown as StorageBackend, target: TARGET, admin_user_id: 'admin',
  request_id: 'req_tn_1', now: NOW, backup_confirmed: true,
} as const;

describe('scanRowsForTenantNormalize 只读预览', () => {
  it('按字段缺口给出计数与分布，且不写数据、不落审计', async () => {
    const storage = await seeded([
      mem(),                                                                     // team+ent 都差
      mem({ mem_id: 'mem_tn_2', team_id: 't1' }),                                // 只差 enterprise
      mem({ mem_id: 'mem_tn_3', enterprise_id: 'e1' }),                          // 只差 team
      mem({ mem_id: 'mem_tn_4', team_id: 't1', enterprise_id: 'e1' }),           // 已规范
      mem({ mem_id: 'mem_tn_5', pinned: true }),                                 // 受保护但确实差
      mem({ mem_id: 'mem_tn_6', deleted: true }),                                // 墓碑
      mem({ mem_id: 'mem_tn_7', user_id: 'u_carol' }),                           // 另一个旧 user
    ]);
    const auditBefore = await storage.queryAudit({});
    const before = await storage.listMemories({ include_deleted: true });
    const p = await scanRowsForTenantNormalize(storage, TARGET);
    expect(p).toMatchObject({
      total: 7, tombstones: 1, mismatched: 5, protected_rows: 1,
      by_field: { team_id_only: 1, enterprise_id_only: 1, both: 3 },
    });
    expect(p.by_user).toEqual({ u_legacy: 4, u_carol: 1 });
    expect(p.sample.length).toBeLessThanOrEqual(20);
    expect(auditBefore).toHaveLength(0); // 预览不写审计
    // 预览之后账本一字未动
    const after = await storage.listMemories({ include_deleted: true });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

describe('normalizeTenantFields 执行归一', () => {
  it('把混住行的 team_id/enterprise_id 重盖为规范值，user_id 与其余字段原样保留', async () => {
    const storage = await seeded([
      mem({ mem_id: 'mem_a' }),
      mem({ mem_id: 'mem_b', version: 9, pinned: true }),
      mem({ mem_id: 'mem_c', team_id: 't1', enterprise_id: 'e1' }), // 已规范，不动
    ]);
    const r = await normalizeTenantFields({ ...ok, storage });
    expect(r).toMatchObject({ total: 3, mismatched: 2, normalized: 2, failed: 0, protected_rows: 1 });
    const rows = await storage.listMemories({ include_deleted: true });
    const byId = new Map(rows.map((m) => [m.mem_id, m]));
    for (const id of ['mem_a', 'mem_b', 'mem_c']) {
      expect(byId.get(id)?.team_id).toBe('t1');
      expect(byId.get(id)?.enterprise_id).toBe('e1');
    }
    // user_id 保留原值（45-A2 口径：只归一 team/enterprise）
    expect(byId.get('mem_a')?.user_id).toBe('u_legacy');
    // 其余字段一字不动
    expect(byId.get('mem_b')).toMatchObject({ version: 9, pinned: true, created_at: NOW - 1000 });
    expect(byId.get('mem_a')?.content).toContain('存量混住行');
  });

  it('逐行 memory_op + 整轮 security_change 审计成对，行审计只记归属字段新旧值不带正文', async () => {
    const storage = await seeded([mem({ mem_id: 'mem_x' }), mem({ mem_id: 'mem_y', team_id: 't1', enterprise_id: 'e1' })]);
    await normalizeTenantFields({ ...ok, storage });
    const audits = await storage.queryAudit({});
    const rowOps = audits.filter((a) => a.action === 'memory_op');
    const summaries = audits.filter((a) => a.action === 'security_change');
    expect(rowOps).toHaveLength(1); // 只有 mem_x 归一
    expect(rowOps[0].detail).toMatchObject({
      op: 'tenant_normalize', mem_id: 'mem_x',
      old_team_id: 'team_local', new_team_id: 't1',
      old_enterprise_id: 'ent_local', new_enterprise_id: 'e1',
      user_id_kept: 'u_legacy', protected: false,
    });
    expect(JSON.stringify(rowOps[0].detail)).not.toContain('存量混住行'); // 正文不进账本
    expect(summaries).toHaveLength(1);
    expect(summaries[0].detail).toMatchObject({
      op: 'tenant_normalize', total: 2, mismatched: 1, normalized: 1, failed: 0,
      target: { team_id: 't1', enterprise_id: 'e1' },
    });
  });

  it('幂等：第二次跑 mismatched=0、零写盘、审计只有一条 security_change（计数 0）', async () => {
    const storage = await seeded([mem({ mem_id: 'mem_i1' }), mem({ mem_id: 'mem_i2' })]);
    const first = await normalizeTenantFields({ ...ok, storage, request_id: 'req_tn_r1' });
    expect(first.normalized).toBe(2);
    const auditsAfterFirst = await storage.queryAudit({});
    const before = await storage.listMemories({ include_deleted: true });
    const second = await normalizeTenantFields({ ...ok, storage, request_id: 'req_tn_r2' });
    expect(second).toMatchObject({ total: 2, mismatched: 0, normalized: 0, failed: 0 });
    const after = await storage.listMemories({ include_deleted: true });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before)); // 零写盘
    const audits = await storage.queryAudit({});
    expect(audits).toHaveLength(auditsAfterFirst.length + 1); // 只多汇总一条
    expect(audits.filter((a) => a.action === 'memory_op')).toHaveLength(2); // 没有新行审计
  });

  it('墓碑行不归一（保留原样诚实计数），受保护行照样归一且单列', async () => {
    const storage = await seeded([
      mem({ mem_id: 'mem_d1', deleted: true }),
      mem({ mem_id: 'mem_p1', pinned: true }),
    ]);
    const r = await normalizeTenantFields({ ...ok, storage });
    expect(r).toMatchObject({ total: 2, tombstones: 1, mismatched: 1, normalized: 1, protected_rows: 1 });
    const rows = new Map((await storage.listMemories({ include_deleted: true })).map((m) => [m.mem_id, m]));
    expect(rows.get('mem_d1')).toMatchObject({ team_id: 'team_local', enterprise_id: 'ent_local' }); // 原样
    expect(rows.get('mem_p1')).toMatchObject({ team_id: 't1', enterprise_id: 'e1' });
  });

  it('拒绝矩阵：缺管理员 / 缺备份确认 / 空目标 —— 全部抛错且零写盘零审计', async () => {
    const base = await seeded([mem()]);
    const before = await base.listMemories({ include_deleted: true });
    await expect(normalizeTenantFields({ ...ok, storage: base, admin_user_id: '' })).rejects.toThrow(/管理员身份/);
    const noBackup = {
      storage: base, target: TARGET, admin_user_id: 'admin', request_id: 'r', now: NOW, backup_confirmed: false,
    } as unknown as Parameters<typeof normalizeTenantFields>[0]; // 故意伪造：缺备份确认必须被拒绝
    await expect(normalizeTenantFields(noBackup)).rejects.toThrow(/备份/);
    await expect(normalizeTenantFields({ ...ok, storage: base, target: { team_id: '', enterprise_id: '' } })).rejects.toThrow(/归一目标缺失/);
    expect(JSON.stringify(await base.listMemories({ include_deleted: true }))).toBe(JSON.stringify(before));
    expect(await base.queryAudit({})).toHaveLength(0);
  });
});
