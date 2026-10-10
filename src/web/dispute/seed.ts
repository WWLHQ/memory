// 冲突裁决页（REQ-006 / P7）种子数据
// 覆盖 4 种 conflict_type + 1 条超期>7d + 1 条已替代带 replaced_by（9.7 / 12.1）。
import type { ConflictRecord } from './types.ts';

export const SEED_CONFLICTS: ConflictRecord[] = [
  {
    id: 'cf_001', old_id: 'mem_020', new_id: 'mem_021',
    old_content: '缓存 TTL 设为 300s', new_content: '缓存 TTL 设为 60s',
    old_confidence: 0.8, new_confidence: 0.85,
    conflict_type: 'direct_contradiction', conflict_score: 0.92,
    dispute_flag: true, overdue_days: 3, created_at: '2026-10-07T09:00:00.000Z',
  },
  {
    id: 'cf_002', old_id: 'mem_030', new_id: 'mem_031',
    old_content: '默认端口 8080', new_content: '默认端口 3000',
    old_confidence: 0.7, new_confidence: 0.72,
    conflict_type: 'partial_overlap', conflict_score: 0.78,
    dispute_flag: true, overdue_days: 9, created_at: '2026-09-28T09:00:00.000Z',
  },
  {
    id: 'cf_003', old_id: 'mem_040', new_id: 'mem_041',
    old_content: '上线前需 review（prod）', new_content: '上线前需 review（staging）',
    old_confidence: 0.6, new_confidence: 0.6,
    conflict_type: 'context_dependent', conflict_score: 0.71,
    dispute_flag: true, overdue_days: 1, created_at: '2026-10-09T09:00:00.000Z',
  },
  {
    id: 'cf_004', old_id: 'mem_050', new_id: 'mem_051',
    old_content: '日志保留 30 天', new_content: '日志保留 90 天',
    old_confidence: 0.5, new_confidence: 0.5,
    conflict_type: 'uncertain', conflict_score: 0.74,
    dispute_flag: true, overdue_days: 12, created_at: '2026-09-25T09:00:00.000Z',
  },
  {
    id: 'cf_005', old_id: 'mem_060', new_id: 'mem_061',
    old_content: '旧阈值：熔断 5 次', new_content: '新阈值：熔断 8 次',
    old_confidence: 0.85, new_confidence: 0.9,
    conflict_type: 'direct_contradiction', conflict_score: 0.95,
    dispute_flag: true, overdue_days: 0,
    replaced_by: 'mem_061', replaced_at: '2026-10-08T09:00:00.000Z',
    created_at: '2026-10-05T09:00:00.000Z',
  },
];

export const CONFIRM_TYPE_LABEL: Record<ConflictRecord['conflict_type'], string> = {
  direct_contradiction: '直接矛盾',
  partial_overlap: '部分重叠',
  context_dependent: '语境相关',
  uncertain: '不确定',
};
