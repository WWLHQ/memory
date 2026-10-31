// REQ-005 T11：前端登录 API client（镜像，§0.3 / 对齐 REQ-003 useBackendMirror）
// 调用 T10 登录后端，挂到 useTenant 的 login/logout（作为 TenantProvider 的 loginFn/onLogout）。
// 默认后端 HOME_BASE（home server，见 src/web/backend.ts）；?backend= 可覆盖。
// 校验结果只认后端：401/423 一律失败（绝不伪造登录成功）；仅网络不可达时返回 backend_unreachable。
import { useCallback } from 'react';
import type { LoginFailReason, LoginResult, TenantContext } from '../../types/home.ts';
import type { LoginFn, LogoutFn } from './tenantContext.tsx';
import { getStoredSessionId, storeSessionId, clearStoredSessionId } from './crossTabAuth.ts';
import { HOME_BASE } from '../backend.ts';

const DEFAULT_BACKEND = HOME_BASE;

/** 从 URL ?backend= 读取覆盖地址（对齐 REQ-003 useBackendMirror 的同名参数） */
function resolveBackendFromQuery(): string | undefined {
  if (typeof window === 'undefined' || !window.location) return undefined;
  const p = new URLSearchParams(window.location.search).get('backend');
  return p || undefined;
}

export interface UseLoginMirrorOptions {
  /** 显式后端地址；优先级高于 ?backend= 与默认 */
  backend?: string;
}

/**
 * 批次22：区分「后端未启动」与「来源被 CORS 白名单拦截」。
 * no-cors 请求不触发预检，服务在线时即使 403 也会返回不透明响应（resolve）；
 * 只有网络层不可达（进程未启动/端口不通）才 reject。
 */
async function probeBackendReachable(base: string, timeoutMs = 1800): Promise<boolean> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    await fetch(`${base}/api/health`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      ...(controller ? { signal: controller.signal } : {}),
    });
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 登录后端镜像 client。
 * @returns login: 调 POST /api/login；成功返回后端 context，失败按后端真实原因返回（不伪造成功）。
 *          logout: 调 POST /api/logout（fire-and-forget）。
 * 这两个函数可直接作为 TenantProvider 的 loginFn / onLogout 注入。
 */
export function useLoginMirror(opts: UseLoginMirrorOptions = {}): { login: LoginFn; logout: LogoutFn } {
  const backend = opts.backend ?? resolveBackendFromQuery() ?? DEFAULT_BACKEND;

  const login = useCallback<LoginFn>(async (input) => {
    const audit = { action: 'login' as const, form: input.form, account: input.account, at: Date.now() };
    let res: Response;
    try {
      res = await fetch(`${backend}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 跨 iframe 登录态桥：把上游页面写入 sessionStorage 的权威 sessionId 透传给后端
          'x-session-id': getStoredSessionId() ?? '',
        },
        body: JSON.stringify({ account: input.account, password: input.password, form: input.form }),
      });
    } catch {
      // 网络层失败：再探一次后端是否在线，区分「来源被拒」与「进程未启动」（两者前端都无法放行）
      const reachable = await probeBackendReachable(backend);
      return {
        ok: false,
        reason: reachable ? 'origin_blocked' : 'backend_unreachable',
        audit,
      } as LoginResult;
    }
    if (res.ok) {
      const body = (await res.json()) as { context: TenantContext; sessionId?: string; audit?: typeof audit };
      if (body.sessionId) storeSessionId(body.sessionId);
      return { ok: true, context: body.context, audit: body.audit ?? audit };
    }
    const body = (await res.json().catch(() => ({}))) as { reason?: LoginFailReason; lockedUntil?: number; audit?: typeof audit };
    clearStoredSessionId();
    return {
      ok: false,
      reason: body.reason ?? 'wrong',
      lockedUntil: body.lockedUntil,
      audit: body.audit ?? audit,
    };
  }, [backend]);

  const logout = useCallback<LogoutFn>(async () => {
    try {
      await fetch(`${backend}/api/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': getStoredSessionId() ?? '' },
      });
    } catch {
      /* fire-and-forget：失败忽略 */
    }
    clearStoredSessionId();
  }, [backend]);

  return { login, logout };
}
