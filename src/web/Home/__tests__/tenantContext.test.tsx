// T5 验收（提前规划的测试）：全局租户上下文 Provider（React，§0.1 / §0.3）
// 对应 specs/tasks/HOME-LOGIN.md T5 「验收（提前规划的测试）」
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { TenantProvider, useTenant, useLogin, useLogout } from '../tenantContext.tsx';
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
    registerAccount(ACCOUNT, hashPassword('pw'), { enterprise_id: 'ent_001', team_id: 'team_readonly_009', perspective: 'team' });
  });
  afterEach(() => resetAuthStore());

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

  it('有 session 但无 context 时，异步调 /api/me 恢复真实租户上下文', async () => {
    // 设置 localStorage 有 session（模拟从首页登录后切换到接入页）
    localStorage.setItem('session:realpage', 'sess_real_123');
    // mock fetch 返回真实租户上下文
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
      () => useTenant(),
      {
        wrapper: ({ children }) => (
          <TenantProvider loginFn={localLogin} backendUrl="http://localhost:8201">
            {children}
          </TenantProvider>
        ),
      },
    );

    // 初始是占位上下文
    expect(result.current?.user_id).toBe('restored-user');

    // 等待异步恢复完成
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // 恢复后是真实租户上下文
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8201/api/me',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-session-id': 'sess_real_123' }) }),
    );
    expect(result.current?.user_id).toBe('user_real');
    expect(result.current?.enterprise_id).toBe('ent_real');
    expect(result.current?.team_id).toBe('team_real');

    // 清理
    localStorage.removeItem('session:realpage');
    vi.unstubAllGlobals();
  });
});
