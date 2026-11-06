// 全局参数页默认值与展示标签（规格常量；用户保存后以内核 preference 快照为真相）。
import type { DevParams, KbPolicyRow, NormalConfig } from './types.ts';
import { CATEGORIES, type Category } from '../../core/memagent/types.ts';
import { policyFor } from '../../core/memagent/forgetting.ts';

/** 普通配置默认（规格表：中/数月/开/重要） */
export const DEFAULT_CONFIG: NormalConfig = {
  forget_speed: 'mid',
  retention: 'months',
  auto_organize: true,
  importance: 'important',
  cost_cny_per_mtok: null,
  proxy_price_cny_per_kcall: null,
  proxy_daily_quota: null,
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

/** 六类知识库展示名：键恒为内核真实 Category，不另造一套分类 */
export const CATEGORY_LABEL: Record<Category, string> = {
  fact: '事实',
  decision: '决策',
  pitfall: '坑 / 任务状态',
  insight: '洞察',
  preference: '偏好',
  context: '上下文',
};

/**
 * 阶段5-E / B9：知识库策略展示值的单一真源。
 * 旧默认值是原型期编造的六个中文分类 + 另一套数字（30/60/90/45/14/7 天），
 * 与内核遗忘策略实际生效的 365/180/30/14/30/2 天完全不一致，且保存进偏好记忆后
 * 从不驱动遗忘执行 —— 属演示数据。现直接由内核 policyFor(category) 派生，
 * 页面上不再维护第二份策略表；分类键也统一成内核 CATEGORIES。
 * 注意：auto_archive_days 只存在于内核策略表，classifyLayer() 按固定 3/30/90 天做层迁移，
 * 不读取该值 —— 表格如实标注「内核未使用」，不假装它驱动归档。
 */
export function kernelKbPolicies(): KbPolicyRow[] {
  return CATEGORIES.map((kb) => {
    const p = policyFor(kb);
    return {
      kb,
      half_life_days: p.half_life_days,
      archive_days: p.auto_archive_days,
      merge_on: p.auto_merge === true, // 'cautious' 按内核口径记作不自动合并
    };
  });
}

export const DEFAULT_KB_POLICIES: KbPolicyRow[] = kernelKbPolicies();

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
