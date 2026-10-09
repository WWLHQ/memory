// REQ-005 T11：前端登录 API client（镜像，§0.3 / 对齐 REQ-003 useBackendMirror）
// 调用 T10 登录后端，挂到 useTenant 的 login/logout（作为 TenantProvider 的 loginFn/onLogout）。
// 默认后端 http://localhost:8200；?backend= 可覆盖。失败（网络/401）不崩，回退本地只读占位（fire-and-forget，不改原型视觉）。
import { useCallback } from 'react';
import type { LoginForm, TenantContext } from '../../types/home.ts';
import type { LoginFn, LogoutFn } from './tenantContext.tsx';

const DEFAULT_BACKEND = 'http://localhost:8200';

/** 从 URL ?backend= 读取覆盖地址（对齐 REQ-003 useBackendMirror 的同名参数） */
function resolveBackendFromQuery(): string | undefined {
  if (typeof window === 'undefined' || !window.location) return undefined;
  const p = new URLSearchParams(window.location.search).get('backend');
  return p || undefined;
}

/** 后端不可用时的本地只读占位上下文（团队只读占位，fire-and-forget 降级） */
function placeholderContext(input: LoginForm): TenantContext {
  return {
    enterprise_id: 'local',
    team_id: 'local-readonly',
    user_id: input.account || 'local-guest',
    perspective: 'personal',
    session_id: `local-${Date.now()}`,
  };
}

export interface UseLoginMirrorOptions {
  /** 显式后端地址；优先级高于 ?backend= 与默认 */
  backend?: string;
}

/**
 * 登录后端镜像 client。
 * @returns login: 调 POST /api/login，成功返回后端 context；失败回退本地只读占位（不抛）。
 *          logout: 调 POST /api/logout（fire-and-forget）。
 * 这两个函数可直接作为 TenantProvider 的 loginFn / onLogout 注入。
 */
export function useLoginMirror(opts: UseLoginMirrorOptions = {}): { login: LoginFn; logout: LogoutFn } {
  const backend = opts.backend ?? resolveBackendFromQuery() ?? DEFAULT_BACKEND;

  const login = useCallback<LoginFn>(async (input) => {
    const audit = { action: 'login' as const, form: input.form, account: input.account, at: Date.now() };
    try {
      const res = await fetch(`${backend}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: input.account, password: input.password, form: input.form }),
      });
      if (res.ok) {
        const body = (await res.json()) as { context: TenantContext; audit?: typeof audit };
        return { ok: true, context: body.context, audit: body.audit ?? audit };
      }
      // 后端不可用/401 → 回退本地只读占位（不崩）
      return { ok: true, context: placeholderContext(input), audit };
    } catch {
      return { ok: true, context: placeholderContext(input), audit };
    }
  }, [backend]);

  const logout = useCallback<LogoutFn>(async () => {
    try {
      await fetch(`${backend}/api/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    } catch {
      /* fire-and-forget：失败忽略 */
    }
  }, [backend]);

  return { login, logout };
}
