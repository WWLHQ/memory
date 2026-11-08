// 审计日志页（REQ-006 / P11）数据模型
// 字段严格对应规格 §P11（4.3 统一审计 / 18.2-E 链路追踪）。

/** 审计动作枚举（4.3；9-D 增补 L0 密钥环/授权会话与安全变更动作） */
export type AuditAction =
  | 'recall' | 'write' | 'verify' | 'dispute' | 'archive' | 'ban' | 'merge'
  | 'recall_skip' | 'recall_breach' | 'rerank_on' | 'rerank_fallback' | 'cold_recall'
  | 'mode_dispatch' | 'mode_fallback' | 'evidence_thin'
  | 'graft' | 'memory_op'
  | 'l0_view' | 'l0_auth_fail'
  | 'l0_auth_request' | 'l0_auth_grant' | 'l0_auth_deny' | 'l0_auth_revoke' | 'l0_auth_expire'
  | 'security_change'
  // A29：Agent 接入动作（接入/测试/轮换/吊销/自动绑定/撤销绑定）
  | 'agent_onboard' | 'agent_test' | 'agent_rotate' | 'agent_revoke'
  | 'auto_bind' | 'unbound';

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
  /** 以下字段来自内核 AuditRecord / detail，取不到时不填（页面如实显示「—」，不补值） */
  agent?: string;
  /** 结果（detail.result / detail.status，如 ok / denied / blocked / skip / 401） */
  result?: string;
  /** 来源（detail.source） */
  source?: string;
  /** 内核耗时（detail.duration_ms） */
  duration_ms?: number;
  /** 备注（detail.message / detail.note） */
  note?: string;
}

export interface AuditFilter {
  enterprise_id?: string;
  user_id?: string;
  ip_address?: string;
  device_info?: string;
  action?: AuditAction | '';
  request_id?: string;
  agent?: string;
  from?: string; // created_at 起（datetime-local / ISO）
  to?: string;   // created_at 止（datetime-local / ISO）
}
