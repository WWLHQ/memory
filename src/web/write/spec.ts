// 写入页（REQ-006 / P2）规格常量（非演示数据）
// ⚠ 查重候选不再有种子：页面挂载时从真实账本（coreListExisting）读取既有记忆，
//   空账本即无候选（诚实空态）。
import { DEDUP_THRESHOLDS } from '../../core/memagent/layerRules.ts';
import { policyFor } from '../../core/memagent/forgetting.ts';
import type { Category } from '../../core/memagent/types.ts';
import type { LayerName, MemoryCategory } from './types.ts';

/** 标签联想候选（规格常量，非演示记忆数据） */
export const TAG_SUGGESTIONS: string[] = [
  'tech-stack', 'constraint', 'pitfall', 'preference', 'workflow', 'git',
  'db', 'compliance', 'project', 'feedback', 'decision', 'legacy',
];

/**
 * 批次48 A18：六类知识库 → 内核 17.6 策略预览。
 * 旧实现是手抄的一张表（fact 90 天 / decision 180 天 / preference 365 天），与内核 POLICIES
 * （fact 365 / decision 30 / preference 180）逐项对不上 —— 页面「预览」是假数字。
 * 现直接读 `policyFor()` 这份内核真源；写入类别到内核 Category 的映射如下：
 * decision→decision / pitfall→pitfall / preference→preference / fact→fact /
 * project→insight（工作项目档）/ feedback→preference（用户反馈归入偏好画像）。
 */
export const KERNEL_CATEGORY: Record<MemoryCategory, Category> = {
  decision: 'decision',
  pitfall: 'pitfall',
  preference: 'preference',
  fact: 'fact',
  project: 'insight',
  feedback: 'preference',
};

function mergeLabel(auto: boolean | 'cautious'): string {
  return auto === true ? '自动合并（相似≥3）' : auto === 'cautious' ? '需人工确认' : '不自动合并';
}

export const CATEGORY_PREVIEW: Record<MemoryCategory, { halfLifeDays: number; archive: string; merge: string }> =
  (Object.keys(KERNEL_CATEGORY) as MemoryCategory[]).reduce(
    (acc, c) => {
      const p = policyFor(KERNEL_CATEGORY[c]);
      acc[c] = { halfLifeDays: p.half_life_days, archive: `${p.auto_archive_days} 天`, merge: mergeLabel(p.auto_merge) };
      return acc;
    },
    {} as Record<MemoryCategory, { halfLifeDays: number; archive: string; merge: string }>,
  );

/** L1..L6 查重阈值：取内核单一真源，页面不再复制一份（曾复制成 L5 0.88，与内核 0.90 漂移） */
export const LAYER_THRESHOLDS: Record<LayerName, number> = { ...DEDUP_THRESHOLDS };
