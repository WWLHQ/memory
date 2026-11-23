// 用户反馈页（REQ-006 / P9）接真内核：提交走 ma._feedback（17.4 trust_delta 内核计算）
// module singleton：内核账本为唯一真相源（禁止注入种子）；confirm/reject/disputed 真实改记忆置信并写审计。
import type { MemAgent } from '../../core/memagent/types.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { getKernel, getKernelStorage } from '../kernel.ts';
import type { FeedbackDraft, FeedbackRecord } from './types.ts';
import { isInternalPrefRow } from '../../core/memagent/paramsSnapshot.ts';

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
    .filter((m) => !m.merged_into && !isInternalPrefRow(m))
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

/** 召回归显行（批次63）：字段全部来自内核 recall 审计真实 detail；null/占位文本由渲染层写明「账本未记录」，不伪造读数 */
export interface RecallEchoRow {
  request_id: string;
  /** ISO 时间（由审计 ts 换算） */
  created_at: string;
  query: string;
  /** 内核召回模式（auto / minimal / …；会话视图也记 auto） */
  mode: string;
  /** 命中数；审计无该字段时 null（渲染层写原因，不伪造 0） */
  hits: number | null;
  /** 调用方（批次15 client 字段；未识别时审计不写 → null，渲染层写原因） */
  client: string | null;
  injected_tokens: number | null;
  saved_tokens: number | null;
}

/**
 * 召回归显 = 内核审计账本中 action='recall' 的真实条目（接入 Agent 经 MCP recall_memory 调用落审计，
 * 字段见 src/core/memagent/agent.ts 两处 audit(request_id, 'recall', …) 写入点）。
 * 取最近 N≤20 条、新记录在前；空账本即空列表，绝不伪造行。
 */
export async function coreLoadRecallEchoes(limit = 20): Promise<RecallEchoRow[]> {
  await getAgent();
  const audits = await getStorage().queryAudit({ action: 'recall' });
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return audits.slice(-limit).reverse().map((a) => {
    const d = a.detail as Record<string, unknown>;
    return {
      request_id: a.request_id,
      created_at: new Date(a.ts).toISOString(),
      query: typeof d.query === 'string' ? d.query : '（审计未记录）',
      mode: typeof d.mode === 'string' ? d.mode : '（审计未记录）',
      hits: num(d.hits),
      client: typeof d.client === 'string' && d.client ? d.client : null,
      injected_tokens: num(d.injected_tokens),
      saved_tokens: num(d.saved_tokens),
    } satisfies RecallEchoRow;
  });
}
