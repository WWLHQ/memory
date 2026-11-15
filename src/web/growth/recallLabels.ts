// 召回权重四分量的人话名（**唯一一份**，2026-11-14 用户硬性要求：UI 不出原始字段名/JSON）。
// 与 `forgetting.scoreParts` 一一对应，不是自创词：
//   w_f × freshness（新鲜度）· w_i × importance（重要性）
//   w_c × confidence（置信度）· w_a × boost（访问热度 = access_count/10）
// 数据层/审计层仍用 w_f/w_i/w_c/w_a（账本契约不动），只在渲染时翻译。
import { RECALL_KEYS, type RecallWeights } from '../../shared/growthConfig.ts';

export const RECALL_KEY_LABEL: Record<keyof RecallWeights, string> = {
  w_f: '新鲜度',
  w_i: '重要性',
  w_c: '置信度',
  w_a: '访问热度',
};

/** 四维权重 → 人话串：`新鲜度 0.35 · 重要性 0.30 · 置信度 0.15 · 访问热度 0.20` */
export function fmtRecallWeights(w: RecallWeights): string {
  return RECALL_KEYS.map((k) => `${RECALL_KEY_LABEL[k]} ${w[k].toFixed(2)}`).join(' · ');
}
