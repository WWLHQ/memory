// 自我净化与生长页规格常量（非演示数据）：五维默认权重 / 逐层阈值 / 标签 / 调度。
import type {
  DimKey, DimWeights, LayerThresholds, ScheduleItem,
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

export const OPT_CONDITIONS = {
  lower_threshold: 'hit_rate < 0.3',
  refine_keyword: 'L6 命中率 < 0.5',
  accelerate_decay: 'low_quality_ratio > 0.4',
  pre_index: '高频查询 Top20',
  regress_weights: '每周日 03:00',
} as const;

/** 调度（13.3）：衰减不可停（R5） */
export const DEFAULT_SCHEDULE: ScheduleItem[] = [
  { key: 'decay', label: '记忆衰减（遗忘曲线推进）', cron: '每日 02:00', required: true, enabled: true },
  { key: 'verdict_reminder', label: '冲突裁决提醒', cron: '每日 08:00', required: false, enabled: true },
  { key: 'self_growth', label: '自生长（权重回归）', cron: '每周日 03:00', required: false, enabled: true },
  { key: 'archive', label: '冷记忆归档', cron: '每月 1 日 04:00', required: false, enabled: true },
];
