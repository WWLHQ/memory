// 待重放写入队列的「只读摘要」口径（D6 / S5）
//
// 主进程把 MCP 写入兜底队列（L0 写密钥锁定期间暂存的 write_memory）转成摘要给壳层任务窗：
// 只给计数与可排查字段，**绝不**把正文、密钥材料、token 或整条 MemReq 递到渲染层。
import type { PendingWrite } from '../core/memagent/pendingWrites.ts';

export interface PendingWriteSummary {
  id: string;
  /** 入队时间（epoch ms） */
  created_at: number;
  project_id: string;
  source_agent: string | null;
  category: string;
  user_id: string | null;
  session_id: string | null;
  /** 正文字符数（不含正文本身） */
  content_chars: number;
  /** 标签个数（不含标签内容） */
  tags: number;
  importance: number | null;
  confidence: number | null;
  half_life_days: number | null;
}

export interface PendingWritesView {
  ok: true;
  count: number;
  items: PendingWriteSummary[];
  /** 条目超过上限时为 true（count 仍是真实总数） */
  truncated: boolean;
  source: string;
  note: string;
  captured_at: string;
}

/** 任务窗默认只展示最近 50 条，避免把队列整体灌到渲染层 */
export const PENDING_SUMMARY_LIMIT = 50;

/** 纯函数：PendingWrite[] → 只读摘要（按入队时间倒序，截断到 limit） */
export function summarizePendingWrites(
  items: PendingWrite[],
  limit: number = PENDING_SUMMARY_LIMIT,
): { items: PendingWriteSummary[]; truncated: boolean } {
  const sorted = [...items].sort((a, b) => b.created_at - a.created_at);
  const kept = sorted.slice(0, Math.max(0, limit));
  return {
    items: kept.map((it) => ({
      id: it.id,
      created_at: it.created_at,
      project_id: it.project_id,
      source_agent: it.source_agent ?? null,
      category: it.category,
      user_id: it.user_id ?? null,
      session_id: it.session_id ?? null,
      content_chars: it.content.length,
      tags: Array.isArray(it.tags) ? it.tags.length : 0,
      importance: it.importance ?? null,
      confidence: it.confidence ?? null,
      half_life_days: it.half_life_days ?? null,
    })),
    truncated: sorted.length > kept.length,
  };
}
