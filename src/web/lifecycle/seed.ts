// 生命周期页（REQ-006 / P4）种子数据
// 覆盖六态（9.10.1）+ 1 条 deprecated 带 replaced_by（9.7）+ N/M 默认 90/180。
import type { LifecycleRecord } from './types.ts';

export const N_DAYS = 90; // hibernating 触发（9.10.1）
export const M_DAYS = 180; // archived 触发（9.10.1）

export const SEED_LIFECYCLE: LifecycleRecord[] = [
  {
    id: 'mem_001', content: '项目技术栈约束（活跃热记忆）', status: 'active',
    ageDays: 5, half_life_days: 60, confidence: 0.95, importance: 0.9,
    access_count: 42, reinforce_count: 8, pinned: true, locked: false, decay_class: 'hot',
  },
  {
    id: 'mem_011', content: '休眠记忆（90 天未访问）', status: 'hibernating',
    ageDays: 95, half_life_days: 30, confidence: 0.4, importance: 0.4,
    access_count: 2, reinforce_count: 0, pinned: false, locked: false, decay_class: 'cold',
  },
  {
    id: 'mem_012', content: '已归档旧结论（180 天）', status: 'archived',
    ageDays: 200, half_life_days: 30, confidence: 0.5, importance: 0.3,
    access_count: 1, reinforce_count: 0, pinned: false, locked: false, decay_class: 'archived',
  },
  {
    id: 'mem_013', content: '已被新版本替代的旧值', status: 'deprecated',
    replaced_by: 'mem_014', replaced_at: '2026-09-01T08:00:00.000Z',
    ageDays: 40, half_life_days: 60, confidence: 0.6, importance: 0.5,
    access_count: 3, reinforce_count: 0, pinned: false, locked: false, decay_class: 'warm',
  },
  {
    id: 'mem_014', content: '替代 mem_013 的新值', status: 'active',
    ageDays: 10, half_life_days: 60, confidence: 0.85, importance: 0.7,
    access_count: 5, reinforce_count: 1, pinned: false, locked: false, decay_class: 'hot',
  },
  {
    id: 'mem_015', content: '过期未验证记忆', status: 'stale',
    ageDays: 120, half_life_days: 90, confidence: 0.35, importance: 0.4,
    access_count: 0, reinforce_count: 0, pinned: false, locked: false, decay_class: 'cold',
  },
  {
    id: 'mem_016', content: '深度休眠的长尾记忆（锁定豁免后台）', status: 'dormant',
    ageDays: 400, half_life_days: 30, confidence: 0.2, importance: 0.2,
    access_count: 0, reinforce_count: 0, pinned: false, locked: true, decay_class: 'dormant',
  },
];
