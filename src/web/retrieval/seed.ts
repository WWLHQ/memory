// REQ-012 T6 种子 hits（覆盖 pinned/cold/locked/conflict/普通）
import type { RetrievalHit } from './types.ts';

export const SEED_HITS: RetrievalHit[] = [
  {
    memory_id: 'mem_p01', content: '部署前置检查清单：备份→灰度→回滚预案', l2_only: false,
    decay_class: 'hot', pinned: true, locked: false, freshness: 0.95, importance: 0.9,
    confidence: 0.92, score: 0.42, tags: ['deploy', 'checklist'], age_days: 2, half_life_days: 30,
  },
  {
    memory_id: 'mem_020', content: '缓存 TTL 设为 300s（与 mem_021 的 60s 冲突）', l2_only: false,
    decay_class: 'hot', pinned: false, locked: false, freshness: 0.9, importance: 0.8,
    confidence: 0.85, score: 0.88, tags: ['cache', 'ttl'], age_days: 3, half_life_days: 30,
    conflict_note: '[冲突] mem_020(L1/用户/昨天) vs mem_021(L1/Agent/今天) → 本模式=事实优先 → 裁定以 mem_021 为准',
  },
  {
    memory_id: 'mem_031', content: '默认端口 3000（部分重叠 mem_030）', l2_only: false,
    decay_class: 'warm', pinned: false, locked: false, freshness: 0.6, importance: 0.7,
    confidence: 0.72, score: 0.76, tags: ['port'], age_days: 12, half_life_days: 30,
  },
  {
    memory_id: 'mem_060', content: '冷存档：2024 年旧数据库选型讨论', l2_only: true,
    decay_class: 'cold', pinned: false, locked: false, freshness: 0.08, importance: 0.4,
    confidence: 0.5, score: 0.61, tags: ['db', 'legacy'], age_days: 400, half_life_days: 60,
  },
  {
    memory_id: 'mem_005', content: '生产库连接串（锁定）', l2_only: false,
    decay_class: 'hot', pinned: false, locked: true, freshness: 0.88, importance: 1,
    confidence: 0.95, score: 0.7, tags: ['prod', 'secret'], age_days: 5, half_life_days: 30,
  },
  {
    memory_id: 'mem_011', content: '用户偏好：回复用中文', l2_only: false,
    decay_class: 'hot', pinned: false, locked: false, freshness: 0.93, importance: 0.85,
    confidence: 0.9, score: 0.65, tags: ['pref'], age_days: 4, half_life_days: 30,
  },
];
