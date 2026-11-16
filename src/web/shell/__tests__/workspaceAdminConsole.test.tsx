// T3（管理员与成员权限设计 §14.1 / AC-9）：管理台默认视图。
// - 管理员登录后壳层默认落「管理台」（复用 security.html?tab=overview），顶栏出现「管理员视图·操作留痕」与「回到工作台」；
// - 成员登录后仍默认首页，导航不出现「管理台」项；
// - 一键切回工作台不改变数据可用性（仅切视图）。
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_STORAGE_KEY } from '../../../shared/sessionKey.ts';

const m = vi.hoisted(() => ({
  ctx: null as Record<string, unknown> | null,
  defaultOverview: {
    loadedAt: 1,
    kernelMode: 'host' as const,
    storageError: null,
    gains: [
      { icon: 'x', title: '累计记忆', big: '7', desc: '内核记忆主表条数', src: '内核账本·实时' },
      { icon: 'x', title: '累计动作', big: '12', desc: '审计流水累计条数', src: '内核账本·实时' },
      { icon: 'x', title: '近 1h 调用', big: '2', desc: '审计 ts ≥ now−60min', src: '内核账本·实时' },
      { icon: 'x', title: '待裁决', big: '1', desc: '9.7 冲突队列', src: '内核账本·实时' },
    ],
    health: { status: 'ok' as const, detail: 'HTTP 200', checkedAt: 1 },
    session: false,
    billing: { status: 'unavailable' as const, detail: '需登录后查询（余额视图按会话鉴权）' },
    raw: { gains: [], anomalies: [], activeMemories: [], todos: [] },
    pendingSync: 0,
    facts: { memories: 7, audits: 12, writeToday: 0, recallToday: 2, conflicts: 1 },
    strata: [
      { layer: 'L0', count: 7 }, { layer: 'L1', count: 2 }, { layer: 'L2', count: 1 },
      { layer: 'L3', count: 0 }, { layer: 'L4', count: 0 }, { layer: 'L5', count: 2 },
      { layer: 'L6', count: 1 },
    ],
    effectGains: [],
    graph: { hubs: [], nodes: [], edges: [], stats: { total: 7, rendered: 0, truncated: 0, refined: 0, conflicts: 1, conflictMemories: 0, merges: 0, grafts: 0, masked: 0 } },
    recentAudits: { ok: true, rows: [], total: 12, error: null },
    today: { ok: true, write: 0, recall: 2, graft: 0, filtered: 0, error: null },
    token: { ok: true, savedPct: null, recallCount: 2, savedTokens: 0, series: [], error: null },
    refine: { ok: false, available: false, view: null, error: '组件单测：不探主进程' },
    mcp: { ok: false, available: false, endpoint: null, clients: [], error: '组件单测：不探主进程' },
    engines: { ok: false, available: false, engines: [], error: '组件单测：不探主进程' },
    dataRoot: { available: false, root: null, error: '组件单测：不探主进程' },
  },
}));

vi.mock('../overview.ts', () => ({ loadOverview: vi.fn(async () => m.defaultOverview) }));
vi.mock('../taskpane.ts', () => ({ loadPendingWrites: vi.fn() }));
vi.mock('../dock.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dock.ts')>();
  return {
    ...actual,
    loadOutputLog: vi.fn(),
    loadScheduleRuns: vi.fn(),
    loadAuditForMemory: vi.fn(),
  };
});
vi.mock('../statusbar.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../statusbar.ts')>();
  return { ...actual, loadStatusbar: vi.fn() };
});
vi.mock('../layers.ts', () => ({ loadLayerPanel: vi.fn() }));
vi.mock('../navCounts.ts', () => ({ loadNavCounts: vi.fn() }));
// T3 核心：会话身份是组件输入。admin → 默认落管理台；member → 保持首页且导航无管理台项。
vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 'sid_admin_console',
  fetchSessionContext: vi.fn(async () => m.ctx as never),
  useSessionContext: () => ({
    sid: 'sid_admin_console',
    context: m.ctx as never,
    role: m.ctx ? (m.ctx as { role?: string }).role ?? 'member' : null,
    loading: false,
  }),
}));

import { Workspace } from '../Workspace.tsx';
import { loadOverview } from '../overview.ts';
import { loadAuditForMemory, loadOutputLog, loadScheduleRuns } from '../dock.ts';
import { loadStatusbar } from '../statusbar.ts';
import { loadLayerPanel } from '../layers.ts';
import { loadNavCounts } from '../navCounts.ts';
import { loadPendingWrites } from '../taskpane.ts';

const ADMIN_CTX = {
  user_id: 'admin', team_id: 'admin-team', enterprise_id: 'local', role: 'admin',
};
const MEMBER_CTX = {
  user_id: 'member1', team_id: 't1', enterprise_id: 'e1', role: 'member',
};

beforeEach(() => {
  m.ctx = null;
  localStorage.clear();
  vi.mocked(loadPendingWrites).mockReset();
  vi.mocked(loadPendingWrites).mockResolvedValue({
    status: 'unavailable',
    detail: '浏览器模式：没有主进程，读不到 MCP 写入兜底队列；请用桌面端查看。',
  });
  vi.mocked(loadOutputLog).mockReset();
  vi.mocked(loadOutputLog).mockResolvedValue({ status: 'unavailable', detail: '组件单测：不读 actions.log' });
  vi.mocked(loadScheduleRuns).mockReset();
  vi.mocked(loadScheduleRuns).mockResolvedValue({ status: 'unavailable', detail: '组件单测：不读调度记录' });
  vi.mocked(loadAuditForMemory).mockReset();
  vi.mocked(loadAuditForMemory).mockResolvedValue({ status: 'ok', view: [] });
  vi.mocked(loadStatusbar).mockReset();
  vi.mocked(loadStatusbar).mockResolvedValue({
    location: { status: 'ok', view: { kind: 'file', path: 'C:\\data\\memories.db.json', source: 'ipc' } },
    l0: { status: 'ok', view: { has_admin_wrap: true, write_unlocked: false, active_sessions: 0, active_grants: 0, member_write_wraps: 0, member_wrap_ids: [] } },
    l0Write: { status: 'ok', view: { unlocked: false, pending: null } },
    collector: {
      status: 'ok',
      view: { running: true, intervalMs: 60_000, lastAt: 1_790_000_000_000, lastCollected: 12, autoRetryStopped: false, consecutiveFails: 0 },
    },
  });
  vi.mocked(loadLayerPanel).mockReset();
  vi.mocked(loadLayerPanel).mockResolvedValue({
    status: 'ok',
    view: {
      total: 7,
      layers: [
        { layer: 'L6', count: 1 }, { layer: 'L5', count: 2 }, { layer: 'L4', count: 0 },
        { layer: 'L3', count: null }, { layer: 'L2', count: 1 }, { layer: 'L1', count: 2 },
      ],
      failed: ['L3'],
      l0: { status: 'ok', view: { has_admin_wrap: true, write_unlocked: false, active_sessions: 0, active_grants: 0, member_write_wraps: 0, member_wrap_ids: [] } },
      l0Write: { status: 'ok', view: { unlocked: false, pending: null } },
      kernelMode: 'host',
      loadedAt: 1_790_000_000_000,
    },
  });
  vi.mocked(loadOverview).mockClear();
  vi.mocked(loadNavCounts).mockReset();
  vi.mocked(loadNavCounts).mockResolvedValue({});
});

async function renderShell() {
  const r = render(<Workspace />);
  await screen.findByTestId('sb-overview-refresh');
  await act(async () => { await Promise.resolve(); });
  return r;
}

describe('T3 管理台默认视图（AC-9）', () => {
  it('管理员登录后默认落「管理台」：激活标签为管理台、iframe 指向 security.html?tab=overview，顶栏出现留痕标识与「回到工作台」', async () => {
    localStorage.setItem(SESSION_STORAGE_KEY, 'sid_admin_console');
    m.ctx = ADMIN_CTX;
    const { container } = await renderShell();
    // 中心区按标签各挂一个 iframe，激活面板带 .active —— 断言必须取激活面板，不是第一个 iframe
    await waitFor(() => {
      const frame = container.querySelector('.page-pane.active iframe.page-frame') as HTMLIFrameElement | null;
      expect(frame?.getAttribute('src')).toContain('/security.html?tab=overview');
    });
    expect(screen.getByTestId('shell-admin-badge').textContent).toContain('管理员视图·操作留痕');
    const back = screen.getByTestId('shell-back-workbench');
    expect(back.textContent).toContain('回到工作台');
  });

  it('管理员一键切回工作台：iframe 回到 index.html，且仅切视图（不报错、不改变会话）', async () => {
    localStorage.setItem(SESSION_STORAGE_KEY, 'sid_admin_console');
    m.ctx = ADMIN_CTX;
    const { container } = await renderShell();
    await waitFor(() => {
      expect((container.querySelector('.page-pane.active iframe.page-frame') as HTMLIFrameElement | null)?.getAttribute('src')).toContain('/security.html?tab=overview');
    });
    await act(async () => { fireEvent.click(screen.getByTestId('shell-back-workbench')); });
    await waitFor(() => {
      expect((container.querySelector('.page-pane.active iframe.page-frame') as HTMLIFrameElement | null)?.getAttribute('src')).toContain('/index.html');
    });
  });

  it('成员登录后仍默认首页，导航不出现「管理台」项，顶栏无管理员标识', async () => {
    localStorage.setItem(SESSION_STORAGE_KEY, 'sid_admin_console');
    m.ctx = MEMBER_CTX;
    const { container } = await renderShell();
    await waitFor(() => {
      const frame = container.querySelector('.page-pane.active iframe.page-frame') as HTMLIFrameElement | null;
      expect(frame?.getAttribute('src')).toContain('/index.html');
    });
    expect(container.textContent).not.toContain('管理台');
    expect(screen.queryByTestId('shell-admin-badge')).toBeNull();
    expect(screen.queryByTestId('shell-back-workbench')).toBeNull();
  });

  it('未登录保持首页，导航不出现「管理台」项', async () => {
    const { container } = await renderShell();
    const frame = container.querySelector('.page-pane.active iframe.page-frame') as HTMLIFrameElement | null;
    expect(frame?.getAttribute('src')).toContain('/index.html');
    expect(container.textContent).not.toContain('管理台');
  });
});
