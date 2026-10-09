// REQ-005 T5：全局租户上下文 Provider（React，§0.1 / §0.3）
// 职责：把登录得到的 TenantContext 注入 React 上下文，全页可读；团队只读、不可改（§0.1/18.2-A）。
// useLogin 调用 T3 login 内核（纯逻辑）；后端落盘/镜像由 T9/T10 提供回调注入（T5 阶段 logout 仅清本地态）。
// 不变量：注入的 context 经 Object.freeze，team_id 等只读字段无法改写（无 setter）。
import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { TenantContext, LoginForm, LoginResult } from '../../types/home.ts';

/**
 * 登录实现：默认走动态 import 的 T3 本地内核。
 * ⚠ 不可静态 import loginService（其依赖 node:crypto）：Vite dev 会抛
 *   "externalized for browser compatibility" 中断模块图 → 白屏。
 *   故默认实现改为动态 import；生产/测试均应注入 loginFn（如 T11 后端镜像）。
 */
export type LoginFn = (input: LoginForm) => LoginResult | Promise<LoginResult>;
/** 登出副作用（T9 后端写审计/清会话）；T5 阶段可选 */
export type LogoutFn = () => void;

interface TenantApi {
  /** 当前上下文；未登录为 null（UI 据此灰置） */
  context: TenantContext | null;
  login: LoginFn;
  logout: LogoutFn;
}

const TenantCtx = createContext<TenantApi | null>(null);

/** 冻结上下文，确保 team_id 等只读字段无法改写（§0.1 团队只读，无 setter） */
function freezeContext(c: TenantContext): TenantContext {
  return Object.freeze({ ...c });
}

/**
 * 默认登录实现：**必须同步返回**（组件测试依赖同路径 setContext 立即生效）。
 * 前端不应本地校验密码（§4.1：密码只走后端），故此处不做本地哈希校验，
 * 统一返回 no_account 交由调用方注入真实 loginFn（T11 后端镜像）。
 * ⚠ 绝不可静态 import loginService（依赖 node:crypto）：Vite dev 会抛
 *   "externalized for browser compatibility" 中断模块图 → 白屏。
 */
const defaultLogin: LoginFn = (input) => ({
  ok: false,
  reason: 'no_account',
  audit: { action: 'login_fail', form: input.form, account: input.account, at: Date.now() },
});

export interface TenantProviderProps {
  children: ReactNode;
  /** 注入登录实现，默认动态加载 T3 本地内核；测试中传 mock */
  loginFn?: LoginFn;
  /** 注入登出副作用（T9 后端），默认无操作 */
  onLogout?: LogoutFn;
}

export function TenantProvider({ children, loginFn = defaultLogin, onLogout }: TenantProviderProps) {
  const [context, setContext] = useState<TenantContext | null>(null);

  const login = useCallback<LoginFn>(async (input) => {
    // 兼容同步 loginFn（T3 本地内核）与异步 loginFn（T11 后端镜像：返回 Promise<LoginResult>）
    const res = loginFn(input);
    if (res instanceof Promise) {
      const settled = await res;
      if (settled.ok) setContext(freezeContext(settled.context));
      return settled;
    }
    // 同步路径：不 await，setContext 同步执行（避免额外微任务，T8 组件测试稳定）
    if (res.ok) setContext(freezeContext(res.context));
    return res;
  }, [loginFn]);

  const logout = useCallback<LogoutFn>(() => {
    onLogout?.();
    setContext(null);
  }, [onLogout]);

  const api = useMemo<TenantApi>(() => ({ context, login, logout }), [context, login, logout]);

  return <TenantCtx.Provider value={api}>{children}</TenantCtx.Provider>;
}

/** 读取当前租户上下文；未登录返回 null。必须在 TenantProvider 内使用。 */
export function useTenant(): TenantContext | null {
  const api = useContext(TenantCtx);
  if (!api) throw new Error('useTenant 必须在 <TenantProvider> 内使用');
  return api.context;
}

/** 触发登录；返回 T3 LoginResult（成功已注入 context） */
export function useLogin(): LoginFn {
  const api = useContext(TenantCtx);
  if (!api) throw new Error('useLogin 必须在 <TenantProvider> 内使用');
  return api.login;
}

/** 触发登出；清本地态并调用注入的后端副作用 */
export function useLogout(): LogoutFn {
  const api = useContext(TenantCtx);
  if (!api) throw new Error('useLogout 必须在 <TenantProvider> 内使用');
  return api.logout;
}
