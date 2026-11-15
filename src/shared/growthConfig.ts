// 生长配置单一真源（批次48 A23）：五维查重权重 / 逐层阈值 / 调度开关。
// 页面写、内核读；旧账本没有该记录 → 默认值（与此前规格常量一致），不做任何猜测性迁移。
// 校验口径：权重必须五维齐全、各 0–1、和 = 1（±1e-6）；阈值必须六层齐全、0–1、L1→L6 单调不减。
// 任何一项不合法 → 整块回退默认（不按比例偷偷修正，避免把坏配置改造成“看起来合理”的配置）。
import { nextDue, parseCron } from './cron.ts';

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

// ==================== M0：自我进化配置（可配项 + 护栏） ====================
//
// 默认 mode='suggest' 是硬约束：改造前「读取期召回权重只产建议、从不落地」。
// 默认值必须让旧账本行为逐字不变；auto 只能由用户显式开启。
// 安全方向：mode 非法 → 回退 suggest，**绝不回退 auto**。

export type EvolutionMode = 'off' | 'suggest' | 'auto';
export const EVOLUTION_MODES = ['off', 'suggest', 'auto'] as const;

/** 验证窗口（天）：判重 30 / 召回 7，与 regression.ts 的历史常量逐字对齐 */
export interface EvolutionWindow {
  dedup_days: number;
  recall_days: number;
}

/** 最小样本：不足即 insufficient，绝不猜 */
export interface EvolutionMinSamples {
  dedup_total: number;
  dedup_negatives: number;
  recall_count: number;
  recall_tagged: number;
}

/**
 * 回诊与回滚。**采纳时刻算死**并写进 growth_op.rollback_plan：
 * 若跟着配置走，会出现「已过 10 天、用户改成 14 天 → 任务又变回未到期」，历史计划被篡改、审计不可回放。
 */
export interface EvolutionRollback {
  after_days: number;
  min_recalls: number;
  /** 回诊主指标跌破该值 → 自动回滚（仅 auto） */
  max_drop: number;
}

/** 护栏：单次步长 / 累计漂移 / 冷却期 */
export interface EvolutionGuard {
  cooldown_days: number;
  max_step: number;
  max_drift: number;
}

export interface EvolutionConfig {
  mode: EvolutionMode;
  window: EvolutionWindow;
  /** 每次召回最多落多少条 per-hit 分量（10–50）：决定评估精度与审计体积 */
  sample_top_n: number;
  min_samples: EvolutionMinSamples;
  rollback: EvolutionRollback;
  guard: EvolutionGuard;
}

/**
 * 默认值全部等于改造前的硬编码常量：
 * 判重 30 天 / 40 条 / 负例 10（regression.ts:REGRESSION_WINDOW_DAYS/MIN_SAMPLES/MIN_NEGATIVES）、
 * 召回 7 天 / 30 次（RECALL_SUGGEST_WINDOW_DAYS/RECALL_SUGGEST_MIN_RECALLS）。
 * `recall_tagged=10` 是 M2 评估器的最小带标签样本，改造前无对应常量（此前从未验证过召回权重）。
 */
export const DEFAULT_EVOLUTION: EvolutionConfig = {
  mode: 'suggest',
  window: { dedup_days: 30, recall_days: 7 },
  sample_top_n: 20,
  min_samples: { dedup_total: 40, dedup_negatives: 10, recall_count: 30, recall_tagged: 10 },
  rollback: { after_days: 7, min_recalls: 20, max_drop: 0.03 },
  guard: { cooldown_days: 7, max_step: 0.05, max_drift: 0.15 },
};

const isNumIn = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** 进化配置主体（除 mode）合法？任一字段越界 → 整块回退默认 */
function validEvolutionBody(r: Record<string, unknown>): boolean {
  const w = (r.window && typeof r.window === 'object' ? r.window : {}) as Record<string, unknown>;
  const m = (r.min_samples && typeof r.min_samples === 'object' ? r.min_samples : {}) as Record<string, unknown>;
  const rb = (r.rollback && typeof r.rollback === 'object' ? r.rollback : {}) as Record<string, unknown>;
  const g = (r.guard && typeof r.guard === 'object' ? r.guard : {}) as Record<string, unknown>;
  return isIntIn(w.dedup_days, 1, 180)
    && isIntIn(w.recall_days, 1, 90)
    && isIntIn(r.sample_top_n, 10, 50)
    && isIntIn(m.dedup_total, 1, 10000)
    && isIntIn(m.dedup_negatives, 1, 10000)
    && isIntIn(m.recall_count, 1, 10000)
    && isIntIn(m.recall_tagged, 1, 10000)
    && isIntIn(rb.after_days, 1, 90)
    && isIntIn(rb.min_recalls, 0, 10000)
    && isNumIn(rb.max_drop, 0.01, 0.20)
    && isIntIn(g.cooldown_days, 1, 90)
    && isNumIn(g.max_step, 0.01, 0.20)
    && isNumIn(g.max_drift, 0.05, 0.50);
}

export function validEvolutionConfig(v: unknown): v is EvolutionConfig {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (!(EVOLUTION_MODES as readonly string[]).includes(r.mode as string)) return false;
  return validEvolutionBody(r);
}

/** 深拷贝默认块（避免页面改一处把共享常量也改了） */
export function cloneDefaultEvolution(mode: EvolutionMode = DEFAULT_EVOLUTION.mode): EvolutionConfig {
  return {
    mode,
    window: { ...DEFAULT_EVOLUTION.window },
    sample_top_n: DEFAULT_EVOLUTION.sample_top_n,
    min_samples: { ...DEFAULT_EVOLUTION.min_samples },
    rollback: { ...DEFAULT_EVOLUTION.rollback },
    guard: { ...DEFAULT_EVOLUTION.guard },
  };
}

/**
 * 归一化：mode 单独处理（非法 → suggest，绝不 auto）；其余字段任一非法 → 整块回退默认。
 * 保留合法 mode 是有意为之：用户显式选了 auto/off，不应因别的字段脏了就被改成 suggest。
 * 输出逐字段重建，绝不把账本里的未知字段带回来。
 */
export function normalizeEvolutionConfig(raw: unknown): EvolutionConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode: EvolutionMode =
    r.mode === 'off' || r.mode === 'auto' || r.mode === 'suggest' ? r.mode : 'suggest';
  if (!validEvolutionBody(r)) return cloneDefaultEvolution(mode);
  const w = r.window as unknown as EvolutionWindow;
  const m = r.min_samples as unknown as EvolutionMinSamples;
  const rb = r.rollback as unknown as EvolutionRollback;
  const g = r.guard as unknown as EvolutionGuard;
  return {
    mode,
    window: { dedup_days: w.dedup_days, recall_days: w.recall_days },
    sample_top_n: r.sample_top_n as number,
    min_samples: {
      dedup_total: m.dedup_total, dedup_negatives: m.dedup_negatives,
      recall_count: m.recall_count, recall_tagged: m.recall_tagged,
    },
    rollback: { after_days: rb.after_days, min_recalls: rb.min_recalls, max_drop: rb.max_drop },
    guard: { cooldown_days: g.cooldown_days, max_step: g.max_step, max_drift: g.max_drift },
  };
}

// ==================== M0：调度表达式可配 ====================

/**
 * 调度表达式（M0）：允许用户改「多久跑一次」。
 * 默认值 = SCHEDULE_TASKS.expr，逐字一致；旧账本无该字段 → 默认，行为不变。
 */
export type ScheduleExprs = Record<ScheduleKey, string>;

export const DEFAULT_SCHEDULE_EXPRS: ScheduleExprs = SCHEDULE_TASKS.reduce<ScheduleExprs>(
  (acc, t) => { acc[t.key] = t.expr; return acc; },
  {} as ScheduleExprs,
);

/**
 * 各任务允许的最短间隔（分钟）：防把回归改成每分钟跑，打爆 CPU 与审计表。
 * 自生长/归档 给 1 天：进化轮要读全量审计并做离线评估，过密无意义且会污染审计。
 */
export const SCHEDULE_MIN_INTERVAL_MIN: Record<ScheduleKey, number> = {
  decay: 15, verdict_reminder: 15, self_growth: 1440, archive: 1440,
};

/** 连续取 4 次到期，返回最小相邻间隔（分钟）；非法/不可达 → null */
export function minIntervalMinutes(expr: string, tzOffsetMin = 480): number | null {
  let cur = Date.UTC(2026, 0, 1, 0, 0, 0);
  const points: number[] = [];
  for (let i = 0; i < 4; i++) {
    const next = nextDue(expr, cur, tzOffsetMin);
    if (next === null) return null;
    points.push(next);
    cur = next;
  }
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++) min = Math.min(min, points[i] - points[i - 1]);
  return Number.isFinite(min) ? Math.round(min / 60000) : null;
}

/** 表达式集合有限，缓存避免热路径（每次召回都会 normalize）反复做日期搜索 */
const MIN_INTERVAL_CACHE = new Map<string, number | null>();
function cachedMinInterval(expr: string): number | null {
  const hit = MIN_INTERVAL_CACHE.get(expr);
  if (hit !== undefined) return hit;
  const v = minIntervalMinutes(expr);
  MIN_INTERVAL_CACHE.set(expr, v);
  return v;
}

export interface ScheduleExprCheck {
  ok: boolean;
  reason?: string;
  /** 该任务要求的最短间隔（分钟） */
  min_interval_min: number;
  /** 实际最小间隔（分钟）；不可解析 → null */
  actual_min: number | null;
}

/** 保存前校验：语法 + 最短间隔。页面用它拦下过密表达式（AC M0-6） */
export function validateScheduleExpr(key: ScheduleKey, expr: string): ScheduleExprCheck {
  const need = SCHEDULE_MIN_INTERVAL_MIN[key];
  if (typeof expr !== 'string' || parseCron(expr) === null) {
    return {
      ok: false, reason: '表达式非法：需要 5 段 cron（分 时 日 月 周）',
      min_interval_min: need, actual_min: null,
    };
  }
  const actual = cachedMinInterval(expr.trim());
  if (actual === null) {
    return {
      ok: false, reason: '表达式不可达（8 年内无到期时刻）',
      min_interval_min: need, actual_min: null,
    };
  }
  if (actual < need) {
    return {
      ok: false,
      reason: `间隔过密：当前约 ${actual} 分钟一次，该任务最短 ${need} 分钟`,
      min_interval_min: need, actual_min: actual,
    };
  }
  return { ok: true, min_interval_min: need, actual_min: actual };
}

/**
 * 逐 key 归一化：非法 key 单独回退该 key 默认，不牵连其他任务。
 * 硬护栏：即使有人直接改账本写入过密表达式，也在这里被拦回默认——
 * 过密值永远不生效（UI 保存路径会先经 validateScheduleExpr 给出明确原因，不是静默回退）。
 */
export function normalizeScheduleExprs(v: unknown): ScheduleExprs {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SCHEDULE_EXPRS };
  for (const k of SCHEDULE_KEYS) {
    const cur = r[k];
    if (typeof cur !== 'string') continue;
    const trimmed = cur.trim();
    if (parseCron(trimmed) === null) continue;
    const actual = cachedMinInterval(trimmed);
    if (actual === null || actual < SCHEDULE_MIN_INTERVAL_MIN[k]) continue;
    out[k] = trimmed;
  }
  return out;
}

/** 主进程取实际表达式：脏值/缺字段 → 该任务默认。调度与页面展示共用此函数 */
export function resolveScheduleExpr(key: ScheduleKey, exprs?: Partial<ScheduleExprs> | null): string {
  const v = exprs?.[key];
  return typeof v === 'string' && parseCron(v) !== null ? v : DEFAULT_SCHEDULE_EXPRS[key];
}

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
  /**
   * 自我进化可配项（M0）。缺省/非法 → DEFAULT_EVOLUTION（mode='suggest'），
   * 页面与调度行为与改造前逐字一致；只有用户显式开启 auto 才会自动采纳参数。
   */
  evolution: EvolutionConfig;
  /**
   * 调度表达式（M0）。缺省/非法 → DEFAULT_SCHEDULE_EXPRS（= SCHEDULE_TASKS.expr），
   * 主进程调度与页面展示共用；改它即改实际执行节奏。
   */
  schedule_exprs: ScheduleExprs;
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
    evolution: normalizeEvolutionConfig(r.evolution),
    schedule_exprs: normalizeScheduleExprs(r.schedule_exprs),
  };
}
