// 排序反馈（2026-11-26，方案 MODE-FEEDBACK-TARGET-FIELD.md §2.2）：
// 用户在召回结果页点「这条应该排第一」→ 写 recall_feedback 审计（复用既有 action，不改记忆置信）。
// detail.rank_wrong=true 与 expected_first_id=记忆 id 是读取侧产 weight_step 建议的唯一证据来源；
// 不写这两字段就当没有排序反馈，绝不从点击行为猜「应该排第一」是哪条。
import { getKernelStorage } from '../kernel.ts';

export interface RankFeedbackInput {
  /** 与本次召回同一 request_id（ModeBannerData.request_id） */
  request_id: string;
  /** 用户认为应该排第一的记忆 id */
  expected_first_id: string;
}

export type RankFeedbackOutcome = { ok: true; request_id: string } | { ok: false; error: string };

export async function coreSubmitRankFeedback(d: RankFeedbackInput): Promise<RankFeedbackOutcome> {
  if (!d.request_id || !d.expected_first_id) {
    return { ok: false, error: 'request_id 与 expected_first_id 都不能为空' };
  }
  try {
    await getKernelStorage().appendAudit({
      request_id: d.request_id,
      action: 'recall_feedback',
      form: 'web',
      ts: Date.now(),
      detail: { rank_wrong: true, expected_first_id: d.expected_first_id },
    });
    return { ok: true, request_id: d.request_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
