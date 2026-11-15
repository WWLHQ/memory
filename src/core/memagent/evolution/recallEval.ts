// M2（可验证的自动进化）· 召回权重离线评估引擎。
//
// 设计红线（见 specs/tasks/SELF-EVOLUTION.md §1/§6）：
// 1) 同一批数据：只用「同一次召唤的同一条 mems_detail」重算，禁止重跑向量检索（选候选集已变，那叫重新测量不是配对比较）；
// 2) 同一判据：主指标 NDCG@topK；护栏 reject_ratio / evidence_thin_ratio；
// 3) 显著性：配对符号检验（sign test）双侧 p ≤ 0.10，否则提升可能纯属噪音；
// 4) 诚实边界：只在 top N 内重排，第 N 名外换榜不可知（结论标注「在 top N 内评估」）。
//
// 本模块是**纯函数**：不读存储、不写审计。读取审计由调用方传入数组（M2-6：评估不做任何写入）。
import type { RecallWeights } from '../../../shared/growthConfig.ts';
import { type MemDetailRow } from '../forgetting.ts';
import type { AuditRecord } from '../types.ts';

/** 主指标提升门槛（与判重 MIN_F1_GAIN 同口径） */
export const MIN_NDCG_GAIN = 0.02;
/** 护栏指标允许的最大上升 */
export const MAX_GUARD_RISE = 0.02;
/** 配对符号检验双侧显著性阈值 */
export const SIGN_TEST_P = 0.10;
/** 默认评估深度（与 sample_top_n 默认一致） */
export const DEFAULT_EVAL_K = 20;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const avg = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** 用一套权重对 mems_detail 一行重算分数（与在线 scoreMemory 同一公式，但**不含 pinned +0.15**——tuple 未含 pinned，见诚实边界）。 */
export function rescoreRow(row: MemDetailRow, w: RecallWeights): number {
  const [, rel, f, imp, conf, boost] = row;
  const s = rel * (w.w_f * f + w.w_i * imp + w.w_c * conf + w.w_a * boost);
  return round3(s);
}

/** 按一套权重给同一批 mems_detail 重排，返回 mem_id 顺序（分数降序；平分保持原序，稳定排序）。 */
export function rankIds(rows: MemDetailRow[], w: RecallWeights): string[] {
  return rows
    .map((row) => ({ id: row[0], score: rescoreRow(row, w) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);
}

/** NDCG@k：rankedGains 已按召回顺序排好；二值/分级增益均适用。IDCG=0（全 0 增益）时返回 0。 */
export function ndcgAtK(rankedGains: number[], k: number): number {
  const dcg = (arr: number[]): number => arr
    .slice(0, Math.max(0, k))
    .reduce((acc, g, i) => acc + g / Math.log2(i + 2), 0); // 位置 1 → log2(2)=1
  const ideal = [...rankedGains].sort((a, b) => b - a);
  const idcg = dcg(ideal);
  if (idcg === 0) return 0;
  return dcg(rankedGains) / idcg;
}

/**
 * 配对符号检验（双侧精确二项检验，H0: p=0.5）。
 * 返回「sum of probabilities ≤ 观测尾概率」的精确双侧 p（n=0 时 p=1）。
 */
export function signTestP(improved: number, declined: number): number {
  const n = improved + declined;
  if (n === 0) return 1;
  const logC = (nn: number, kk: number): number => {
    // log(C(n,k)) 防溢出
    let s = 0;
    for (let i = 1; i <= kk; i++) s += Math.log(nn - kk + i) - Math.log(i);
    return s;
  };
  const pmf = (i: number): number => Math.exp(logC(n, i) - n * Math.LN2); // C(n,i)/2^n
  const observed = Math.min(improved, declined);
  const threshold = pmf(observed) + 1e-12;
  let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(i) <= threshold) p += pmf(i);
  return Math.min(1, p);
}

/** 护栏判定：reject_ratio / evidence_thin_ratio 相对基线的上升均 ≤ MAX_GUARD_RISE 才放行。 */
export function guardCheck(g?: {
  rejectFrom: number; rejectTo: number; thinFrom: number; thinTo: number;
}): { rejectRise: number; thinRise: number; pass: boolean } {
  if (!g) return { rejectRise: 0, thinRise: 0, pass: true };
  const rejectRise = round3(g.rejectTo - g.rejectFrom);
  const thinRise = round3(g.thinTo - g.thinFrom);
  const pass = rejectRise <= MAX_GUARD_RISE && thinRise <= MAX_GUARD_RISE;
  return { rejectRise, thinRise, pass };
}

export type EvalStatus = 'insufficient' | 'rejected' | 'suggest';
export interface EvalDecision {
  status: EvalStatus;
  reason: string;
  /** insufficient 时还差多少条（页面显示「还需 N 条」），其余为 0 */
  needMore: number;
}

/** 决策五态中的三态（M2 只产 insufficient / rejected / suggest；guarded / rolled_back 属 M3）。 */
export function decideOutcome(input: {
  samples: number; minSamples: number; gain: number; p: number; guardPass: boolean;
}): EvalDecision {
  if (input.samples < input.minSamples) {
    return {
      status: 'insufficient',
      reason: `样本不足：${input.samples}/${input.minSamples}`,
      needMore: input.minSamples - input.samples,
    };
  }
  if (!input.guardPass) {
    return { status: 'rejected', reason: '护栏指标上升超过上限，一票否决', needMore: 0 };
  }
  if (input.gain < MIN_NDCG_GAIN) {
    return { status: 'rejected', reason: `NDCG 提升 ${round3(input.gain).toFixed(3)} < ${MIN_NDCG_GAIN}`, needMore: 0 };
  }
  if (input.p > SIGN_TEST_P) {
    return { status: 'rejected', reason: `配对符号检验 p=${round3(input.p).toFixed(3)} > ${SIGN_TEST_P}（不显著）`, needMore: 0 };
  }
  return {
    status: 'suggest',
    reason: `NDCG 提升 ${round3(input.gain).toFixed(3)} 且 p=${round3(input.p).toFixed(3)} ≤ ${SIGN_TEST_P}`,
    needMore: 0,
  };
}

export interface EvalSample {
  /** 一次召回的 mems_detail（M1-2 埋点原样） */
  rows: MemDetailRow[];
  /** 强标签：mem_id → 增益（confirm=1 / reject=0）。只有强标签参与主 NDCG。 */
  labels: Record<string, number>;
  /** 弱标签：单独评估，**禁止** 混入强标签 NDCG（M2-5）。 */
  weakLabels?: Record<string, number>;
}

export interface EvalInput {
  samples: EvalSample[];
  wFrom: RecallWeights;
  wTo: RecallWeights;
  /** 最小召回样本数（来自 evolution.min_samples.recall_count） */
  minSamples: number;
  /** 评估深度 k（默认 DEFAULT_EVAL_K=20） */
  k?: number;
  /** 护栏输入（可缺省=不设护栏）；由调用方按评估窗口算好传入 */
  guard?: { rejectFrom: number; rejectTo: number; thinFrom: number; thinTo: number };
}

export interface RecallEvalResult {
  status: EvalStatus;
  reason: string;
  needMore: number;
  /** 参与主 NDCG 的有效样本数（有 ≥1 个强正标签且 mems_detail 可解析） */
  samples: number;
  meanFrom: number;
  meanTo: number;
  gain: number;
  improved: number;
  declined: number;
  p: number;
  guard: { rejectRise: number; thinRise: number; pass: boolean };
  /** 「在 top N 内评估」——样本中出现过的最大 mems_detail 条数 */
  topN: number;
  /** 弱标签单独评估结果（不参与主 NDCG） */
  weak?: { samples: number; meanFrom: number; meanTo: number; gain: number };
}

/** 单次召回：两套权重下各自重排后的 NDCG@k；无强正标签 → null（无法判别）。 */
function evalOne(
  rows: MemDetailRow[], labels: Record<string, number>, wFrom: RecallWeights, wTo: RecallWeights, k: number,
): { from: number; to: number } | null {
  const gainById = new Map<string, number>();
  let positives = 0;
  for (const r of rows) {
    const g = labels[r[0]] ?? 0;
    gainById.set(r[0], g);
    if (g > 0) positives += 1;
  }
  if (positives === 0) return null;
  const fromGains = rankIds(rows, wFrom).map((id) => gainById.get(id) ?? 0);
  const toGains = rankIds(rows, wTo).map((id) => gainById.get(id) ?? 0);
  return { from: ndcgAtK(fromGains, k), to: ndcgAtK(toGains, k) };
}

/**
 * 主入口：对同批 mems_detail 用 from/to 两套权重离线重算，产出决策。
 * - 有效样本 = 有强正标签的召回（无正标签的召回回 NDCG 恒 0，无法判别，跳过）；
 * - 提升 = mean(NDCG_to) − mean(NDCG_from)；
 * - 显著性 = 配对符号检验；护栏 = guardCheck。
 */
export function evaluateRecallWeights(input: EvalInput): RecallEvalResult {
  const k = input.k ?? DEFAULT_EVAL_K;
  const strong: { from: number; to: number }[] = [];
  const weak: { from: number; to: number }[] = [];
  let topN = 0;
  for (const s of input.samples) {
    topN = Math.max(topN, s.rows.length);
    const r = evalOne(s.rows, s.labels, input.wFrom, input.wTo, k);
    if (r) strong.push(r);
    if (s.weakLabels) {
      const wr = evalOne(s.rows, s.weakLabels, input.wFrom, input.wTo, k);
      if (wr) weak.push(wr);
    }
  }
  const samples = strong.length;
  const meanFrom = avg(strong.map((x) => x.from));
  const meanTo = avg(strong.map((x) => x.to));
  const gain = round3(meanTo - meanFrom);
  let improved = 0;
  let declined = 0;
  for (const x of strong) {
    if (x.to > x.from + 1e-9) improved += 1;
    else if (x.to < x.from - 1e-9) declined += 1;
  }
  const p = signTestP(improved, declined);
  const guard = guardCheck(input.guard);
  const decision = decideOutcome({ samples, minSamples: input.minSamples, gain, p, guardPass: guard.pass });

  const result: RecallEvalResult = {
    ...decision,
    samples,
    meanFrom: round3(meanFrom),
    meanTo: round3(meanTo),
    gain,
    improved,
    declined,
    p: round3(p),
    guard,
    topN,
  };
  if (weak.length > 0) {
    const wf = avg(weak.map((x) => x.from));
    const wt = avg(weak.map((x) => x.to));
    result.weak = { samples: weak.length, meanFrom: round3(wf), meanTo: round3(wt), gain: round3(wt - wf) };
  }
  return result;
}

/** mems_detail 行合法性（M1-5：旧审计无此字段 → 调用方如实跳过，不回填、不推断）。 */
export function isMemDetailRow(v: unknown): v is MemDetailRow {
  if (!Array.isArray(v) || v.length !== 6) return false;
  if (typeof v[0] !== 'string') return false;
  for (let i = 1; i < 6; i++) if (typeof v[i] !== 'number' || !Number.isFinite(v[i])) return false;
  return true;
}

/**
 * M2 审计适配器（纯函数，**只读**）：把 recall 审计与 recall_feedback 审计转成 EvalSample[]。
 * - 强标签只认 `recall_feedback` 的 confirm=1 / reject=0；disputed 属中标签，不进强 NDCG；
 * - 旧 recall 审计无 `mems_detail` → 计入 skippedOld 并跳过（M1-5），不补零、不推断。
 */
export function samplesFromAudits(
  recallAudits: AuditRecord[],
  feedbackAudits: AuditRecord[],
): { samples: EvalSample[]; skippedOld: number; skippedUnlabeled: number } {
  // 1) 按 recall_id 收强标签
  const labelsByRecall = new Map<string, Record<string, number>>();
  for (const a of feedbackAudits) {
    if (a.action !== 'recall_feedback') continue;
    const d = a.detail as { recall_id?: unknown; mem_id?: unknown; verdict?: unknown };
    if (typeof d.recall_id !== 'string' || typeof d.mem_id !== 'string') continue;
    const gain = d.verdict === 'confirm' ? 1 : d.verdict === 'reject' ? 0 : null;
    if (gain === null) continue; // disputed / 其它 → 不作强标签
    const bucket = labelsByRecall.get(d.recall_id) ?? {};
    bucket[d.mem_id] = gain;
    labelsByRecall.set(d.recall_id, bucket);
  }
  // 2) 逐条 recall 取 mems_detail 配对
  const samples: EvalSample[] = [];
  let skippedOld = 0;
  let skippedUnlabeled = 0;
  for (const a of recallAudits) {
    if (a.action !== 'recall') continue;
    const md = a.detail.mems_detail;
    if (!Array.isArray(md)) { skippedOld += 1; continue; }
    const labels = labelsByRecall.get(a.request_id);
    if (!labels || Object.keys(labels).length === 0) { skippedUnlabeled += 1; continue; }
    const rows = md.filter(isMemDetailRow);
    if (rows.length === 0) { skippedOld += 1; continue; }
    samples.push({ rows, labels });
  }
  return { samples, skippedOld, skippedUnlabeled };
}
