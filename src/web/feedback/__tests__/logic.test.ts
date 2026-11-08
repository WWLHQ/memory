import { describe, it, expect } from 'vitest';
import { trustDelta, validateDraft, statShare } from '../logic.ts';
import { SEED_FEEDBACKS } from './fixtures.ts';
import type { FeedbackDraft } from '../types.ts';

const d = (over: Partial<FeedbackDraft>): FeedbackDraft => ({
  memory_id: 'mem_001', action: 'confirm', rating: 5, comment: '可用', ...over,
});

describe('trustDelta（17.4）', () => {
  it('confirm +0.1 / reject −0.05 / disputed 0', () => {
    expect(trustDelta('confirm')).toBe(0.1);
    expect(trustDelta('reject')).toBe(-0.05);
    expect(trustDelta('disputed')).toBe(0);
  });
});

describe('validateDraft（13.7）', () => {
  it('memory_id 必填', () => {
    expect(validateDraft(d({ memory_id: '' })).error).toContain('必填');
  });
  it('未选评分（0）→ 拦截，不再默认 3 星', () => {
    expect(validateDraft(d({ rating: 0 })).error).toContain('选择 1–5 星');
  });
  it('空评论 → 拦截（reject 同时保留自生长 warning）', () => {
    const v = validateDraft(d({ action: 'reject', comment: '   ' }));
    expect(v.error).toContain('不允许空评论');
    expect(v.warning).toContain('自生长');
  });
  it('reject 有评分有原因 → 全通过', () => {
    const v = validateDraft(d({ action: 'reject', comment: '过时' }));
    expect(v.error).toBeNull();
    expect(v.warning).toBeNull();
  });
});

describe('statShare（7.1/7.2）', () => {
  const s = statShare(SEED_FEEDBACKS);
  it('占比统计', () => {
    expect(s.total).toBe(5);
    expect(s.confirm).toBe(3);
    expect(s.reject).toBe(1);
    expect(s.disputed).toBe(1);
  });
  it('rating 分布与均分', () => {
    expect(s.ratingDist).toEqual([0, 1, 1, 1, 2]);
    expect(s.avgRating).toBe(3.8);
  });
  it('trust 累计 = 3×0.1 − 0.05 = 0.25', () => {
    expect(s.trustTotal).toBe(0.25);
  });
  it('TopN', () => {
    expect(s.topLiked[0].rating).toBe(5);
    expect(s.topDisliked[0].rating).toBe(2);
  });
  it('未评分记录（rating=0）不进均值/分布/TopN，也不冒充 3 星（批次48 A13）', () => {
    const mixed = statShare([
      { id: 'a', memory_id: 'm1', action: 'confirm', rating: 0, comment: '', trust_delta: 0.1, created_at: '' },
      { id: 'b', memory_id: 'm2', action: 'reject', rating: 5, comment: '过时', trust_delta: -0.05, created_at: '' },
    ]);
    expect(mixed.ratingDist).toEqual([0, 0, 0, 0, 1]);
    expect(mixed.avgRating).toBe(5);
    expect(mixed.topLiked.map((r) => r.id)).toEqual(['b']);
    expect(mixed.topDisliked.map((r) => r.id)).toEqual(['b']);
    expect(mixed.total).toBe(2);      // 动作占比仍按全部记录
  });
});
