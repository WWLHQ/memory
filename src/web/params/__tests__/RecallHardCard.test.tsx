// 批次62 · 参数页「硬前置召回 A/B/C」卡片单测：
// 浏览器模式诚实降级、徽标显示真值（不拿草稿冒充已启用）、二选一按钮只改草稿、
// 保存只发变化字段、B 未填上游不许启用、C 意图与生效不一致必须提示、非管理员只能看。
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
    scriptExists: true,
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

function mockRole(role: 'admin' | 'member') {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ context: { user_id: 'u1', team_id: 't1', enterprise_id: 'e1', role } }),
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

  test('非管理员：开关禁用 + 说明需要管理员', async () => {
    mockRole('member');
    setHost();
    render(<RecallHardCard />);
    await waitFor(() => expect(screen.getByTestId('rh-a-pick')).toBeInTheDocument());
    expect((screen.getByTestId('rh-a-pick').querySelector('[data-value="on"]') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('rh-c-pick').querySelector('[data-value="off"]') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('rh-need-admin')).toHaveTextContent('需管理员');
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
