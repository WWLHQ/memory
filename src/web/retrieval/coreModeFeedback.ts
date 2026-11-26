// P2-8 §3.4 模式反馈真实落盘：写内核审计 action=mode_feedback。
// 边界：本模块只负责「把用户这一次判断如实写进账本」；它不声称已进 7.2 样本池——
// 7.2 的读取/热更接线属 P2-9 待拍板范围，未批准前不得冒充已闭环。
import { getKernelStorage } from '../kernel.ts';
import type { Mode, Scene } from './types.ts';

export type ModeFeedbackVerdict = 'up' | 'down';
export const MODE_FEEDBACK_REASONS = ['召回内容不对', '模式选错', '其它'] as const;
export type ModeFeedbackReason = typeof MODE_FEEDBACK_REASONS[number];

/** 目标模式合法值：五种具体模式（不含 auto——自动是观测档不是目标） */
export const EXPECTED_MODES: Mode[] = ['top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'];

export interface ModeFeedbackInput {
  /** 与 mode_dispatch / recall 审计同一 request_id，便于按链路回放 */
  request_id: string;
  /** 本次生效模式；自动观测档传 'auto'，不伪装成某个具体模式 */
  mode: Mode | 'auto';
  verdict: ModeFeedbackVerdict;
  reason?: ModeFeedbackReason;
  /** 用户指定 / 自动分流，与 ModeBanner 同口径 */
  source: 'manual' | 'auto';
  /** 用户认为「应该分到哪个模式」。仅 👎+模式选错 时有效，其余一律归一化写 null */
  expected_mode?: Mode | null;
  /** 本次场景：critical 下禁选极简（对齐 P2-8 手动模式约束）；缺字段按非 critical */
  scene?: Scene;
}

/**
 * 目标模式归一化（B 效果 + C 变异验证的落点）：
 *  · 仅 verdict=down 且 reason=模式选错 才可能写出非 null；其余三种情况一律 null。
 *  · 非法值 / auto / 与当前生效模式相同（选了等于没说）/ critical 下的 minimal → 一律 null，不猜。
 * 这是纯函数，UI 与账本共用同一口径，避免第二套判断。
 */
export function normalizeExpectedMode(
  raw: Mode | null | undefined,
  ctx: { verdict: ModeFeedbackVerdict; reason?: ModeFeedbackReason; mode: Mode | 'auto'; scene?: Scene },
): Mode | null {
  if (ctx.verdict !== 'down' || ctx.reason !== '模式选错') return null;
  if (!raw || !EXPECTED_MODES.includes(raw)) return null;
  if (raw === ctx.mode) return null;
  if (ctx.scene === 'critical' && raw === 'minimal') return null;
  return raw;
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
        expected_mode: normalizeExpectedMode(d.expected_mode, {
          verdict: d.verdict, reason: d.reason, mode: d.mode, scene: d.scene,
        }),
      },
    });
    return { ok: true, request_id: d.request_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
