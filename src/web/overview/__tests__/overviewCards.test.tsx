// 2026-11-16 用户要求的三件版式事：
// ① 效果证据四卡长宽统一（等宽 + 等高，卡内三段对齐、来源行贴底）；
// ② 卡片解释区说人话（文案侧断言在 AgentOnboard/__tests__/coreReal.test.ts，那里是唯一来源）；
// ③ 「今日概览」上移到「L2–L6 补炼队列」上面。
// jsdom 不加载外链 CSS，所以版式靠读 overviewPage.css 钉住；顺序靠真实渲染后的 DOM 位置断言。
// 闸门 C 变异靶点：把 .af-g4 的 align-items 改回 start、或把 TodayPanel 挪回右栏末尾，本文件必红。
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { OverviewSnapshot } from '../../shell/overview.ts';
import { emptyLayerGraph } from '../../Home/layerGraph.ts';

const css = readFileSync(`${process.cwd()}/src/web/overview/overviewPage.css`, 'utf8');

const h = vi.hoisted(() => ({ loadOverview: vi.fn(), loadMcpPanel: vi.fn() }));

vi.mock('../../shell/overview.ts', () => ({ loadOverview: h.loadOverview, loadMcpPanel: h.loadMcpPanel }));
vi.mock('../../kernel.ts', () => ({ rebuildKernelForDataPlane: vi.fn() }));
vi.mock('../../shared/hostTheme.ts', () => ({ useHostTheme: () => 'light' }));
vi.mock('../../shared/shellNavigate.ts', () => ({ requestShellView: vi.fn() }));

import { OverviewPage } from '../OverviewPage.tsx';

const FOUR_GAINS = [
  { icon: '🪙', title: 'Token 节省', big: '0%', desc: '本周期共 <b>2 次召回</b>，每次平均带 <b>750t</b> 上下文；带得越少，Agent 越省', src: '内核账本 · 每次召回实算' },
  { icon: '⚡', title: '效率提升', big: '4 次命中', desc: '跨会话召回 <b>2 次</b>，累计命中 <b>4 条</b>记忆', src: '内核账本 · 每次命中实算' },
  { icon: '🔁', title: '跨 Agent 复用', big: '3 条 · 2 域', desc: '一次写入，多个 Agent 都能命中；目前 <b>2 个</b>项目共用这批记忆', src: '内核账本 · 按项目统计' },
  { icon: '💸', title: '模型成本节省', big: '省 ¥0.002', desc: '本周期共 <b>2 次召回</b>，累计少注入 <b>1,000t</b>；金额按你设的单价折算，属估算值', src: '内核账本 · 按单价折算' },
];

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
    effectGains: FOUR_GAINS,
    graph: emptyLayerGraph(),
    recentAudits: { ok: true, rows: [], total: 12, error: null },
    today: { ok: true, write: 1, recall: 2, graft: 0, filtered: 0, error: null },
    token: { ok: true, savedPct: 40, recallCount: 2, savedTokens: 600, series: [900, 600], error: null },
    refine: { ok: false, available: false, view: null, error: '非桌面壳' },
    mcp: { ok: false, available: false, endpoint: null, clients: [], error: '非桌面壳' },
    engines: { ok: false, available: false, engines: [], error: '非桌面壳' },
    dataRoot: { available: true, root: 'D:\\data', error: null },
    l0Write: { available: true, unlocked: true, detail: null },
    ...over,
  };
}

describe('效果证据四卡：长宽统一（版式契约）', () => {
  it('四卡所在网格等高拉伸，不再是 align-items: start 的参差不齐', () => {
    // 断言必须锁在 .af-g4 自己的声明块内（[^}]*）：.af-cols 仍是有意保留的 align-items:start，
    // 用 [\s\S]*? 会跨块误命中，把「两栏顶对齐」当成回退。
    expect(css).toMatch(/\.af-g4\s*\{[^}]*align-items:\s*stretch/);
    expect(css).not.toMatch(/\.af-g4\s*\{[^}]*align-items:\s*start/);
    expect(css).toMatch(/\.af-g4\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('卡内改成 flex 列：说明区吃掉剩余高度、来源行贴底对齐', () => {
    expect(css).toMatch(/\.af-stat\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/\.af-stat \.d\s*\{[^}]*flex:\s*1 1 auto/);
    expect(css).toMatch(/\.af-stat \.src\s*\{[^}]*margin-top:\s*auto/);
  });

  it('每张卡都有最小高度，空账本也不会塌成一条', () => {
    expect(css).toMatch(/\.af-g4 > \.af-stat\s*\{[^}]*min-height:\s*96px/);
  });
});

describe('效果证据四卡：结构与顺序（真实渲染）', () => {
  beforeEach(() => {
    h.loadOverview.mockReset();
    h.loadMcpPanel.mockReset();
    h.loadMcpPanel.mockResolvedValue({ ok: false, available: false, endpoint: null, clients: [], error: '非桌面壳' });
  });

  it('四卡同容器、同 class（等宽由同一列轨道保证），标题与来源都在', async () => {
    h.loadOverview.mockResolvedValue(snap());
    render(<OverviewPage />);
    const wrap = await screen.findByTestId('home-gains');
    const cards = screen.getAllByTestId('home-gain-card');
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.parentElement).toBe(wrap);
      expect(card.className).toContain('af-panel');
      expect(card.className).toContain('af-stat');
      expect(card.querySelector('.k')).not.toBeNull();
      expect(card.querySelector('.v')).not.toBeNull();
      expect(card.querySelector('.src')).not.toBeNull();
    }
  });

  it('今日概览排在 L2–L6 补炼队列之前', async () => {
    h.loadOverview.mockResolvedValue(snap());
    render(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId('home-today')).toBeInTheDocument());
    const today = screen.getByTestId('home-today');
    const refine = screen.getByTestId('home-refine');
    // 同一右栏、且 today 在 refine 之前
    expect(today.parentElement).toBe(refine.parentElement);
    expect(today.compareDocumentPosition(refine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
