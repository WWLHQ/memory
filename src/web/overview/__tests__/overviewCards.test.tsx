// 2026-11-21 首页 1:1 复刻（设计真源 stratum-a-full.html pg-home），覆盖 2026-11-16 的两条版式约定：
// ① 效果四卡 = af-stat k/v/d 三段（设计稿无图标位、无来源行；批次52 去掉 align-items 让四卡等高同尺寸）；
// ② 右栏顺序（批次52）：今日概览 → TOKEN 节省率 → 补炼队列 → MCP 接入 → 引擎延迟排行；
// ③ 卡片文案口径断言仍在 AgentOnboard/__tests__/coreReal.test.ts（唯一来源）。
// jsdom 不加载外链 CSS，所以版式靠读 overviewPage.css 钉住；顺序靠真实渲染后的 DOM 位置断言。
// 闸门 C 变异靶点：给 .af-g4 加回 align-items、把 .src 加回卡片、或右栏顺序改回旧版，本文件必红。
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { OverviewSnapshot, OverviewRefinePanel } from '../../shell/overview.ts';
import { emptyLayerGraph } from '../../Home/layerGraph.ts';

const css = readFileSync(`${process.cwd()}/src/web/overview/overviewPage.css`, 'utf8');

const h = vi.hoisted(() => ({
  loadOverview: vi.fn(),
  loadMcpPanel: vi.fn(),
  logoutCurrentSession: vi.fn(),
}));

vi.mock('../../shell/overview.ts', () => ({ loadOverview: h.loadOverview, loadMcpPanel: h.loadMcpPanel }));
vi.mock('../../kernel.ts', () => ({ rebuildKernelForDataPlane: vi.fn() }));
vi.mock('../../shared/hostTheme.ts', () => ({ useHostTheme: () => 'light' }));
vi.mock('../../shared/shellNavigate.ts', () => ({ requestShellView: vi.fn() }));
// 批次51：页头登出走 ShellLoginDialog 的真实口径；单测只验「点击触发一次登出 + 整壳重载」
vi.mock('../../shell/ShellLoginDialog.tsx', () => ({ logoutCurrentSession: h.logoutCurrentSession }));

import { OverviewPage } from '../OverviewPage.tsx';

const FOUR_GAINS = [
  { icon: '🪙', title: 'Token 节省', big: '0%', desc: '本周期共 <b>2 次召回</b>，每次平均带 <b>750t</b> 上下文；带得越少，Agent 越省', src: '内核账本 · 每次召回实算' },
  { icon: '⚡', title: '效率提升', big: '4 次命中', desc: '跨会话召回 <b>2 次</b>，累计命中 <b>4 条</b>记忆', src: '内核账本 · 每次命中实算' },
  { icon: '🔁', title: '跨 Agent 复用', big: '3 条 · 2 域', desc: '一次写入，多个 Agent 都能命中；目前 <b>2 个</b>项目共用这批记忆', src: '内核账本 · 按项目统计' },
  { icon: '💸', title: '模型成本节省', big: '省 ¥0.002', desc: '本周期共 <b>2 次召回</b>，累计少注入 <b>1,000t</b>；金额按你设的单价折算，属估算值', src: '内核账本 · 按单价折算' },
];

/** 可用补炼队列视图（真实 RefineQueueView 形状，面板完整渲染用） */
const REFINED_VIEW = {
  summary: {
    enabled: true, pending: 2, done: 3, failed: 1, skipped: 0,
    day: '2026-11-21', day_rows: 6, cap_enabled: true, cap_rows: 500, day_limit: 500, day_left: 494,
    max_engines_per_call: 3, stop_codes: { thin_l1: 1 }, updated_at: 1, queue_path: 'refine-queue.json',
  },
  engine: { loaded: true, usable: true },
};

const MCP_OK = { ok: true, available: true, endpoint: '127.0.0.1:8204', clients: [], error: null };
const ENGINES_OK = { ok: true, available: true, engines: [{ name: 'deepseek', model: 'deepseek-chat', latencyMs: 420 }], error: null };
const TODAY_OK = { ok: true, write: 1, recall: 2, graft: 0, filtered: 0, error: null };
const REFINE_OK: OverviewRefinePanel = { ok: true, available: true, view: REFINED_VIEW, error: null };

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
    today: TODAY_OK,
    token: { ok: true, savedPct: 40, recallCount: 2, savedTokens: 600, series: [900, 600], error: null },
    refine: REFINE_OK,
    mcp: MCP_OK,
    engines: ENGINES_OK,
    dataRoot: { available: true, root: 'D:\\data', error: null },
    l0Write: { available: true, unlocked: true, detail: null },
    ...over,
  };
}

describe('效果证据四卡：设计稿版式契约（1:1 复刻）', () => {
  it('四卡网格 4 等份轨道且不设 align-items（默认 stretch 等高，批次52 四卡同尺寸）', () => {
    // 断言锁在 .af-g4 自己的声明块内（[^}]*）：.af-cols 也有 align-items:start，[\s\S]*? 会跨块误命中。
    // 批次52：去掉 start 对齐，四卡默认 stretch 等高同尺寸（用户拍板「最上面四卡片大小要一样」）。
    expect(css).toMatch(/\.af-g4\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).not.toMatch(/\.af-g4\s*\{[^}]*align-items/);
  });

  it('统计卡 = k/v/d 三段：.v 是 mono 24px 主数值（批次52 方向纠偏：内卡对齐外层设计稿规格）；不再有 .src 来源行', () => {
    expect(css).toMatch(/\.af-stat \.v\s*\{[^}]*font-size:\s*24px/);
    expect(css).toMatch(/\.af-stat \.v\s*\{[^}]*font-family:\s*var\(--mono\)/);
    expect(css).toMatch(/\.af-stat \.d\.mut\s*\{/);
    expect(css).not.toMatch(/\.af-stat \.src/);
  });
});

describe('效果证据四卡：结构与顺序（真实渲染）', () => {
  beforeEach(() => {
    h.loadOverview.mockReset();
    h.loadMcpPanel.mockReset();
    h.loadMcpPanel.mockResolvedValue(MCP_OK);
  });

  it('四卡同容器、同 class，k/v/d 齐全；图标与来源行不渲染', async () => {
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
      expect(card.querySelector('.d')).not.toBeNull();
      expect(card.querySelector('.src')).toBeNull();
      // 图标 emoji 只在导航条使用，四卡 k 段不再带图标位
      expect(card.querySelector('.k')!.textContent).not.toMatch(/[🪙⚡🔁💸]/u);
    }
  });

  it('批次52 右栏顺序：今日概览上移至首位（原 TOKEN 节省率位置）→ TOKEN → 补炼 → MCP → 引擎', async () => {
    h.loadOverview.mockResolvedValue(snap());
    render(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId('home-today')).toBeInTheDocument());
    const order = ['home-today', 'home-token', 'home-refine', 'home-mcp', 'home-engine'].map((id) => screen.getByTestId(id));
    expect(order[0].parentElement).toBe(order[1].parentElement);
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('页头 = af-head 模板：标题 + UTC+08:00 副行 + 立即备份/+ 写入记忆，无「重读」按钮', async () => {
    h.loadOverview.mockResolvedValue(snap());
    render(<OverviewPage />);
    const head = await screen.findByTestId('overview-head');
    expect(head.className).toContain('af-head');
    expect(head.querySelector('h1')!.textContent).toBe('总览工作台');
    expect(head.querySelector('.sub')!.textContent).toContain('UTC+08:00');
    expect(head.querySelector('.sub')!.textContent).toContain('数据根 D:\\data');
    expect(screen.getByRole('button', { name: '立即备份' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ 写入记忆' })).toBeInTheDocument();
    expect(screen.queryByTestId('home-reload')).toBeNull();
  });

  it('批次51：登录态页头「立即备份」前有「登出」按钮（点击触发一次真实登出，随后整壳重载）', async () => {
    h.loadOverview.mockResolvedValue(snap()); // snap 默认 session: true
    h.logoutCurrentSession.mockResolvedValue({ backendAccepted: true });
    render(<OverviewPage />);
    const logout = await screen.findByTestId('ov-logout');
    expect(logout).toBeEnabled();
    expect(logout.textContent).toBe('登出');
    // 位置在「立即备份」之前
    const backup = screen.getByRole('button', { name: '立即备份' });
    expect(logout.compareDocumentPosition(backup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 点击后先禁用防重复（jsdom 无 navigation，重载那句由源码级契约钉住，见文件末尾）
    fireEvent.click(logout);
    expect(logout).toBeDisabled();
    await waitFor(() => expect(h.logoutCurrentSession).toHaveBeenCalledTimes(1));
  });

  it('批次51：登出 → 整壳重载（iframe 内无壳层回调通道，靠同源重载同步会话态）', () => {
    expect(readFileSync(`${process.cwd()}/src/web/overview/OverviewPage.tsx`, 'utf8'))
      .toMatch(/logoutCurrentSession\(\)\.finally\(\(\) => window\.parent\.location\.reload\(\)\)/);
  });

  it('批次51：未登录页头显示「去登录」、不渲染「登出」（没有会话就没有可登出的东西）', async () => {
    h.loadOverview.mockResolvedValue(snap({ session: false }));
    render(<OverviewPage />);
    await screen.findByTestId('overview-head');
    expect(screen.queryByTestId('ov-logout')).toBeNull();
    expect(screen.getByRole('button', { name: '去登录' })).toBeInTheDocument();
  });

  it('异常速览 = af-alert 模板行（error→bad）+ hint 近 30 分钟', async () => {
    h.loadOverview.mockResolvedValue(snap({
      raw: {
        gains: [], activeMemories: [], todos: [],
        anomalies: [{ title: 'LLM 降级', detail: 'deepseek 超时', level: 'error', request_id: 'req_ab12' }],
      },
    }));
    render(<OverviewPage />);
    const wrap = await screen.findByTestId('home-anomalies');
    const ph = wrap.parentElement!.querySelector('.af-ph')!;
    expect(ph.querySelector('.hint')!.textContent).toBe('近 30 分钟 · 窗口聚合');
    const alert = wrap.querySelector('.af-alert.bad')!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('LLM 降级');
    expect(alert.textContent).toContain('req_ab12');
  });

  it('层级条不再按层配色：strata bar 走默认 accent（设计稿口径）', () => {
    expect(css).toMatch(/\.af-strata-cell \.bar i\s*\{[^}]*background:\s*var\(--accent\)/);
    expect(css).not.toMatch(/\.af-strata-cell \.bar i\s*\{[^}]*background:\s*var\(--c-l/);
  });
});
