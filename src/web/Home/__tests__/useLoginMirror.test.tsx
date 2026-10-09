// T11 验收（提前规划的测试）：前端登录 API client（镜像，§0.3）
// 对应 specs/tasks/HOME-LOGIN.md T11 「验收（提前规划的测试）」
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { render, fireEvent } from '@testing-library/react';
import { useLoginMirror } from '../useLoginMirror.ts';
import { TenantProvider, useLogin, useTenant } from '../tenantContext.tsx';
import type { LoginForm, TenantContext, LoginResult } from '../../../types/home.ts';

const form: LoginForm = { account: 'alice', password: 'pw', form: 'desktop' };

function okBody(context: TenantContext) {
  return {
    ok: true,
    json: async () => ({ context, audit: { action: 'login' as const, form: 'desktop' as const, account: 'alice', at: 1 } }),
  };
}
const backendCtx: TenantContext = {
  enterprise_id: 'ent_001',
  team_id: 'team_x',
  user_id: 'alice',
  perspective: 'team',
  session_id: 'sess-backend',
};

function stubFetch(fn: unknown) {
  vi.stubGlobal('fetch', fn);
}

describe('T11 前端登录 API client', () => {
  let originalLocation: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLocation) {
      Object.defineProperty(window, 'location', originalLocation);
      originalLocation = undefined;
    }
  });

  function setQuery(q: string) {
    originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', { value: { search: q }, configurable: true });
  }

  it('login() → fetch POST /api/login 请求体含 account/password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okBody(backendCtx));
    stubFetch(fetchMock);
    const { result } = renderHook(() => useLoginMirror());
    await act(async () => {
      await result.current.login(form);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toContain('/api/login');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.account).toBe('alice');
    expect(body.password).toBe('pw');
    expect(body.form).toBe('desktop');
  });

  it('成功 → 注入 context（经 TenantProvider 注入后端 context）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okBody(backendCtx));
    stubFetch(fetchMock);
    function Probe() {
      const login = useLogin();
      const ctx = useTenant();
      return <button id="go" onClick={() => login(form)}>{ctx ? ctx.user_id : 'anon'}</button>;
    }
    function App() {
      const mirror = useLoginMirror();
      return (
        <TenantProvider loginFn={mirror.login}>
          <Probe />
        </TenantProvider>
      );
    }
    const { container } = render(<App />);
    expect(container.textContent).toBe('anon');
    await act(async () => {
      fireEvent.click(container.querySelector('#go')!);
    });
    // 后端 context 已注入
    expect(container.textContent).toBe('alice');
  });

  it('失败（网络错误）→ 不崩，回退本地只读占位', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    stubFetch(fetchMock);
    const { result } = renderHook(() => useLoginMirror());
    let res!: LoginResult;
    await act(async () => {
      res = await result.current.login(form);
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.context.user_id).toBe('alice');
      expect(res.context.team_id).toBe('local-readonly');
    }
  });

  it('失败（401）→ 不崩，回退本地只读占位', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    stubFetch(fetchMock);
    const { result } = renderHook(() => useLoginMirror());
    let res!: LoginResult;
    await act(async () => {
      res = await result.current.login(form);
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.context.team_id).toBe('local-readonly');
    }
  });

  it('logout() → POST /api/logout', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    stubFetch(fetchMock);
    const { result } = renderHook(() => useLoginMirror());
    await act(async () => {
      await result.current.logout();
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string }];
    expect(url).toContain('/api/logout');
    expect(init.method).toBe('POST');
  });

  it('?backend= 覆盖默认地址（且 opts.backend 优先）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okBody(backendCtx));
    stubFetch(fetchMock);

    // 1) ?backend= 覆盖默认
    setQuery('?backend=http://example.com:9999');
    const { result: r1 } = renderHook(() => useLoginMirror());
    await act(async () => {
      await r1.current.login(form);
    });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://example.com:9999/api/login');

    // 2) opts.backend 优先于 ?backend=
    const { result: r2 } = renderHook(() => useLoginMirror({ backend: 'http://opt:1111' }));
    await act(async () => {
      await r2.current.login(form);
    });
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe('http://opt:1111/api/login');
  });
});

