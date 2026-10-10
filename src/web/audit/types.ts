// 审计日志页（REQ-006 / P11）数据模型
// 字段严格对应规格 §P11（4.3 统一审计 / 18.2-E 链路追踪）。

/** 审计动作枚举（4.3） */
export type AuditAction =
  | 'recall' | 'write' | 'verify' | 'dispute' | 'archive' | 'ban' | 'merge'
  | 'recall_skip' | 'recall_breach' | 'rerank_on' | 'rerank_fallback' | 'cold_recall'
  | 'mode_dispatch' | 'mode_fallback' | 'evidence_thin';

export interface AuditEntry {
  enterprise_id: string;
  user_id: string;
  ip_address: string;
  device_info: string;
  action: AuditAction;
  resource_type: string;
  resource_id: string;
  old_status?: string;
  new_status?: string;
  old_id?: string;
  new_id?: string;
  evidence_thin?: boolean;
  request_id: string;
  payload_tokens: number;
  pipeline_llm_tokens: number;
  created_at: string;
}

export interface AuditFilter {
  enterprise_id?: string;
  user_id?: string;
  ip_address?: string;
  device_info?: string;
  action?: AuditAction | '';
  request_id?: string;
  from?: string; // created_at 起（ISO）
  to?: string;   // created_at 止（ISO）
}
