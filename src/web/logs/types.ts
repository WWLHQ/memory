// 日志记录页（REQ-011 / P15）数据模型
// 规格：§1 数据模型 / §2.1 过滤 / §2.3 异常分类 / §2.4 L0 授权 / R-LOG1~8。

export type LogLevel = 'info' | 'warn' | 'error';
/** 端（19.10） */
export type LogForm = 'desktop' | 'web' | 'mobile' | 'mac' | 'linux' | 'cli';

/** 全动作枚举（4.3.1 全量子集，§0） */
export type LogAction =
  | 'recall' | 'write' | 'gc' | 'auto_bind' | 'unbound'
  | 'sync_up' | 'sync_down' | 'sync_fail' | 'sync_reconcile'
  | 'conflict_resolve' | 'llm_proxy' | 'llm_fallback'
  | 'l0_view' | 'l0_auth_fail' | 'login' | 'team_assign'
  | 'mode_dispatch' | 'rerank_fallback' | 'audit_delete';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  form: LogForm;
  action: LogAction;
  agent?: string;
  /** 审计链主键（18.2-E）；缺失前端补 n/a（R-LOG2） */
  request_id: string;
  message: string;
  ref_audit?: string;
  extra?: Record<string, string | number>;
}

/** 异常分类（§2.3） */
export type ErrorKind =
  | 'breaker_open' | 'sync_fail' | 'quota_exceed' | 'l0_decrypt_fail' | 'vector_error' | 'conflict_pending';

/** 过滤器（§2.1 六维） */
export interface LogFilter {
  level: 'all' | LogLevel;
  form: LogForm | 'all';
  actions: LogAction[];   // 空 = 全部
  window: '5min' | '1h' | '24h' | '7d';
  keyword: string;
  onlyAbnormal: boolean;
}

/** L0 授权状态（R-LOG3，会话级） */
export interface L0State {
  role: 'admin' | 'member';
  unlocked: boolean;
  failCount: number;
  lockedUntil: number | null;
}
