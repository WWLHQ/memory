// P14 种子数据：五维默认权重 / 逐层阈值 / 判重样本 / 反馈指标 / 五项优化 / 调度 / Δ 曲线
import type {
  DedupSample, DeltaPoint, DimKey, DimWeights, GrowthMetrics, LayerThresholds, ScheduleItem,
} from './types.ts';

export const DEFAULT_WEIGHTS: DimWeights = {
  semantic: 0.35, keyword: 0.20, entity: 0.15, structure: 0.10, llm_judge: 0.20,
};

export const DEFAULT_THRESHOLDS: LayerThresholds = {
  L1: 0.70, L2: 0.75, L3: 0.80, L4: 0.85, L5: 0.90, L6: 0.90,
};

export const DIM_LABELS: Record<DimKey, string> = {
  semantic: '语义（semantic）',
  keyword: '关键词（keyword）',
  entity: '实体（entity）',
  structure: '结构（structure）',
  llm_judge: 'LLM 裁决（llm_judge）',
};

export const LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const;

/** 判重样本池：「重新判重」轮换；含未命中（全层走完走新建）与跨层命中演示 */
export const SAMPLES: DedupSample[] = [
  {
    id: 's1', label: '「用户偏好深色主题 · 凌晨使用多」', target: 'L2',
    dims: { semantic: 0.91, keyword: 0.62, entity: 0.70, structure: 0.55, llm_judge: 0.88 },
  },
  {
    id: 's2', label: '「API 网关超时重试策略 · 指数退避」', target: 'L4',
    dims: { semantic: 0.44, keyword: 0.85, entity: 0.40, structure: 0.66, llm_judge: 0.35 },
  },
  {
    id: 's3', label: '「部署脚本使用 Docker Compose v2」', target: 'L1',
    dims: { semantic: 0.96, keyword: 0.78, entity: 0.82, structure: 0.71, llm_judge: 0.93 },
  },
  {
    id: 's4', label: '「季度汇报模板 · 数据看板优先」', target: 'L3',
    dims: { semantic: 0.55, keyword: 0.48, entity: 0.62, structure: 0.52, llm_judge: 0.41 },
  },
];

/** 24h 查重统计（6.2，演示） */
export const DEDUP_STATS_24H = { short_circuit_hits: 37, merged: 21, avg_cost_ms: 6.4 };

/** 自生长反馈指标（7.1，只读；种子值演示 C2/C5/③ 触发） */
export const SEED_METRICS: GrowthMetrics = {
  hit_rate: 0.28,          // < 0.3 → ① 降阈值触发（C2）
  confirmed: 132,
  rejected: 41,
  low_quality_ratio: 0.45, // > 0.4 → ③ 加速遗忘触发
  level_stats_L6: 0.42,    // < 0.5 → ② 关键词提取优化触发（C5）
  latency_ms: 218,
};

export const OPT_CONDITIONS = {
  lower_threshold: 'hit_rate < 0.3',
  refine_keyword: 'L6 命中率 < 0.5',
  accelerate_decay: 'low_quality_ratio > 0.4',
  pre_index: '高频查询 Top20',
  regress_weights: '每周日 03:00',
} as const;

/** 调度（13.3）：衰减不可停（R5） */
export const SEED_SCHEDULE: ScheduleItem[] = [
  { key: 'decay', label: '记忆衰减（遗忘曲线推进）', cron: '每日 02:00', required: true, enabled: true },
  { key: 'verdict_reminder', label: '冲突裁决提醒', cron: '每日 08:00', required: false, enabled: true },
  { key: 'self_growth', label: '自生长（权重回归）', cron: '每周日 03:00', required: false, enabled: true },
  { key: 'archive', label: '冷记忆归档', cron: '每月 1 日 04:00', required: false, enabled: true },
];

/** 7 日 Δ 曲线（R3：取自 7.1 真实反馈演示数据；周日点 is_tuned） */
export const SEED_DELTA: DeltaPoint[] = [
  { day: '周一', delta: 0.012, is_tuned: false },
  { day: '周二', delta: 0.018, is_tuned: false },
  { day: '周三', delta: 0.015, is_tuned: false },
  { day: '周四', delta: 0.024, is_tuned: false },
  { day: '周五', delta: 0.021, is_tuned: false },
  { day: '周六', delta: 0.026, is_tuned: false },
  { day: '周日', delta: 0.041, is_tuned: true },
];
