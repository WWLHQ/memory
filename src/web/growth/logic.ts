// P14 纯逻辑（T2）：五维加权 / 逐层阈值 / 短路嫁接 / 优化评估 / Δ 收益 / 调度校验 / 审计
import type {
  DedupSample, DeltaPoint, DimKey, DimWeights, GrowthAuditEntry, GrowthMetrics,
  Layer, LayerThresholds, OptimizationItem, ScheduleItem, ShortCircuitStep,
} from './types.ts';
import { LAYERS, OPT_CONDITIONS } from './seed.ts';

/** 六维加权平均（6.1：五维权重，和=1.0） */
export function weightedScore(dims: Record<DimKey, number>, w: DimWeights): number {
  const sum = (Object.keys(dims) as DimKey[]).reduce((acc, k) => acc + dims[k] * w[k], 0);
  return Math.round(sum * 1000) / 1000;
}

export function layerThresholdOf(layer: Layer, t: LayerThresholds): number {
  return t[layer];
}

/** 6.1：score ≥ threshold 判重 */
export function isDuplicate(score: number, threshold: number): boolean {
  return score >= threshold;
}

/** R1/C1：五维权重和=1.0（容差 1e-6），各维 0–1 */
export function validateWeights(w: DimWeights): { ok: boolean; sum: number; msg: string } {
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) return { ok: false, sum, msg: `R1 五维权重之和必须 = 1.0（当前 ${sum.toFixed(4)}）` };
  const bad = Object.entries(w).find(([, v]) => v < 0 || v > 1);
  if (bad) return { ok: false, sum, msg: `R1 权重须在 0–1：${bad[0]}=${bad[1]}` };
  return { ok: true, sum, msg: '' };
}

/** R1：逐层阈值 L1→L6 单调不减，且 0–1 */
export function validateThresholds(t: LayerThresholds): { ok: boolean; msg: string } {
  for (let i = 0; i < LAYERS.length; i++) {
    const v = t[LAYERS[i]];
    if (v < 0 || v > 1) return { ok: false, msg: `阈值须在 0–1：${LAYERS[i]}=${v}` };
    if (i > 0 && v < t[LAYERS[i - 1]]) {
      return { ok: false, msg: `R1 逐层阈值须单调不减：${LAYERS[i]}(${v}) < ${LAYERS[i - 1]}(${t[LAYERS[i - 1]]})` };
    }
  }
  return { ok: true, msg: '' };
}

/**
 * 6.2 短路嫁接：写入 → 从 L1 逐层查重 → 命中层即合并停止，未命中走新建。
 * score 为样本综合分，thresholds 为逐层阈值；短路 = 只查到命中层为止。
 */
export function shortCircuitPath(sample: DedupSample, w: DimWeights, t: LayerThresholds): ShortCircuitStep[] {
  const score = weightedScore(sample.dims, w);
  const steps: ShortCircuitStep[] = [];
  for (const layer of LAYERS) {
    const hit = isDuplicate(score, t[layer]);
    steps.push({ layer, hit, action: hit ? '合并至该层并停止（短路）' : undefined });
    if (hit) break;
  }
  if (steps.every((s) => !s.hit)) {
    steps.push({ layer: '新建', hit: false, action: '全层未命中 → 新建记忆' });
  }
  return steps;
}

/**
 * 7.2 五项自动优化评估（只读指标驱动，不改指标）：
 * ① hit_rate<0.3 ② L6<0.5 ③ low_quality_ratio>0.4 ④ 高频 Top20（演示恒 idle/可手动） ⑤ 每周日 03:00
 */
export function evaluateOptimizations(m: GrowthMetrics): OptimizationItem[] {
  return [
    {
      key: 'lower_threshold', title: '① 降低判重阈值', condition: OPT_CONDITIONS.lower_threshold,
      action: 'adjust_threshold(lower)', auditName: '阈值变更',
      state: m.hit_rate < 0.3 ? 'triggered' : 'idle', triggeredBy: `hit_rate=${m.hit_rate.toFixed(2)}`,
    },
    {
      key: 'refine_keyword', title: '② 优化关键词提取', condition: OPT_CONDITIONS.refine_keyword,
      action: 'refine_keyword_extraction', auditName: 'keyword_refined',
      state: m.level_stats_L6 < 0.5 ? 'triggered' : 'idle', triggeredBy: `L6=${m.level_stats_L6.toFixed(2)}`,
    },
    {
      key: 'accelerate_decay', title: '③ 加速遗忘', condition: OPT_CONDITIONS.accelerate_decay,
      action: 'accelerate_decay', auditName: '衰减变更',
      state: m.low_quality_ratio > 0.4 ? 'triggered' : 'idle', triggeredBy: `low_quality=${m.low_quality_ratio.toFixed(2)}`,
    },
    {
      key: 'pre_index', title: '④ 预建索引', condition: OPT_CONDITIONS.pre_index,
      action: 'build_pre_index', auditName: '索引构建',
      state: 'idle', triggeredBy: 'Top20 高频查询',
    },
    {
      key: 'regress_weights', title: '⑤ 权重回归', condition: OPT_CONDITIONS.regress_weights,
      action: 'regress_mode_weights', auditName: 'weight_tuned',
      state: 'idle', triggeredBy: '周期调度',
    },
  ];
}

/** R3/C4：Δ = 调权重后命中率 − 调权重前命中率（入参取自真实 7.1 反馈） */
export function growthDelta(before: number, after: number): number {
  return Math.round((after - before) * 1000) / 1000;
}

/** 13.3：手动触发一次自生长 = 追加一个 is_tuned 点（Δ 来自真实反馈差值） */
export function appendTunedPoint(series: DeltaPoint[], day: string, delta: number): DeltaPoint[] {
  return [...series, { day, delta, is_tuned: true }].slice(-14);
}

/** R5/C6：调度至少保留每日 02:00 衰减，停用衰减 → 拒 */
export function validateSchedule(items: ScheduleItem[]): { ok: boolean; msg: string } {
  const decay = items.find((s) => s.key === 'decay');
  if (decay && !decay.enabled) return { ok: false, msg: 'R5 衰减调度不可停用（至少保留衰减，13.3）' };
  return { ok: true, msg: '' };
}

/** R2/G6：优化动作写审计；⑤ 权重回归与手动触发 → weight_tuned（R4 等价 ⑤） */
export function auditOptimization(
  opt: { auditName: string; action: string; key: string },
  extra: Record<string, unknown>,
  manual = false,
): GrowthAuditEntry {
  const isWeightTuned = opt.key === 'regress_weights' || manual;
  return {
    event: isWeightTuned ? 'weight_tuned' : opt.auditName,
    action: opt.action,
    payload: JSON.stringify(extra),
    at: Date.now(),
  };
}
