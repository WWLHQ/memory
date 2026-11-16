// T1 数据使用门禁（管理员与成员权限设计 §2）：会话有效即放行，管理员额外打审计标。
// 纯函数、零 Electron / 文件系统依赖：main.ts 注入会话查询与审计函数，测试可直接打。
// 判据：admin = member 的超集（不硬互斥）；admin 调用数据面时强制留痕，防"管理员悄悄看/写记忆"。
// 会话真源由调用方注入（main.ts 传 homeServerRef.getSessionContext），不接受渲染层自报角色。

import type { TenantContext } from '../types/home.ts';

export type DataUseGateResult =
  | { ok: true; ctx: TenantContext; audit: { actor_role: 'admin'; via: 'admin_override' } | null }
  | { ok: false; error: string; code: 'E_AUTH_SESSION' };

export interface DataUseGateDeps {
  /** 会话真源查询：sid → 上下文；无会话返回 null */
  getSessionContext: (sid: string) => TenantContext | null;
  /** 审计落点：admin 调用数据面时记一行（由 main.ts 注入 actionLog） */
  auditAdminUse?: (channel: string, user: string) => void;
}

/**
 * 数据使用门禁：会话有效即放行（admin / member 均可），无会话拒绝；
 * role=admin 时回调 auditAdminUse 并回传审计标记，调用方据此在业务日志里带上 actor_role。
 */
export function checkDataUse(
  sessionId: unknown,
  channel: string,
  deps: DataUseGateDeps,
): DataUseGateResult {
  const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
  const ctx = sid ? deps.getSessionContext(sid) : null;
  if (!ctx) {
    return { ok: false, code: 'E_AUTH_SESSION', error: '需要登录后操作（会话已过期或未登录）' };
  }
  if (ctx.role === 'admin') {
    deps.auditAdminUse?.(channel, ctx.user_id);
    return { ok: true, ctx, audit: { actor_role: 'admin', via: 'admin_override' } };
  }
  return { ok: true, ctx, audit: null };
}
