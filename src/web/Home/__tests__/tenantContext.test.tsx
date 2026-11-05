// T5 验收（提前规划的测试）：全局租户上下文 Provider（React，§0.1 / §0.3）
// 对应 specs/tasks/HOME-LOGIN.md T5 「验收（提前规划的测试）」
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { TenantProvider, useTenant, useTenantRestoring, useLogin, useLogout } from '../tenantContext.tsx';
import { login as localLogin, registerAccount, resetAuthStore } from '../../../auth/loginService.ts';
import { hashPassword } from '../../../auth/hash.ts';
import type { LoginForm, TenantContext } from '../../../types/home.ts';

const ACCOUNT = 'bob';
const ctxSample: TenantContext = {
  enterprise_id: 'ent_001',
  team_id: 'team_readonly_009',
  user_id: ACCOUNT,
  perspective: 'team',
  session_id: 'sess_bob',
};

function formOf(pwd: string, account = ACCOUNT): LoginForm {
  return { account, password: pwd, form: 'desktop' };
}

function wrapperWith(overrides: { loginFn?: any; onLogout?: any } = {}) {
  return ({ children }: { children: ReactNode }) =>
    <TenantProvider loginFn={localLogin} {...overrides}>{children}</TenantProvider>;
}

describe('T5 全局租户上下文 Provider', () => {
  beforeEach(() => {
    resetAuthStore();
    localStorage.removeItem('session:realpage'); // 阶段5-D：隔离跨用例的 session 残留
    registerAccount(ACCOUNT, hashPassword('pw'), { enterprise_id: 'ent_001', team_id: 'team_readonly_009', perspective: 'team' });
  });
  afterEach(() => { resetAuthStore(); vi.unstubAllGlobals(); });

  it('未登录 useTenant() 返回 null', () => {
    const { result } = renderHook(() => useTenant(), { wrapper: wrapperWith() });
    expect(result.current).toBeNull();
  });

  it('登录后子组件 useTenant() 读到非 null context', async () => {
    const { result } = renderHook(
      () => ({ t: useTenant(), login: useLogin() }),
      { wrapper: wrapperWith() },
    );
    await act(async () => {
      result.current.login(formOf('pw'));
    });
    expect(result.current.t).not.toBeNull();
    expect(result.current.t?.user_id).toBe(ACCOUNT);
  });

  it('登出后 useTenant() 回到 null', async () => {
    const { result } = renderHook(
      () => ({ t: useTenant(), login: useLogin(), logout: useLogout() }),
      { wrapper: wrapperWith() },
    );
    await act(async () => {
      result.current.login(formOf('pw'));
    });
    expect(result.current.t).not.toBeNull();
    act(() => result.current.logout());
    expect(result.current.t).toBeNull();
  });

  it('context.team_id 只读：试图改写不生效（freeze）', async () => {
    const { result } = renderHook(
      () => ({ t: useTenant(), login: useLogin() }),
      { wrapper: wrapperWith() },
    );
    await act(async () => {
      result.current.login(formOf('pw'));
    });
    const c = result.current.t!;
    const before = c.team_id;
    // 冻结对象：严格模式赋值抛错、非严格静默忽略——两种情况下 team_id 均保持不变
    expect(() => {
      try {
        (c as TenantContext & { team_id: string }).team_id = 'hacked_team';
      } catch {
        /* 严格模式忽略 */
      }
    }).not.toThrow();
    expect(c.team_id).toBe(before);
    expect(c.team_id).toBe('team_readonly_009');
  });

  it('useLogin 触发注入后端调用（mock loginFn）', async () => {
    const loginFn = vi.fn((input: LoginForm) => ({
      ok: true as const,
      context: ctxSample,
      audit: { action: 'login' as const, form: input.form, account: input.account, at: Date.now() },
    }));
    const { result } = renderHook(
      () => ({ t: useTenant(), login: useLogin() }),
      { wrapper: wrapperWith({ loginFn }) },
    );
    await act(async () => {
      result.current.login(formOf('pw'));
    });
    expect(loginFn).toHaveBeenCalledTimes(1);
    expect(loginFn).toHaveBeenCalledWith(formOf('pw'));
    expect(result.current.t?.user_id).toBe(ACCOUNT);
  });

  it('useLogout 触发注入后端调用（mock onLogout）', async () => {
    const onLogout = vi.fn();
    const { result } = renderHook(
      () => ({ t: useTenant(), login: useLogin(), logout: useLogout() }),
      { wrapper: wrapperWith({ onLogout }) },
    );
    await act(async () => {
      result.current.login(formOf('pw'));
    });
    act(() => result.current.logout());
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(result.current.t).toBeNull();
  });

  it('阶段5-D：有 session 时只认 /api/me 的真实租户，恢复前不伪造占位身份', async () => {
    localStorage.setItem('session:realpage', 'sess_real_123');
    const realCtx = {
      enterprise_id: 'ent_real',
      team_id: 'team_real',
      user_id: 'user_real',
      perspective: 'team' as const,
      session_id: 'sess_real_123',
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ context: realCtx }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(
      () => ({ t: useTenant(), restoring: useTenantRestoring() }),
      {
        wrapper: ({ children }) => (
          <TenantProvider loginFn={localLogin} backendUrl="http://localhost:8201">
            {children}
          </TenantProvider>
        ),
      },
    );

    // 恢复前：未登录就是未登录，绝不出现 'restored-user' 之类的占位身份
    expect(result.current.t).toBeNull();
    expect(result.current.restoring).toBe(true);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8201/api/me',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-session-id': 'sess_real_123' }) }),
    );
    expect(result.current.restoring).toBe(false);
    expect(result.current.t?.user_id).toBe('user_real');
    expect(result.current.t?.enterprise_id).toBe('ent_real');
    expect(result.current.t?.team_id).toBe('team_real');
  });

  it('阶段5-D：/api/me 非 2xx / 缺 context / 网络失败一律保持未登录', async () => {
    localStorage.setItem('session:realpage', 'sess_bad');
    const cases: Array<() => Promise<unknown>> = [
      async () => ({ ok: false }),
      async () => ({ ok: true, json: async () => ({}) }),
      async () => { throw new Error('offline'); },
    ];
    for (const impl of cases) {
      vi.stubGlobal('fetch', vi.fn(impl));
      const { result, unmount } = renderHook(
        () => ({ t: useTenant(), restoring: useTenantRestoring() }),
        { wrapper: ({ children }) => (
          <TenantProvider loginFn={localLogin} backendUrl="http://localhost:8201">{children}</TenantProvider>
        ) },
      );
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      expect(result.current.t).toBeNull();
      expect(result.current.restoring).toBe(false);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('阶段5-D：无 session 不发起 /api/me，直接未登录', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(
      () => ({ t: useTenant(), restoring: useTenantRestoring() }),
      { wrapper: ({ children }) => (
        <TenantProvider loginFn={localLogin} backendUrl="http://localhost:8201">{children}</TenantProvider>
      ) },
    );
    expect(result.current.t).toBeNull();
    expect(result.current.restoring).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
