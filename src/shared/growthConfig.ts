// 生长配置单一真源（批次48 A23）：五维查重权重 / 逐层阈值 / 调度开关。
// 页面写、内核读；旧账本没有该记录 → 默认值（与此前规格常量一致），不做任何猜测性迁移。
// 校验口径：权重必须五维齐全、各 0–1、和 = 1（±1e-6）；阈值必须六层齐全、0–1、L1→L6 单调不减。
// 任何一项不合法 → 整块回退默认（不按比例偷偷修正，避免把坏配置改造成“看起来合理”的配置）。
export const DIM_KEYS = ['semantic', 'keyword', 'entity', 'structure', 'llm_judge'] as const;
export type DimKey = (typeof DIM_KEYS)[number];
export type DimWeights = Record<DimKey, number>;

/**
 * 召回打分权重（批次61 GAP-1）：使用数据 → 召回排序参数的唯一配置入口。
 * 与五维查重权重（DimWeights）是两件事：前者决定「读出时怎么排序」，后者决定「写入时算不算重复」。
 * 历史上前者写死在 `forgetting.ts:SCORE_WEIGHTS`，全仓无写入点，导致自生长只影响写入、不影响读出。
 */
export const RECALL_KEYS = ['w_f', 'w_i', 'w_c', 'w_a'] as const;
export type RecallKey = (typeof RECALL_KEYS)[number];
export type RecallWeights = Record<RecallKey, number>;

export const LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const;
export type Layer = (typeof LAYERS)[number];
export type LayerThresholds = Record<Layer, number>;

export const SCHEDULE_KEYS = ['decay', 'verdict_reminder', 'self_growth', 'archive'] as const;
export type ScheduleKey = (typeof SCHEDULE_KEYS)[number];
export type ScheduleFlags = Record<ScheduleKey, boolean>;

export const DEFAULT_WEIGHTS: DimWeights = {
  semantic: 0.35, keyword: 0.20, entity: 0.15, structure: 0.10, llm_judge: 0.20,
};

/**
 * 反馈回灌策略（批次61 GAP-2）：把 `feedback` 的 reject 累计接进净化动作。
 *
 * 为什么必须 `enabled: false` 缺省：历史行为是「reject 只降 confidence，到 0.05 需连续 9 次，
 * 实际近乎不触发」。若默认开启，升级后老账本的记忆会开始自行降档——用户无法解释的漂移。
 * 故一律由用户显式启用，默认值与改造前逐字等价（AC B1）。
 */
export interface FeedbackPolicy {
  /** 总开关：false = 只改 confidence，行为与改造前完全一致 */
  enabled: boolean;
  /** 统计窗口（天）：只数窗口内的 reject，避免历史积压一启用就批量降档 */
  window_days: number;
  /** 窗口内累计 reject 达到该次数才降档 */
  reject_downgrade_threshold: number;
}

export const DEFAULT_FEEDBACK_POLICY: FeedbackPolicy = {
  enabled: false, window_days: 30, reject_downgrade_threshold: 3,
};

const isIntIn = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** 反馈策略合法：开关为布尔、窗口 1–365 天、阈值 1–50 次；任一不合法 → 整块回退默认（保持关闭） */
export function validFeedbackPolicy(v: unknown): v is FeedbackPolicy {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.enabled === 'boolean'
    && isIntIn(r.window_days, 1, 365)
    && isIntIn(r.reject_downgrade_threshold, 1, 50);
}

/**
 * 召回打分默认权重：与内核历史常量 `forgetting.ts:SCORE_WEIGHTS` 逐字一致。
 * 为什么在 shared 里再定义一份：shared 不能反向引用 core（依赖方向是 core → shared），
 * 故这里是真源，`forgetting.ts` 反过来引用本常量——两处永不漂移。
 */
export const DEFAULT_RECALL_WEIGHTS: RecallWeights = {
  w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20,
};

export const DEFAULT_THRESHOLDS: LayerThresholds = {
  L1: 0.70, L2: 0.75, L3: 0.80, L4: 0.85, L5: 0.90, L6: 0.90,
};

export const DEFAULT_SCHEDULE_FLAGS: ScheduleFlags = {
  decay: true, verdict_reminder: true, self_growth: true, archive: true,
};

/**
 * 调度任务真源（批次48 A23.2）：主进程 cron 与页面展示共用同一份，避免「页面写 02:00、
 * 主进程跑 03:00」这类静默漂移。
 * - `expr` = 主进程实际执行的 5 段 cron（解释见 shared/cron.ts）；
 * - `when` = 页面展示口径（由同一规格人工维护，测试校验 expr 可解析）。
 */
export interface ScheduleTaskSpec {
  key: ScheduleKey;
  label: string;
  when: string;
  expr: string;
  /** 是否允许停用（衰减不可停，R5） */
  required: boolean;
}

export const SCHEDULE_TASKS: readonly ScheduleTaskSpec[] = [
  { key: 'decay', label: '记忆衰减（遗忘曲线推进）', when: '每日 02:00', expr: '0 2 * * *', required: true },
  { key: 'verdict_reminder', label: '冲突裁决提醒', when: '每日 08:00', expr: '0 8 * * *', required: false },
  { key: 'self_growth', label: '自生长（权重回归）', when: '每周日 03:00', expr: '0 3 * * 0', required: false },
  { key: 'archive', label: '冷记忆归档', when: '每月 1 日 04:00', expr: '0 4 1 * *', required: false },
];

export interface GrowthConfig {
  weights: DimWeights;
  thresholds: LayerThresholds;
  schedule: ScheduleFlags;
  /**
   * 召回打分权重（批次61 GAP-1）。缺省/非法 → DEFAULT_RECALL_WEIGHTS（= 历史常量），
   * 因此旧账本读出来与改造前逐字一致；只有显式保存过才改变读出排序。
   */
  recall_weights: RecallWeights;
  /**
   * 反馈回灌策略（批次61 GAP-2）。缺省/非法 → DEFAULT_FEEDBACK_POLICY（enabled:false），
   * 即「reject 只降 confidence」，与改造前逐字一致；只有用户显式启用才改变净化动作。
   */
  feedback_policy: FeedbackPolicy;
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

/** 召回权重合法：四维齐全、各 0–1、和 = 1（±1e-6）——与五维查重权重同一校验口径，坏块整块回退 */
export function validRecallWeights(v: unknown): v is RecallWeights {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  let sum = 0;
  for (const k of RECALL_KEYS) {
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
    recall_weights: validRecallWeights(r.recall_weights) ? { ...r.recall_weights } : { ...DEFAULT_RECALL_WEIGHTS },
    feedback_policy: validFeedbackPolicy(r.feedback_policy) ? { ...r.feedback_policy } : { ...DEFAULT_FEEDBACK_POLICY },
  };
}
