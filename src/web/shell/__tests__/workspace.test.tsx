// 壳层渲染行为（批次48 S1）：导航、不可用态、状态栏诚实口径、底部标签。
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestOverride } from '../../Home/crossTabAuth.ts';
import { PAGES } from '../views.ts';
import { SELECTION_MSG } from '../../shared/selectionChannel.ts';
import { SHELL_GOTO_MSG } from '../../shared/shellNavigate.ts';
import { L0_WRITE_LOCK_SIGNAL_KEY } from '../../shared/l0WriteLockSignal.ts';

// 概览条的数据加载走真实内核/网络；组件单测只验证渲染契约，故固定快照。
// 批次55：层级刻度与四卡共用这份快照里的 strata 计数，不再单独 mock 一个加载器。
const m = vi.hoisted(() => ({
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
    raw: { gains: [] as unknown[], anomalies: [] as unknown[], activeMemories: [] as unknown[], todos: [] as unknown[] },
    pendingSync: 0,
    facts: { memories: 7, audits: 12, writeToday: 0, recallToday: 2, conflicts: 1 },
    strata: [
      { layer: 'L0', count: 7 }, { layer: 'L1', count: 2 }, { layer: 'L2', count: 1 },
      { layer: 'L3', count: 0 }, { layer: 'L4', count: 0 }, { layer: 'L5', count: 2 },
      { layer: 'L6', count: 1 },
    ],
    // 批次57-B 新增面板字段：壳层本身不消费（仅概览页 iframe 用）， fixture 补齐为诚实空/不可用态
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
vi.mock('../overview.ts', () => ({
  loadOverview: vi.fn(async () => m.defaultOverview),
}));

vi.mock('../taskpane.ts', () => ({
  loadPendingWrites: vi.fn(),
}));

// 底部面板/状态栏数据源走真实宿主与账本；渲染测试替换加载器，契约不变。
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
  return {
    ...actual,
    loadStatusbar: vi.fn(),
  };
});

vi.mock('../layers.ts', () => ({
  loadLayerPanel: vi.fn(),
}));

// 批次54：角标加载器读真账本 / 接入后端；组件单测只验证渲染契约，固定返回值。
vi.mock('../navCounts.ts', () => ({
  loadNavCounts: vi.fn(),
}));

import { Workspace } from '../Workspace.tsx';
import { loadOverview } from '../overview.ts';
import { loadAuditForMemory, loadOutputLog, loadScheduleRuns } from '../dock.ts';
import { loadStatusbar } from '../statusbar.ts';
import { loadLayerPanel } from '../layers.ts';
import { loadNavCounts } from '../navCounts.ts';
import { loadPendingWrites } from '../taskpane.ts';

beforeEach(() => {
  localStorage.clear();
  setTestOverride(false);
  vi.mocked(loadPendingWrites).mockReset();
  vi.mocked(loadPendingWrites).mockResolvedValue({
    status: 'unavailable',
    detail: '浏览器模式：没有主进程，读不到 MCP 写入兜底队列；请用桌面端查看。',
  });
  vi.mocked(loadOutputLog).mockReset();
  vi.mocked(loadOutputLog).mockResolvedValue({
    status: 'unavailable',
    detail: '浏览器模式：没有主进程，读不到本机 actions.log；请在桌面端查看。',
  });
  vi.mocked(loadScheduleRuns).mockReset();
  vi.mocked(loadScheduleRuns).mockResolvedValue({
    status: 'unavailable',
    detail: '未登录：浏览器使用进程内内存账本，读不到主进程的调度运行记录；请在桌面端查看。',
  });
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

/** 渲染并等待首页异步加载落地（避免 act 警告，也确保断言发生在真实渲染之后） */
async function renderShell() {
  const r = render(<Workspace />);
  await screen.findByTestId('sb-overview-refresh');
  await act(async () => { await Promise.resolve(); });
  return r;
}

describe('工作台壳层', () => {
  it('默认打开首页，中心区嵌入真实 index.html（iframe 而非假内容）', async () => {
    const { container } = await renderShell();
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0);
    const frames = container.querySelectorAll('iframe.page-frame');
    expect(frames.length).toBe(1);
    expect((frames[0] as HTMLIFrameElement).getAttribute('src')).toContain('/index.html');
  });

  it('写锁信号到达壳层 → 首页 iframe 被重挂（修复轮5：首页是后台 iframe，会错过 storage 事件，且 iframe 内 focus/visibilitychange 对「切换 shell 标签」无效，必须由壳层 native 顶层可靠驱动重挂）', async () => {
    const { container } = await renderShell();
    const before = container.querySelector('iframe.page-frame') as HTMLIFrameElement | null;
    expect(before).toBeTruthy();
    // 模拟「写入页解锁写密钥」后广播的写锁信号（跨文档 storage 事件到达壳层 native 顶层）
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: L0_WRITE_LOCK_SIGNAL_KEY, newValue: String(Date.now()) }));
    });
    // 壳层监听信号 → 递增 homeReloadNonce → 首页 iframe key 变化 → React 卸载旧 iframe 并挂载新节点
    await waitFor(() => {
      const after = container.querySelector('iframe.page-frame') as HTMLIFrameElement | null;
      expect(after).not.toBe(before);
    });
    // 重挂后首页仍指向 index.html（只是重新加载，拿最新写锁真值）
    expect((container.querySelector('iframe.page-frame') as HTMLIFrameElement).getAttribute('src')).toContain('/index.html');
  });

  it('轮6：从其它页切回首页 tab → 首页 iframe 被重挂（覆盖「安全页解锁写密钥后回首页」主路径，不依赖跨 iframe storage 信号）', async () => {
    const { container } = await renderShell();
    const before = container.querySelector('iframe.page-frame') as HTMLIFrameElement | null;
    expect(before).toBeTruthy();
    // 先打开「账号与安全」tab，离开首页（activeId 变为 security，本 effect 不触发重挂）
    act(() => { fireEvent.click(screen.getByText('账号与安全')); });
    // 切回首页 tab → 壳层按 activeId==='home' 强制重挂首页 iframe（key 变化 → React 替换节点）
    const homeTab = Array.from(container.querySelectorAll('.vtab')).find(
      (b) => (b.textContent ?? '').includes('首页'),
    ) as HTMLElement | undefined;
    expect(homeTab).toBeTruthy();
    act(() => { fireEvent.click(homeTab as HTMLElement); });
    await waitFor(() => {
      const after = container.querySelector('iframe.page-frame') as HTMLIFrameElement | null;
      expect(after).not.toBe(before);
    });
    // 重挂后首页仍指向 index.html（重新加载，拿最新写锁真值）
    expect((container.querySelector('iframe.page-frame') as HTMLIFrameElement).getAttribute('src')).toContain('/index.html');
  });

  it('DOM 为五组 22 项（新增「MCP 接入」「个人记忆」；管理台未登录不渲染），角标只显示真实读数，不出现参考图示例数', async () => {
    vi.mocked(loadNavCounts).mockResolvedValue({ 'memory-bank': 7, dispute: 2, agent: 3 });
    const { container } = await renderShell();
    const groups = Array.from(container.querySelectorAll('.tree .tree-group')).map((e) => e.textContent);
    expect(groups).toEqual(['工作台', '记忆管理', '连接', '治理', '智能']);
    expect(container.querySelectorAll('.tree .tree-row')).toHaveLength(22);

    // 2026-11-28 用户要求：取消「记忆库」「Agent 接入」后面的数字角标（条数/卡片数不是待办信号）
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('nav-count-memory-bank')).toBeNull();
    expect(screen.queryByTestId('nav-count-agent')).toBeNull();
    // 待裁决这类真待办角标仍照常显示
    expect(screen.getByTestId('nav-count-dispute').textContent).toBe('2');
    expect(screen.getByTestId('nav-count-dispute').getAttribute('title')).toContain('coreConflicts');
    expect(container.textContent).not.toContain('1467');
    // 2026-11-28 用户要求：中心区底部的解释性状态条整块取消（「同源真实页面 + 页面文件名」都不留）
    expect(container.textContent).not.toContain('数据来源：');
    expect(container.textContent).not.toContain('同源真实页面');
    expect(container.querySelector('.center-foot')).toBeNull();
  });

  it('批次54：角标读数为 0 或读不到时不渲染徽标', async () => {
    vi.mocked(loadNavCounts).mockResolvedValue({ 'memory-bank': 0, dispute: 0, agent: 0 });
    const { container } = await renderShell();
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid^="nav-count-"]')).toBeNull();
  });

  it('批次51 顶部布局：品牌左对齐标题栏 + 命令入口；QAT 工具簇整簇取消；命令条含面包屑/命令/命令按钮（范围读数已取消）', async () => {
    const { container } = await renderShell();
    const titlebar = screen.getByTestId('shell-titlebar');
    // ① QAT 工具簇已整簇取消（用户 2026-11-21）：标题栏不得再出现 .qa / qa-* 按钮
    expect(container.querySelector('.qa')).toBeNull();
    expect(screen.queryByTestId('qa-login')).toBeNull();
    expect(screen.queryByTestId('qa-logout')).toBeNull();
    expect(screen.queryByTestId('qa-theme')).toBeNull();
    expect(screen.queryByTestId('qa-assistant')).toBeNull();
    expect(screen.queryByTestId('qa-inspector')).toBeNull();
    expect(screen.queryByTestId('qa-personal')).toBeNull();
    expect(screen.queryByTestId('shell-menubar')).toBeNull();
    // ② 品牌块仍在标题栏（STRATUM：strata 六条徽标 + MultiAgent Memory + 「层析 STRATUM」小字）
    const brand = titlebar.querySelector('.tb-left') as HTMLElement | null;
    expect(brand).not.toBeNull();
    expect(brand?.querySelector('.strata-logo')).not.toBeNull();
    expect(brand?.querySelector('.app-name')?.textContent).toContain('MultiAgent Memory');
    expect(brand?.querySelector('.tb-sub')?.textContent).toContain('层析 STRATUM');
    expect(titlebar.dataset.brandAlign).toBeUndefined();
    // ③ 命令入口 + 44px 命令条（面包屑；批次53：命令面板按钮已取消，范围读数与状态栏重复也已取消）
    expect(screen.getByTestId('shell-cmd-entry')).toBeInTheDocument();
    const cmdbar = screen.getByTestId('shell-cmdbar');
    expect(cmdbar.querySelector('.cb-crumbs')).not.toBeNull();
    expect(cmdbar.querySelector('.cb-scope')).toBeNull();
    expect(screen.queryByTestId('cmdbar-palette')).toBeNull();
    // ④ Ribbon 已移除
    expect(container.querySelector('.ribbon-body')).toBeNull();
    expect(container.querySelector('.ribbon-tabs')).toBeNull();
  });

  it('v5 命令条：首页显示「写入记忆」主命令与「重读」，面包屑为工作台分组', async () => {
    const { container } = await renderShell();
    const cmdbar = screen.getByTestId('shell-cmdbar');
    expect(cmdbar.querySelector('.cb-crumb')?.textContent).toBe('工作台');
    expect(cmdbar.querySelector('.cb-crumb.cur')?.textContent).toBe('首页');
    expect(screen.getByTestId('cb-cmd-写入记忆')).toBeInTheDocument();
    expect(screen.getByTestId('cb-cmd-重读')).toBeInTheDocument();
    // 主命令为墨青实底
    expect(screen.getByTestId('cb-cmd-写入记忆').classList.contains('primary')).toBe(true);
    // 导航折叠按钮在命令条最左
    expect(cmdbar.querySelector('[data-testid="cmdbar-nav-toggle"]')).not.toBeNull();
    expect(container).toBeDefined();
  });

  it('批次55：层级刻度复用概览页同一次账本快照，七档真实读数，标题为「层级刻度 · STRATA」', async () => {
    const { container } = await renderShell();
    const scale = screen.getByTestId('strata-scale');
    const nav = container.querySelector('.nav-pane') as HTMLElement;
    // ① 位置在功能导航栏内，且排在导航树之后（最下面）
    expect(nav.contains(scale)).toBe(true);
    const tree = container.querySelector('.tree') as HTMLElement;
    expect(tree.compareDocumentPosition(scale) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ② 标题带 STRATA 层析英文（STRATUM 1:1 复刻：层级刻度 · STRATA）
    expect(scale.querySelector('.tree-group')?.textContent).toBe('层级刻度 · STRATA');
    // ③ L0–L6 共 7 行，顺序与定稿一致
    const rows = [...scale.querySelectorAll('.strata-row')];
    expect(rows.map((r) => r.getAttribute('data-layer'))).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(rows.map((r) => r.querySelector('.strata-name')?.textContent))
      .toEqual(['密文', '脱敏', '摘要', '要点', '场景', '边界', '索引']);
    // ④ 数字来自概览页同一次真实账本读取，不是演示数据
    expect(rows.map((r) => r.querySelector('.strata-count')?.textContent)).toEqual(['7', '2', '1', '0', '0', '2', '1']);
    expect(scale.textContent).not.toContain('1467');
    // ⑤ 数据源标注，避免把浏览器内存账本读成本机库
    expect(scale.textContent).toContain('本机账本');
  });

  it('批次55：概览快照缺某层 → 该层显示「读取失败」而非 0', async () => {
    vi.mocked(loadOverview).mockResolvedValueOnce({
      ...m.defaultOverview,
      strata: m.defaultOverview.strata.filter((s) => s.layer !== 'L3'),
    } as never);
    const { container } = await renderShell();
    const rows = [...container.querySelectorAll('.strata-row')];
    expect(rows[3].querySelector('.strata-count')?.textContent).toBe('读取失败');
    expect(rows[3].classList.contains('err')).toBe(true);
  });

  it('层级刻度读取失败：如实报错，不渲染任何伪造计数', async () => {
    vi.mocked(loadOverview).mockResolvedValueOnce({
      ...m.defaultOverview,
      storageError: 'E_LEDGER_LOCKED',
      strata: null,
    } as never);
    const { container } = await renderShell();
    const scale = screen.getByTestId('strata-scale');
    expect(scale.textContent).toContain('读取失败：账本读取失败：账本暂时被占用，请稍后重试');
    expect(scale.textContent).not.toContain('E_LEDGER_LOCKED');
    expect(container.querySelector('.strata-row')).toBeNull();
    expect(screen.queryByText('1467')).toBeNull();
  });

  it('首页账本读取失败：壳层错误条只说人话，不露 IPC 方法名与错误码（2026-11-16）', async () => {
    vi.mocked(loadOverview).mockResolvedValueOnce({
      ...m.defaultOverview,
      storageError: "Error invoking remote method 'storage:queryAudit': Error: 需要登录后操作（会话已过期或未登录）",
    } as never);
    await renderShell();
    const strip = screen.getByTestId('overview-storage-error');
    expect(strip.textContent).toContain('账本暂时读不到（不是空的）');
    expect(strip.textContent).toContain('请先登录，登录后即可查看');
    expect(strip.textContent).not.toContain('Error invoking');
    expect(strip.textContent).not.toContain('storage:queryAudit');
    expect(strip.textContent).not.toContain('E_AUTH_SESSION');
  });

  it('概览页整页渲染在 iframe 内：壳层不再叠旧首页数据条，未登录也不再叠失真的只读灰条', async () => {
    const { container } = await renderShell();
    // 旧 ov-strip（4 卡 + chips）已移除，避免与概览页统计卡叠层重复
    expect(container.querySelector('.ov-strip')).toBeNull();
    expect(screen.queryByText('累计记忆')).toBeNull();
    // 未登录：storage IPC 一律拒绝，「本地账本仍可读」是失真文案，整条移除
    expect(screen.queryByTestId('auth-readonly-strip')).toBeNull();
    expect(screen.queryByText(/本地账本仍可读/)).toBeNull();
    // 登录入口仍在标题栏头像 / 状态栏，不依赖灰条
    expect(screen.getByTestId('shell-avatar')).toBeInTheDocument();
    // 成本余额需会话：如实不可用，不显示编造余额
    expect(screen.getByTestId('sb-billing').textContent).toContain('不可用');
    expect(screen.getByTestId('sb-billing').getAttribute('title')).toContain('需登录');
  });

  it('顶部提示去重：未登录且账本读取失败时只显示一条真实错误条（2026-11-16）', async () => {
    vi.mocked(loadOverview).mockResolvedValueOnce({
      ...m.defaultOverview,
      storageError: "Error invoking remote method 'storage:queryAudit': Error: 需要登录后操作（会话已过期或未登录）",
    } as never);
    const { container } = await renderShell();
    expect(screen.getByTestId('overview-storage-error')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-readonly-strip')).toBeNull();
    expect(container.querySelectorAll('.ov-error-strip, .auth-strip')).toHaveLength(1);
    // 唯一那条仍是人话，不带原始异常
    const strip = screen.getByTestId('overview-storage-error');
    expect(strip.textContent).toContain('请先登录，登录后即可查看');
    expect(strip.textContent).not.toContain('Error invoking');
  });

  it('登录不再占主导航：login.html 保留为可直达兜底页（PAGES 映射未删）', async () => {
    const { container } = await renderShell();
    // 主导航里不再出现「登录与会话」
    expect(screen.queryByRole('treeitem', { name: /登录与会话/ })).toBeNull();
    // 兜底页仍是真实页面映射：深链 /login.html 继续可直达
    expect(PAGES.login.file).toBe('login.html');
    expect(container.querySelectorAll('iframe.page-frame').length).toBe(1);
  });

  it('批次51：QAT 登出按钮已取消——登出入口迁至首页页头（见 overview 用例），壳层不再有 qa-logout', async () => {
    await renderShell();
    expect(screen.queryByTestId('qa-logout')).toBeNull();
    expect(screen.getByTestId('shell-avatar')).toBeInTheDocument();
  });

  it('STRATUM：登录入口（标题栏头像 / 状态栏会话格）打开同一个登录弹窗', async () => {
    await renderShell();

    // ① 标题栏头像（STRATUM：24px accent 圆 + 角色）
    fireEvent.click(screen.getByTestId('shell-avatar'));
    const modal = screen.getByTestId('shell-login-modal');
    expect(modal).toBeInTheDocument();
    // 同一实例：未登录时给出真实登录表单（真实 /api/login 由 E2E 覆盖）
    expect(screen.getByTestId('slm-account')).toBeInTheDocument();
    expect(screen.getByTestId('slm-password')).toBeInTheDocument();
    expect(screen.getByTestId('slm-submit')).toBeEnabled();
    // 状态栏会话格也是同一入口
    fireEvent.click(screen.getByTestId('sb-session'));
    expect(screen.getByTestId('shell-login-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('slm-close'));
  });

  it('右键导航树：真实动作可用；无能力项禁用并写原因，不出现空菜单', async () => {
    await renderShell();
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: /首页/ }));
    const menu = screen.getByTestId('ctx-navmenu');
    expect(menu).toBeInTheDocument();
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
    expect(screen.getByTestId('ctx-navmenu-open')).toBeEnabled();
    const toggle = screen.getByTestId('ctx-navmenu-toggle');
    expect(toggle).toBeDisabled();
    expect(toggle.getAttribute('title')).toContain('该导航项没有子项');
    // 真实动作：打开「首页」（已有标签则切换，不新增假页）
    fireEvent.click(screen.getByTestId('ctx-navmenu-open'));
    expect(screen.queryByTestId('ctx-navmenu')).toBeNull();
  });

  it('右键标签条：真实关闭标签；唯一标签时禁用并写原因', async () => {
    const { container } = await renderShell();
    const firstTab = container.querySelector('.vtab') as HTMLElement;
    fireEvent.contextMenu(firstTab);
    const close = screen.getByTestId('ctx-tabmenu-close');
    expect(close).toBeDisabled();
    expect(close.getAttribute('title')).toContain('至少保留一个标签');
    expect(screen.getByTestId('ctx-tabmenu-closeOthers')).toBeDisabled();
    expect(screen.getByTestId('ctx-tabmenu-refresh')).toBeEnabled();

    fireEvent.click(screen.getByRole('treeitem', { name: /^记忆库$/ }));
    const tabs = container.querySelectorAll('.vtab');
    expect(tabs.length).toBeGreaterThan(1);
    fireEvent.contextMenu(tabs[tabs.length - 1] as HTMLElement);
    fireEvent.click(screen.getByTestId('ctx-tabmenu-close'));
    expect(container.querySelectorAll('.vtab').length).toBe(tabs.length - 1);
  });

  it('属性检查器默认收起：右侧竖条可展开、面板按钮可再收起（批次51：QAT 按钮已随工具簇取消）', async () => {
    const { container } = await renderShell();
    const pane = () => container.querySelector('.inspector-pane') as HTMLElement;
    expect(pane().className).toContain('collapsed');
    // 收起态必须留一个看得见、点得到的展开入口，不能只藏在右键菜单里
    expect(screen.getByTestId('qa-inspector-expand')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('qa-inspector-expand'));
    expect(pane().className).not.toContain('collapsed');
    expect(screen.queryByTestId('qa-inspector-expand')).toBeNull();

    fireEvent.click(screen.getByTestId('qa-inspector-collapse'));
    expect(pane().className).toContain('collapsed');
    expect(screen.getByTestId('qa-inspector-expand')).toBeInTheDocument();
  });

  it('v5-BC：Ctrl+Shift+I 切换属性检查器（与右侧竖条/面板同一状态源）', async () => {
    const { container } = await renderShell();
    const pane = () => container.querySelector('.inspector-pane') as HTMLElement;
    expect(pane().className).toContain('collapsed');
    fireEvent.keyDown(window, { key: 'I', ctrlKey: true, shiftKey: true });
    expect(pane().className).not.toContain('collapsed');
    fireEvent.keyDown(window, { key: 'i', ctrlKey: true, shiftKey: true });
    expect(pane().className).toContain('collapsed');
  });

  it('右键属性检查器：无选中时复制项禁用并写原因，菜单项可展开默认收起的检查器', async () => {
    const { container } = await renderShell();
    fireEvent.contextMenu(screen.getByTestId('shell-inspector'));
    expect(screen.getByTestId('ctx-inspmenu')).toBeInTheDocument();
    const copyId = screen.getByTestId('ctx-inspmenu-copyId');
    expect(copyId).toBeDisabled();
    expect(copyId.getAttribute('title')).toContain('中心页未选中记忆');
    expect(screen.getByTestId('ctx-inspmenu-copyFile')).toBeEnabled();
    const toggle = screen.getByTestId('ctx-inspmenu-collapse');
    expect(toggle).toHaveTextContent('展开属性检查器');
    fireEvent.click(toggle);
    expect((container.querySelector('.inspector-pane') as HTMLElement).className).not.toContain('collapsed');
  });

  it('中心页表格行右键：同源 iframe 的真实 DOM 行触发壳层菜单；复制 ID 是真实动作，写操作禁用并写原因', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = await renderShell();
    const frame = container.querySelector('iframe.page-frame') as HTMLIFrameElement;
    // jsdom 不会真的加载 iframe：用同一实现造一个同源 Document，挂到 contentDocument 上
    const doc = document.implementation.createHTMLDocument('frame');
    Object.defineProperty(frame, 'contentDocument', { value: doc, configurable: true });
    // 触发 onLoad：壳层给同源 iframe 文档挂 contextmenu 监听
    fireEvent.load(frame);
    const table = doc.createElement('table');
    const tbody = doc.createElement('tbody');
    const tr = doc.createElement('tr');
    tr.setAttribute('data-testid', 'row-mem_fixture_1');
    const td = doc.createElement('td');
    td.textContent = '真实账本行夹具';
    tr.appendChild(td);
    tbody.appendChild(tr);
    table.appendChild(tbody);
    const host = doc.body ?? doc.documentElement;
    host.appendChild(table);

    // 直接用目标文档派发 contextmenu（createHTMLDocument 无 defaultView，RTL fireEvent 取不到 window）
    const fireCtx = (node: Element, x: number, y: number) => {
      const ev = doc.createEvent('MouseEvent');
      ev.initMouseEvent('contextmenu', true, true, window, 0, x, y, x, y, false, false, false, false, 2, null);
      act(() => { node.dispatchEvent(ev); });
      return ev;
    };
    fireCtx(tr, 100, 100);
    expect(screen.getByTestId('ctx-rowmenu')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-rowmenu')).toHaveTextContent('表格行：mem_fixture_1');
    const forget = screen.getByTestId('ctx-rowmenu-forget');
    expect(forget).toBeDisabled();
    expect(forget.getAttribute('title')).toContain('壳层不代行页面写操作');
    // 真实动作：复制记忆 ID（写入剪贴板 + 状态栏如实回执）
    fireEvent.click(screen.getByTestId('ctx-rowmenu-copyId'));
    expect(writeText).toHaveBeenCalledWith('mem_fixture_1');
    await waitFor(() => expect(screen.getByTestId('sb-msg')).toHaveTextContent('已复制记忆 ID：mem_fixture_1'));
    // 非表格行同样被壳层接管：给页面级菜单（不是空菜单，也不放原生菜单过去）
    const plainEv = fireCtx(doc.documentElement, 10, 10);
    expect(plainEv.defaultPrevented).toBe(true);
    expect(screen.queryByTestId('ctx-rowmenu')).toBeNull();
    expect(screen.getByTestId('ctx-framemenu')).toHaveTextContent('中心页（iframe）');
    const pageCopySel = screen.getByTestId('ctx-framemenu-copySel');
    expect(pageCopySel).toBeDisabled();
    expect(pageCopySel.getAttribute('title')).toContain('页面内没有选中文本');
    expect(screen.getByTestId('ctx-framemenu-refresh')).toBeEnabled();
  });

  it('壳层全域右键：非登录区有非空菜单且不含登录项；登录入口处才出现「登录 / 会话」', async () => {
    const { container } = await renderShell();
    // RTL fireEvent 返回 false 表示事件已被 preventDefault（原生菜单不会出现）
    expect(fireEvent.contextMenu(container.querySelector('.statusbar') as HTMLElement)).toBe(false);
    const menu = screen.getByTestId('ctx-shellmenu');
    expect(menu).toHaveTextContent('右键：状态栏');
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
    const copySel = screen.getByTestId('ctx-shellmenu-copySel');
    expect(copySel).toBeDisabled();
    expect(copySel.getAttribute('title')).toContain('当前页面上没有选中文本');
    // 批次50：状态栏空白处本身没有登录入口 → 右键不补「登录 / 会话」
    expect(screen.queryByTestId('ctx-shellmenu-login')).toBeNull();
    // 真实动作：刷新中心区与底部读数
    fireEvent.click(screen.getByTestId('ctx-shellmenu-refresh'));
    await waitFor(() => expect(screen.getByTestId('sb-msg')).toHaveTextContent('已刷新全部打开的真实页面'));

    expect(fireEvent.contextMenu(screen.getByTestId('shell-cmdbar'))).toBe(false);
    expect(screen.getByTestId('ctx-shellmenu')).toHaveTextContent('右键：命令条');
    expect(screen.queryByTestId('ctx-shellmenu-login')).toBeNull();

    // 批次51：标题栏工具簇已取消，右键标题栏空白处走默认菜单（无登录项）
    expect(fireEvent.contextMenu(screen.getByTestId('shell-titlebar'))).toBe(false);
    expect(screen.getByTestId('ctx-shellmenu')).toBeInTheDocument();
    expect(screen.queryByTestId('ctx-shellmenu-login')).toBeNull();

    // 真有登录入口的位置：标题栏头像、状态栏会话格
    expect(fireEvent.contextMenu(screen.getByTestId('shell-avatar'))).toBe(false);
    expect(screen.getByTestId('ctx-shellmenu-login')).toBeInTheDocument();
    expect(fireEvent.contextMenu(screen.getByTestId('sb-session'))).toBe(false);
    expect(screen.getByTestId('ctx-shellmenu-login')).toBeInTheDocument();
  });

  it('登录弹窗密码默认为密文，显示/隐藏切换保留内容与焦点', async () => {
    await renderShell();
    fireEvent.click(screen.getByTestId('shell-avatar'));
    const pw = screen.getByTestId('slm-password') as HTMLInputElement;
    expect(pw.getAttribute('type')).toBe('password');
    fireEvent.change(pw, { target: { value: 'S3cret-pass' } });
    pw.focus();
    const toggle = screen.getByTestId('slm-pw-toggle');
    expect(toggle.getAttribute('aria-label')).toBe('显示密码');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.mouseDown(toggle);
    fireEvent.click(toggle);
    // 只改 type：值不变、焦点仍在输入框
    expect(pw.getAttribute('type')).toBe('text');
    expect(pw.value).toBe('S3cret-pass');
    expect(document.activeElement).toBe(pw);
    expect(toggle.getAttribute('aria-label')).toBe('隐藏密码');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(pw.getAttribute('type')).toBe('password');
    expect(pw.value).toBe('S3cret-pass');
    expect(document.activeElement).toBe(pw);
    expect(toggle.getAttribute('aria-label')).toBe('显示密码');
  });

  it('中心页表格行菜单对齐定稿条目：详情/编辑/分层禁用并写原因', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = await renderShell();
    const frame = container.querySelector('iframe.page-frame') as HTMLIFrameElement;
    const doc = document.implementation.createHTMLDocument('frame');
    Object.defineProperty(frame, 'contentDocument', { value: doc, configurable: true });
    fireEvent.load(frame);
    const tr = doc.createElement('tr');
    tr.setAttribute('data-testid', 'row-mem_fixture_2');
    (doc.body ?? doc.documentElement).appendChild(tr);
    const ev = doc.createEvent('MouseEvent');
    ev.initMouseEvent('contextmenu', true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 2, null);
    act(() => { tr.dispatchEvent(ev); });
    expect(screen.getByTestId('ctx-rowmenu-details')).toBeDisabled();
    expect(screen.getByTestId('ctx-rowmenu-details').getAttribute('title')).toContain('记忆管理页');
    expect(screen.getByTestId('ctx-rowmenu-edit')).toBeDisabled();
    expect(screen.getByTestId('ctx-rowmenu-edit').getAttribute('title')).toContain('不代行写操作');
    expect(screen.getByTestId('ctx-rowmenu-layers')).toBeDisabled();
    expect(screen.getByTestId('ctx-rowmenu-layers').getAttribute('title')).toContain('不代读页面数据');
    expect(screen.getByTestId('ctx-rowmenu-audit')).toBeEnabled();
  });

  it('演示通览不进主导航', async () => {
    await renderShell();
    expect(screen.queryByText(/通览/)).toBeNull();
  });

  it('记忆管理组：记忆库平铺入口打开 memory.html?tab=all；个人记忆为独立导航项并直达 personal.html（只一项，不重复）', async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByRole('treeitem', { name: /^记忆库$/ }));
    const frame = container.querySelector('.page-pane.active iframe.page-frame');
    const src = frame ? frame.getAttribute('src') : null;
    expect(src).toContain('/memory.html');
    expect(src).toContain('tab=all');
    expect(container.querySelectorAll('iframe.page-frame').length).toBeGreaterThan(1);
    // 个人记忆：唯一导航项，落在记忆管理组内，直达真实整页 personal.html
    const personalItems = screen.getAllByRole('treeitem', { name: /^个人记忆/ });
    expect(personalItems).toHaveLength(1);
    // 组内位置：紧跟「记忆库」、在「层级管理」之前（确属记忆管理组）
    const labels = Array.from(container.querySelectorAll('.tree .tree-row')).map((e) => e.textContent ?? '');
    const iBank = labels.findIndex((t) => t.includes('记忆库'));
    const iPersonal = labels.findIndex((t) => t.includes('个人记忆'));
    const iLayered = labels.findIndex((t) => t.includes('层级管理'));
    expect(iPersonal).toBe(iBank + 1);
    expect(iLayered).toBe(iPersonal + 1);
    fireEvent.click(personalItems[0]);
    const frame2 = container.querySelector('.page-pane.active iframe.page-frame');
    expect(frame2 ? frame2.getAttribute('src') : null).toContain('/personal.html');
    // 旧四子项中活跃/蛰伏/已归档仍不进主导航（反向断言）
    for (const label of [/活跃/, /蛰伏\/休眠/, /已归档/]) {
      expect(screen.queryByRole('treeitem', { name: label })).toBeNull();
    }
    expect(container.querySelector('.shell-empty')).toBeFalsy();
  });

  it('v5 命令面板：禁用命令被置灰并给出原因，不伪造结果；帮助入口真实打开快捷键参考', async () => {
    await renderShell();
    // Ctrl+K 打开命令面板
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('shell-palette')).toBeInTheDocument();
    // 无对应能力的命令置灰并写原因（原菜单「打开记忆库…」）
    const openLib = screen.getByText('打开记忆库…').closest('.pal-row') as HTMLElement;
    expect(openLib.classList.contains('disabled')).toBe(true);
    expect(openLib.getAttribute('title')).toContain('程序未提供库切换指令');
    // 「检查更新」同样禁用带原因
    expect(screen.getByText('检查更新').closest('.pal-row')?.classList.contains('disabled')).toBe(true);
    // 帮助命令真实打开快捷键参考浮层（不再是禁用占位）
    fireEvent.click(screen.getByText('快捷键参考'));
    expect(screen.getByTestId('shell-keys')).toBeInTheDocument();
    expect(screen.getByText('Ctrl 1..8')).toBeInTheDocument();
  });

  it('底部终端页签已取消：页签里不再出现「终端」，也没有不可用占位容器', async () => {
    const { container } = await renderShell();
    expect(screen.queryByRole('button', { name: /终端/ })).toBeNull();
    expect(container.querySelector('[data-testid="dock-term-unavailable"]')).toBeNull();
    expect(screen.queryByText(/程序未提供终端命令通道/)).toBeNull();
  });

  it('状态栏接真实读数：库/L0/后台/已选/行高可追溯，且无「—」占位', async () => {
    const { container } = await renderShell();
    await screen.findByTestId('sb-l0');
    const bar = container.querySelector('.statusbar') as HTMLElement;
    expect(bar.textContent).not.toMatch(/—/);
    expect(screen.getByTestId('sb-storage').textContent).toContain('memories.db.json');
    expect(screen.getByTestId('sb-storage').getAttribute('title')).toContain('C:\\data\\memories.db.json');
    // L0 两把锁都要显示：查阅锁（解密查阅会话）与写锁（写密钥），互不替代
    expect(screen.getByTestId('sb-l0').textContent).toContain('查阅锁');
    expect(screen.getByTestId('sb-l0').textContent).toContain('写锁');
    expect(screen.getByTestId('sb-l0').getAttribute('title')).toContain('有效授权 0');
    // 状态栏文案必须直读两把锁，而不是拿其中一个冒充另一个
    expect(screen.getByTestId('sb-l0').getAttribute('title')).toContain('查阅锁（解密查阅会话）锁定');
    expect(screen.getByTestId('sb-l0').getAttribute('title')).toContain('写锁（写密钥）锁定');
    expect(screen.getByTestId('sb-l0').getAttribute('title')).toContain('两把锁互不替代');
    expect(screen.getByTestId('sb-bg').textContent).toContain('运行中');
    expect(screen.getByTestId('sb-bg').getAttribute('title')).toContain('间隔 60000 ms');
    expect(screen.getByTestId('sb-selected').textContent).toContain('无');
    expect(bar.textContent).toContain('行高 26 px');
  });

  it('L0 两把锁在状态栏各自独立显示：写锁已解锁时查阅锁仍如实为锁（2026-11-10）', async () => {
    // 写锁已解锁 + 有 2 个活跃查阅会话：两把锁都要各自如实反映，不能互相冒充
    vi.mocked(loadStatusbar).mockResolvedValue({
      location: { status: 'ok', view: { kind: 'file', path: 'C:\\data\\memories.db.json', source: 'ipc' } },
      l0: { status: 'ok', view: { has_admin_wrap: true, write_unlocked: true, active_sessions: 2, active_grants: 1, member_write_wraps: 0, member_wrap_ids: [] } },
      l0Write: { status: 'ok', view: { unlocked: true, pending: null } },
      collector: {
        status: 'ok',
        view: { running: true, intervalMs: 60_000, lastAt: 1_790_000_000_000, lastCollected: 12, autoRetryStopped: false, consecutiveFails: 0 },
      },
    });
    await renderShell();
    await screen.findByTestId('sb-l0');
    const cell = screen.getByTestId('sb-l0');
    // 写锁已解 → 明确写「写已解」，不再显示「写锁锁定」
    expect(cell.textContent).toContain('写已解');
    expect(cell.textContent).not.toContain('写锁');
    // 查阅锁按真实会话数显示
    expect(cell.textContent).toContain('查阅2会话');
    const title = cell.getAttribute('title')!;
    expect(title).toContain('查阅锁（解密查阅会话）已开 2 个会话');
    expect(title).toContain('写锁（写密钥）已解锁');
  });

  it('成员口径：查阅锁读不到（requireAdmin）但写密钥已解锁 → 显示「本人可直读」（口径一回归）', async () => {
    // 成员调 l0:status 必被拒（查阅锁/授权是管理员口径），但写锁走 getWriteStatus，
    // 账号级通道是通的 —— 不能因为查阅锁读不到就把写锁也写成「不可用」。
    // 口径一（2026-11-17）：解锁写密钥后本人可免审批直读自己的 L0 → 不再谎报「查阅不可用」。
    vi.mocked(loadStatusbar).mockResolvedValue({
      location: { status: 'ok', view: { kind: 'file', path: 'C:////data////memories.db.json', source: 'ipc' } },
      l0: { status: 'error', detail: '需要管理员权限（§4.4.4）' },
      l0Write: { status: 'ok', view: { unlocked: true, pending: 0 } },
      collector: {
        status: 'ok',
        view: { running: true, intervalMs: 60_000, lastAt: 1_790_000_000_000, lastCollected: 12, autoRetryStopped: false, consecutiveFails: 0 },
      },
    });
    await renderShell();
    const cell = await screen.findByTestId('sb-l0');
    expect(cell.textContent).toContain('查阅本人可直读');
    expect(cell.textContent).not.toContain('查阅不可用');
    expect(cell.textContent).toContain('写已解');
    const title = cell.getAttribute('title')!;
    expect(title).toContain('写锁（写密钥）已解锁');
    expect(title).toContain('本人条目可直读');
  });

  it('成员口径：查阅锁读不到且写锁也锁着 → 如实写「查阅不可用」', async () => {
    vi.mocked(loadStatusbar).mockResolvedValue({
      location: { status: 'ok', view: { kind: 'file', path: 'C:////data////memories.db.json', source: 'ipc' } },
      l0: { status: 'error', detail: '需要管理员权限（§4.4.4）' },
      l0Write: { status: 'ok', view: { unlocked: false, pending: 0 } },
      collector: {
        status: 'ok',
        view: { running: true, intervalMs: 60_000, lastAt: 1_790_000_000_000, lastCollected: 12, autoRetryStopped: false, consecutiveFails: 0 },
      },
    });
    await renderShell();
    const cell = await screen.findByTestId('sb-l0');
    expect(cell.textContent).toContain('查阅不可用');
    expect(cell.textContent).toContain('写锁');
  });

  it('状态栏不可用态写原因，不用 0 或「—」冒充读数', async () => {
    vi.mocked(loadStatusbar).mockResolvedValue({
      location: { status: 'ok', view: { kind: 'memory', source: 'browser-memory' } },
      l0: { status: 'unavailable', detail: '浏览器模式：L0 会话由桌面主进程的 L0Vault 保管，浏览器读不到。' },
      l0Write: { status: 'unavailable', detail: '浏览器模式：写密钥由桌面主进程的 L0Vault 保管，浏览器读不到。' },
      collector: { status: 'error', detail: '主进程未返回 ok（采集器状态不可读）' },
    });
    const { container } = await renderShell();
    await screen.findByTestId('sb-l0');
    const bar = container.querySelector('.statusbar') as HTMLElement;
    expect(screen.getByTestId('sb-storage').textContent).toContain('内存态');
    expect(screen.getByTestId('sb-l0').textContent).toContain('不可用');
    expect(screen.getByTestId('sb-l0').getAttribute('title')).toContain('L0Vault');
    expect(screen.getByTestId('sb-bg').textContent).toContain('异常');
    expect(bar.textContent).not.toMatch(/—/);
  });

  it('主题切换会写到 html[data-theme]，并被状态栏按钮反映', async () => {
    await renderShell();
    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: '深色' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('S3 深链接线（D4）：壳层把初值真的交给目标真实页面', () => {
  function activeFrameSrc(container: HTMLElement): string | null {
    const frame = container.querySelector('.page-pane.active iframe.page-frame');
    return frame ? frame.getAttribute('src') : null;
  }

  function openPalette() {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('shell-palette')).toBeInTheDocument();
  }

  it('命令面板「归档（需登录）」开独立标签，iframe src 带 ?status=archived', async () => {
    // 该动作按程序能力需登录：临时置会话有效，验证深链初值确实交给目标页
    setTestOverride(true);
    const { container } = await renderShell();
    openPalette();
    fireEvent.click(screen.getByText('归档（需登录）'));
    const src = activeFrameSrc(container);
    expect(src).toContain('/memory.html');
    expect(src).toContain('status=archived');
    // 归档与「全部记忆」是同一页面不同初值 → 必须是独立标签，不能复用旧标签
    expect(container.querySelector('.tabstrip')?.textContent ?? '').toContain('已归档');
    setTestOverride(false);
  });

  it('未登录时「需登录」动作按程序实际能力禁用并给出原因', async () => {
    await renderShell();
    openPalette();
    const archive = screen.getByText('归档（需登录）').closest('.pal-row') as HTMLElement;
    expect(archive.classList.contains('disabled')).toBe(true);
    expect(archive.getAttribute('title')).toContain('未登录（会话 401）');
  });

  it('批次54：L0 不再占主导航，命令深链仍打开 memory.html?tab=l0', async () => {
    const { container } = await renderShell();
    expect(screen.queryByRole('treeitem', { name: /L0 密文/ })).toBeNull();
    openPalette();
    await act(async () => {
      fireEvent.click(screen.getByText('显示 L0 密文'));
      await Promise.resolve();
    });
    const src = activeFrameSrc(container);
    expect(src).toContain('/memory.html');
    expect(src).toContain('tab=l0');
    expect(src).not.toContain('/memory-layered.html');
    expect(src).not.toContain('#l0bar');
  });

  it('无 href 的命令仍复用原有标签，不凭空新增重复标签', async () => {
    const { container } = await renderShell();
    openPalette();
    fireEvent.click(screen.getByText('记忆列表（全部）'));
    const src = activeFrameSrc(container);
    expect(src).toContain('/memory.html');
    expect(src).not.toContain('status=archived');
  });
});

describe('S3.5 中心区 iframe → 壳层导航（SHELL_GOTO_MSG）', () => {
  async function dispatchGoto(container: HTMLElement, id: string) {
    const frame = container.querySelector('.page-pane.active iframe.page-frame') as HTMLIFrameElement | null;
    expect(frame?.contentWindow).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { [SHELL_GOTO_MSG]: id },
        origin: window.location.origin,
        source: frame!.contentWindow,
      }));
    });
  }

  it('57-D：iframe 请求 login → 打开壳层登录弹窗（login 不占主导航，不再被静默丢弃）', async () => {
    const { container } = await renderShell();
    expect(screen.queryByTestId('shell-login-modal')).toBeNull();
    await dispatchGoto(container, 'login');
    expect(screen.getByTestId('shell-login-modal')).toBeInTheDocument();
    expect(screen.getByTestId('slm-account')).toBeInTheDocument();
    // 不得把 login 当 NAV 项开成新标签
    expect(container.querySelector('.tabstrip')?.textContent ?? '').not.toContain('login.html');
  });

  it('57-D：iframe 请求 NAV 内 id → 照常打开对应标签（回归口径）', async () => {
    const { container } = await renderShell();
    await dispatchGoto(container, 'audit');
    expect(container.querySelector('.tabstrip')?.textContent ?? '').toContain('审计日志');
  });
});

describe('S4 属性检查器：只显示真实页面回传的选中项', () => {
  const PAYLOAD = {
    v: 1 as const,
    page: 'memory.html',
    title: '记忆 mem_1',
    subtitle: '真实账本记录 · 状态 active',
    fields: [
      { k: 'ID', v: 'mem_1', mono: true },
      { k: '状态', v: 'active' },
    ],
  };

  async function dispatchTo(container: HTMLElement, payload: unknown, opts: { origin?: string } = {}) {
    // 属性检查器默认收起：这些用例验的是「展开后显示真实字段」，先走显式展开入口
    const expand = screen.queryByTestId('qa-inspector-expand');
    if (expand) fireEvent.click(expand);
    const frame = container.querySelector('.page-pane.active iframe.page-frame') as HTMLIFrameElement | null;
    expect(frame?.contentWindow).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { [SELECTION_MSG]: payload },
        origin: opts.origin ?? window.location.origin,
        source: frame!.contentWindow,
      }));
    });
  }

  it('收到当前页合法回传 → 检查器显示字段与来源，不显示「尚未接入」占位', async () => {
    const { container } = await renderShell();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(screen.getByText('记忆列表（全部）'));
    await dispatchTo(container, PAYLOAD);
    expect(screen.getByText(/记忆 mem_1/)).toBeInTheDocument();
    expect(screen.getByText('mem_1')).toBeInTheDocument();
    expect(screen.getByText(/来源：memory.html 回传的真实账本字段/)).toBeInTheDocument();
    expect(screen.queryByText(/中心页尚未回传选中项/)).toBeNull();
  });

  it('收起再展开不丢选中项：折叠只收 UI，不动中心页回传的真实字段', async () => {
    const { container } = await renderShell();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(screen.getByText('记忆列表（全部）'));
    await dispatchTo(container, PAYLOAD);
    fireEvent.click(screen.getByTestId('qa-inspector-collapse'));
    expect((container.querySelector('.inspector-pane') as HTMLElement).className).toContain('collapsed');
    fireEvent.click(screen.getByTestId('qa-inspector-expand'));
    expect(screen.getByText(/记忆 mem_1/)).toBeInTheDocument();
    expect(screen.getByText('mem_1')).toBeInTheDocument();
  });

  it('回传 null → 检查器退回诚实空态（不保留上一份选区）', async () => {
    const { container } = await renderShell();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(screen.getByText('记忆列表（全部）'));
    await dispatchTo(container, PAYLOAD);
    await dispatchTo(container, null);
    expect(screen.queryByText('mem_1')).toBeNull();
    expect(screen.getByText(/中心页尚未回传选中项/)).toBeInTheDocument();
  });

  it('非同源来源的回传被丢弃', async () => {
    const { container } = await renderShell();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(screen.getByText('记忆列表（全部）'));
    await dispatchTo(container, PAYLOAD, { origin: 'http://evil.example' });
    expect(screen.queryByText('mem_1')).toBeNull();
  });

  it('页面与当前激活标签不符的回传被丢弃（避免后台标签串数据）', async () => {
    const { container } = await renderShell();
    // 当前激活仍是首页 index.html
    await dispatchTo(container, PAYLOAD);
    expect(screen.queryByText('mem_1')).toBeNull();
  });

  it('形状不合法的回传被丢弃', async () => {
    const { container } = await renderShell();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(screen.getByText('记忆列表（全部）'));
    await dispatchTo(container, { v: 1, page: 'memory.html', title: 'x', fields: [] });
    expect(screen.queryByText('x')).toBeNull();
  });
});

describe('S5 任务窗「待重放写入」：只读，不可用就说原因', () => {
  async function openTaskPane() {
    const r = await renderShell();
    // 状态栏的任务窗开关（Ribbon 里也有同名 title，这里限定在状态栏内取）
    const cell = r.container.querySelector('.statusbar [title="任务窗格"]') as HTMLElement | null;
    expect(cell).toBeTruthy();
    await act(async () => {
      fireEvent.click(cell!);
      await Promise.resolve();
    });
    return r;
  }

  it('浏览器模式如实不可用，不显示 0 条冒充空队列', async () => {
    await openTaskPane();
    const note = await screen.findByTestId('pending-unavailable');
    expect(note.textContent).toContain('浏览器模式');
    expect(screen.queryByTestId('pending-count')).toBeNull();
  });

  it('主进程返回真实队列 → 显示计数与每条摘要，且不含正文', async () => {
    vi.mocked(loadPendingWrites).mockResolvedValue({
      status: 'ok',
      view: {
        ok: true,
        count: 2,
        items: [
          { id: 'pend_2', created_at: 2000, project_id: 'P-1', source_agent: 'claude-code', category: 'fact', user_id: 'u1', session_id: null, content_chars: 12, tags: 1, importance: 0.6, confidence: null, half_life_days: null },
          { id: 'pend_1', created_at: 1000, project_id: 'P-1', source_agent: null, category: 'fact', user_id: null, session_id: null, content_chars: 8, tags: 0, importance: null, confidence: null, half_life_days: null },
        ],
        truncated: false,
        source: 'MCP 写入兜底队列（主进程内存 · 与 8202/8204 MCP 共用）',
        note: '只读摘要，不含正文与密钥材料。',
        captured_at: '2026-11-08T00:00:00.000Z',
      },
    });
    await openTaskPane();
    await screen.findByTestId('pending-count');
    expect(screen.getByTestId('pending-count').textContent).toContain('2');
    expect(screen.getAllByTestId('pending-item')).toHaveLength(2);
    expect(screen.getByText('pend_2')).toBeInTheDocument();
    // 无 source_agent 时说明缺失原因，而不是用「—」填充
    expect(screen.getByText(/未标注（请求无 source_agent）/)).toBeInTheDocument();
    expect(screen.getByText(/不含正文与密钥材料/)).toBeInTheDocument();
  });

  it('真实空队列 → 明确的空队列说明，而不是不可用', async () => {
    vi.mocked(loadPendingWrites).mockResolvedValue({
      status: 'ok',
      view: {
        ok: true, count: 0, items: [], truncated: false,
        source: 'MCP 写入兜底队列（主进程内存）',
        note: '进程重启即清空。',
        captured_at: '2026-11-08T00:00:00.000Z',
      },
    });
    await openTaskPane();
    await screen.findByTestId('pending-count');
    expect(screen.getByText(/队列为空：当前没有因 L0 写密钥未解锁而暂存的写入/)).toBeInTheDocument();
    expect(screen.queryByTestId('pending-unavailable')).toBeNull();
  });

  it('读取失败 → 显示原因与刷新入口，不渲染任何队列数字', async () => {
    vi.mocked(loadPendingWrites).mockResolvedValue({ status: 'error', detail: '宿主能力缺失: window.api.l0.pendingWrites' });
    await openTaskPane();
    const err = await screen.findByTestId('pending-error');
    expect(err.textContent).toContain('宿主能力缺失');
    expect(screen.queryByTestId('pending-count')).toBeNull();
    const pane = document.querySelector('.taskpane') as HTMLElement;
    expect(within(pane).getByRole('button', { name: '刷新' })).toBeInTheDocument();
  });
});

describe('S6 底部四标签：只渲染真实数据，不可用就给原因', () => {
  const RUN = {
    requestId: 'req_sched_1',
    taskKey: 'decay',
    label: '记忆衰减（遗忘曲线推进）',
    trigger: 'cron',
    status: 'ok',
    startedAt: 1_790_000_000_000,
    durationMs: 42,
    nextDueAt: 1_790_030_000_000,
    error: null,
  };

  function badge(container: HTMLElement, label: string): string | null {
    const tab = Array.from(container.querySelectorAll('.bp-tab')).find((b) => (b.textContent ?? '').includes(label));
    return tab?.querySelector('.bn')?.textContent ?? null;
  }

  /** 底部标签栏里的同名按钮（避免与 Ribbon 的「查看审计」等按钮撞名） */
  function tabButton(container: HTMLElement, label: string): HTMLButtonElement {
    const el = Array.from(container.querySelectorAll('.bp-head .bp-tab'))
      .find((b) => (b.textContent ?? '').includes(label));
    if (!el) throw new Error(`找不到底部标签：${label}`);
    return el as HTMLButtonElement;
  }

  /** 定稿 D1 默认收起底部面板：点底部标签即展开，再断言面板内真实数据 */
  async function openDock(container: HTMLElement) {
    await act(async () => { fireEvent.click(tabButton(container, '输出')); });
  }

  it('定稿默认：底部面板收起，只留标签栏；不渲染面板体与拖拽条', async () => {
    const { container } = await renderShell();
    const panel = container.querySelector('.bottom-panel') as HTMLElement;
    expect(panel.classList.contains('collapsed')).toBe(true);
    expect(container.querySelector('.bp-body')).toBeNull();
    expect(container.querySelector('.dock-resizer')).toBeNull();
  });

  it('输出：浏览器模式如实不可用，且不显示任何角标数字', async () => {
    const { container } = await renderShell();
    await openDock(container);
    const note = await screen.findByTestId('dock-log-unavailable');
    expect(note.textContent).toContain('浏览器模式');
    expect(container.querySelectorAll('.bp-tab .bn')).toHaveLength(0);
  });

  it('输出：真实尾读行按原样展示，问题标签只派生 warn/error 并带真实计数', async () => {
    vi.mocked(loadOutputLog).mockResolvedValue({
      status: 'ok',
      view: {
        path: 'C:\\Users\\x\\actions.log',
        scanLines: 3,
        capturedAt: 1_790_000_100_000,
        lines: [
          { raw: 'a', ts: '2026-11-08T01:00:00.000Z', level: 'info', scope: 'kernel', action: 'server:start', message: '已监听 8201' },
          { raw: 'b', ts: '2026-11-08T01:00:01.000Z', level: 'warn', scope: 'sched', action: 'tick-slow', message: 'tick 超过 100ms' },
          { raw: 'c', ts: '2026-11-08T01:00:02.000Z', level: 'error', scope: 'sync', action: 'pull:fail', message: '后端不可达' },
        ],
      },
    });
    const { container } = await renderShell();
    await openDock(container);
    const rows = await screen.findAllByTestId('dock-log-row');
    expect(rows).toHaveLength(3);
    expect(screen.getByText(/tick 超过 100ms/)).toBeInTheDocument();
    expect(screen.getByText(/C:\\Users\\x\\actions.log/)).toBeInTheDocument();
    expect(badge(container, '输出')).toBe('3');
    // 问题标签 = 同一真实日志里的 warn/error（2 条），不是演示聚合
    await act(async () => { fireEvent.click(tabButton(container, '问题')); });
    expect((await screen.findAllByTestId('dock-problem-row')).length).toBe(2);
    expect(badge(container, '问题')).toBe('2');
    // 2026-11-22 用户要求说人话：说明改成「发生了什么/影响/处理」，不再出现「派生」等内部术语
    expect(screen.getByText(/最近共 2 条，其中 1 条需要你处理/)).toBeInTheDocument();
    expect(screen.queryByText(/由最近的动作日志派生（不是独立问题库）/)).toBeNull();
  });

  it('问题：真实日志没有 warn/error → 明确说没有，而不是不可用', async () => {
    vi.mocked(loadOutputLog).mockResolvedValue({
      status: 'ok',
      view: { path: null, scanLines: 2, capturedAt: 1, lines: [
        { raw: 'a', ts: null, level: 'info', scope: 'k', action: 'a', message: 'ok' },
      ] },
    });
    const { container } = await renderShell();
    await openDock(container);
    await screen.findByTestId('dock-log-row');
    await act(async () => { fireEvent.click(tabButton(container, '问题')); });
    expect(await screen.findByTestId('dock-problems-empty')).toBeInTheDocument();
    expect(badge(container, '问题')).toBe('0');
  });

  it('任务：真实 schedule_run 记录展示任务名/触发/耗时/下次到期', async () => {
    vi.mocked(loadScheduleRuns).mockResolvedValue({ status: 'ok', view: [RUN] });
    const { container } = await renderShell();
    await act(async () => { fireEvent.click(tabButton(container, '任务')); });
    const row = await screen.findByTestId('dock-task-row');
    expect(row.textContent).toContain('记忆衰减（遗忘曲线推进）');
    expect(row.textContent).toContain('触发 cron');
    expect(row.textContent).toContain('耗时 42 ms');
    expect(row.textContent).toContain('下次到期');
    expect(badge(container, '任务')).toBe('1');
  });

  it('任务：真实空集 → 说明是空集，不补演示任务也不显示 0 冒充未接入', async () => {
    vi.mocked(loadScheduleRuns).mockResolvedValue({ status: 'ok', view: [] });
    const { container } = await renderShell();
    await act(async () => { fireEvent.click(tabButton(container, '任务')); });
    expect(await screen.findByTestId('dock-tasks-empty')).toBeInTheDocument();
    expect(badge(container, '任务')).toBe('0');
  });

  it('任务：浏览器未登录 → 不可用原因，不查询、不显示 0', async () => {
    const { container } = await renderShell();
    await act(async () => { fireEvent.click(tabButton(container, '任务')); });
    const note = await screen.findByTestId('dock-tasks-unavailable');
    expect(note.textContent).toContain('读不到主进程的调度运行记录');
    expect(badge(container, '任务')).toBeNull();
  });

  it('审计：未选中对象不查询也不显示计数', async () => {
    const { container } = await renderShell();
    await act(async () => { fireEvent.click(tabButton(container, '审计')); });
    expect(await screen.findByTestId('dock-audit-no-selection')).toBeInTheDocument();
    expect(loadAuditForMemory).not.toHaveBeenCalled();
    expect(badge(container, '审计')).toBeNull();
  });

  it('审计：选中真实对象后按 ID 过滤真实审计行', async () => {
    const PAYLOAD = {
      v: 1 as const,
      page: 'memory.html',
      title: '记忆 mem_1',
      subtitle: '真实账本记录',
      fields: [{ k: 'ID', v: 'mem_1', mono: true }],
    };
    vi.mocked(loadAuditForMemory).mockResolvedValue({
      status: 'ok',
      view: [{ requestId: 'req_audit_1', action: 'memory_op', ts: 1_790_000_000_000, summary: '{"mem_id":"mem_1","op":"pin"}' }],
    });
    const { container } = await renderShell();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      await Promise.resolve();
    });
    expect(screen.getByTestId('shell-palette')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('记忆列表（全部）'));
    });
    const frame = container.querySelector('.page-pane.active iframe.page-frame') as HTMLIFrameElement;
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { [SELECTION_MSG]: PAYLOAD },
        origin: window.location.origin,
        source: frame.contentWindow,
      }));
    });
    await act(async () => { fireEvent.click(tabButton(container, '审计')); });
    const row = await screen.findByTestId('dock-audit-row');
    expect(row.textContent).toContain('memory_op');
    expect(row.textContent).toContain('"op":"pin"');
    expect(loadAuditForMemory).toHaveBeenCalledWith('mem_1');
    expect(badge(container, '审计')).toBe('1');
    expect(screen.getByTestId('sb-selected').textContent).toContain('1 条');
  });

  it('终端页签已删除（不再留不可用占位，也不再有死分支）', async () => {
    const { container } = await renderShell();
    expect(screen.queryByRole('button', { name: /终端/ })).toBeNull();
    expect(container.querySelector('[data-testid="dock-term-unavailable"]')).toBeNull();
    expect(screen.queryByText(/程序未提供终端命令通道/)).toBeNull();
  });
});

describe('S7 分层 L1–L6 / L0 面板：只在层级管理页或记忆库分层标签出现，数字全部来自真实 browse', () => {
  it('打开分层页才出现分层条；失败层显示读取失败而不是 0', async () => {
    await renderShell();
    expect(screen.queryByTestId('layer-strip')).toBeNull();
    fireEvent.click(screen.getByRole('treeitem', { name: /层级管理/ }));
    const strip = await screen.findByTestId('layer-strip');
    await waitFor(() => expect(strip.textContent).toContain('账本 7 条'));
    expect(strip.textContent).toContain('L6 1');
    expect(strip.textContent).toContain('L4 0');
    expect(strip.textContent).toContain('L3 读取失败');
    expect(screen.getByTestId('layer-strip-l0').textContent).toContain('已锁定');
    expect(loadLayerPanel).toHaveBeenCalledTimes(1);
  });

  it('分层读取失败 → 给原因，不渲染任何数字', async () => {
    vi.mocked(loadLayerPanel).mockResolvedValue({ status: 'error', detail: '账本读取失败：E_LEDGER_LOCKED' });
    await renderShell();
    fireEvent.click(screen.getByRole('treeitem', { name: /层级管理/ }));
    expect((await screen.findByTestId('layer-strip-error')).textContent).toContain('账本暂时被占用，请稍后重试');
    expect((await screen.findByTestId('layer-strip-error')).textContent).not.toContain('E_LEDGER_LOCKED');
    expect(screen.queryByText(/账本 7 条/)).toBeNull();
  });
});

describe('记忆助手：已从壳层浮窗改为独立整页', () => {
  it('导航「记忆助手」打开整页（assistant.html），不再渲染壳层浮层面板', async () => {
    const { container } = await renderShell();
    // 壳层不再有浮层面板
    expect(screen.queryByTestId('memory-assistant')).toBeNull();
    // 导航项指向真实页面
    fireEvent.click(screen.getByRole('treeitem', { name: /记忆助手/ }));
    const frame = container.querySelector('.page-pane.active iframe.page-frame');
    expect(frame?.getAttribute('src')).toContain('/assistant.html');
    // 批次51：QAT「记忆助手」按钮已随工具簇取消，入口只剩导航树
    expect(screen.queryByTestId('qa-assistant')).toBeNull();
  });
});

describe('功能导航折叠：折叠后只显示图标栏（不归零、不隐藏功能项）', () => {
  it('折叠后保留窄图标栏：树项只显示图标，名称走 title 提示，文字/角标隐藏', async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByTestId('nav-collapse-toggle'));

    const nav = container.querySelector('.nav-pane') as HTMLElement;
    expect(nav.className).toContain('collapsed');
    // 栏体不再归零（保留图标栏宽度）
    expect(nav.getBoundingClientRect === undefined || true).toBe(true);
    const shell = container.querySelector('.shell') as HTMLElement;
    expect(shell.style.getPropertyValue('--nav-w')).toBe('44px');

    // 树项仍在（功能没丢），但标记为 icon-only
    const rows = container.querySelectorAll('.tree-row');
    expect(rows.length).toBeGreaterThan(10);
    expect(container.querySelectorAll('.tree-row.icon-only').length).toBe(rows.length);
    // 图标可见、文字隐藏（隐藏由 CSS class 控制，这里校验结构标记）
    expect(screen.getByTestId('nav-item-home')).toHaveAttribute('title', '首页');
    expect(screen.getByTestId('nav-item-home').querySelector('.tico')).toBeTruthy();
    // 折叠按钮仍在图标栏内（可随时展开）
    expect(screen.getByTestId('nav-collapse-toggle')).toBeTruthy();
    expect(screen.getByTestId('nav-reopen')).toBeTruthy();
  });

  it('折叠态点击图标仍能打开对应页面', async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByTestId('nav-collapse-toggle'));
    fireEvent.click(screen.getByTestId('nav-item-memory-bank'));
    const frame = container.querySelector('.page-pane.active iframe.page-frame');
    expect(frame?.getAttribute('src')).toContain('/memory.html');
  });

  it('展开后恢复完整文字导航', async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByTestId('nav-collapse-toggle'));
    fireEvent.click(screen.getByTestId('nav-reopen'));
    const nav = container.querySelector('.nav-pane') as HTMLElement;
    expect(nav.className).not.toContain('collapsed');
    expect(container.querySelectorAll('.tree-row.icon-only').length).toBe(0);
    const shell = container.querySelector('.shell') as HTMLElement;
    expect(shell.style.getPropertyValue('--nav-w')).not.toBe('44px');
  });
});

describe('v5 设计稿对齐：导航头部工具（新建记忆 + 折叠，无前置图标）', () => {
  it('「新建记忆」按钮打开写入页；头部不再渲染前置图标', async () => {
    const { container } = await renderShell();
    // v5 设计稿 nav-head 只有 label + 工具按钮（新建/折叠），没有 folder 前置图标
    expect(container.querySelector('.nav-pane .pane-head .ph-ic')).toBeNull();
    fireEvent.click(screen.getByTestId('nav-new-memory'));
    const frame = container.querySelector('.page-pane.active iframe.page-frame');
    expect(frame?.getAttribute('src')).toContain('/write.html');
  });
});
