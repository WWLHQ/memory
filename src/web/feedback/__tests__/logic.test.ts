import { describe, it, expect } from 'vitest';
import { trustDelta, validateDraft, statShare } from '../logic.ts';
import { SEED_FEEDBACKS } from '../seed.ts';
import type { FeedbackDraft } from '../types.ts';

const d = (over: Partial<FeedbackDraft>): FeedbackDraft => ({
  memory_id: 'mem_001', action: 'confirm', rating: 3, comment: '', ...over,
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
  it('reject 无原因 → warning 不阻断', () => {
    const v = validateDraft(d({ action: 'reject' }));
    expect(v.error).toBeNull();
    expect(v.warning).toContain('自生长');
  });
  it('reject 有原因 → 全通过', () => {
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
});
