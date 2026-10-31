// 用户反馈页单测夹具（仅测试用；页面数据真相 = 内核审计账本）。
import type { FeedbackRecord } from '../types.ts';
import { getKernelWithSeed } from '../../kernel.ts';

export const SEED_FEEDBACKS: FeedbackRecord[] = [
  { id: 'fb_001', memory_id: 'mem_001', action: 'confirm', rating: 5, comment: '准确', trust_delta: 0.1, created_at: '2026-10-09T08:00:00Z' },
  { id: 'fb_002', memory_id: 'mem_011', action: 'confirm', rating: 4, comment: '', trust_delta: 0.1, created_at: '2026-10-09T09:00:00Z' },
  { id: 'fb_003', memory_id: 'mem_012', action: 'reject', rating: 2, comment: '已过时', trust_delta: -0.05, created_at: '2026-10-09T10:00:00Z' },
  { id: 'fb_004', memory_id: 'mem_020', action: 'disputed', rating: 3, comment: '与 TTL 60s 冲突', trust_delta: 0, created_at: '2026-10-10T07:00:00Z' },
  { id: 'fb_005', memory_id: 'mem_001', action: 'confirm', rating: 5, comment: '再次确认', trust_delta: 0.1, created_at: '2026-10-10T08:00:00Z' },
];

/** 用例夹具：反馈下拉候选 = 真实账本既有记忆 */
export async function seedFeedbackMemories(): Promise<void> {
  const ma = getKernelWithSeed();
  const rows: Array<[string, string]> = [
    ['mem_001', '项目技术栈约束：Node 20 + SQLite + React'],
    ['mem_012', '已归档旧结论：早期用 MySQL'],
    ['mem_020', '有争议的端口约定：8080 vs 3000'],
  ];
  for (const [id, content] of rows) {
    await ma._seedMemory({ mem_id: id, content, category: 'fact', project_id: 'P1', layer: 'L2' });
  }
}
