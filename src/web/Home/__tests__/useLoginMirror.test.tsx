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
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // 恢复无 query 的干净 URL
    window.history.replaceState(null, '', '/');
  });

  /** jsdom 30 中 window.location 不可重定义，改用 history API 修改 search */
  function setQuery(q: string) {
    window.history.replaceState(null, '', q);
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

  it('失败（网络错误）→ 如实失败 backend_unreachable，不本地放行', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    stubFetch(fetchMock);
    const { result } = renderHook(() => useLoginMirror());
    let res!: LoginResult;
    await act(async () => {
      res = await result.current.login(form);
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('backend_unreachable');
  });

  it('批次22：后端在线但来源被拒（POST 失败 + no-cors 探针可达）→ origin_blocked', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch')) // CORS 预检被 403 → fetch reject
      .mockResolvedValueOnce({ type: 'opaque', ok: false, status: 0 }); // no-cors 探针：服务在线即可达
    stubFetch(fetchMock);
    const { result } = renderHook(() => useLoginMirror());
    let res!: LoginResult;
    await act(async () => {
      res = await result.current.login(form);
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('origin_blocked');
    const [healthUrl, healthInit] = fetchMock.mock.calls[1] as [string, { mode?: string }];
    expect(healthUrl).toContain('/api/health');
    expect(healthInit.mode).toBe('no-cors');
  });

  it('失败（401）→ 如实返回后端原因，不伪造登录成功', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ reason: 'wrong' }) });
    stubFetch(fetchMock);
    const { result } = renderHook(() => useLoginMirror());
    let res!: LoginResult;
    await act(async () => {
      res = await result.current.login(form);
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('wrong');
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

    // 1) ?backend= 覆盖默认（批次27 起登录地址也走 P1-1 回环白名单：外部主机拒绝回落默认）
    setQuery('?backend=http://127.0.0.1:9999');
    const { result: r1 } = renderHook(() => useLoginMirror());
    await act(async () => {
      await r1.current.login(form);
    });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://127.0.0.1:9999/api/login');

    // 2) opts.backend 优先于 ?backend=
    const { result: r2 } = renderHook(() => useLoginMirror({ backend: 'http://opt:1111' }));
    await act(async () => {
      await r2.current.login(form);
    });
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe('http://opt:1111/api/login');
  });
});


describe('批次27：默认后端被占（origin_blocked）时自动切受信 dev 后端', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
    sessionStorage.clear();
  });

  function setQuery(q: string) {
    window.history.replaceState(null, '', q);
  }

  it('默认后端在线但不放行本来源 → 自动探测 8211 命中并重试成功，会话记忆备用地址', async () => {
    setQuery('');
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch')) // POST 默认 8201：CORS 拦截 → reject
      .mockResolvedValueOnce({ ok: true, json: async () => undefined }) // no-cors 探针：在线（不透明响应）
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, service: 'home' }) }) // 8211 /api/health：受信 dev 后端
      .mockResolvedValueOnce(okBody(backendCtx)); // POST 8211 /api/login：成功
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLoginMirror());
    let res: LoginResult | undefined;
    await act(async () => {
      res = await result.current.login(form);
    });
    expect(res?.ok).toBe(true);
    if (res?.ok) expect(res.context.user_id).toBe('alice');
    const loginUrls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/api/login'));
    expect(loginUrls.map((c) => c[0])).toEqual([
      'http://localhost:8201/api/login',
      'http://127.0.0.1:8211/api/login',
    ]);
    // 会话记忆：随后无参读 homeBaseUrl 即备用地址（本文件 import 自 backend）
    const { homeBaseUrl } = await import('../../backend.ts');
    expect(homeBaseUrl()).toBe('http://127.0.0.1:8211');
  });

  it('探测未命中（无受信 dev 后端）→ 如实 origin_blocked，不冒充成功', async () => {
    setQuery('');
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch')) // POST 默认
      .mockResolvedValue({ ok: true, json: async () => undefined }); // 探针与 5 个备用端口探测全部「在线但不放行」
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLoginMirror());
    let res: LoginResult | undefined;
    await act(async () => {
      res = await result.current.login(form);
    });
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.reason).toBe('origin_blocked');
  });

  it('显式 opts.backend 不做自动切换（调用方明确指定即尊重）', async () => {
    setQuery('');
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ ok: true, json: async () => undefined });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLoginMirror({ backend: 'http://opt:1111' }));
    let res: LoginResult | undefined;
    await act(async () => {
      res = await result.current.login(form);
    });
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.reason).toBe('origin_blocked');
    // 只有两类调用：login + 探针；没有 8211–8215 探测
    expect(fetchMock.mock.calls.length).toBe(2);
  });
});
