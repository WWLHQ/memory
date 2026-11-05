// REQ-005 T11：前端登录 API client（镜像，§0.3 / 对齐 REQ-003 useBackendMirror）
// 调用 T10 登录后端，挂到 useTenant 的 login/logout（作为 TenantProvider 的 loginFn/onLogout）。
// 后端地址：显式 opts.backend → homeBaseUrl()（?backend= → 会话记忆 → 默认，见 src/web/backend.ts）。
// 校验结果只认后端：401/423 一律失败（绝不伪造登录成功）；仅网络不可达时返回 backend_unreachable。
// 批次27：默认后端 origin_blocked（多半被安装版桌面端占用）时，自动探测 8211–8215 上
// `npm run dev` 起的受信后端并自动切换重试——不再要求用户手动重跑 npm run dev。
import { useCallback } from 'react';
import type { LoginForm, LoginFailReason, LoginResult, TenantContext } from '../../types/home.ts';
import type { Form } from '../../types/agentOnboard.ts';
import type { LoginFn, LogoutFn } from './tenantContext.tsx';
import { getStoredSessionId, storeSessionId, clearStoredSessionId } from './crossTabAuth.ts';
import { HOME_BASE, discoverTrustedDevBackend, homeBaseUrl, rememberHomeBase } from '../backend.ts';

export interface UseLoginMirrorOptions {
  /** 显式后端地址；优先级高于会话记忆与默认（给了显式地址就不做自动切换） */
  backend?: string;
}

/** 会话内单次登录请求；网络层失败返回 null（与后端业务失败区分） */
async function attemptLogin(
  backend: string,
  input: LoginForm,
  audit: { action: 'login'; form: Form; account: string; at: number },
): Promise<Extract<LoginResult, { ok: true }> | Extract<LoginResult, { ok: false }> | null> {
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
    return null;
  }
  if (res.ok) {
    const body = (await res.json()) as { context: TenantContext; sessionId?: string; audit?: typeof audit };
    if (body.sessionId) storeSessionId(body.sessionId);
    return { ok: true, context: body.context, audit: body.audit ?? audit };
  }
  const body = (await res.json().catch(() => ({}))) as {
    reason?: LoginFailReason;
    lockedUntil?: number;
    remaining?: number;
    failCount?: number;
    audit?: typeof audit;
  };
  clearStoredSessionId();
  return {
    ok: false,
    reason: body.reason ?? 'wrong',
    lockedUntil: body.lockedUntil,
    remaining: body.remaining,
    failCount: body.failCount,
    audit: body.audit ?? audit,
  };
}

/** 批次22：区分「后端未启动」与「来源被 CORS 白名单拦截」。
 *  no-cors 请求不触发预检，服务在线时即使 403 也会返回不透明响应（resolve）；
 *  只有网络层不可达（进程未启动/端口不通）才 reject。 */
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
  const explicitBackend = opts.backend;

  const login = useCallback<LoginFn>(async (input) => {
    const audit = { action: 'login' as const, form: input.form, account: input.account, at: Date.now() };
    const backend = (explicitBackend ?? homeBaseUrl()) || HOME_BASE;
    const first = await attemptLogin(backend, input, audit);
    if (first !== null) return first;
    // 网络层失败：探一次后端是否在线，区分「来源被拒」与「进程未启动」
    const reachable = await probeBackendReachable(backend);
    if (reachable && !explicitBackend) {
      // 批次27：默认/会话后端在线但不放行本来源 → 自动找受信 dev 后端并重试（用户无需重跑 npm run dev）
      const alt = await discoverTrustedDevBackend();
      if (alt) {
        rememberHomeBase(alt);
        const retry = await attemptLogin(alt, input, audit);
        if (retry !== null) return retry;
      }
    }
    return {
      ok: false,
      reason: reachable ? 'origin_blocked' : 'backend_unreachable',
      audit,
    } as LoginResult;
  }, [explicitBackend]);

  const logout = useCallback<LogoutFn>(async () => {
    const backend = (explicitBackend ?? homeBaseUrl()) || HOME_BASE;
    try {
      await fetch(`${backend}/api/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': getStoredSessionId() ?? '' },
      });
    } catch {
      /* fire-and-forget：失败忽略 */
    }
    clearStoredSessionId();
  }, [explicitBackend]);

  return { login, logout };
}
