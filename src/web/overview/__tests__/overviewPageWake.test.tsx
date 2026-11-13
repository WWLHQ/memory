// 批次60 修复轮4 首页写锁提示自测：写锁是进程级事实，页面必须「回到前台 / 收到信号」就补读一次。
// 根因：security 页解锁后首页红条不消失 —— storage 事件只在**其它**文档触发，且后台 iframe 不保证收到；
// index.html 作为独立文档错过事件后就一直停在旧快照上。
// 闸门 C 变异靶点：删掉 focus / visibilitychange 监听，本文件 2 例必红。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { OverviewSnapshot } from '../../shell/overview.ts';
import { emptyLayerGraph } from '../../Home/layerGraph.ts';

const h = vi.hoisted(() => ({ loadOverview: vi.fn() }));

vi.mock('../../shell/overview.ts', () => ({ loadOverview: h.loadOverview }));
vi.mock('../../kernel.ts', () => ({ rebuildKernelForDataPlane: vi.fn() }));
vi.mock('../../shared/hostTheme.ts', () => ({ useHostTheme: () => 'light' }));
vi.mock('../../shared/shellNavigate.ts', () => ({ requestShellView: vi.fn() }));

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

describe('首页写锁提示：回到前台即补读真实写锁', () => {
  beforeEach(() => {
    h.loadOverview.mockReset();
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
      if (original) Object.defineProperty(Document.prototype, 'visibilityState', original);
      else delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });
});
