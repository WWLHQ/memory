// 自我净化与生长页规格常量（非演示数据）：五维默认权重 / 逐层阈值 / 标签 / 调度。
// 权重与阈值默认值单一真源在 shared/growthConfig.ts（内核、页面、测试共用一份）。
import type { DimWeights, LayerThresholds, ScheduleItem } from './types.ts';
import {
  DEFAULT_THRESHOLDS as SHARED_THRESHOLDS,
  DEFAULT_WEIGHTS as SHARED_WEIGHTS,
  SCHEDULE_TASKS,
  type DimKey,
} from '../../shared/growthConfig.ts';

export const DEFAULT_WEIGHTS: DimWeights = { ...SHARED_WEIGHTS };

export const DEFAULT_THRESHOLDS: LayerThresholds = { ...SHARED_THRESHOLDS };

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

/**
 * 调度（13.3）：衰减不可停（R5）。
 * 批次48 A23.2：时刻/标签/是否可停全部来自 shared/growthConfig.ts 的 SCHEDULE_TASKS
 * （主进程 cron 与页面展示同一份真源），这里只补页面态 enabled。
 */
export const DEFAULT_SCHEDULE: ScheduleItem[] = SCHEDULE_TASKS.map((t) => ({
  key: t.key, label: t.label, cron: t.when, required: t.required, enabled: true,
}));
