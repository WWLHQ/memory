// 批次60 修复轮4 首页写锁提示自测：写锁是进程级事实，页面必须「回到前台 / 收到信号」就补读一次。
// 根因：security 页解锁后首页红条不消失 —— storage 事件只在**其它**文档触发，且后台 iframe 不保证收到；
// index.html 作为独立文档错过事件后就一直停在旧快照上。
// 闸门 C 变异靶点：删掉 focus / visibilitychange 监听，本文件 2 例必红。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import type { OverviewSnapshot } from '../../shell/overview.ts';
import { emptyLayerGraph } from '../../Home/layerGraph.ts';

const h = vi.hoisted(() => ({
  loadOverview: vi.fn(),
  loadMcpPanel: vi.fn(),
  loadL0Write: vi.fn(),
  l0UnlockWrite: vi.fn(),
  l0UnlockWriteForMember: vi.fn(),
}));

vi.mock('../../shell/overview.ts', () => ({ loadOverview: h.loadOverview, loadMcpPanel: h.loadMcpPanel }));
vi.mock('../../kernel.ts', () => ({
  rebuildKernelForDataPlane: vi.fn(),
  getKernel: () => ({
    l0UnlockWrite: (...a: unknown[]) => h.l0UnlockWrite(...a),
    l0UnlockWriteForMember: (...a: unknown[]) => h.l0UnlockWriteForMember(...a),
  }),
}));
vi.mock('../../shared/hostTheme.ts', () => ({ useHostTheme: () => 'light' }));
vi.mock('../../shared/shellNavigate.ts', () => ({ requestShellView: vi.fn() }));
// 首页解锁弹窗复用真实 L0WriteUnlock：这里只替换会话/内核通道，组件本身照常渲染
vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 's_test',
  fetchSessionContext: async () => null,
  useSessionContext: () => ({
    sid: 's_test', context: { role: 'admin', user_id: 'admin_test' }, role: 'admin', loading: false,
  }),
}));
vi.mock('../../shell/statusbar.ts', () => ({ loadL0Write: h.loadL0Write }));

import { OverviewPage } from '../OverviewPage.tsx';

function snap(over: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  return {
    loadedAt: Date.UTC(2026, 10, 10, 1, 30, 0),
    kernelMode: 'host',
    storageError: null,
    gains: [],
    raw: { gains: [], anomalies: [], activeMemories: [], todos: [] },
    pendingSync: 0,
    health: { status: 'ok', detail: 'HTTP 200', checkedAt: 1 },
    session: true,
    billing: { status: 'ok', detail: '1 个引擎厂商实时可查', live: 1, total: 1 },
    facts: { memories: 7, audits: 12, writeToday: 1, recallToday: 2, conflicts: 1 },
    strata: [{ layer: 'L1', count: 7 }],
    effectGains: [{ icon: 'x', title: 'Token 节省', big: '-40%', desc: 'd', src: 's' }],
    graph: emptyLayerGraph(),
    recentAudits: { ok: true, rows: [], total: 12, error: null },
    today: { ok: true, write: 1, recall: 2, graft: 0, filtered: 0, error: null },
    token: { ok: true, savedPct: 40, recallCount: 2, savedTokens: 600, series: [900, 600], error: null },
    refine: { ok: false, available: false, view: null, error: '非桌面壳' },
    mcp: { ok: false, available: false, endpoint: null, clients: [], error: '非桌面壳' },
    engines: { ok: false, available: false, engines: [], error: '非桌面壳' },
    dataRoot: { available: true, root: 'D:\\data', error: null },
    ...over,
  };
}

const LOCKED = snap({ l0Write: { available: true, unlocked: false, detail: null } });
const UNLOCKED = snap({ l0Write: { available: true, unlocked: true, detail: null } });

beforeEach(() => {
  // 默认让「启动暂态后台重试」挂起：只测快照渲染，不让 800ms 定时器改写断言对象
  h.loadL0Write.mockReset();
  h.loadL0Write.mockReturnValue(new Promise(() => {}));
  h.l0UnlockWrite.mockReset();
  h.l0UnlockWriteForMember.mockReset();
});

describe('首页写锁提示：回到前台即补读真实写锁', () => {
  beforeEach(() => {
    h.loadOverview.mockReset();
    h.loadMcpPanel.mockReset();
    h.loadMcpPanel.mockResolvedValue({ ok: false, available: false, endpoint: null, clients: [], error: '非桌面壳' });
  });

  it('窗口 focus → 重读一次，已解锁则红条消失（不必等 storage 事件）', async () => {
    h.loadOverview.mockResolvedValueOnce(LOCKED).mockResolvedValue(UNLOCKED);
    render(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId('home-l0-lock-alert')).toBeInTheDocument());

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(screen.queryByTestId('home-l0-lock-alert')).toBeNull());
    expect(h.loadOverview.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('文档回到可见（visibilitychange 且非 hidden）→ 同样补读', async () => {
    h.loadOverview.mockResolvedValueOnce(LOCKED).mockResolvedValue(UNLOCKED);
    render(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId('home-l0-lock-alert')).toBeInTheDocument());

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(screen.queryByTestId('home-l0-lock-alert')).toBeNull());
  });

  it('文档处于 hidden 时不补读（后台不必白跑一次取数）', async () => {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      h.loadOverview.mockResolvedValue(LOCKED);
      render(<OverviewPage />);
      await waitFor(() => expect(screen.getByTestId('home-l0-lock-alert')).toBeInTheDocument());
      const before = h.loadOverview.mock.calls.length;

      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(h.loadOverview.mock.calls.length).toBe(before);
    } finally {
      // original 取自 Document.prototype：document 自身覆盖的属性必须删掉，
      // 否则后面用例的 focus 补读会被永久 hidden 吞掉（2026-11-16 实测污染）
      void original;
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });
});

describe('首页 L0 提示：未登录完全隐藏，登录后照常显示（2026-11-16）', () => {
  beforeEach(() => {
    h.loadOverview.mockReset();
    h.loadMcpPanel.mockReset();
    h.loadMcpPanel.mockResolvedValue({ ok: false, available: false, endpoint: null, clients: [], error: '非桌面壳' });
  });

  async function loggedInThenOut(loggedIn: OverviewSnapshot, testId: string) {
    // 先证明该提示在登录态确实会出现，再切到未登录同一写锁事实，证明只因登录态而隐藏
    // （页头已按设计稿去掉「重读」按钮；补读走 focus 监听，本测试顺带复验它仍生效）
    h.loadOverview.mockResolvedValueOnce(loggedIn).mockResolvedValue({ ...loggedIn, session: false });
    render(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.queryByTestId(testId)).toBeNull());
    expect(h.loadOverview.mock.calls.length).toBeGreaterThanOrEqual(2);
  }

  it('写密钥未解锁：未登录隐藏', async () => {
    await loggedInThenOut(LOCKED, 'home-l0-lock-alert');
  });

  it('写锁状态读不到：未登录隐藏', async () => {
    const UNKNOWN = snap({ l0Write: { available: false, unlocked: false, detail: '桌面壳未返回状态' } });
    await loggedInThenOut(UNKNOWN, 'home-l0-lock-unknown');
  });

  it('近 30 分钟写入被挡：未登录隐藏', async () => {
    const BLOCKED = snap({
      raw: {
        gains: [], activeMemories: [], todos: [],
        anomalies: [{ title: 'L0 写密钥未解锁：写入被挡', detail: '近 30 分钟 2 条没入库', level: 'error' }],
      },
      l0Write: { available: false, unlocked: false, detail: '桌面壳未返回状态' },
    });
    await loggedInThenOut(BLOCKED, 'home-l0-blocked-alert');
  });
});

describe('启动冷启：写锁探针超时不再以「需要重读」打扰用户（2026-11-22）', () => {
  beforeEach(() => {
    h.loadOverview.mockReset();
    h.loadMcpPanel.mockReset();
    h.loadMcpPanel.mockResolvedValue({ ok: false, available: false, endpoint: null, clients: [], error: '非桌面壳' });
  });

  const PENDING = snap({
    l0Write: { available: false, unlocked: false, detail: '写锁状态读取超时（不阻塞首页其它读数）', transient: true },
  });

  it('transient 快照 → 不显示「状态暂不可读」提示（不再要求用户点重读）', async () => {
    h.loadOverview.mockResolvedValue(PENDING);
    render(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId('overview-head')).toBeInTheDocument());
    expect(screen.queryByTestId('home-l0-lock-unknown')).toBeNull();
    // 只钉写锁区：MCP 卡自带的「重读」是另一功能，不能拿来当断言靶
    expect(screen.queryByText(/写密钥锁状态暂不可读/)).toBeNull();
  });

  it('后台静默重试读到真锁 → 自动转成常驻解锁提示（全程无需用户点按钮）', async () => {
    h.loadOverview.mockResolvedValue(PENDING);
    h.loadL0Write.mockReset();
    h.loadL0Write.mockResolvedValue({ status: 'ok', view: { unlocked: false } });
    render(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId('home-l0-lock-alert')).toBeInTheDocument(), { timeout: 3000 });
    expect(h.loadL0Write).toHaveBeenCalled();
    expect(screen.queryByTestId('home-l0-lock-unknown')).toBeNull();
  });
});

describe('首页解锁：点一次「去解锁」直接弹出可输入的解锁框（2026-11-22）', () => {
  beforeEach(() => {
    h.loadOverview.mockReset();
    h.loadMcpPanel.mockReset();
    h.loadMcpPanel.mockResolvedValue({ ok: false, available: false, endpoint: null, clients: [], error: '非桌面壳' });
  });

  it('点一次即出框（含口令输入框），关闭按钮可收起', async () => {
    h.loadOverview.mockResolvedValue(LOCKED);
    render(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId('home-l0-lock-alert')).toBeInTheDocument());

    expect(screen.queryByTestId('home-unlock-mask')).toBeNull();
    fireEvent.click(screen.getByTestId('home-l0-unlock-open'));
    expect(screen.getByTestId('home-unlock-mask')).toBeInTheDocument();
    expect(screen.getByTestId('l0-unlock-password')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('home-unlock-close'));
    expect(screen.queryByTestId('home-unlock-mask')).toBeNull();
  });

  it('框内输入口令并提交 → 调真实内核解锁，成功后弹窗关闭并重读账本', async () => {
    h.l0UnlockWrite.mockResolvedValue(undefined);
    h.loadOverview.mockResolvedValueOnce(LOCKED).mockResolvedValue(UNLOCKED);
    render(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId('home-l0-lock-alert')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('home-l0-unlock-open'));
    fireEvent.change(screen.getByTestId('l0-unlock-password'), { target: { value: 'pw_test' } });
    fireEvent.click(screen.getByTestId('l0-unlock-submit'));

    await waitFor(() => expect(h.l0UnlockWrite).toHaveBeenCalledWith('pw_test'));
    await waitFor(() => expect(screen.queryByTestId('home-unlock-mask')).toBeNull());
    expect(h.loadOverview.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(h.l0UnlockWriteForMember).not.toHaveBeenCalled();
  });
});
