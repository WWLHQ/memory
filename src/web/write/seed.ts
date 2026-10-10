// 写入页（REQ-006 / P2）种子数据
import type { ExistingMemory, LayerName, MemoryCategory } from './types.ts';

/** 标签联想候选 */
export const SEED_TAGS: string[] = [
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

/** L1..L6 查重阈值（6.1）：L1 0.7 … L6 0.9 递增 */
export const LAYER_THRESHOLDS: Record<LayerName, number> = {
  L1: 0.7, L2: 0.75, L3: 0.8, L4: 0.85, L5: 0.88, L6: 0.9,
};

/** 既有记忆（查重候选；真实环境由后端返回，此处为演示种子） */
export const SEED_EXISTING: ExistingMemory[] = [
  { id: 'mem_001', content: '项目技术栈约束：后端 Node 22 + React 19 strict' },
  { id: 'mem_002', content: '上次重构失败的根因：vitest 默认 pool 双实例化' },
  { id: 'mem_010', content: 'CORS 预检需把自定义请求头加入后端白名单' },
];
