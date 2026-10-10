import { describe, it, expect } from 'vitest';
import {
  canMigrate, freshnessPreview, importanceLevel, staleCheck, applyLifecycle, STATUS_FLOW,
} from '../logic.ts';
import { SEED_LIFECYCLE } from '../seed.ts';
import type { LifecycleRecord } from '../types.ts';

const rec = (over: Partial<LifecycleRecord>): LifecycleRecord => ({
  id: 'm', content: 'c', status: 'active', ageDays: 0, half_life_days: 30,
  confidence: 0.5, importance: 0.5, access_count: 1, reinforce_count: 0,
  pinned: false, locked: false, decay_class: 'hot', ...over,
});

describe('freshnessPreview', () => {
  it('= 0.5^(age/hl)，下限 0.05', () => {
    expect(freshnessPreview(0, 30)).toBe(1);
    expect(freshnessPreview(30, 30)).toBe(0.5);
    expect(freshnessPreview(600, 30)).toBe(0.05); // 下限
    expect(freshnessPreview(0, 0)).toBe(1); // 非法 hl 视作 1，age=0 → 1
  });
});

describe('canMigrate / STATUS_FLOW', () => {
  it('active 可迁各停泊态', () => {
    expect(canMigrate('active', 'hibernating')).toBe(true);
    expect(canMigrate('active', 'archived')).toBe(true);
    expect(canMigrate('active', 'stale')).toBe(true);
  });
  it('archived 可恢复 active', () => {
    expect(canMigrate('archived', 'active')).toBe(true);
  });
  it('dormant 可恢复 active，不可直接回 archived 之外的非法', () => {
    expect(canMigrate('dormant', 'active')).toBe(true);
    expect(canMigrate('active', 'active')).toBe(false); // 同态不算迁移
  });
  it('所有态都有合法出边（六态机连通）', () => {
    for (const s of Object.keys(STATUS_FLOW)) {
      expect(STATUS_FLOW[s as keyof typeof STATUS_FLOW].length).toBeGreaterThan(0);
    }
  });
});

describe('importanceLevel', () => {
  it('0–1 → 1–5 级（15.1）', () => {
    expect(importanceLevel(0.95)).toBe(5);
    expect(importanceLevel(0.75)).toBe(4);
    expect(importanceLevel(0.55)).toBe(3);
    expect(importanceLevel(0.35)).toBe(2);
    expect(importanceLevel(0.1)).toBe(1);
  });
});

describe('staleCheck', () => {
  it('age≥N(90) → hibernate，age≥M(180) → archive', () => {
    expect(staleCheck(rec({ ageDays: 95 })).hibernate).toBe(true);
    expect(staleCheck(rec({ ageDays: 89 })).hibernate).toBe(false);
    expect(staleCheck(rec({ ageDays: 200 })).archive).toBe(true);
  });
});

describe('applyLifecycle', () => {
  const list = SEED_LIFECYCLE;

  it('合法迁移成功并改状态', () => {
    const r = list.find((m) => m.id === 'mem_015')!; // stale
    const res = applyLifecycle(list, r, { kind: 'migrate', target: 'archived' }, 'req_t');
    expect(res.ok).toBe(true);
    expect(res.audit).toBe('lifecycle_change');
    expect(res.request_id).toBe('req_t');
    expect(res.affected[0].status).toBe('archived');
  });

  it('非法迁移被拒（active→active）', () => {
    const r = list.find((m) => m.id === 'mem_001')!;
    const res = applyLifecycle(list, r, { kind: 'migrate', target: 'active' }, 'req_t');
    expect(res.ok).toBe(false);
  });

  it('锁定记忆迁移被拒（G4）', () => {
    const r = list.find((m) => m.id === 'mem_016')!; // dormant + locked
    const res = applyLifecycle(list, r, { kind: 'migrate', target: 'active' }, 'req_t');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('已锁定');
  });

  it('调参：half_life 下限 1 / confidence 下限 0.05 / importance 下限 0.1', () => {
    const r = list.find((m) => m.id === 'mem_011')!;
    const res = applyLifecycle(list, r, { kind: 'param', half_life_days: 0, confidence: 0, importance: 0 }, 'req_t');
    expect(res.affected[0].half_life_days).toBe(1);
    expect(res.affected[0].confidence).toBe(0.05);
    expect(res.affected[0].importance).toBe(0.1);
  });

  it('锁定记忆调参被拒，仅解锁允许', () => {
    const r = list.find((m) => m.id === 'mem_016')!; // locked
    expect(applyLifecycle(list, r, { kind: 'param', confidence: 0.5 }, 'req_t').ok).toBe(false);
    const unlock = applyLifecycle(list, r, { kind: 'param', locked: false }, 'req_t');
    expect(unlock.ok).toBe(true);
    expect(unlock.affected[0].locked).toBe(false);
  });

  it('批量迁移：stale→archived 仅合法且未锁定的生效', () => {
    // mem_015 stale（可→archived）、mem_016 dormant+locked（跳过）、mem_012 已 archived（跳过）
    const res = applyLifecycle(list, list[0], { kind: 'batch_migrate', ids: ['mem_015', 'mem_016', 'mem_012'], target: 'archived' }, 'req_b');
    expect(res.affected.map((r) => r.id)).toEqual(['mem_015']);
    expect(res.audit).toBe('lifecycle_change');
  });
});

describe('种子覆盖', () => {
  it('六态全覆盖', () => {
    const statuses = new Set(SEED_LIFECYCLE.map((r) => r.status));
    for (const s of ['active', 'hibernating', 'archived', 'deprecated', 'stale', 'dormant']) {
      expect(statuses.has(s as LifecycleRecord['status'])).toBe(true);
    }
  });
  it('含 deprecated 带 replaced_by', () => {
    const d = SEED_LIFECYCLE.find((m) => m.status === 'deprecated')!;
    expect(d.replaced_by).toBe('mem_014');
  });
});
