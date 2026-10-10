// 用户反馈页（REQ-006 / P9）种子数据
import type { FeedbackRecord, InjectedContext } from './types.ts';

/** memory_id 下拉选项（选中带出摘要） */
export const SEED_OPTIONS: { id: string; summary: string }[] = [
  { id: 'mem_001', summary: '项目技术栈约束（关联记忆）' },
  { id: 'mem_011', summary: '用户偏好：回复用中文' },
  { id: 'mem_012', summary: '已归档：2024 年旧流程' },
  { id: 'mem_020', summary: '缓存 TTL 300s（存在冲突）' },
  { id: 'mem_031', summary: '默认端口 3000（部分重叠）' },
];

/** R1 注入上下文（只读） */
export const CTX: InjectedContext = {
  user_id: 'user_001',
  enterprise_id: 'ent_001',
  request_id: 'req_fb_seed',
};

/** 历史反馈（统计卡） */
export const SEED_FEEDBACKS: FeedbackRecord[] = [
  { id: 'fb_001', memory_id: 'mem_001', action: 'confirm', rating: 5, comment: '准确', trust_delta: 0.1, created_at: '2026-10-09T08:00:00Z' },
  { id: 'fb_002', memory_id: 'mem_011', action: 'confirm', rating: 4, comment: '', trust_delta: 0.1, created_at: '2026-10-09T09:00:00Z' },
  { id: 'fb_003', memory_id: 'mem_012', action: 'reject', rating: 2, comment: '已过时', trust_delta: -0.05, created_at: '2026-10-09T10:00:00Z' },
  { id: 'fb_004', memory_id: 'mem_020', action: 'disputed', rating: 3, comment: '与 TTL 60s 冲突', trust_delta: 0, created_at: '2026-10-10T07:00:00Z' },
  { id: 'fb_005', memory_id: 'mem_001', action: 'confirm', rating: 5, comment: '再次确认', trust_delta: 0.1, created_at: '2026-10-10T08:00:00Z' },
];
