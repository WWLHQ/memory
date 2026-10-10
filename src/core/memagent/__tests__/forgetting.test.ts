// REQ-010 遗忘机制契约测试（17.11 AC 覆盖 + 17.7 迁移规则 + 17.6 策略表）
import { describe, expect, it } from 'vitest';
import {
  buildSummary, classifyLayer, forgetOne, freshnessOf, hardFilter, policyFor,
  reinforceOne, restoreOne, runForgettingCycle, scoreMemory,
} from '../forgetting.ts';
import { InMemoryStorage } from '../storage.ts';
import type { Memory } from '../types.ts';

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;

function mem(o: Partial<Memory> = {}): Memory {
  return {
    mem_id: o.mem_id ?? `m${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2', content: o.content ?? 'some content here',
    decay_class: 'hot', pinned: false, locked: false, version: 1,
    created_at: NOW - 1 * DAY,
    ...o,
  };
}

describe('17.5 新鲜度与打分', () => {
  it('半衰期：1 个半衰期后 freshness=0.5，两个=0.25；钳制 ≥0.05', () => {
    const m = mem({ created_at: NOW - 30 * DAY, half_life_days: 30 });
    expect(freshnessOf(m, NOW)).toBeCloseTo(0.5, 5);
    const m2 = mem({ created_at: NOW - 60 * DAY, half_life_days: 30 });
    expect(freshnessOf(m2, NOW)).toBeCloseTo(0.25, 5);
    const m3 = mem({ created_at: NOW - 1000 * DAY, half_life_days: 30 });
    expect(freshnessOf(m3, NOW)).toBe(0.05);
  });

  it('AC-03：pinned 免检 + 加分 0.15', () => {
    const plain = mem({ decay_class: 'warm' });
    const pinned = mem({ decay_class: 'warm', pinned: true });
    expect(hardFilter(plain)).toBe(true);  // warm 参与
    expect(scoreMemory(pinned, 0.8, NOW) - scoreMemory(plain, 0.8, NOW)).toBeCloseTo(0.15, 5);
    // cold 默认被过滤，但 pinned cold 免检直进候选
    expect(hardFilter(mem({ decay_class: 'cold' }))).toBe(false);
    expect(hardFilter(mem({ decay_class: 'cold', pinned: true }))).toBe(true);
  });

  it('AC-11：Cold/Archived/Dormant 不进默认召回候选', () => {
    expect(hardFilter(mem({ decay_class: 'cold' }))).toBe(false);
    expect(hardFilter(mem({ decay_class: 'archived' }))).toBe(false);
    expect(hardFilter(mem({ decay_class: 'dormant' }))).toBe(false);
    expect(hardFilter(mem({ decay_class: 'hot' }))).toBe(true);
  });

  it('下限钳制：低 importance/confidence 不被清零', () => {
    const m = mem({ importance: 0, confidence: 0 });
    const s = scoreMemory(m, 1, NOW);
    expect(s).toBeGreaterThan(0);
  });
});

describe('17.7 层迁移', () => {
  it('hot >3d → warm；warm >30d → cold', () => {
    expect(classifyLayer(mem({ decay_class: 'hot', created_at: NOW - 4 * DAY }), NOW)).toBe('warm');
    expect(classifyLayer(mem({ decay_class: 'warm', created_at: NOW - 31 * DAY }), NOW)).toBe('cold');
  });

  it('warm：freshness<0.1 或 confidence<0.3 → cold', () => {
    expect(classifyLayer(mem({ decay_class: 'warm', created_at: NOW - 40 * DAY, half_life_days: 7 }), NOW)).toBe('cold');
    expect(classifyLayer(mem({ decay_class: 'warm', confidence: 0.2 }), NOW)).toBe('cold');
  });

  it('cold：freshness<0.05 且 >90d → dormant', () => {
    const m = mem({ decay_class: 'cold', created_at: NOW - 100 * DAY, half_life_days: 10 });
    expect(classifyLayer(m, NOW)).toBe('dormant');
  });

  it('AC-04：locked / pinned 不参与自动迁移', () => {
    expect(classifyLayer(mem({ decay_class: 'hot', created_at: NOW - 40 * DAY, locked: true }), NOW)).toBeNull();
    expect(classifyLayer(mem({ decay_class: 'hot', created_at: NOW - 40 * DAY, pinned: true }), NOW)).toBeNull();
  });

  it('17.3 操作语义：忘记=降权不删除（AC-05）/ 恢复=拉回 warm（AC-06）/ 记住=进 hot', () => {
    const hot = mem({ decay_class: 'hot', confidence: 0.8, importance: 0.8 });
    const forgotten = forgetOne(hot);
    expect(forgotten.decay_class).toBe('warm');
    expect(forgotten.confidence).toBeLessThan(hot.confidence!);

    const cold = mem({ decay_class: 'cold', created_at: NOW - 60 * DAY });
    const restored = restoreOne(cold, NOW);
    expect(restored.decay_class).toBe('warm');

    const reinforced = reinforceOne(mem({ decay_class: 'warm' }), NOW);
    expect(reinforced.decay_class).toBe('hot');
    expect(reinforced.reinforce_count).toBe(1);
  });
});

describe('17.6 知识库策略表', () => {
  it('六类默认半衰期：fact 365 / preference 180 / decision 30 / pitfall 14 / context 2', () => {
    expect(policyFor('fact').half_life_days).toBe(365);
    expect(policyFor('preference').half_life_days).toBe(180);
    expect(policyFor('decision').half_life_days).toBe(30);
    expect(policyFor('pitfall').half_life_days).toBe(14);
    expect(policyFor('context').half_life_days).toBe(2);
    expect(policyFor('fact').auto_merge).toBe(false);
    expect(policyFor('decision').auto_merge).toBe(true);
  });
});

describe('17.9 合并与摘要', () => {
  it('AC-09：合并生成摘要 + merged_from + 原文降 cold 保留', () => {
    const group = [
      mem({ content: 'deploy docker step one', category: 'decision', importance: 0.9 }),
      mem({ content: 'deploy docker step two', category: 'decision' }),
      mem({ content: 'deploy docker step three', category: 'decision' }),
    ];
    const built = buildSummary(group, NOW)!;
    expect(built.summary.merged_from).toHaveLength(3);
    expect(built.summary.importance).toBe(0.9);
    expect(built.originals.every((o) => o.decay_class === 'cold' && o.merged_into === built.summary.mem_id)).toBe(true);
  });
  it('少于 3 条 / 锁定导致不足 3 条 → 不合并', () => {
    expect(buildSummary([mem(), mem()], NOW)).toBeNull();
    const locked = [mem({ locked: true }), mem({ locked: true }), mem()];
    expect(buildSummary(locked, NOW)).toBeNull();
  });
});

describe('17.10 后台周期任务', () => {
  it('一轮任务：迁移计数 + 审计；locked 豁免（AC-04）', async () => {
    const storage = new InMemoryStorage();
    await storage.putMemory(mem({ mem_id: 'a1', decay_class: 'hot', created_at: NOW - 4 * DAY }));
    await storage.putMemory(mem({ mem_id: 'a2', decay_class: 'hot', created_at: NOW - 4 * DAY, locked: true }));
    const report = await runForgettingCycle(storage, NOW);
    expect(report.migrated).toBe(1); // 仅未锁定的 a1
    const a2 = await storage.getMemory('a2');
    expect(a2?.decay_class).toBe('hot');
    const audits = await storage.queryAudit({ action: 'gc' });
    expect(audits.length).toBe(1);
    expect(audits[0].request_id).toBe(report.request_id);
  });

  it('AC-01：任务不删除任何知识', async () => {
    const storage = new InMemoryStorage();
    for (let i = 0; i < 5; i++) await storage.putMemory(mem({ mem_id: `k${i}`, content: `zz${i} distinct subject line`, created_at: NOW - 100 * DAY }));
    await runForgettingCycle(storage, NOW);
    expect(storage.size).toBe(5);
  });

  it('AC-14：enabled=false 可关闭（审计记 skipped）', async () => {
    const storage = new InMemoryStorage();
    await storage.putMemory(mem({ created_at: NOW - 40 * DAY }));
    const r = await runForgettingCycle(storage, NOW, { enabled: false });
    expect(r.migrated).toBe(0);
    const audits = await storage.queryAudit({ action: 'gc' });
    expect(audits[0].detail.skipped).toBe(true);
  });

  it('合并集成：同主题 ≥3 条 → 周期内生成摘要 + 原文保留（AC-09）', async () => {
    const storage = new InMemoryStorage();
    for (let i = 0; i < 3; i++) {
      await storage.putMemory(mem({ mem_id: `d${i}`, content: `deploy docker guide part ${i}`, category: 'decision' }));
    }
    const r = await runForgettingCycle(storage, NOW);
    expect(r.summaries_created).toBe(1);
    expect(r.merged_originals).toBe(3);
    expect(storage.size).toBe(4); // 3 原文 + 1 摘要（不删除）
    const d0 = await storage.getMemory('d0');
    expect(d0?.decay_class).toBe('cold');
  });
});
