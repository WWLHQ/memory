// P2-8 §3.4 模式反馈真实落盘：写内核审计 action=mode_feedback。
// 边界：本模块只负责「把用户这一次判断如实写进账本」；它不声称已进 7.2 样本池——
// 7.2 的读取/热更接线属 P2-9 待拍板范围，未批准前不得冒充已闭环。
import { getKernelStorage } from '../kernel.ts';
import type { Mode } from './types.ts';

export type ModeFeedbackVerdict = 'up' | 'down';
export const MODE_FEEDBACK_REASONS = ['召回内容不对', '模式选错', '其它'] as const;
export type ModeFeedbackReason = typeof MODE_FEEDBACK_REASONS[number];

export interface ModeFeedbackInput {
  /** 与 mode_dispatch / recall 审计同一 request_id，便于按链路回放 */
  request_id: string;
  /** 本次生效模式；自动观测档传 'auto'，不伪装成某个具体模式 */
  mode: Mode | 'auto';
  verdict: ModeFeedbackVerdict;
  reason?: ModeFeedbackReason;
  /** 用户指定 / 自动分流，与 ModeBanner 同口径 */
  source: 'manual' | 'auto';
}

export type ModeFeedbackOutcome =
  | { ok: true; request_id: string }
  | { ok: false; error: string };

/** 提交模式反馈：真写审计；写失败如实返回错误，页面不得显示「已记录」。 */
export async function coreSubmitModeFeedback(d: ModeFeedbackInput): Promise<ModeFeedbackOutcome> {
  try {
    await getKernelStorage().appendAudit({
      request_id: d.request_id,
      action: 'mode_feedback',
      form: 'web',
      ts: Date.now(),
      detail: {
        mode: d.mode,
        verdict: d.verdict,
        verdict_zh: d.verdict === 'up' ? '模式选对' : '模式选错',
        reason: d.reason ?? null,
        source: d.source,
      },
    });
    return { ok: true, request_id: d.request_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
