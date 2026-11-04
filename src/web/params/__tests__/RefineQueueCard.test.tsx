// 参数页 · L2–L6 后台补炼队列卡单测（批次39）：浏览器模式诚实降级、进度只读可见、
// 角色闸门（开关/入队/重试仅管理员）、三个动作的回执原样回显、引擎不可用时说清「只排不炼」、
// 主进程拒绝时显示原因而不是假装 0 待炼。批次40-C 追加：深度口径文案、阶梯停层原因码分布、入队回执 thin_skipped。
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RefineQueueCard } from '../RefineQueueCard.tsx';
import { clearStoredSessionId, storeSessionId } from '../../Home/crossTabAuth.ts';

const realFetch = globalThis.fetch;

const SUMMARY = {
  enabled: true, pending: 1585, done: 3, failed: 0, skipped: 2,
  day: '2026-11-02', day_rows: 5, day_limit: 500, day_left: 495,
  max_engines_per_call: 3, stop_codes: { thin: 2, too_short: 1 },
  updated_at: Date.UTC(2026, 10, 2, 13, 30, 0),
  queue_path: 'C:\\Users\\LHQ\\AppData\\Roaming\\MultiAgent Memory\\refine-queue.json',
};

const view = (over: Record<string, unknown> = {}) => ({
  ok: true, summary: SUMMARY, engine: { loaded: true, usable: true }, ...over,
});

function setHost(opts: {
  state?: () => Promise<unknown>;
  setEnabled?: (enabled: unknown) => Promise<unknown>;
  backfill?: () => Promise<unknown>;
  retryFailed?: () => Promise<unknown>;
} = {}) {
  (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
  (window as unknown as { api: unknown }).api = {
    refineQueue: {
      state: opts.state ?? (async () => view()),
      setEnabled: opts.setEnabled ?? (async (enabled: unknown) => view({ summary: { ...SUMMARY, enabled } })),
      backfill: opts.backfill ?? (async () => view({ report: { added: 1580, already_queued: 5, settled: 0, protected_skipped: 1, not_eligible: 0 } })),
      retryFailed: opts.retryFailed ?? (async () => view({ retried: 7, summary: { ...SUMMARY, failed: 0, pending: SUMMARY.pending + 7 } })),
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

describe('RefineQueueCard（批次39）', () => {
  test('浏览器模式：如实说明队列由主进程维护，不渲染进度与控件', () => {
    render(<RefineQueueCard />);
    expect(screen.getByTestId('refine-card')).toBeInTheDocument();
    expect(screen.getByTestId('refine-unavailable').textContent).toContain('不是桌面宿主环境');
    expect(screen.queryByTestId('refine-summary')).toBeNull();
    expect(screen.queryByTestId('refine-backfill')).toBeNull();
  });

  test('管理员：进度与额度按主进程数字原样显示（含队列文件路径）', async () => {
    mockRole('admin');
    setHost();
    render(<RefineQueueCard />);
    await waitFor(() => expect(screen.getByTestId('refine-summary').textContent).toContain('1585'));
    const text = screen.getByTestId('refine-summary').textContent!;
    expect(text).toContain('已炼成 3');
    expect(text).toContain('5 / 500');
    expect(text).toContain('还剩 495');
    expect(text).toContain('refine-queue.json');
    expect(text).toContain('21:30:00'); // updated_at 按 UTC+08:00 显示
    // 口径说明把拍板常量写在卡面上，不让用户猜
    expect(screen.getByTestId('refine-card').textContent).toContain('最多试 3 个引擎');
    expect(screen.getByTestId('refine-card').textContent).toContain('不自动重试');
    // 批次40-C：深度按料给（不是每条都炼到 L6）+ 阶梯停在哪儿的原因码分布
    expect(screen.getByTestId('refine-card').textContent).toContain('炼到多深由这条 L1 的料决定');
    const stops = screen.getByTestId('refine-stop-codes').textContent!;
    expect(stops).toContain('L1 太短，没有料炼摘要（thin）2 行');
    expect(stops).toContain('压得太狠（低于本层下限）（too_short）1 行');
  });

  test('批次40-C：没有停层记录时不渲染「阶梯停在哪」那行（不摆个空壳）', async () => {
    mockRole('admin');
    setHost({ state: async () => view({ summary: { ...SUMMARY, stop_codes: {} } }) });
    render(<RefineQueueCard />);
    await waitFor(() => expect(screen.getByTestId('refine-summary')).toBeInTheDocument());
    expect(screen.queryByTestId('refine-stop-codes')).toBeNull();
  });

  test('普通成员：只读进度，开关与三个按钮全部禁用并提示需管理员', async () => {
    mockRole('member');
    setHost();
    render(<RefineQueueCard />);
    await waitFor(() => expect(screen.getByTestId('refine-summary')).toBeInTheDocument());
    expect(screen.getByTestId('refine-need-admin')).toBeInTheDocument();
    expect(screen.getByTestId('refine-toggle')).toBeDisabled();
    expect(screen.getByTestId('refine-backfill')).toBeDisabled();
    expect(screen.getByTestId('refine-retry')).toBeDisabled();
    // 只读刷新按钮仍可用
    expect(screen.getByTestId('refine-refresh')).toBeEnabled();
  });

  test('点「把存量入队补炼」：显示 added / 已在队 / 受保护 / 不合格 四个真实计数', async () => {
    mockRole('admin');
    const backfill = vi.fn(async () => view({ report: { added: 1580, already_queued: 5, settled: 0, protected_skipped: 1, not_eligible: 0 } }));
    setHost({ backfill });
    render(<RefineQueueCard />);
    await waitFor(() => expect(screen.getByTestId('refine-summary')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('refine-backfill'));
    await waitFor(() => expect(backfill).toHaveBeenCalledTimes(1));
    const msg = screen.getByTestId('refine-msg').textContent!;
    expect(msg).toContain('已入队 1580 行');
    expect(msg).toContain('受保护不入队 1');
    expect(msg).toContain('不合格 0');
    // 回执没有这个键就不编：不能凭空冒出「料太短」计数
    expect(msg).not.toContain('料太短');
  });

  test('批次40-C：入队回执带 thin_skipped 时点名「料太短直接跳过」（这些行不起活也不占额度）', async () => {
    mockRole('admin');
    const backfill = vi.fn(async () => view({
      report: { added: 900, already_queued: 0, settled: 0, protected_skipped: 0, not_eligible: 0, thin_skipped: 12 },
    }));
    setHost({ backfill });
    render(<RefineQueueCard />);
    await waitFor(() => expect(screen.getByTestId('refine-summary')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('refine-backfill'));
    await waitFor(() => expect(screen.getByTestId('refine-msg').textContent).toContain('料太短直接跳过 12'));
  });

  test('切换开关：把布尔值传给主进程（暂停时说明「仍入队但不起活」）', async () => {
    mockRole('admin');
    const setEnabled = vi.fn(async (enabled: unknown) => view({ summary: { ...SUMMARY, enabled } }));
    setHost({ setEnabled });
    render(<RefineQueueCard />);
    await waitFor(() => expect(screen.getByTestId('refine-toggle')).toBeChecked());
    await userEvent.click(screen.getByTestId('refine-toggle'));
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith(false, 'sid_test'));
    expect(screen.getByTestId('refine-msg').textContent).toContain('队列已暂停');
  });

  test('failed=0 时「重试失败行」不可点；有失败行才给点，并回显放回的行数', async () => {
    mockRole('admin');
    setHost();
    const { unmount } = render(<RefineQueueCard />);
    await waitFor(() => expect(screen.getByTestId('refine-summary')).toBeInTheDocument());
    expect(screen.getByTestId('refine-retry')).toBeDisabled();
    unmount();

    mockRole('admin');
    const retryFailed = vi.fn(async () => view({ retried: 7, summary: { ...SUMMARY, failed: 3 } }));
    setHost({
      state: async () => view({ summary: { ...SUMMARY, failed: 3 } }),
      retryFailed,
    });
    render(<RefineQueueCard />);
    await waitFor(() => expect(screen.getByTestId('refine-retry')).toBeEnabled());
    await userEvent.click(screen.getByTestId('refine-retry'));
    await waitFor(() => expect(retryFailed).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('refine-msg').textContent).toContain('7 行');
  });

  test('引擎不可用：明说「只排不炼、不判失败、不消耗额度」', async () => {
    mockRole('admin');
    setHost({ state: async () => view({ engine: { loaded: true, usable: false } }) });
    render(<RefineQueueCard />);
    await waitFor(() => expect(screen.getByTestId('refine-engine-warn').textContent).toContain('只排不炼'));
  });

  test('主进程拒绝：显示真实原因（需要管理员/会话失效），不假装 0 待炼', async () => {
    mockRole('member');
    setHost({ state: async () => ({ ok: false, error: '需要登录会话' }) });
    render(<RefineQueueCard />);
    await waitFor(() => expect(screen.getByTestId('refine-error').textContent).toContain('需要登录会话'));
    expect(screen.queryByTestId('refine-summary')).toBeNull();
  });
});
