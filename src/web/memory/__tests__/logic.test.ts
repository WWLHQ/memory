import { describe, it, expect } from 'vitest';
import { applyOp, decayClass, sortMemories, summarizeContent, OP_TOAST } from '../logic.ts';
import { SEED_MEMORIES } from '../seed.ts';
import type { MemoryRecord, MemoryOp } from '../types.ts';

const base: MemoryRecord = {
  id: 't1', content: 'hello', type: 'fact', tags: [],
  importance: 0.5, confidence: 0.5, access_count: 1, reinforce_count: 0,
  pinned: false, locked: false, archived: false, status: 'active',
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  ageDays: 0, halfLifeDays: 30,
};

describe('decayClass', () => {
  it('hot/warm/cold 按 freshness 分档', () => {
    expect(decayClass({ ...base, ageDays: 0, halfLifeDays: 30 })).toBe('hot'); // 1
    expect(decayClass({ ...base, ageDays: 45, halfLifeDays: 30 })).toBe('warm'); // 0.5^1.5≈0.35
    expect(decayClass({ ...base, ageDays: 80, halfLifeDays: 30 })).toBe('cold'); // 0.5^2.67≈0.16
  });
  it('archived 字段优先返回 archived', () => {
    expect(decayClass({ ...base, archived: true })).toBe('archived');
  });
  it('status=dormant 返回 dormant', () => {
    expect(decayClass({ ...base, status: 'dormant' })).toBe('dormant');
  });
});

describe('sortMemories', () => {
  it('pinned 永远最上', () => {
    const list = [
      { ...base, id: 'a', pinned: false, confidence: 0.9 },
      { ...base, id: 'b', pinned: true, confidence: 0.1 },
    ];
    expect(sortMemories(list)[0].id).toBe('b');
  });
  it('其余按 confidence 降序', () => {
    const list = [
      { ...base, id: 'a', confidence: 0.3 },
      { ...base, id: 'b', confidence: 0.8 },
      { ...base, id: 'c', confidence: 0.5 },
    ];
    expect(sortMemories(list).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('summarizeContent', () => {
  it('cold/dormant 返回 L2 占位符（G3）', () => {
    expect(summarizeContent({ ...base, ageDays: 300 })).toContain('L2 占位符');
    expect(summarizeContent({ ...base, status: 'dormant' })).toContain('L2 占位符');
  });
  it('其他返回原文', () => {
    expect(summarizeContent({ ...base, ageDays: 0 })).toBe('hello');
  });
});

describe('applyOp', () => {
  const ops: MemoryOp[] = ['remember', 'forget', 'pin', 'unpin', 'lock', 'unlock', 'archive', 'restore', 'delete'];
  it('remember 升 importance/confidence 且状态 active', () => {
    const r = applyOp({ ...base, importance: 0.5, confidence: 0.5 }, 'remember');
    expect(r.ok).toBe(true);
    expect(r.rec!.importance).toBeGreaterThan(0.5);
    expect(r.rec!.confidence).toBeGreaterThan(0.5);
    expect(r.rec!.status).toBe('active');
    expect(r.audit).toBe('memory_remember');
  });
  it('forget 降权不删', () => {
    const r = applyOp({ ...base, importance: 0.5, confidence: 0.5 }, 'forget');
    expect(r.rec!.importance).toBeLessThan(0.5);
    expect(r.rec!.confidence).toBeLessThan(0.5);
    expect(r.rec).not.toBeNull();
  });
  it('delete 返回 null', () => {
    const r = applyOp(base, 'delete');
    expect(r.rec).toBeNull();
    expect(r.audit).toBe('memory_delete');
  });
  it('pin/unpin/lock/unlock/archive/restore 改对应字段', () => {
    expect(applyOp(base, 'pin').rec!.pinned).toBe(true);
    expect(applyOp({ ...base, pinned: true }, 'unpin').rec!.pinned).toBe(false);
    expect(applyOp(base, 'lock').rec!.locked).toBe(true);
    expect(applyOp({ ...base, locked: true }, 'unlock').rec!.locked).toBe(false);
    expect(applyOp(base, 'archive').rec!.archived).toBe(true);
    expect(applyOp({ ...base, archived: true }, 'restore').rec!.archived).toBe(false);
  });
  it('locked 记忆拒绝非 unlock 操作（G4）', () => {
    const locked = { ...base, locked: true };
    for (const op of ops.filter((o) => o !== 'unlock')) {
      const r = applyOp(locked, op);
      expect(r.ok).toBe(false);
      expect(r.audit).toBe('locked_blocked');
      expect(r.rec).toEqual(locked); // 记录不变
    }
    expect(applyOp(locked, 'unlock').ok).toBe(true);
  });
  it('importance/confidence 下限钳制', () => {
    const r = applyOp({ ...base, importance: 0.1, confidence: 0.05 }, 'forget');
    expect(r.rec!.importance).toBe(0.1);
    expect(r.rec!.confidence).toBe(0.05);
  });
});

describe('OP_TOAST', () => {
  it('覆盖全部操作且有文案', () => {
    const ops: MemoryOp[] = ['remember', 'forget', 'pin', 'unpin', 'lock', 'unlock', 'archive', 'restore', 'delete'];
    for (const op of ops) expect(OP_TOAST[op].length).toBeGreaterThan(0);
  });
});

describe('SEED_MEMORIES', () => {
  it('含 cold（仅 L2）样例且 mem_004 为 cold', () => {
    const c = SEED_MEMORIES.find((m) => m.id === 'mem_004')!;
    expect(decayClass(c)).toBe('cold');
    expect(summarizeContent(c)).toContain('L2 占位符');
  });
  it('含 locked 样例 mem_005', () => {
    expect(SEED_MEMORIES.find((m) => m.id === 'mem_005')!.locked).toBe(true);
  });
  it('含 pinned 样例且排序后置顶', () => {
    const sorted = sortMemories(SEED_MEMORIES);
    expect(sorted[0].pinned).toBe(true);
  });
});
