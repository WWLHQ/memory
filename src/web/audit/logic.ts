// 审计日志页（REQ-006 / P11）纯逻辑层
// 全部为纯函数，便于单测覆盖（T2 验收）。
import type { AuditAction, AuditEntry, AuditFilter } from './types.ts';

/** 审计动作中文可读名（4.3 枚举可读化） */
export const ACTION_LABEL: Record<AuditAction, string> = {
  recall: '召回',
  write: '写入',
  verify: '核验',
  dispute: '争议',
  archive: '归档',
  ban: '封禁',
  merge: '合并',
  recall_skip: '召回跳过',
  recall_breach: '召回超支',
  rerank_on: '重排开启',
  rerank_fallback: '重排回退',
  cold_recall: '冷召回',
  mode_dispatch: '模式分流',
  mode_fallback: '模式兜底',
  evidence_thin: '证据不足',
};

export function actionLabel(a: AuditAction): string {
  return ACTION_LABEL[a] ?? a;
}

/** 过滤（§P11 过滤栏各维，全部 AND） */
export function filterEntries(list: AuditEntry[], f: AuditFilter): AuditEntry[] {
  return list.filter((e) => {
    if (f.enterprise_id && e.enterprise_id !== f.enterprise_id) return false;
    if (f.user_id && e.user_id !== f.user_id) return false;
    if (f.ip_address && e.ip_address !== f.ip_address) return false;
    if (f.device_info && !e.device_info.includes(f.device_info)) return false;
    if (f.action && e.action !== f.action) return false;
    if (f.request_id && e.request_id !== f.request_id) return false;
    if (f.from && e.created_at < f.from) return false;
    if (f.to && e.created_at > f.to) return false;
    return true;
  });
}

/** 链路追踪（18.2-E）：同一 request_id 全部行，按时间升序 */
export function chainByRequest(list: AuditEntry[], requestId: string): AuditEntry[] {
  return list
    .filter((e) => e.request_id === requestId)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 导出 CSV（4.3 全量字段） */
export function exportCsv(list: AuditEntry[]): string {
  const headers = [
    'created_at', 'action', 'resource_type', 'resource_id', 'old_status', 'new_status',
    'old_id', 'new_id', 'evidence_thin', 'request_id', 'payload_tokens',
    'pipeline_llm_tokens', 'enterprise_id', 'user_id', 'ip_address', 'device_info',
  ];
  const rows = list.map((e) =>
    headers.map((h) => csvCell((e as unknown as Record<string, unknown>)[h])).join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}

/** 导出 JSON */
export function exportJson(list: AuditEntry[]): string {
  return JSON.stringify(list, null, 2);
}
