// 生长配置单一真源（批次48 A23）：五维查重权重 / 逐层阈值 / 调度开关。
// 页面写、内核读；旧账本没有该记录 → 默认值（与此前规格常量一致），不做任何猜测性迁移。
// 校验口径：权重必须五维齐全、各 0–1、和 = 1（±1e-6）；阈值必须六层齐全、0–1、L1→L6 单调不减。
// 任何一项不合法 → 整块回退默认（不按比例偷偷修正，避免把坏配置改造成“看起来合理”的配置）。
export const DIM_KEYS = ['semantic', 'keyword', 'entity', 'structure', 'llm_judge'] as const;
export type DimKey = (typeof DIM_KEYS)[number];
export type DimWeights = Record<DimKey, number>;

export const LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const;
export type Layer = (typeof LAYERS)[number];
export type LayerThresholds = Record<Layer, number>;

export const SCHEDULE_KEYS = ['decay', 'verdict_reminder', 'self_growth', 'archive'] as const;
export type ScheduleKey = (typeof SCHEDULE_KEYS)[number];
export type ScheduleFlags = Record<ScheduleKey, boolean>;

export const DEFAULT_WEIGHTS: DimWeights = {
  semantic: 0.35, keyword: 0.20, entity: 0.15, structure: 0.10, llm_judge: 0.20,
};

export const DEFAULT_THRESHOLDS: LayerThresholds = {
  L1: 0.70, L2: 0.75, L3: 0.80, L4: 0.85, L5: 0.90, L6: 0.90,
};

export const DEFAULT_SCHEDULE_FLAGS: ScheduleFlags = {
  decay: true, verdict_reminder: true, self_growth: true, archive: true,
};

export interface GrowthConfig {
  weights: DimWeights;
  thresholds: LayerThresholds;
  schedule: ScheduleFlags;
}

const isUnit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** 权重合法：五维齐全、各 0–1、和 = 1（±1e-6） */
export function validWeights(v: unknown): v is DimWeights {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  let sum = 0;
  for (const k of DIM_KEYS) {
    if (!isUnit(r[k])) return false;
    sum += r[k] as number;
  }
  return Math.abs(sum - 1) <= 1e-6;
}

/** 阈值合法：六层齐全、各 0–1、L1→L6 单调不减 */
export function validThresholds(v: unknown): v is LayerThresholds {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  for (let i = 0; i < LAYERS.length; i++) {
    const cur = r[LAYERS[i]];
    if (!isUnit(cur)) return false;
    if (i > 0 && (cur as number) < (r[LAYERS[i - 1]] as number)) return false;
  }
  return true;
}

/** 调度开关：缺失/非布尔 → 该键取默认；衰减不可停（R5）恒 true */
export function normalizeScheduleFlags(v: unknown): ScheduleFlags {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SCHEDULE_FLAGS };
  for (const k of SCHEDULE_KEYS) {
    if (k === 'decay') continue;
    if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  }
  return out;
}

/** 任意账本/页面输入 → 合法配置；坏块回退默认，绝不“修正”成看似合理的值 */
export function normalizeGrowthConfig(raw: unknown): GrowthConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<GrowthConfig>;
  return {
    weights: validWeights(r.weights) ? { ...r.weights } : { ...DEFAULT_WEIGHTS },
    thresholds: validThresholds(r.thresholds) ? { ...r.thresholds } : { ...DEFAULT_THRESHOLDS },
    schedule: normalizeScheduleFlags(r.schedule),
  };
}
