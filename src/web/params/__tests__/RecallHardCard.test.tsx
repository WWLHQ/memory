// 批次62 · 参数页「硬前置召回 A/B/C」卡片单测：
// 浏览器模式诚实降级、徽标显示真值（不拿草稿冒充已启用）、二选一按钮只改草稿、
// 保存只发变化字段、B 未填上游不许启用、C 意图与生效不一致必须提示。
// 2026-11-16 权限下放：A / C 成员可改，B 仍限管理员；未登录才整块禁用。
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RecallHardCard } from '../RecallHardCard.tsx';
import { clearStoredSessionId, storeSessionId } from '../../Home/crossTabAuth.ts';

const realFetch = globalThis.fetch;

const BASE_STATE = {
  ok: true,
  config: { a_hook: true, b_gateway: false, b_upstream: '', b_port: 8300, c_strict_gate: true },
  a: {
    enabled: true, installed: true,
    hostPath: 'C:\\Users\\LHQ\\.workbuddy\\settings.json',
    hookScript: 'D:\\repo\\dist-electron\\recall-hard\\force_recall.mjs',
    installedPath: 'D:\\repo\\dist-electron\\recall-hard\\force_recall.mjs',
    scriptExists: true,
    lastRun: null,
    overwritten: false,
    note: '宿主钩子已写入配置 · 路径 C:\\Users\\LHQ\\.workbuddy\\settings.json',
    needsRestart: false,
  },
  b: { enabled: false, running: false, port: 8300, upstream: '', baseUrl: 'http://127.0.0.1:8300/v1' },
  c: { enabled: true, effective: true },
};

const state = (over: Record<string, unknown> = {}) => ({ ...BASE_STATE, ...over });

function setHost(opts: {
  state?: () => Promise<unknown>;
  set?: (patch: unknown) => Promise<unknown>;
} = {}) {
  (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
  (window as unknown as { api: unknown }).api = {
    recallHard: {
      state: opts.state ?? (async () => state()),
      set: opts.set ?? (async (patch: unknown) => {
        const p = (patch ?? {}) as Record<string, unknown>;
        return state({
          config: { ...BASE_STATE.config, ...p },
          a: { ...BASE_STATE.a, enabled: p.a_hook ?? BASE_STATE.a.enabled, installed: p.a_hook ?? BASE_STATE.a.installed },
          c: { enabled: p.c_strict_gate ?? true, effective: p.c_strict_gate ?? true },
        });
      }),
    },
    log: { write: () => undefined },
  };
}

function clearHost() {
  delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
  delete (window as unknown as { api?: unknown }).api;
}

function mockRole(role: 'admin' | 'member' | null) {
  // 注意 useSessionContext 的口径：context 存在且非 admin 一律算 member；未登录 = context 为 null。
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      context: role ? { user_id: 'u1', team_id: 't1', enterprise_id: 'e1', role } : null,
    }),
  }));
}

beforeEach(() => { localStorage.clear(); storeSessionId('sid_test'); });
afterEach(() => {
  clearHost();
  clearStoredSessionId();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('RecallHardCard（批次62）', () => {
  test('浏览器模式：如实说明三层开关由主进程执行，不渲染任何开关', async () => {
    mockRole('admin');
    render(<RecallHardCard />);
    expect(await screen.findByTestId('recall-hard-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('rh-a-pick')).toBeNull();
  });

  test('徽标显示真值：A 已装钩子 / B 未运行 / C 生效中', async () => {
    mockRole('admin');
    setHost();
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-a-st')).toHaveTextContent('已启用'));
    expect(screen.getByTestId('rh-b-st')).toHaveTextContent('未启用');
    expect(screen.getByTestId('rh-c-st')).toHaveTextContent('已启用');
    expect(screen.getByTestId('rh-a-state')).toHaveTextContent('宿主钩子已写入配置');
    expect(screen.getByTestId('rh-b-state')).toHaveTextContent('网关未运行 · 监听端口 8300');
    expect(screen.getByTestId('rh-baseurl')).toHaveTextContent('http://127.0.0.1:8300/v1');
    // 二选一按钮的选中态必须跟着草稿意图走（A 开 → 「启用」高亮，「不启用」不高亮）
    const onBtn = screen.getByTestId('rh-a-pick').querySelector('[data-value="on"]') as HTMLElement;
    const offBtn = screen.getByTestId('rh-a-pick').querySelector('[data-value="off"]') as HTMLElement;
    expect(onBtn.className).toContain('active');
    expect(onBtn).toHaveAttribute('aria-pressed', 'true');
    expect(offBtn.className).not.toContain('active');
    expect(offBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('点「不启用」只改草稿：先出现未保存提示，保存后才发 patch 且只发变化字段', async () => {
    mockRole('admin');
    const setSpy = vi.fn(async (patch: unknown) => state({
      config: { ...BASE_STATE.config, ...(patch as Record<string, unknown>) },
      a: { ...BASE_STATE.a, enabled: false, installed: false, note: '宿主钩子已摘除 · 其它钩子保留' },
    }));
    setHost({ set: setSpy });
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-a-pick')).toBeInTheDocument());

    // 未改动时保存按钮不可点（没有改动就没有提交）
    expect(screen.getByTestId('rh-save')).toBeDisabled();

    await userEvent.click(screen.getByTestId('rh-a-pick').querySelector('[data-value="off"]') as HTMLElement);
    expect(screen.getByTestId('rh-summary')).toHaveTextContent('有未保存改动');
    expect(screen.getByTestId('rh-save')).not.toBeDisabled();
    expect(setSpy).not.toHaveBeenCalled(); // 点按钮 ≠ 已保存

    await userEvent.click(screen.getByTestId('rh-save'));
    await waitFor(() => expect(setSpy).toHaveBeenCalledTimes(1));
    expect(setSpy.mock.calls[0][0]).toEqual({ a_hook: false }); // 只发变化字段
    await waitFor(() => expect(screen.getByTestId('rh-msg')).toHaveTextContent('已保存并生效'));
    expect(screen.getByTestId('rh-a-state')).toHaveTextContent('宿主钩子已摘除');
  });

  test('B 未填上游就点「启用」→ 当场拒绝，不发请求', async () => {
    mockRole('admin');
    const setSpy = vi.fn(async (patch: unknown) => state({ config: { ...BASE_STATE.config, ...(patch as object) } }));
    setHost({ set: setSpy });
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-b-pick')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('rh-b-pick').querySelector('[data-value="on"]') as HTMLElement);
    expect(screen.getByTestId('rh-msg')).toHaveTextContent('请先填写上游地址再启用 B');
    expect(setSpy).not.toHaveBeenCalled();
    // 草稿没被改动：保存按钮仍不可点
    expect(screen.getByTestId('rh-save')).toBeDisabled();
  });

  test('C：服务端当前生效值与配置意图不一致时明确提示', async () => {
    mockRole('admin');
    setHost({ state: async () => state({ c: { enabled: true, effective: false } }) });
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-c-lag')).toHaveTextContent('配置意图与实际生效不一致'));
    expect(screen.getByTestId('rh-c-st')).toHaveTextContent('未启用');
  });

  test('A 脚本缺失时给出告警（不假装启用成功）', async () => {
    mockRole('admin');
    setHost({ state: async () => state({ a: { ...BASE_STATE.a, installed: false, scriptExists: false, note: '钩子脚本不存在：D:\\x\\force_recall.mjs' } }) });
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-a-script-missing')).toBeInTheDocument());
    expect(screen.getByTestId('rh-a-st')).toHaveTextContent('未启用');
  });

  test('A 改动后需要重启宿主：横幅明说 hooks 不热加载', async () => {
    mockRole('admin');
    setHost({ state: async () => state({ a: { ...BASE_STATE.a, needsRestart: true } }) });
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-a-restart')).toHaveTextContent('hooks 不热加载'));
  });

  test('A 写入后被宿主回写覆盖：明说「再点保存也没用，先退出宿主」，不再骗用户点保存', async () => {
    mockRole('admin');
    setHost({
      state: async () => state({
        a: {
          ...BASE_STATE.a,
          installedPath: 'D:\\repo\\resources\\app.asar\\dist-electron\\recall-hard\\force_recall.mjs',
          overwritten: true,
          needsRestart: true,
        },
      }),
    });
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-a-overwritten')).toBeInTheDocument());
    expect(screen.getByTestId('rh-a-overwritten')).toHaveTextContent('完全退出宿主');
    // 已被覆盖时不能再显示「点保存会重写」——那句已经验证无效，会误导用户反复点
    expect(screen.queryByTestId('rh-a-path-mismatch')).toBeNull();
  });

  test('A 路径不符但还没写过（overwritten=false）：仍提示点保存可修正', async () => {
    mockRole('admin');
    setHost({
      state: async () => state({
        a: {
          ...BASE_STATE.a,
          installedPath: 'D:\\repo\\resources\\app.asar\\dist-electron\\recall-hard\\force_recall.mjs',
        },
      }),
    });
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-a-path-mismatch')).toHaveTextContent('点「保存并生效」会重写为'));
    expect(screen.queryByTestId('rh-a-overwritten')).toBeNull();
  });

  test('成员：A / C 可改、B 仍禁用，并说明成员可改范围', async () => {
    mockRole('member');
    setHost();
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-a-pick')).toBeInTheDocument());
    // 权限下放：A 宿主钩子 / C 内核门禁 对成员开放
    expect((screen.getByTestId('rh-a-pick').querySelector('[data-value="off"]') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('rh-c-pick').querySelector('[data-value="off"]') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('rh-save') as HTMLButtonElement).disabled).toBe(true); // 无改动时保存仍禁用
    // B 仍限管理员：开关与上游输入都点不动
    expect((screen.getByTestId('rh-b-pick').querySelector('[data-value="on"]') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('rh-upstream')).toBeDisabled();
    expect(screen.getByTestId('rh-b-need-admin')).toHaveTextContent('B 需管理员');
    // 给成员的是「可改范围」说明，不是笼统的「需管理员」
    expect(screen.getByTestId('rh-member-scope')).toHaveTextContent('成员可改 A');
    expect(screen.queryByTestId('rh-need-admin')).toBeNull();
  });

  test('成员：改 A 后可保存，patch 只含 a_hook（不偷偷带上 B 字段）', async () => {
    mockRole('member');
    const setSpy = vi.fn((..._args: unknown[]) => Promise.resolve(state()));
    setHost({ set: setSpy });
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-a-pick')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('rh-a-pick').querySelector('[data-value="off"]') as HTMLElement);
    const saveBtn = screen.getByTestId('rh-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    await userEvent.click(saveBtn);
    // hostCall 会在末尾附 sessionId，所以只校验 patch 本身
    await waitFor(() => expect(setSpy).toHaveBeenCalled());
    expect(setSpy.mock.calls[0][0]).toEqual({ a_hook: false });
  });

  test('未登录：三层都禁用并提示需管理员', async () => {
    mockRole(null);
    setHost();
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-a-pick')).toBeInTheDocument());
    expect((screen.getByTestId('rh-a-pick').querySelector('[data-value="on"]') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('rh-c-pick').querySelector('[data-value="off"]') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('rh-need-admin')).toHaveTextContent('需管理员');
  });

  test('失败锁·角标：无记录不显示；最近失败显示中文原因，不泄露英文枚举', async () => {
    mockRole('admin');
    // 无 lastRun → 不显示角标
    setHost();
    const { unmount } = render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-a-st')).toBeInTheDocument());
    expect(screen.queryByTestId('rh-a-lastrun')).toBeNull();
    unmount();

    // 最近失败 → 显示人话角标，title 给人话原因，绝不出现英文枚举
    setHost({ state: async () => state({
      a: { ...BASE_STATE.a, lastRun: { schema: 1, status: 'failed', reason: 'rpc_error', at: '2026-01-01T00:00:00.000Z', hits: 0 } },
    }) });
    render(<RecallHardCard />);
    const badge = await screen.findByTestId('rh-a-lastrun');
    expect(badge).toHaveTextContent('最近召回失败');
    expect(badge).toHaveClass('bad');
    expect(badge.getAttribute('title')).toContain('记忆服务没响应');
    expect(badge.getAttribute('title')).not.toContain('rpc_error');
  });

  test('失败锁·角标：成功显示条数，零命中显示「零命中」', async () => {
    mockRole('admin');
    setHost({ state: async () => state({
      a: { ...BASE_STATE.a, lastRun: { schema: 1, status: 'ok', at: '2026-01-01T00:00:00.000Z', hits: 4 } },
    }) });
    const { unmount } = render(<RecallHardCard />);
    expect(await screen.findByTestId('rh-a-lastrun')).toHaveTextContent('本轮已召回 4 条');
    unmount();

    setHost({ state: async () => state({
      a: { ...BASE_STATE.a, lastRun: { schema: 1, status: 'empty', at: '2026-01-01T00:00:00.000Z', hits: 0 } },
    }) });
    render(<RecallHardCard />);
    expect(await screen.findByTestId('rh-a-lastrun')).toHaveTextContent('本轮零命中');
  });

  test('主进程拒绝保存：显示原因，不显示「已保存」', async () => {
    mockRole('admin');
    setHost({ set: async () => ({ ...state(), ok: false, error: '需要管理员权限' }) });
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-a-pick')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('rh-a-pick').querySelector('[data-value="off"]') as HTMLElement);
    await userEvent.click(screen.getByTestId('rh-save'));
    await waitFor(() => expect(screen.getByTestId('rh-error')).toHaveTextContent('需要管理员权限'));
    expect(screen.queryByTestId('rh-msg')).toBeNull();
  });
});
