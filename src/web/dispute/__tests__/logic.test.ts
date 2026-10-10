import { describe, it, expect } from 'vitest';
import { typeLabel, overdueDays, isOverdue, applyVerdict, auditPair, queueSort } from '../logic.ts';
import { SEED_CONFLICTS } from '../seed.ts';
import type { ConflictRecord } from '../types.ts';

const rec = (over: Partial<ConflictRecord>): ConflictRecord => ({
  id: 'cf', old_id: 'o1', new_id: 'n1', old_content: '旧', new_content: '新',
  old_confidence: 0.7, new_confidence: 0.8, conflict_type: 'direct_contradiction',
  conflict_score: 0.9, dispute_flag: true, overdue_days: 1,
  created_at: '2026-10-08T09:00:00.000Z', ...over,
});

describe('typeLabel', () => {
  it('四类中文可读', () => {
    expect(typeLabel('direct_contradiction')).toBe('直接矛盾');
    expect(typeLabel('partial_overlap')).toBe('部分重叠');
    expect(typeLabel('context_dependent')).toBe('语境相关');
    expect(typeLabel('uncertain')).toBe('不确定');
  });
});

describe('overdueDays / isOverdue', () => {
  const now = new Date('2026-10-09T09:00:00.000Z').getTime();
  it('距今天数', () => {
    expect(overdueDays('2026-10-08T09:00:00.000Z', now)).toBe(1);
    expect(overdueDays('2026-10-09T09:00:00.000Z', now)).toBe(0);
  });
  it('>7 天判定超期（12.1）', () => {
    expect(isOverdue(rec({ created_at: '2026-10-01T09:00:00.000Z' }), now)).toBe(true);
    expect(isOverdue(rec({ created_at: '2026-10-08T09:00:00.000Z' }), now)).toBe(false);
  });
});

describe('applyVerdict', () => {
  it('auto_override：旧 deprecated + 新 trust+0.1 + replaced_by 回填', () => {
    const r = applyVerdict(rec({ new_confidence: 0.85 }), 'auto_override');
    expect(r.old_status).toBe('deprecated');
    expect(r.new_confidence).toBe(0.95);
    expect(r.replaced_by).toBe('n1');
  });
  it('user_confirm：新值挂 dispute', () => {
    expect(applyVerdict(rec({}), 'user_confirm').new_disputed).toBe(true);
  });
  it('merge：两条均 deprecated + 合并占位', () => {
    const r = applyVerdict(rec({}), 'merge');
    expect(r.merged).toBe(true);
    expect(r.old_status).toBe('deprecated');
  });
  it('hold：维持 dispute', () => {
    expect(applyVerdict(rec({}), 'hold').held).toBe(true);
  });
});

describe('auditPair', () => {
  it('old_id/new_id 成对（18.4 约束5）', () => {
    const a = auditPair(rec({ old_id: 'o1', new_id: 'n1' }), 'auto_override', 'req_x');
    expect(a.old_id).toBe('o1');
    expect(a.new_id).toBe('n1');
    expect(a.action).toBe('dispute');
    expect(a.request_id).toBe('req_x');
    expect(a.note).toContain('deprecated');
  });
  it('各 verdict note 不同', () => {
    const ns = (['auto_override', 'user_confirm', 'merge', 'hold'] as const).map(
      (v) => auditPair(rec({}), v, 'r').note,
    );
    expect(new Set(ns).size).toBe(4);
  });
});

describe('queueSort', () => {
  it('仅 dispute_flag=true 且按超期降序', () => {
    const now = new Date('2026-10-09T09:00:00.000Z').getTime();
    const list = [
      rec({ id: 'a', created_at: '2026-10-08T09:00:00.000Z', dispute_flag: true }),
      rec({ id: 'b', created_at: '2026-10-01T09:00:00.000Z', dispute_flag: true }),
      rec({ id: 'c', created_at: '2026-10-05T09:00:00.000Z', dispute_flag: false }),
    ];
    const sorted = queueSort(list, now);
    expect(sorted.map((r) => r.id)).toEqual(['b', 'a']); // 超期最久的 b 在前，非 dispute 的 c 被滤
  });
});

describe('种子覆盖', () => {
  it('四种 conflict_type 全覆盖', () => {
    const types = new Set(SEED_CONFLICTS.map((r) => r.conflict_type));
    expect(
      ['direct_contradiction', 'partial_overlap', 'context_dependent', 'uncertain'].every(
        (t) => types.has(t as ConflictRecord['conflict_type']),
      ),
    ).toBe(true);
  });
  it('含超期>7d 与已替代样本', () => {
    expect(SEED_CONFLICTS.some((r) => r.overdue_days > 7)).toBe(true);
    expect(SEED_CONFLICTS.some((r) => r.replaced_by)).toBe(true);
  });
});
