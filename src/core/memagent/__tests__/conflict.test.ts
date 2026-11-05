// 批次46-3：内核三模式冲突裁决原子 API 契约测试
// 配对真实性 / 四 verdict 落定 / 红线（显式 verdict、dry_run 零写入、只归档不删除、历史不回放）
// / coreGcFull 接线
import { describe, expect, it } from 'vitest';
import { coreListConflicts, coreResolveConflict } from '../conflict.ts';
import { coreGcFull } from '../memories.ts';
import { InMemoryStorage } from '../storage.ts';
import type { ConflictVerdict, Memory } from '../types.ts';

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;
const CID = 'cf_46_3';
const OLD_TEXT = '部署脚本必须校验 Redis 连接，避免超时';
const NEW_TEXT = '部署脚本必须校验 TLS 证书，避免中间人';

function mem(o: Partial<Memory> = {}): Memory {
  return {
    mem_id: o.mem_id ?? `m${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2', content: o.content ?? OLD_TEXT,
    decay_class: 'hot', pinned: false, locked: false, version: 1,
    created_at: NOW - 2 * DAY,
    ...o,
  };
}

/** 一对真实 pending 冲突（共享 conflict_id，created_at 决定 old/new） */
async function seedPair(storage: InMemoryStorage, over: Partial<Memory> = {}): Promise<void> {
  await storage.putMemory(mem({
    mem_id: 'old', conflict_id: CID, created_at: NOW - 2 * DAY, confidence: 0.5,
    content: OLD_TEXT, ...over,
  }));
  await storage.putMemory(mem({
    mem_id: 'new', conflict_id: CID, created_at: NOW - 1 * DAY, confidence: 0.6,
    content: NEW_TEXT,
  }));
}

const reqOf = (v: ConflictVerdict, o: Record<string, unknown> = {}) => ({
  old_id: 'old', new_id: 'new', conflict_id: CID, project_id: 'P1', verdict: v, ...o,
});

describe('46-3 A · 真实配对（不伪造对手 / 不猜分数与类型）', () => {
  it('同 conflict_id 两条 → 1 对，old/new 按 created_at，score/type 如实为 null', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    const pairs = await coreListConflicts(storage);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      conflict_id: CID, old_id: 'old', new_id: 'new', project_id: 'P1',
      conflict_score: null, conflict_type: null,
    });
    expect(pairs[0].note).toContain('未实现');
  });

  it('对手缺失 / 已 archived / 墓碑 → 不入队、不伪造对', async () => {
    const storage = new InMemoryStorage();
    await storage.putMemory(mem({ mem_id: 'solo', conflict_id: CID }));
    expect(await coreListConflicts(storage)).toHaveLength(0);
    await storage.putMemory(mem({ mem_id: 'gone', conflict_id: CID, decay_class: 'archived' }));
    expect(await coreListConflicts(storage)).toHaveLength(0);
    await storage.putMemory(mem({ mem_id: 'tomb', conflict_id: CID, deleted: true }));
    expect(await coreListConflicts(storage)).toHaveLength(0);
  });

  it('同 conflict_id 三条（歧义）→ 不入队，不硬凑成一对', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    await storage.putMemory(mem({ mem_id: 'third', conflict_id: CID, created_at: NOW }));
    expect(await coreListConflicts(storage)).toHaveLength(0);
  });

  it('跨项目共享 conflict_id → 不入队（配对必须同项目）', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    await storage.putMemory({ ...(await storage.getMemory('new'))!, project_id: 'P2' });
    expect(await coreListConflicts(storage)).toHaveLength(0);
  });

  it('projectId 过滤：只返回指定项目的对', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    await storage.putMemory(mem({ mem_id: 'p2_old', project_id: 'P2', conflict_id: 'cf_p2', created_at: NOW - 3 * DAY }));
    await storage.putMemory(mem({ mem_id: 'p2_new', project_id: 'P2', conflict_id: 'cf_p2', created_at: NOW - 2 * DAY }));
    expect(await coreListConflicts(storage)).toHaveLength(2);
    const onlyP2 = await coreListConflicts(storage, { projectId: 'P2' });
    expect(onlyP2).toHaveLength(1);
    expect(onlyP2[0].project_id).toBe('P2');
  });

  it('audit pending=true 路径入队；pending=false 历史审计不回放；同源去重', async () => {
    const storage = new InMemoryStorage();
    await storage.putMemory(mem({ mem_id: 'a_old', created_at: NOW - 3 * DAY }));
    await storage.putMemory(mem({ mem_id: 'a_new', created_at: NOW - 2 * DAY }));
    await storage.appendAudit({
      request_id: 'req_hist', action: 'conflict_resolve', ts: NOW - 4 * DAY,
      detail: { old_id: 'a_old', new_id: 'a_new', conflict_id: 'cf_hist', pending: false, verdict: 'auto_override' },
    });
    expect(await coreListConflicts(storage)).toHaveLength(0); // 历史已落定不回放
    await storage.appendAudit({
      request_id: 'req_pend', action: 'conflict_resolve', ts: NOW - DAY,
      detail: { old_id: 'a_old', new_id: 'a_new', conflict_id: 'cf_pend', pending: true, verdict: 'user_confirm' },
    });
    const pairs = await coreListConflicts(storage);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].conflict_id).toBe('cf_pend');
    // 路径 1 再给同一对打 conflict_id 标记，仍只入队一次
    await storage.putMemory({ ...(await storage.getMemory('a_old'))!, conflict_id: 'cf_pend' });
    await storage.putMemory({ ...(await storage.getMemory('a_new'))!, conflict_id: 'cf_pend' });
    expect(await coreListConflicts(storage)).toHaveLength(1);
  });
});

describe('46-3 B · 四 verdict 真实落定', () => {
  it('auto_override：旧 archived + 新 confidence +0.1 + 两条清 conflict_id + 成对审计', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    const r = await coreResolveConflict(reqOf('auto_override'), { storage, now: NOW });

    expect(r.ok).toBe(true);
    expect(r.resolved).toBe(true);
    expect(r.conflicts_resolved).toBe(1);
    expect(r.audit).toEqual({ request_id: r.request_id, action: 'conflict_resolve' });
    const old = await storage.getMemory('old');
    const newer = await storage.getMemory('new');
    expect(old?.decay_class).toBe('archived');
    expect(old?.conflict_id).toBeUndefined();
    expect(old?.version).toBe(2);
    expect(newer?.confidence).toBeCloseTo(0.7, 5);
    expect(newer?.conflict_id).toBeUndefined();
    expect(newer?.decay_class).toBe('hot'); // 新值不归档
    const audits = await storage.queryAudit({ action: 'conflict_resolve' });
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({
      old_id: 'old', new_id: 'new', verdict: 'auto_override', conflict_id: CID, pending: false,
    });
    expect(audits[0].project_id).toBe('P1');
  });

  it('merge：质量门通过 → 双归档 + 合并记忆 merged_from 含两条 + 两条审计 + resolved=1', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    const r = await coreResolveConflict(reqOf('merge'), { storage, now: NOW });

    expect(r.resolved).toBe(true);
    expect(r.conflicts_resolved).toBe(1);
    expect(r.merged_mem_id).toBeDefined();
    const merged = await storage.getMemory(r.merged_mem_id!);
    expect(merged?.merged_from).toEqual(['old', 'new']);
    expect(merged?.project_id).toBe('P1'); // 真实共同归属，不硬编码
    expect(merged?.content).toContain('合并');
    expect(merged?.content_l1).toBe(merged?.content);
    expect(merged?.layer).toBe('L1');
    for (const id of ['old', 'new']) {
      const m = await storage.getMemory(id);
      expect(m?.decay_class).toBe('archived');
      expect(m?.conflict_id).toBeUndefined();
      expect(m?.merged_into).toBe(r.merged_mem_id);
    }
    expect(await storage.queryAudit({ action: 'merge' })).toHaveLength(1);
    const resolved = await storage.queryAudit({ action: 'conflict_resolve' });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].detail).toMatchObject({ old_id: 'old', new_id: 'new', pending: false });
  });

  it('merge 质量门拦截（噪声内容）→ 整组回滚、保持 pending、resolved=0', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    await storage.putMemory({ ...(await storage.getMemory('old'))!, content: '你好，我是一个 AI 助手' });
    await storage.putMemory({ ...(await storage.getMemory('new'))!, content: '你好，我是一个AI助手呀' });
    const before = (await storage.listMemories({})).map((m) => ({ ...m }));
    const r = await coreResolveConflict(reqOf('merge'), { storage, now: NOW });

    expect(r.ok).toBe(false);
    expect(r.resolved).toBe(false);
    expect(r.conflicts_resolved).toBe(0);
    expect(r.quality_gate_blocked).toBe(true);
    expect(r.reason).toContain('质量门');
    expect((await storage.listMemories({})).map((m) => ({ ...m }))).toEqual(before);
    expect(await storage.queryAudit({})).toHaveLength(0);
  });

  it('user_confirm / hold：库状态完全不变、保持 pending、resolved=0、成对审计', async () => {
    for (const v of ['user_confirm', 'hold'] as const) {
      const storage = new InMemoryStorage();
      await seedPair(storage);
      const before = (await storage.listMemories({})).map((m) => ({ ...m }));
      const r = await coreResolveConflict(reqOf(v), { storage, now: NOW });

      expect(r.ok).toBe(true);
      expect(r.resolved).toBe(false);
      expect(r.conflicts_resolved).toBe(0);
      expect((await storage.listMemories({})).map((m) => ({ ...m }))).toEqual(before);
      const audits = await storage.queryAudit({ action: 'conflict_resolve' });
      expect(audits).toHaveLength(1);
      expect(audits[0].detail).toMatchObject({ old_id: 'old', new_id: 'new', verdict: v, pending: true });
    }
  });

  it('locked 行：blocked_locked=true、记忆不变、resolved=0（G4 仅 unlock 放行）', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    await storage.putMemory({ ...(await storage.getMemory('old'))!, locked: true });
    const r = await coreResolveConflict(reqOf('auto_override'), { storage, now: NOW });
    expect(r.blocked_locked).toBe(true);
    expect(r.resolved).toBe(false);
    expect(r.conflicts_resolved).toBe(0);
    expect((await storage.getMemory('old'))?.decay_class).toBe('hot');
    expect((await storage.getMemory('old'))?.version).toBe(1);
  });
});

describe('46-3 C · 红线', () => {
  it('dry_run=true：四 verdict 全部零写入（记忆/审计）、audit=null、resolved=0', async () => {
    for (const v of ['auto_override', 'merge', 'user_confirm', 'hold'] as const) {
      const storage = new InMemoryStorage();
      await seedPair(storage);
      const before = (await storage.listMemories({})).map((m) => ({ ...m }));
      const r = await coreResolveConflict(reqOf(v, { dry_run: true }), { storage, now: NOW });
      expect(r.dry_run).toBe(true);
      expect(r.audit).toBeNull();
      expect(r.resolved).toBe(false);
      expect(r.conflicts_resolved).toBe(0);
      expect((await storage.listMemories({})).map((m) => ({ ...m }))).toEqual(before);
      expect(await storage.queryAudit({})).toHaveLength(0);
    }
  });

  it('跨项目 / 越界 project_id → 明确拒绝且零写入', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    await storage.putMemory({ ...(await storage.getMemory('new'))!, project_id: 'P2' });
    const r1 = await coreResolveConflict(reqOf('auto_override'), { storage, now: NOW });
    expect(r1.ok).toBe(false);
    expect(r1.reason).toMatch(/跨项目|作用域/);
    const r2 = await coreResolveConflict(reqOf('auto_override', { project_id: 'P_OTHER' }), { storage, now: NOW });
    expect(r2.ok).toBe(false);
    expect(await storage.queryAudit({})).toHaveLength(0);
  });

  it('非法 / 缺失 verdict 明确拒绝（绝不默认 auto_override）', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    await expect(coreResolveConflict(reqOf('bogus' as ConflictVerdict), { storage, now: NOW }))
      .rejects.toThrow(/verdict/);
    await expect(coreResolveConflict(reqOf(undefined as unknown as ConflictVerdict), { storage, now: NOW }))
      .rejects.toThrow(/verdict/);
    expect((await storage.getMemory('old'))?.decay_class).toBe('hot');
    expect(await storage.queryAudit({})).toHaveLength(0);
  });

  it('对手缺失 → 如实空态不抛错、零写入；裁决不删除任何记忆、不回显 L0 密文', async () => {
    const storage = new InMemoryStorage();
    await storage.putMemory(mem({ mem_id: 'old', conflict_id: CID, content_l0_enc: 'L0_SECRET' }));
    const r = await coreResolveConflict(reqOf('auto_override'), { storage, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('对手');
    expect(storage.size).toBe(1);
    expect(JSON.stringify(r)).not.toContain('L0_SECRET');
    expect(JSON.stringify(r)).not.toContain('content_l0_enc');
  });
});

describe('46-3 D · coreGcFull 接线（D3/D8：二者都给才落定）', () => {
  it('resolve_conflicts=true + verdict → conflicts_resolved 真实计数', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    const r = await coreGcFull(
      { project_id: 'P1', resolve_conflicts: true, verdict: 'auto_override' },
      { storage, now: NOW },
    );
    expect(r.conflicts_resolved).toBe(1);
    expect((await storage.getMemory('old'))?.decay_class).toBe('archived');
    expect((await storage.getMemory('new'))?.confidence).toBeCloseTo(0.7, 5);
  });

  it('只给 resolve_conflicts 不给 verdict → 明确拒绝，绝不默认 auto_override', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    await expect(coreGcFull({ project_id: 'P1', resolve_conflicts: true }, { storage, now: NOW }))
      .rejects.toThrow(/verdict/);
    expect((await storage.getMemory('old'))?.decay_class).toBe('hot');
  });

  it('只给 verdict 不给 resolve_conflicts → 不落定、conflicts_resolved=0', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    const r = await coreGcFull(
      { project_id: 'P1', verdict: 'auto_override' }, { storage, now: NOW },
    );
    expect(r.conflicts_resolved).toBe(0);
    expect((await storage.getMemory('old'))?.decay_class).toBe('hot');
  });

  it('非法 verdict → 明确拒绝；缺省不带裁决 → conflicts_resolved=0（46-2 行为保留）', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    await expect(coreGcFull(
      { project_id: 'P1', resolve_conflicts: true, verdict: 'nonsense' as ConflictVerdict },
      { storage, now: NOW },
    )).rejects.toThrow(/verdict/);
    const plain = await coreGcFull({ project_id: 'P1' }, { storage, now: NOW });
    expect(plain.conflicts_resolved).toBe(0);
  });

  it('dry_run=true 且带裁决 → 全程零写入、audit=null、conflicts_resolved=0', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    const before = (await storage.listMemories({})).map((m) => ({ ...m }));
    const r = await coreGcFull(
      { project_id: 'P1', dry_run: true, resolve_conflicts: true, verdict: 'auto_override' },
      { storage, now: NOW },
    );
    expect(r.conflicts_resolved).toBe(0);
    expect(r.audit).toBeNull();
    expect((await storage.listMemories({})).map((m) => ({ ...m }))).toEqual(before);
  });

  it('重复调用不重复计数（红线4：历史 conflict_resolve 不回放）', async () => {
    const storage = new InMemoryStorage();
    await seedPair(storage);
    const first = await coreGcFull(
      { project_id: 'P1', resolve_conflicts: true, verdict: 'auto_override' },
      { storage, now: NOW },
    );
    expect(first.conflicts_resolved).toBe(1);
    const second = await coreGcFull(
      { project_id: 'P1', resolve_conflicts: true, verdict: 'auto_override' },
      { storage, now: NOW + DAY },
    );
    expect(second.conflicts_resolved).toBe(0);
    expect((await storage.getMemory('old'))?.version).toBe(2);
  });

  it('user_confirm / hold 经 gcFull 仍保持 pending、conflicts_resolved=0', async () => {
    for (const v of ['user_confirm', 'hold'] as const) {
      const storage = new InMemoryStorage();
      await seedPair(storage);
      const r = await coreGcFull(
        { project_id: 'P1', resolve_conflicts: true, verdict: v }, { storage, now: NOW },
      );
      expect(r.conflicts_resolved).toBe(0);
      expect((await storage.getMemory('old'))?.decay_class).toBe('hot');
      expect((await storage.getMemory('old'))?.conflict_id).toBe(CID);
    }
  });
});
