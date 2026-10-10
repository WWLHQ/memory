// 全局参数页（REQ-006 / P5）种子数据
import type { DevParams, KbPolicyRow, NormalConfig } from './types.ts';

/** 普通配置默认（规格表：中/数月/开/重要） */
export const DEFAULT_CONFIG: NormalConfig = {
  forget_speed: 'mid',
  retention: 'months',
  auto_organize: true,
  importance: 'important',
};

export const SPEED_LABEL: Record<NormalConfig['forget_speed'], string> = {
  slow: '慢', mid: '中', fast: '快',
};
export const RETENTION_LABEL: Record<NormalConfig['retention'], string> = {
  long: '长期', months: '数月', weeks: '数周', short: '短期',
};
export const IMPORTANCE_LABEL: Record<NormalConfig['importance'], string> = {
  normal: '普通', important: '重要', locked: '锁定',
};

/** 六类知识库策略（17.6） */
export const SEED_KB_POLICIES: KbPolicyRow[] = [
  { kb: '项目知识', half_life_days: 30, archive_days: 180, merge_on: true },
  { kb: '决策知识', half_life_days: 60, archive_days: 365, merge_on: true },
  { kb: '偏好知识', half_life_days: 90, archive_days: 365, merge_on: false },
  { kb: '流程知识', half_life_days: 45, archive_days: 270, merge_on: true },
  { kb: '事实知识', half_life_days: 14, archive_days: 90, merge_on: true },
  { kb: '上下文知识', half_life_days: 7, archive_days: 30, merge_on: false },
];

/** 开发者模式默认（2.4.3 / 2.4.1 / 15.3 / 9.10） */
export const DEFAULT_DEV: DevParams = {
  weights: { w_f: 0.35, w_i: 0.3, w_c: 0.15, w_a: 0.2 },
  payload: { soft: 1500, warn: 2000, break: 3000 },
  cold: { cold_sim: 0.85, dormant_sim: 0.9, top1_min: 0.6, l2_max_tokens: 200 },
  n_days: 90,
  m_days: 180,
};

/** 重要性等级映射（15.1，等级 5 永不清除 —— 只读展示） */
export const LEVEL_MAPPING = [
  { level: 1, weight: '0.5x', decay: '0.99/天', clearable: true },
  { level: 2, weight: '0.8x', decay: '0.98/天', clearable: true },
  { level: 3, weight: '1.0x', decay: '0.97/天', clearable: true },
  { level: 4, weight: '2.0x', decay: '0.95/天', clearable: true },
  { level: 5, weight: '3.0x', decay: '0.90/天', clearable: false },
];
