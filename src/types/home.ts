// REQ-005 首页与登录卡片：全局租户上下文 + 首页领域类型
// 来源：需求规格书_UI页面设计.md §0.1（全局租户上下文）/ §0.2（首页）/ §0.3（登录卡片）
// 复用：Form / Gain 取自 agentOnboard（端形态自动识别、功劳 4 卡与 REQ-003 同构）

import type { Form, Gain } from './agentOnboard.ts';

/** 视角（§0.1 矩阵，按 3.2 过滤可见范围） */
export type Perspective = 'personal' | 'team' | 'enterprise';

/**
 * 全局租户上下文（§0.1 / 18.2-A）。
 * 团队 team_id 由管理员在账号页（P12）分配，用户侧只读、不可自选——本类型只消费，不提供 setter。
 */
export interface TenantContext {
  enterprise_id: string;
  team_id: string;
  user_id: string;
  perspective: Perspective;
  session_id: string;
}

/** 同步角色（19.11：主源 / 镜像 / 离线） */
export type SyncRole = 'primary' | 'mirror' | 'offline';

/** 当前端 & 同步状态（§0.2 顶栏） */
export interface SyncState {
  form: Form;
  role: SyncRole;
  lastReconcileAt: number;
  /** 离线端待回传条数（pending_sync，19.11 §5）；offline 时 >0 */
  pendingSync: number;
}

/** 登录表单（§0.3：账号/密码/端形态；团队不出现在输入） */
export interface LoginForm {
  account: string;
  password: string;
  form: Form; // 自动识别，只读
}

/** 登录失败原因枚举（§0.3 / 4.2） */
export type LoginFailReason = 'empty' | 'no_account' | 'wrong' | 'locked';

/** 登录审计事件（§4.3：登录必记审计 action=login · form:<端>；4.3.1 统一审计枚举 login/logout/login_fail/team_assign） */
export interface LoginAudit {
  action: 'login' | 'login_fail' | 'logout' | 'team_assign';
  form: Form;
  account: string;
  at: number;
}

/** 登录结果（§0.3：成功注入 context；失败带原因；锁定带 lockedUntil；均带审计描述） */
export type LoginResult =
  | { ok: true; context: TenantContext; audit: LoginAudit }
  | { ok: false; reason: LoginFailReason; lockedUntil?: number; audit: LoginAudit };

/** 异常速览项（§0.2：置顶 error；可跳日志页 P15 / 机制页 P10 / 反代理 P13） */
export interface AnomalyItem {
  title: string;
  detail: string;
  level: 'error' | 'warn';
  request_id: string;
  jump?: string; // 如 'P15' / 'P10' / 'P13'
}

/** 活跃记忆项（§0.2：近 1h 召回 TopN + decay_class + 命中质量） */
export interface ActiveMemory {
  title: string;
  hits: number;
  decayClass: 'hot' | 'warm' | 'cold';
  request_id: string;
}

/** 待办项（§0.2：9.7 待裁决数 / 反代理临上限提醒） */
export interface TodoItem {
  label: string;
  detail: string;
  request_id: string;
  kind?: 'dispute' | 'proxy_budget';
}

/** 首页 Dashboard 四区块（§0.2） */
export interface HomeDashboard {
  gains: Gain[]; // 功劳 4 卡（复用 REQ-003 Gains 形状）
  anomalies: AnomalyItem[];
  activeMemories: ActiveMemory[];
  todos: TodoItem[];
}

/** 视角合法值集合（供校验/测试复用） */
export const PERSPECTIVES: readonly Perspective[] = ['personal', 'team', 'enterprise'] as const;
/** 同步角色合法值集合 */
export const SYNC_ROLES: readonly SyncRole[] = ['primary', 'mirror', 'offline'] as const;
/** 登录失败原因合法值集合 */
export const LOGIN_FAIL_REASONS: readonly LoginFailReason[] = ['empty', 'no_account', 'wrong', 'locked'] as const;
