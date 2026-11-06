// 批次48 A23.3：写入期判重决策的离线回归（用户已定 6 条定义，原方案落地）。
//
// 1) 目标函数 = 写入期「合并 / 不合并」二分类的 **F1**（positive = 合并）。
// 2) 成功门槛 = 测试集 F1 提升 ≥ 0.02 且 precision 下降 ≤ 0.05，两者同时满足才采纳。
// 3) 样本不足（总数 < 40 或负例 < 10）→ 不调整，写 `insufficient_samples` 审计并带 counts。
// 4) 允许同时调整权重与逐层阈值；阈值限 [0.50, 0.95]、六层单调不减、末尾合法性校验，不合法回滚。
// 5) 反馈时间窗 30 天；同一记忆多次反馈取最近一次。
// 6) 冷启动不回溯推断历史五维分：只读带 `dedup_eval`（dims + policy 快照）的写入记录，
//    没有埋点的旧记录一律不参与（no-op 期间如实积累样本）。
//
// 训练的标签 = 系统当时真实做出的合并/不合并决定（不是人工标注）。因此评估集衡量的是
// 「新参数对历史决策的复现程度」——这是用户定义的口径，不做二次解释。
// 限制：每条写入只保留当时最优候选的五维分，换权重后候选排序可能变化，无法回溯；
// 该限制在审计里以 `note` 如实标注。

import {
  LAYERS, validThresholds, validWeights,
  type DimWeights, type GrowthConfig, type Layer, type LayerThresholds,
} from '../../shared/growthConfig.ts';
import { DEDUP_EVAL_SCHEMA_V, weightedDedupScore, type DimensionScores } from './dedup.ts';
import { growthConfigFromLedger, saveGrowthConfigToLedger } from './paramsSnapshot.ts';
import { sha256hex } from './sync.ts';
import { ulid } from './ulid.ts';
import type { AuditRecord, Form, StorageBackend } from './types.ts';

export const REGRESSION_WINDOW_DAYS = 30;
export const MIN_SAMPLES = 40;
export const MIN_NEGATIVES = 10;
export const MIN_F1_GAIN = 0.02;
export const MAX_PRECISION_DROP = 0.05;
export const THRESHOLD_MIN = 0.50;
export const THRESHOLD_MAX = 0.95;

const DAY = 24 * 3600_000;

export interface DedupSample {
  mem_id: string;
  ts: number;
  layer: Layer;
  dims: DimensionScores;
  /** 标签：true = 当时合并了（grafted），false = 未合并 */
  merged: boolean;
}

export interface SampleCounts {
  total: number;
  positives: number;
  negatives: number;
  window_days: number;
}

export interface ClassificationMetrics {
  f1: number;
  precision: number;
  recall: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  n: number;
}

export interface MetricsBundle {
  train: ClassificationMetrics;
  test: ClassificationMetrics;
}

export type RegressionRunResult =
  | { status: 'insufficient_samples'; counts: SampleCounts }
  | {
    status: 'not_adopted';
    reason: string;
    counts: SampleCounts;
    before: MetricsBundle;
    after: MetricsBundle;
    proposed: GrowthConfig;
  }
  | {
    status: 'adopted';
    counts: SampleCounts;
    before: MetricsBundle;
    after: MetricsBundle;
    config: GrowthConfig;
  };

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** 审计里 dedup_eval 的结构（写入期埋点，A23.3）；缺字段的历史记录返回 null（不回溯推断） */
function evalOf(detail: Record<string, unknown> | undefined): { layer: Layer; dims: DimensionScores; merged: boolean } | null {
  const e = detail?.dedup_eval as Record<string, unknown> | undefined;
  if (!e || typeof e !== 'object') return null;
  // 只采信当前埋点版本：旧版本不回填、不推断（规则 6）
  if (e.schema_v !== DEDUP_EVAL_SCHEMA_V) return null;
  if (typeof e.layer !== 'string' || !(LAYERS as readonly string[]).includes(e.layer)) return null;
  if (typeof e.merged !== 'boolean') return null;
  const d = e.dims as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return null;
  for (const k of ['semantic', 'keyword', 'entity', 'structure'] as const) {
    if (typeof d[k] !== 'number' || !Number.isFinite(d[k])) return null;
  }
  const judge = typeof d.judge === 'number' && Number.isFinite(d.judge) ? d.judge : undefined;
  return {
    layer: e.layer as Layer,
    dims: {
      semantic: d.semantic as number, keyword: d.keyword as number,
      entity: d.entity as number, structure: d.structure as number, judge,
    },
    merged: e.merged,
  };
}

/**
 * 从真实写入审计抽取样本（时间窗内、同一 mem_id 取最近一次）。
 * 标签按 `detail.dedup === 'grafted'` 对齐（埋点的 merged 字段是同一决策的冗余记录）。
 */
export function collectDedupSamples(
  audits: AuditRecord[], now: number, windowDays = REGRESSION_WINDOW_DAYS,
): DedupSample[] {
  const since = now - windowDays * DAY;
  const latest = new Map<string, DedupSample>();
  for (const a of audits) {
    if (a.action !== 'write' || a.ts < since || a.ts > now) continue;
    const detail = a.detail as Record<string, unknown> | undefined;
    const ev = evalOf(detail);
    if (!ev) continue;
    const memId = detail?.mem_id;
    if (typeof memId !== 'string' || !memId) continue;
    const prev = latest.get(memId);
    if (prev && prev.ts >= a.ts) continue;
    const label = detail?.dedup === 'grafted' ? true : detail?.dedup === 'new' ? false : ev.merged;
    latest.set(memId, { mem_id: memId, ts: a.ts, layer: ev.layer, dims: ev.dims, merged: label });
  }
  return [...latest.values()].sort((a, b) => a.ts - b.ts || a.mem_id.localeCompare(b.mem_id));
}

export function countSamples(samples: DedupSample[], windowDays = REGRESSION_WINDOW_DAYS): SampleCounts {
  const positives = samples.filter((s) => s.merged).length;
  return { total: samples.length, positives, negatives: samples.length - positives, window_days: windowDays };
}

/** 分类指标（positive = 合并；阈值按样本自身层级取） */
export function classify(
  samples: DedupSample[], weights: DimWeights, thresholds: LayerThresholds,
): ClassificationMetrics {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const s of samples) {
    const predicted = weightedDedupScore(s.dims, weights) >= thresholds[s.layer];
    if (s.merged && predicted) tp++;
    else if (!s.merged && predicted) fp++;
    else if (s.merged && !predicted) fn++;
    else tn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    f1: round3(f1), precision: round3(precision), recall: round3(recall), tp, fp, fn, tn,
    n: samples.length,
  };
}

/** 确定性 70/30 划分：按 mem_id 哈希分桶（同一账本任何时候结果一致） */
export function splitSamples(samples: DedupSample[]): { train: DedupSample[]; test: DedupSample[] } {
  const train: DedupSample[] = [];
  const test: DedupSample[] = [];
  for (const s of samples) {
    const bucket = parseInt(sha256hex(s.mem_id).slice(0, 2), 16) % 10;
    (bucket < 7 ? train : test).push(s);
  }
  return { train, test };
}

/**
 * 权重候选：llm_judge 保持当前值（样本里缺 judge 时该权重本就被归一化剔除），
 * 其余四维在剩余权重池上按步长枚举。顺序固定 → 结果确定。
 */
function weightCandidates(current: DimWeights): DimWeights[] {
  const judge = current.llm_judge;
  const pool = 1 - judge;
  if (!(pool > 0)) return [{ ...current }];
  const step = Math.abs(pool / 0.1 - Math.round(pool / 0.1)) < 1e-9 ? 0.1 : 0.05;
  const units = Math.floor(pool / step + 1e-9);
  const out: DimWeights[] = [{ ...current }];
  for (let a = 0; a <= units; a++) {
    for (let b = 0; a + b <= units; b++) {
      for (let c = 0; a + b + c <= units; c++) {
        const structure = round3(1 - judge - a * step - b * step - c * step);
        const cand: DimWeights = {
          semantic: round3(a * step), keyword: round3(b * step), entity: round3(c * step),
          structure, llm_judge: round3(judge),
        };
        if (validWeights(cand)) out.push(cand);
      }
    }
  }
  return out;
}

/** 单层阈值在 [0.50,0.95] 上的最优值（按该层训练样本 F1；该层样本不足时保留原值） */
function tuneThreshold(level: Layer, train: DedupSample[], weights: DimWeights, current: number): number {
  const rows = train.filter((s) => s.layer === level);
  const positives = rows.filter((s) => s.merged).length;
  if (rows.length < 5 || positives === 0 || positives === rows.length) {
    // 少于 5 条或只有单一类别 → 不动（避免用无区分度的数据把阈值拉到边界）
    return current;
  }
  let best = current;
  let bestF1 = classify(rows, weights, makeThresholds(current)).f1;
  for (let v = THRESHOLD_MIN; v <= THRESHOLD_MAX + 1e-9; v += 0.01) {
    const t = Math.round(v * 100) / 100;
    const f1 = classify(rows, weights, makeThresholds(t)).f1;
    if (f1 > bestF1) { bestF1 = f1; best = t; }
  }
  return best;
}

function makeThresholds(v: number): LayerThresholds {
  const out = { L1: v, L2: v, L3: v, L4: v, L5: v, L6: v } as LayerThresholds;
  return out;
}

/** 六层单调不减投影（只向上抬后层，不改变已合法的前层） */
function monotonic(t: LayerThresholds): LayerThresholds {
  const out = { ...t };
  for (let i = 1; i < LAYERS.length; i++) {
    out[LAYERS[i]] = Math.max(out[LAYERS[i]], out[LAYERS[i - 1]]);
  }
  return out;
}

export interface RegressionOptions {
  now?: number;
  windowDays?: number;
}

/** 纯算法：样本 → 是否采纳（不写审计、不落库；I/O 由 runGrowthRegression 负责） */
export function evaluateRegression(
  samples: DedupSample[], current: GrowthConfig, opts: RegressionOptions = {},
): RegressionRunResult {
  const windowDays = opts.windowDays ?? REGRESSION_WINDOW_DAYS;
  const counts = countSamples(samples, windowDays);
  if (counts.total < MIN_SAMPLES || counts.negatives < MIN_NEGATIVES) {
    return { status: 'insufficient_samples', counts };
  }
  const { train, test } = splitSamples(samples);
  const testPositive = test.filter((s) => s.merged).length;
  if (test.length < 10 || testPositive === 0 || testPositive === test.length) {
    return {
      status: 'not_adopted', reason: 'test_split_degenerate', counts,
      before: { train: classify(train, current.weights, current.thresholds), test: classify(test, current.weights, current.thresholds) },
      after: { train: classify(train, current.weights, current.thresholds), test: classify(test, current.weights, current.thresholds) },
      proposed: current,
    };
  }

  const baseline = {
    train: classify(train, current.weights, current.thresholds),
    test: classify(test, current.weights, current.thresholds),
  };

  // 1) 权重：按训练集微 F1 选最优（并列时取离当前权重更近者）
  let bestWeights = current.weights;
  let bestThresholds = current.thresholds;
  let bestTrainF1 = baseline.train.f1;
  let bestDistance = 0;
  for (const w of weightCandidates(current.weights)) {
    const tunedRaw: LayerThresholds = { ...current.thresholds };
    for (const level of LAYERS) tunedRaw[level] = tuneThreshold(level, train, w, current.thresholds[level]);
    const tuned = monotonic(tunedRaw);
    const f1 = classify(train, w, tuned).f1;
    const distance = (Object.keys(w) as (keyof DimWeights)[])
      .reduce((acc, k) => acc + Math.abs(w[k] - current.weights[k]), 0);
    if (f1 > bestTrainF1 || (f1 === bestTrainF1 && distance < bestDistance)) {
      bestWeights = w; bestThresholds = tuned; bestTrainF1 = f1; bestDistance = distance;
    }
  }

  const proposed: GrowthConfig = {
    weights: bestWeights,
    thresholds: bestThresholds,
    schedule: current.schedule,
  };
  const after = {
    train: classify(train, bestWeights, bestThresholds),
    test: classify(test, bestWeights, bestThresholds),
  };

  // 2) 合法性校验：不合法一律回滚（definition 4）
  if (!validWeights(proposed.weights) || !validThresholds(proposed.thresholds)) {
    return { status: 'not_adopted', reason: 'invalid_proposal', counts, before: baseline, after, proposed };
  }

  // 3) 成功门槛：测试集 F1 提升 ≥ 0.02 且 precision 下降 ≤ 0.05
  const f1Gain = after.test.f1 - baseline.test.f1;
  const precisionDrop = baseline.test.precision - after.test.precision;
  if (f1Gain >= MIN_F1_GAIN && precisionDrop <= MAX_PRECISION_DROP) {
    return { status: 'adopted', counts, before: baseline, after, config: proposed };
  }
  return {
    status: 'not_adopted',
    reason: f1Gain < MIN_F1_GAIN ? 'f1_gain_below_threshold' : 'precision_drop_over_threshold',
    counts, before: baseline, after, proposed,
  };
}

export interface RegressionRunOptions extends RegressionOptions {
  requestId: string;
  form: Form;
  enterpriseId?: string;
  teamId?: string;
}

/**
 * 完整一趟：读真实审计 → 评估 → 写审计（insufficient_samples / weight_regression / weight_tuned）
 * → 采纳时把新配置落 growth:v1 账本（唯一写入口 saveGrowthConfigToLedger）。
 * 不伪造：任何一步没有真实证据就按其结果如实落账。
 */
export async function runGrowthRegression(
  storage: StorageBackend, opts: RegressionRunOptions,
): Promise<RegressionRunResult> {
  const now = opts.now ?? Date.now();
  const audits = await storage.queryAudit({});
  const samples = collectDedupSamples(audits, now, opts.windowDays ?? REGRESSION_WINDOW_DAYS);
  const current = growthConfigFromLedger(await storage.listMemories({}));
  const result = evaluateRegression(samples, current, { now, windowDays: opts.windowDays });

  if (result.status === 'insufficient_samples') {
    await storage.appendAudit({
      request_id: opts.requestId, action: 'insufficient_samples', form: opts.form,
      project_id: 'P_SYSTEM', ts: now,
      detail: { kind: 'dedup_regression', ...result.counts, minimum: { total: MIN_SAMPLES, negatives: MIN_NEGATIVES } },
    });
    return result;
  }

  if (result.status === 'not_adopted') {
    await storage.appendAudit({
      request_id: opts.requestId, action: 'weight_regression', form: opts.form,
      project_id: 'P_SYSTEM', ts: now,
      detail: {
        kind: 'dedup_regression', status: 'not_adopted', reason: result.reason, counts: result.counts,
        before: result.before, after: result.after, proposed: result.proposed,
        note: '未采纳：不改任何权重/阈值（账本保持原配置）',
      },
    });
    return result;
  }

  await saveGrowthConfigToLedger(storage, result.config, {
    requestId: opts.requestId, form: opts.form,
    enterpriseId: opts.enterpriseId, teamId: opts.teamId,
  });
  await storage.appendAudit({
    request_id: opts.requestId, action: 'weight_tuned', form: opts.form,
    project_id: 'P_SYSTEM', ts: now,
    detail: {
      kind: 'dedup_regression', status: 'adopted', trigger: 'regression',
      counts: result.counts,
      before: { weights: current.weights, thresholds: current.thresholds },
      after: { weights: result.config.weights, thresholds: result.config.thresholds },
      metrics: { before: result.before, after: result.after },
      note: '已采纳：仅保留当时最优候选的五维分，换权重后的候选重排无法回溯（样本口径限制）',
    },
  });
  return result;
}

/** 供主进程 cron 任务使用的 request_id（确定性可读前缀 + ulid） */
export function regressionRequestId(now: number): string {
  return `req_reg_${ulid(now)}`;
}




