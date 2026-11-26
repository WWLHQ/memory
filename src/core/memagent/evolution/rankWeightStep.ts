// weight_step 建议（2026-11-26，方案 MODE-FEEDBACK-TARGET-FIELD.md §2.2）：
// 排序反馈 recall_feedback.detail.rank_wrong=true + expected_first_id 给出「正确条目没排第一」的信号。
// 证据来源只有账本真实字段：同 request_id 的 recall.mems_detail（per-hit 四分量）+ 用户点名的 expected_first_id。
// 纯函数：不读存储、不写配置；建议由 loop.ts 落库。绝不从「用户点了某条」猜他想要哪条排第一。
import type { RecallWeights } from '../../../shared/growthConfig.ts';
import type { AuditRecord } from '../types.ts';
import { rankIds } from './recallEval.ts';
import { type MemDetailRow } from '../forgetting.ts';

/** weight_step 是 recall 打分权重的同模式内微调，走独立建议/审计事件，绝不塞进 mode_dispatch 快照 */
export interface WeightStepProposal {
  family: 'recall_weights';
  kind: 'weight_step';
  dimension: keyof RecallWeights;
  from: RecallWeights;
  to: RecallWeights;
  reason: string;
  sample_request_ids: string[];
}

const DETAIL_KEYS: Array<keyof RecallWeights> = ['w_f', 'w_i', 'w_c', 'w_a'];
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

const detailOf = (a: AuditRecord): Record<string, unknown> =>
  a.detail && typeof a.detail === 'object' ? a.detail as Record<string, unknown> : {};

export interface RankSample {
  request_id: string;
  ts: number;
  rows: MemDetailRow[];
  /** 用户点名「应该排第一」的 mem_id */
  expected_first_id: string;
  /** 当前实际排第一的 mem_id（由 mems_detail + 现行权重重排得出，不是审计里的原始 hits 顺序） */
  current_first_id: string | null;
}

/** 账本 → 有效排序样本（同 request_id 去重；缺 mems_detail / 点名条目不在候选 → 跳过，不猜） */
export function buildRankSamples(
  audits: AuditRecord[],
  current: RecallWeights,
  opts: { now: number; windowDays: number; since?: number },
): { samples: RankSample[]; skipped: number } {
  const DAY = 24 * 3600 * 1000;
  const from = opts.now - Math.max(1, opts.windowDays) * DAY;
  const since = opts.since ?? 0;
  const recalls = new Map<string, MemDetailRow[]>();
  for (const a of audits) {
    if (a.action !== 'recall') continue;
    const raw = detailOf(a).mems_detail;
    if (!Array.isArray(raw)) continue;
    const rows = raw.filter((r): r is MemDetailRow => Array.isArray(r) && r.length >= 6);
    if (rows.length) recalls.set(a.request_id, rows);
  }
  const seen = new Set<string>();
  const samples: RankSample[] = [];
  let skipped = 0;
  for (const a of audits) {
    if (a.action !== 'recall_feedback') continue;
    if (a.ts < from || a.ts <= since) continue;
    const d = detailOf(a);
    if (d.rank_wrong !== true || typeof d.expected_first_id !== 'string' || !d.expected_first_id) continue;
    if (seen.has(a.request_id)) continue;
    seen.add(a.request_id);
    const rows = recalls.get(a.request_id);
    if (!rows || !rows.some((r) => r[0] === d.expected_first_id)) { skipped += 1; continue; }
    const order = rankIds(rows, current);
    samples.push({
      request_id: a.request_id, ts: a.ts, rows,
      expected_first_id: d.expected_first_id,
      current_first_id: order[0] ?? null,
    });
  }
  return { samples, skipped };
}

/**
 * 找出「把哪一维 +step 后，被点名条目能排第一」。
 * 遍历四个分量各试一次（只加不减），命中即记该维度；全不命中返回 null（不硬凑建议）。
 */
function helpfulDimension(row: MemDetailRow, rows: MemDetailRow[], current: RecallWeights, step: number): keyof RecallWeights | null {
  const [, , f, imp, conf, boost] = row;
  const vals: Record<keyof RecallWeights, number> = { w_f: f, w_i: imp, w_c: conf, w_a: boost };
  for (const k of DETAIL_KEYS) {
    if (vals[k] <= 0) continue; // 该条目这维本就为 0，加权重也没用
    const to: RecallWeights = { ...current, [k]: round3(current[k] + step) };
    // 此消彼长：从其余三维按现值比例扣回，保持权重和=1
    const others = DETAIL_KEYS.filter((x) => x !== k);
    const otherSum = others.reduce((s, x) => s + current[x], 0);
    if (otherSum <= 0) continue;
    for (const x of others) to[x] = round3(current[x] * (1 - to[k]) / otherSum);
    // 整块校验前置：和必须为 1（round3 累计误差 ≤0.002 可接受）
    const sum = DETAIL_KEYS.reduce((s, x) => s + to[x], 0);
    if (Math.abs(sum - 1) > 0.005) continue;
    if (rankIds(rows, to)[0] === row[0]) return k;
  }
  return null;
}

/**
 * 产 weight_step 建议：≥2 条不同 request_id 指向同一维度（且步长 ≤ max_step）才产一条。
 * 权重和=1、此消彼长；走 recall_weights 族的独立建议，不与 mode_dispatch 混。
 */
export function proposeWeightStep(
  samples: RankSample[],
  current: RecallWeights,
  maxStep: number,
): { proposal: WeightStepProposal | null; reason: string } {
  if (samples.length === 0) return { proposal: null, reason: '无有效排序反馈（需 recall_feedback.rank_wrong + expected_first_id 且候选可解析）' };
  const counts = new Map<keyof RecallWeights, string[]>();
  for (const s of samples) {
    const row = s.rows.find((r) => r[0] === s.expected_first_id);
    if (!row) continue;
    const k = helpfulDimension(row, s.rows, current, maxStep);
    if (!k) continue;
    counts.set(k, [...(counts.get(k) ?? []), s.request_id]);
  }
  const top = [...counts.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  if (!top) return { proposal: null, reason: '排序反馈未集中在单一可调维度（≥2 条不同请求才产建议）' };
  const [dim, ids] = top;
  const keys = DETAIL_KEYS;
  const to: RecallWeights = { ...current, [dim]: round3(current[dim] + maxStep) };
  const others = keys.filter((x) => x !== dim);
  const otherSum = others.reduce((s, x) => s + current[x], 0);
  if (otherSum <= 0) return { proposal: null, reason: '其余维度权重和为 0，无法此消彼长' };
  for (const x of others) to[x] = round3(current[x] * (1 - to[dim]) / otherSum);
  return {
    proposal: {
      family: 'recall_weights', kind: 'weight_step',
      dimension: dim,
      from: { ...current }, to,
      reason: `${ids.length} 条排序反馈指向「${dim}」维度：用户点名的条目调高该维度后可排第一，建议步长 +${maxStep}（此消彼长、权重和=1）`,
      sample_request_ids: ids,
    },
    reason: '',
  };
}
