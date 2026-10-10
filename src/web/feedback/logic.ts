// 用户反馈页（REQ-006 / P9）纯逻辑层
import type { FeedbackAction, FeedbackDraft, FeedbackRecord } from './types.ts';

/** trust_delta（17.4）：confirm +0.1 / reject −0.05 / disputed 0（转人工） */
export function trustDelta(a: FeedbackAction): number {
  return a === 'confirm' ? 0.1 : a === 'reject' ? -0.05 : 0;
}

/** 表单校验：memory_id 必填；reject 建议填 comment（warning，不阻断） */
export function validateDraft(d: FeedbackDraft): { error: string | null; warning: string | null } {
  if (!d.memory_id) return { error: '请选择 memory_id（必填）', warning: null };
  if (d.action === 'reject' && !d.comment.trim())
    return { error: null, warning: 'reject 建议填写原因，便于自生长归因（7.2）' };
  return { error: null, warning: null };
}

/** 统计卡（7.1/7.2） */
export interface FeedbackStats {
  confirm: number;
  reject: number;
  disputed: number;
  total: number;
  ratingDist: number[]; // index 0 → 1星
  avgRating: number;
  trustTotal: number;
  topLiked: FeedbackRecord[];
  topDisliked: FeedbackRecord[];
}

export function statShare(list: FeedbackRecord[]): FeedbackStats {
  const n = list.length || 1;
  const ratingDist = [0, 0, 0, 0, 0];
  let sum = 0;
  for (const f of list) {
    ratingDist[f.rating - 1] += 1;
    sum += f.rating;
  }
  const byRating = [...list].sort((a, b) => b.rating - a.rating);
  return {
    confirm: list.filter((f) => f.action === 'confirm').length,
    reject: list.filter((f) => f.action === 'reject').length,
    disputed: list.filter((f) => f.action === 'disputed').length,
    total: list.length,
    ratingDist,
    avgRating: Math.round((sum / n) * 100) / 100,
    trustTotal: Math.round(list.reduce((s, f) => s + f.trust_delta, 0) * 100) / 100,
    topLiked: byRating.slice(0, 2),
    topDisliked: byRating.slice(-2).reverse(),
  };
}

/** 提交后的反馈记录（request_id 继承链路，fb_ 前缀） */
export function composeRecord(d: FeedbackDraft, seq: number, requestId: string): FeedbackRecord {
  return { ...d, id: `fb_${String(seq).padStart(3, '0')}`, trust_delta: trustDelta(d.action), created_at: new Date().toISOString(), ...(requestId ? {} : {}) };
}
