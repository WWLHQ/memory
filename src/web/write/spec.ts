// 写入页（REQ-006 / P2）规格常量（非演示数据）
// ⚠ 查重候选不再有种子：页面挂载时从真实账本（coreListExisting）读取既有记忆，
//   空账本即无候选（诚实空态）。
import { DEDUP_THRESHOLDS } from '../../core/memagent/layerRules.ts';
import type { LayerName, MemoryCategory } from './types.ts';

/** 标签联想候选（规格常量，非演示记忆数据） */
export const TAG_SUGGESTIONS: string[] = [
  'tech-stack', 'constraint', 'pitfall', 'preference', 'workflow', 'git',
  'db', 'compliance', 'project', 'feedback', 'decision', 'legacy',
];

/** 六类知识库 → 默认半衰期 / 归档 / 合并策略预览（17.6） */
export const CATEGORY_PREVIEW: Record<MemoryCategory, { halfLifeDays: number; archive: string; merge: string }> = {
  decision: { halfLifeDays: 180, archive: '长期', merge: '按实体合并' },
  pitfall: { halfLifeDays: 120, archive: '数月', merge: '按踩坑合并' },
  preference: { halfLifeDays: 365, archive: '长期', merge: '按用户合并' },
  fact: { halfLifeDays: 90, archive: '数月', merge: '按来源合并' },
  project: { halfLifeDays: 180, archive: '长期', merge: '按 project_id 合并' },
  feedback: { halfLifeDays: 60, archive: '数周', merge: '按 memory_id 合并' },
};

/** L1..L6 查重阈值：取内核单一真源，页面不再复制一份（曾复制成 L5 0.88，与内核 0.90 漂移） */
export const LAYER_THRESHOLDS: Record<LayerName, number> = { ...DEDUP_THRESHOLDS };
