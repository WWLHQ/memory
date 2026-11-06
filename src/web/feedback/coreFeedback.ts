// 用户反馈页（REQ-006 / P9）接真内核：提交走 ma._feedback（17.4 trust_delta 内核计算）
// module singleton：内核账本为唯一真相源（禁止注入种子）；confirm/reject/disputed 真实改记忆置信并写审计。
import type { MemAgent } from '../../core/memagent/types.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { getKernel, getKernelStorage } from '../kernel.ts';
import type { FeedbackDraft, FeedbackRecord } from './types.ts';

function getStorage(): StorageBackend {
  return getKernelStorage();
}

function getAgent(): Promise<MemAgent> {
  return Promise.resolve(getKernel());
}

export interface FeedbackOutcome {
  ok: boolean;
  /** 内核计算的 trust_delta（confirm +0.1 / reject −0.05 / disputed 0） */
  trust_delta: number;
  request_id: string;
  /** 操作后的记忆置信（回显用） */
  confidence?: number;
}

/** 提交反馈：内核 17.4 规则执行（confirm +0.1 / reject −0.05 / disputed 挂 9.7 裁决） */
export async function coreSubmitFeedback(d: FeedbackDraft): Promise<FeedbackOutcome> {
  const ma = await getAgent();
  // 批次48 A13：评分与原因一并写进内核审计（旧实现丢弃评分，页面统计全靠默认 3 星）
  const r = await ma._feedback(d.memory_id, d.action, { rating: d.rating, comment: d.comment });
  if (!r.ok) return { ok: false, trust_delta: 0, request_id: r.request_id };
  return { ok: true, trust_delta: r.trust_delta, request_id: r.request_id, confidence: r.mem?.confidence };
}

/** memory_id 下拉选项 = 真实账本既有记忆（空库即空，无种子兜底） */
export interface MemoryOption { id: string; summary: string }

export async function coreListMemoryOptions(): Promise<MemoryOption[]> {
  await getAgent();
  const mems = await getStorage().listMemories({});
  return mems
    .filter((m) => !m.merged_into)
    .map((m) => ({ id: m.mem_id, summary: (m.content_orig ?? m.content).slice(0, 60) }));
}

/**
 * 反馈历史记录 = 内核审计账本中 action='memory_op'（op ∈ confirm/reject/disputed）的条目。
 * 真实内核 ma._feedback 写审计格式：detail = { op, trust_delta, mem_id, confidence, rating?, comment? }。
 * 批次48 A13：rating/comment 从审计真实读取；历史条目（旧内核/MCP 入口未带评分）rating=0，代表「未评分」，
 * 统计时不计入均值与星级分布 —— 不再统一补默认 3 星制造假分布。
 * 空库即空列表，无种子兜底。
 */
export async function coreLoadFeedbackRecords(): Promise<FeedbackRecord[]> {
  await getAgent();
  const audits = await getStorage().queryAudit({ action: 'memory_op' });
  const valid = audits.filter((a) => {
    const op = (a.detail as { op?: string })?.op;
    return op === 'confirm' || op === 'reject' || op === 'disputed';
  });
  return valid.map((a, idx) => {
    const d = a.detail as { op?: string; trust_delta?: number; mem_id?: string; rating?: unknown; comment?: unknown };
    const rating = typeof d.rating === 'number' && Number.isInteger(d.rating) && d.rating >= 1 && d.rating <= 5 ? d.rating : 0;
    return {
      id: `fb_${String(valid.length - idx).padStart(3, '0')}`,
      memory_id: d.mem_id ?? '',
      action: (d.op ?? 'confirm') as FeedbackRecord['action'],
      rating,
      comment: typeof d.comment === 'string' ? d.comment : '',
      trust_delta: d.trust_delta ?? 0,
      created_at: new Date(a.ts).toISOString(),
    } satisfies FeedbackRecord;
  }).reverse(); // 新记录在前
}
