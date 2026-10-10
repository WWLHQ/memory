// 记忆管理页（REQ-006 / P8）纯逻辑层
// 全部为纯函数，便于单测覆盖（T2 验收）。
import type { DecayClass, MemoryOp, MemoryRecord, OpResult } from './types.ts';

/** 当前时间戳（注入可测；默认 Date.now） */
function now(): number {
  return Date.now();
}

/**
 * decay 温度推导（15.3 / 17.5）
 * - archived 字段 → archived
 * - status=dormant → dormant
 * - 否则按 freshness = 0.5^(age/half)：≥0.5 hot，≥0.2 warm，其余 cold
 */
export function decayClass(rec: MemoryRecord): DecayClass {
  if (rec.archived) return 'archived';
  if (rec.status === 'dormant') return 'dormant';
  const half = rec.halfLifeDays > 0 ? rec.halfLifeDays : 30;
  const freshness = Math.pow(0.5, rec.ageDays / half);
  if (freshness >= 0.5) return 'hot';
  if (freshness >= 0.2) return 'warm';
  return 'cold';
}

/**
 * 排序（17.8 / R5）：pinned 永远最上 → 其余按 confidence 降序（同分 importance 次级）
 */
export function sortMemories(list: MemoryRecord[]): MemoryRecord[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.importance - a.importance;
  });
}

/**
 * 内容摘要（G3 / 15.3）：cold/dormant 仅呈现 L2 占位符，L1 原文需审计展开
 */
export function summarizeContent(rec: MemoryRecord): string {
  const d = decayClass(rec);
  if (d === 'cold' || d === 'dormant') {
    return '（冷/休眠记忆 · 仅 L2 占位符，展开原文需审计）';
  }
  return rec.content;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 应用 17.3 操作（G4 locked 约束 / G6 审计）
 * - locked 记忆除 unlock 外全部拒绝（ok=false，记录不变）
 * - delete 返回 rec=null（彻底删除，非降权）
 */
export function applyOp(rec: MemoryRecord, op: MemoryOp): OpResult {
  const ts = new Date(now()).toISOString();

  if (rec.locked && op !== 'unlock') {
    return { rec, audit: 'locked_blocked', ok: false };
  }

  const bump = (r: MemoryRecord, di: number, dc: number): MemoryRecord => ({
    ...r,
    importance: clamp(r.importance + di, 0.1, 1),
    confidence: clamp(r.confidence + dc, 0.05, 1),
    updated_at: ts,
  });

  switch (op) {
    case 'remember':
      // 升 importance + 短期提 confidence → Hot（17.3）
      return { rec: { ...bump(rec, 0.2, 0.2), status: 'active' }, audit: 'memory_remember', ok: true };
    case 'forget':
      // 降权不删（17.3）
      return { rec: bump(rec, -0.2, -0.2), audit: 'memory_forget', ok: true };
    case 'pin':
      return { rec: { ...rec, pinned: true, updated_at: ts }, audit: 'memory_pin', ok: true };
    case 'unpin':
      return { rec: { ...rec, pinned: false, updated_at: ts }, audit: 'memory_unpin', ok: true };
    case 'lock':
      return { rec: { ...rec, locked: true, updated_at: ts }, audit: 'memory_lock', ok: true };
    case 'unlock':
      return { rec: { ...rec, locked: false, updated_at: ts }, audit: 'memory_unlock', ok: true };
    case 'archive':
      return { rec: { ...rec, archived: true, status: 'archived', updated_at: ts }, audit: 'memory_archive', ok: true };
    case 'restore':
      return { rec: { ...rec, archived: false, status: 'active', updated_at: ts }, audit: 'memory_restore', ok: true };
    case 'delete':
      return { rec: null, audit: 'memory_delete', ok: true };
    default:
      return { rec, audit: 'noop', ok: false };
  }
}

/** 17.3 操作推荐文案（toast 用） */
export const OP_TOAST: Record<MemoryOp, string> = {
  remember: '已提升这条信息的优先级。',
  forget: '这条信息已降权，后续会较少主动出现。你可以稍后恢复。',
  pin: '已置顶该记忆。',
  unpin: '已取消置顶。',
  lock: '已锁定：该记忆豁免后台任务，仅可解锁。',
  unlock: '已解锁。',
  archive: '已归档。',
  restore: '已恢复为活跃。',
  delete: '已彻底删除该记忆。',
};
