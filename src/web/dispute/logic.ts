// 冲突裁决页（REQ-006 / P7）纯逻辑层
// 全部为纯函数，便于单测覆盖（T2 验收）。
import type { ConflictAudit, ConflictRecord, ConflictType, Verdict } from './types.ts';
import { CONFIRM_TYPE_LABEL } from './seed.ts';

/** 冲突类型中文可读名（9.7 四类） */
export function typeLabel(t: ConflictType): string {
  return CONFIRM_TYPE_LABEL[t] ?? t;
}

/** 距今天数（注入 now 可测；默认 Date.now） */
export function overdueDays(createdAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 86400000));
}

/** 超期判定（12.1）：>7 天高亮 */
export function isOverdue(r: ConflictRecord, now: number = Date.now()): boolean {
  return overdueDays(r.created_at, now) > 7;
}

export interface VerdictResult {
  /** auto_override：旧 deprecated + new trust+0.1 + replaced_by 回填（9.7） */
  old_status?: 'deprecated';
  new_confidence?: number;
  replaced_by?: string;
  /** user_confirm：new 挂 dispute */
  new_disputed?: boolean;
  /** merge：两条均 deprecated + 生成合并占位 */
  merged?: boolean;
  /** hold：维持 */
  held?: boolean;
}

/** 应用裁决（9.7 三模式 + 保留） */
export function applyVerdict(rec: ConflictRecord, v: Verdict): VerdictResult {
  switch (v) {
    case 'auto_override':
      return {
        old_status: 'deprecated',
        new_confidence: Math.min(1, Math.round((rec.new_confidence + 0.1) * 100) / 100),
        replaced_by: rec.new_id,
      };
    case 'user_confirm':
      return { new_disputed: true };
    case 'merge':
      return { merged: true, old_status: 'deprecated' };
    case 'hold':
      return { held: true };
    default:
      return { held: true };
  }
}

/** 成对审计对象（16.2 / 18.4 约束5）：old_id + new_id 必须成对 */
export function auditPair(rec: ConflictRecord, v: Verdict, requestId: string): ConflictAudit {
  const note: Record<Verdict, string> = {
    auto_override: '旧值 deprecated，新值信任 +0.1',
    user_confirm: '保留旧值，新值挂 dispute',
    merge: '两条均 deprecated，生成合并记忆',
    hold: '维持 dispute 待后续',
  };
  return { action: 'dispute', old_id: rec.old_id, new_id: rec.new_id, verdict: v, request_id: requestId, note: note[v] };
}

/** 队列过滤 + 超期排序（12.1）：dispute_flag=true → 超期天数降序 */
export function queueSort(list: ConflictRecord[], now: number = Date.now()): ConflictRecord[] {
  return list
    .filter((r) => r.dispute_flag)
    .sort((a, b) => overdueDays(b.created_at, now) - overdueDays(a.created_at, now));
}
