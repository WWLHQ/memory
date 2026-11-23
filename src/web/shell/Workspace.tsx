// 工作台壳层（批次48 S1 建；v5 重设计改造）：36px 标题栏 + 44px 上下文命令条 + 导航树 + 标签条
// + 属性检查器 + 任务窗 + 底部四标签 + 26px 状态栏；原菜单栏/Ribbon 全量命令收进 Ctrl+K 命令面板。
//
// 设计边界（与定稿 D1 一致，设计真源 design-mockups/记忆工作台-界面重设计-v5.html）：
// - 壳只提供「导航与布局」，中心区用同源 iframe 承载已真实落地的页面；
// - 壳内任何数字都必须能追到真实来源：尚未接线的部位一律写「未接入」并给出原因，
//   绝不显示编造读数、假计数或「—」冒充真实值；
// - overview.html（演示通览）不进入主导航。

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { formatLogClock } from '../Home/programLog.ts';
import { getStoredSessionId, hasActiveSession } from '../Home/crossTabAuth.ts';
import { fetchSessionContext } from '../shared/session.ts';
import type { TenantContext } from '../../types/home.ts';
import { Icon } from './Icons.tsx';
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from './ContextMenu.tsx';
import { ShellLoginDialog } from './ShellLoginDialog.tsx';
import { CommandPalette } from './CommandPalette.tsx';
import { loadOverview, type OverviewSnapshot } from './overview.ts';
import { emptyLayerGraph } from '../Home/layerGraph.ts';
import { loadPendingWrites, type PendingWritesResult } from './taskpane.ts';
import {
  BOTTOM_TABS, CMDS, NAV, PAGES, QUICK_VIEWS, findNav, flattenNav,
  type BottomTabId, type CmdItem, type IconName, type NavItem, type PageKey,
  type PaletteItem, type ShellAction,
} from './views.ts';
import {
  countActionableProblems, loadAuditForMemory, loadOutputLog, loadScheduleRuns, problemsFromLog,
  type AuditRow, type DockResult, type OutputLogView, type ScheduleRun,
} from './dock.ts';
import { humanActionLabel, humanizeLogLine, problemsIntro } from './humanLog.ts';
import { loadStatusbar, shortLocation, type StatusSnapshot } from './statusbar.ts';
import { loadLayerPanel, type LayerPanelView } from './layers.ts';
import { strataViewFromOverview, type StrataScaleView } from './strataScale.ts';
import { StrataScale } from './StrataScale.tsx';
import { ShellStatusCard } from './ShellStatusCard.tsx';
import { loadNavCounts, type NavCounts } from './navCounts.ts';
import { SELECTION_MSG, parseSelection, type SelectionPayload } from '../shared/selectionChannel.ts';
import { NAV_COUNT_MSG, parseNavCount } from '../shared/navCountChannel.ts';
import { SHELL_GOTO_MSG } from '../shared/shellNavigate.ts';
import { humanErrorText } from '../shared/kernelLoad.tsx';
import { onL0WriteLockChanged } from '../shared/l0WriteLockSignal.ts';
import { runStartupAutoOnboard } from '../AgentOnboard/startupAutoOnboard.ts';

const STORE_THEME = 'memdesk.shell.theme.v1';
const STORE_DENSITY = 'memdesk.shell.density.v1';
const STORE_ZOOM = 'memdesk.shell.zoom.v1';

/** Electron 壳（preload 暴露 __ELECTRON__）：只有桌面端才需要为系统窗口按钮预留右上角、才走拖拽区 */
const IS_ELECTRON = typeof window !== 'undefined' && Boolean((window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__);

/** 功能导航折叠后的窄图标栏宽度（px）：只显示图标，悬停出名称 */
const NAV_COLLAPSED_W = 44;
/** 窗口按钮覆盖层主题同步通道（浏览器模式无此桥） */
export type ShellShortcutAction =
  | 'refresh' | 'search' | 'help' | 'security'
  | 'dock' | 'nav' | 'inspector' | 'quick1' | 'quick2' | 'quick3' | 'quick4'
  | 'quick5' | 'quick6' | 'quick7' | 'quick8';
interface ShellWindowBridge {
  setTitleBarTheme?: (theme: 'light' | 'dark') => Promise<{ ok: boolean }>;
  onShortcut?: (cb: (action: ShellShortcutAction) => void) => () => void;
}
function shellWindowBridge(): ShellWindowBridge | undefined {
  return (window as unknown as { api?: { shell?: ShellWindowBridge } }).api?.shell;
}

type ThemeMode = 'system' | 'light' | 'dark';
type Density = 'comfortable' | 'compact';

interface OpenTab {
  id: string;
  label: string;
  page?: PageKey;
  /** D4 页面初值：`?status=archived` / `#l0bar` */
  href?: string;
  unavailable?: string;
}

/**
 * 顶层 ?backend= / ?agentBackend= 透传给 iframe 内页面（与 Overview 的透传口径一致）。
 * href 只做两件事：追加查询参数（`?k=v`）或锚点（`#id`），由目标页自己解析成真实筛选/定位。
 */
function pageUrl(key: PageKey, href?: string): string {
  const params = new URLSearchParams(location.search);
  const q = new URLSearchParams();
  const backend = params.get('backend');
  const agentBackend = params.get('agentBackend');
  if (backend) q.set('backend', backend);
  if (agentBackend) q.set('agentBackend', agentBackend);
  let hash = '';
  if (href?.startsWith('?')) {
    new URLSearchParams(href.slice(1)).forEach((v, k) => { if (v) q.set(k, v); });
  } else if (href?.startsWith('#')) {
    hash = href;
  }
  const qs = q.toString();
  return `/${PAGES[key].file}${qs ? `?${qs}` : ''}${hash}`;
}

function readStore(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 本地存储不可用不打断界面 */
  }
}

function systemPrefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function Workspace() {
  const [activeId, setActiveId] = useState<string>('home');
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([
    { id: 'home', label: '首页', page: 'home' },
  ]);
  const [openParents, setOpenParents] = useState<Record<string, boolean>>({});
  /** Ctrl+K 命令面板（v5）：原菜单 + Ribbon 全量命令的常驻入口 */
  const [palOpen, setPalOpen] = useState(false);
  /** 快捷键帮助浮层（F1 / ?） */
  const [keysOpen, setKeysOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  // 用户 2026-11-16 要求：属性检查器默认收起，需要时由 QAT / 右侧竖条 / 右键菜单显式展开
  const [inspCollapsed, setInspCollapsed] = useState(true);
  const [taskOpen, setTaskOpen] = useState(false);
  /** 定稿 D1：底部面板默认收起（只留 31px 标签栏），把纵向空间让给中心区；点标签/状态栏可展开 */
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState<BottomTabId>('output');
  const [statusVisible, setStatusVisible] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const v = readStore(STORE_THEME, 'system');
    return v === 'light' || v === 'dark' ? v : 'system';
  });
  const [darkSystem, setDarkSystem] = useState(systemPrefersDark);
  const [density, setDensity] = useState<Density>(() => (readStore(STORE_DENSITY, 'comfortable') === 'compact' ? 'compact' : 'comfortable'));
  const [zoom, setZoom] = useState<number>(() => {
    const n = Number(readStore(STORE_ZOOM, '100'));
    return Number.isFinite(n) && n >= 80 && n <= 125 ? n : 100;
  });
  const [navWidth, setNavWidth] = useState(196);
  const [inspWidth, setInspWidth] = useState(318);
  const [dockHeight, setDockHeight] = useState(190);
  const [reloadNonce, setReloadNonce] = useState(0);
  /**
   * 首页（index.html）是中心区 iframe，不是顶层窗口。它在后台（用户停在写入/安全页解锁写密钥）
   * 会错过 storage 事件，且 iframe 内的 focus/visibilitychange 对「切换 shell 标签」完全无效，
   * 因此「解锁后首页红条不消失」靠首页自己监听不可靠。改由壳层（native 顶层，storage 事件可靠）
   * 收到写锁信号后递增本 nonce，主动重挂首页 iframe，让它重新 loadOverview 拿真值。
   */
  const [homeReloadNonce, setHomeReloadNonce] = useState(0);
  /** T3：管理台默认视图只在会话身份首次解析时应用一次；此后不再覆盖用户选择。 */
  const adminDefaultAppliedRef = useRef(false);
  /** T3：用户是否已主动切换过视图（openView 的所有入口都算，含 Ribbon / 快捷键）。 */
  const userNavigatedRef = useRef(false);
  const [message, setMessage] = useState('工作台已就绪：中心区为同源真实页面，壳层尚未接线的部位会明确标注原因。');
  const [sessionActive, setSessionActive] = useState(() => hasActiveSession());
  /** 当前会话真实身份（/api/me 确认；null = 未确认，绝不按 localStorage 冒充身份） */
  const [identity, setIdentity] = useState<TenantContext | null>(null);
  /** 身份是否已核对过一轮（区分「还没查」与「查了但没有会话」——启动自动接入要等这一步） */
  const [identityChecked, setIdentityChecked] = useState(false);
  /** 壳层登录弹窗（菜单栏 / 登录状态处两处入口共用同一实例） */
  const [loginOpen, setLoginOpen] = useState(false);
  /** 右键菜单（导航树 / 标签条 / 检查器 / 中心页表格行共用同一渲染器） */
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [overview, setOverview] = useState<OverviewSnapshot | null>(null);
  const [overviewBusy, setOverviewBusy] = useState(false);
  /** S4：中心区真实页面回传的选中项（null = 未选中/无回传，绝不推测） */
  const [selection, setSelection] = useState<SelectionPayload | null>(null);
  /** S5：任务窗「待重放写入」只读视图（null = 尚未读取） */
  const [pending, setPending] = useState<PendingWritesResult | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  /** S6：底部面板真实数据（null = 尚未读取） */
  const [dockLog, setDockLog] = useState<DockResult<OutputLogView> | null>(null);
  const [dockLogBusy, setDockLogBusy] = useState(false);
  const [dockTasks, setDockTasks] = useState<DockResult<ScheduleRun[]> | null>(null);
  const [dockTasksBusy, setDockTasksBusy] = useState(false);
  const [dockAudit, setDockAudit] = useState<DockResult<AuditRow[]> | null>(null);
  const [dockAuditBusy, setDockAuditBusy] = useState(false);
  /** S7：状态栏真实读数（账本位置 / L0 保险库 / 采集器后台） */
  // 分格就绪：四路状态各自先到先显示，不等最慢的一路（2026-11-22 启动提速）
  const [status, setStatus] = useState<Partial<StatusSnapshot>>({});
  /** S7：分层 L1–L6 / L0 面板（仅在中心页为分层或 L0 时读取） */
  const [layerPanel, setLayerPanel] = useState<DockResult<LayerPanelView> | null>(null);
  const pendingBusyRef = useRef(false);
  const frameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  /** 右键菜单位置换算用：读取当前 zoom，避免事件回调闭包拿到过期比例 */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  /** 已挂右键监听的 iframe 文档（避免重复挂载） */
  const bridgedDocs = useRef<WeakSet<Document>>(new WeakSet());
  const activePageRef = useRef<PageKey | undefined>(undefined);

  const refreshOverview = useCallback(() => {
    setOverviewBusy(true);
    loadOverview()
      .then((s) => setOverview(s))
      .catch((e) => setOverview({
        loadedAt: Date.now(), kernelMode: 'browser', storageError: String(e),
        gains: [],
        raw: { gains: [], anomalies: [], activeMemories: [], todos: [] },
        pendingSync: 0,
        facts: null,
        strata: null,
        effectGains: [],
        graph: emptyLayerGraph(),
        recentAudits: { ok: false, rows: [], total: 0, error: '概览聚合异常' },
        today: { ok: false, write: 0, recall: 0, graft: 0, filtered: 0, error: '概览聚合异常' },
        token: { ok: false, savedPct: null, recallCount: 0, savedTokens: 0, series: [], error: '概览聚合异常' },
        refine: { ok: false, available: false, view: null, error: '概览聚合异常' },
        mcp: { ok: false, available: false, endpoint: null, clients: [], error: '概览聚合异常' },
        engines: { ok: false, available: false, engines: [], error: '概览聚合异常' },
        dataRoot: { available: false, root: null, error: '概览聚合异常' },
        health: { status: 'down', detail: '概览聚合异常', checkedAt: Date.now() },
        session: hasActiveSession(), billing: { status: 'unavailable', detail: '概览聚合异常' },
      }))
      .finally(() => setOverviewBusy(false));
  }, []);

  // 概览真实数据：挂载时读取一次；登录态变化后重读（成本/会话字段随真实会话变化）
  useEffect(() => { refreshOverview(); }, [refreshOverview, sessionActive]);

  // S5：任务窗「待重放写入」只读读取（打开任务窗时读一次；也可手动点刷新）
  const refreshPending = useCallback(async () => {
    if (pendingBusyRef.current) return;
    pendingBusyRef.current = true;
    setPendingBusy(true);
    try {
      setPending(await loadPendingWrites());
    } finally {
      pendingBusyRef.current = false;
      setPendingBusy(false);
    }
  }, []);

  useEffect(() => { if (taskOpen) void refreshPending(); }, [taskOpen, refreshPending, sessionActive]);

  // S6：底部面板读取（只在对应标签可见时按需读一次；刷新按钮可重读）
  const refreshDockLog = useCallback(async () => {
    setDockLogBusy(true);
    try {
      setDockLog(await loadOutputLog());
    } finally {
      setDockLogBusy(false);
    }
  }, []);

  const refreshDockTasks = useCallback(async () => {
    setDockTasksBusy(true);
    try {
      setDockTasks(await loadScheduleRuns());
    } finally {
      setDockTasksBusy(false);
    }
  }, []);

  const refreshDockAudit = useCallback(async (memId: string) => {
    setDockAuditBusy(true);
    try {
      setDockAudit(await loadAuditForMemory(memId));
    } finally {
      setDockAuditBusy(false);
    }
  }, []);

  /** 选中对象 id：只认中心页回传的 ID 字段，没有就不查审计 */
  const selectionId = selection?.fields.find((f) => f.k === 'ID')?.v ?? null;

  useEffect(() => {
    if (!dockOpen || dockTab === 'tasks' || dockTab === 'audit') return;
    if (dockLog) return;
    void refreshDockLog();
  }, [dockOpen, dockTab, dockLog, refreshDockLog]);

  useEffect(() => {
    if (!dockOpen || dockTab !== 'tasks' || dockTasks) return;
    void refreshDockTasks();
  }, [dockOpen, dockTab, dockTasks, refreshDockTasks]);

  useEffect(() => {
    if (!dockOpen || dockTab !== 'audit') return;
    if (!selectionId) {
      setDockAudit(null);
      return;
    }
    void refreshDockAudit(selectionId);
  }, [dockOpen, dockTab, selectionId, refreshDockAudit]);

  // S7：状态栏读数（挂载 + 登录态变化时读一次；F5/刷新动作也会清空重读）
  const refreshStatus = useCallback(async () => {
    setStatus({});
    const snap = await loadStatusbar((part) => setStatus((prev) => ({ ...prev, ...part })));
    setStatus(snap);
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus, sessionActive]);

  const resolvedTheme = theme === 'system' ? (darkSystem ? 'dark' : 'light') : theme;

  // 主题：写入 <html data-theme>，样式表按此切换（仅作用于壳层；21 页表现层本轮不改）
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  // 顶部自绘标题栏：系统绘制的窗口按钮覆盖层跟随壳层主题换底色/符号色（桌面端专用）
  useEffect(() => {
    if (!IS_ELECTRON) return;
    void shellWindowBridge()?.setTitleBarTheme?.(resolvedTheme);
  }, [resolvedTheme]);

  // 系统主题跟随
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDarkSystem(mq.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    return undefined;
  }, []);

  // 密度
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-density', density);
    writeStore(STORE_DENSITY, density);
  }, [density]);

  useEffect(() => { writeStore(STORE_THEME, theme); }, [theme]);
  useEffect(() => { writeStore(STORE_ZOOM, String(zoom)); }, [zoom]);

  // 登录态跟随其它标签/iframe 的存储变化（只读展示真实会话是否存在）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStore = () => setSessionActive(hasActiveSession());
    window.addEventListener('storage', onStore);
    return () => window.removeEventListener('storage', onStore);
  }, []);

  // 写锁（写密钥）状态变化 → 状态栏立刻重读真实 l0Status；同时主动重挂首页 iframe
  // （首页是中心区 iframe，对「切换 shell 标签」无效，必须由壳层 native 顶层可靠地驱动重挂）
  useEffect(() => onL0WriteLockChanged(() => {
    void refreshStatus();
    setHomeReloadNonce((n) => n + 1);
  }), [refreshStatus, setHomeReloadNonce]);

  // 【轮6·真正兜底】每次切回「首页」tab，强制重挂首页 iframe（key 变化 → 重新加载 index.html
  // → 重新 loadOverview 拿写锁真值）。前几轮（轮3/4/5）都依赖「跨 iframe 的 storage 信号」驱动
  // 首页刷新，但 Electron 下该信号未必可靠到达壳层，导致「在安全/写入页解锁写密钥 → 回到首页，
  // 红条仍在」。本 effect 用纯 React 状态（activeId）触发，100% 可靠，覆盖主路径。
  // 注：activeId 初始即 'home'，首次挂载会多触发一次重挂（无害）。
  useEffect(() => {
    if (activeId === 'home') setHomeReloadNonce((n) => n + 1);
  }, [activeId, setHomeReloadNonce]);

  // 启动时用本机 sessionId 向 /api/me 核对真实身份：查不到就不写身份（状态栏只显示「已登录/未登录」）
  useEffect(() => {
    const sid = getStoredSessionId();
    if (!sid) { setIdentity(null); setIdentityChecked(true); return; }
    let alive = true;
    fetchSessionContext(sid)
      .then((ctx) => { if (alive) { setIdentity(ctx); setIdentityChecked(true); } })
      .catch(() => { if (alive) { setIdentity(null); setIdentityChecked(true); } });
    return () => { alive = false; };
  }, []);

  /**
   * 启动即自动发现并接入本机 Agent（2026-11-16 用户要求：软件起来就扫，不等切到接入页）。
   * 之前这条链路挂在接入页挂载 effect 上，用户不点「Agent 接入」就永远不跑。
   * 等身份核对完成再起扫：写 MCP 配置要真实会话判定管理员权限，先扫只能记一堆「无会话」。
   * 单次闸 + 会话内标记都在 runStartupAutoOnboard 里：切页/重挂/StrictMode 双挂载都不会重复三路真扫。
   */
  useEffect(() => {
    if (!identityChecked) return;
    void runStartupAutoOnboard({
      sid: getStoredSessionId(),
      role: identity?.role ?? null,
    });
  }, [identityChecked, identity?.role]);

  /** 登录弹窗回传会话变化：更新身份与只读门禁；概览/状态栏随 sessionActive 自动重读真实数据 */
  const onLoginSession = useCallback((ctx: TenantContext | null) => {
    setIdentity(ctx);
    setSessionActive(hasActiveSession());
  }, []);

  const active = useMemo(() => openTabs.find((t) => t.id === activeId) ?? openTabs[0], [activeId, openTabs]);
  /** 命令深链会派生 id（如 memory-bank?tab=layers），按 page + href 兜底回查 NAV，属性检查器不丢标题。 */
  const activeNav = useMemo(() => {
    if (!active) return undefined;
    const direct = findNav(active.id);
    if (direct) return direct;
    const all = flattenNav();
    return all.find((n) => n.page === active.page && (n.href ?? '') === (active.href ?? ''))
      ?? all.find((n) => n.page === active.page);
  }, [active]);

  /** S7：分层条只在「层级管理」页或记忆库的分层 / L0 标签时出现（数据与中心页同源）。 */
  const showLayerStrip = active?.page === 'layered'
    || (active?.page === 'memory' && (active.href?.includes('tab=layers') || active.href?.includes('tab=l0') || false));

  useEffect(() => {
    if (!showLayerStrip || layerPanel) return;
    void (async () => setLayerPanel(await loadLayerPanel()))();
  }, [showLayerStrip, layerPanel]);

  // 批次55：层级刻度直接复用概览页同一次真实账本快照，不再独立读 storage / browse。
  const strataScale = useMemo<DockResult<StrataScaleView> | null>(
    () => overview ? strataViewFromOverview(overview) : null,
    [overview],
  );

  useEffect(() => { activePageRef.current = active?.page; }, [active?.page]);
  // 切换标签即清空选中项：绝不把上一页的选区挂到新页面上
  useEffect(() => { setSelection(null); }, [activeId]);

  // S4：接收中心区真实页面的选中项回传（只接受同源、且来自本壳当前嵌入的 iframe）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object' || !(SELECTION_MSG in data)) return;
      const fromOurs = Object.values(frameRefs.current)
        .some((f) => f?.contentWindow === (e.source as unknown as Window | null));
      if (!fromOurs) return;
      const raw = data[SELECTION_MSG];
      if (raw === null) {
        setSelection(null);
        return;
      }
      const parsed = parseSelection(raw);
      if (!parsed) return;
      const page = activePageRef.current;
      // 只接受当前激活标签对应页面的回传；其它页（含后台标签）一律丢弃
      if (!page || PAGES[page].file !== parsed.page) return;
      setSelection(parsed);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 第一轮个人记忆：中心区页面回传真实待确认计数 → 左侧导航角标（只接受本壳 iframe 的同源回传）
  const [navCounts, setNavCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onCount = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object' || !(NAV_COUNT_MSG in data)) return;
      const fromOurs = Object.values(frameRefs.current)
        .some((f) => f?.contentWindow === (e.source as unknown as Window | null));
      if (!fromOurs) return;
      const parsed = parseNavCount(data[NAV_COUNT_MSG]);
      if (!parsed) return;
      setNavCounts((prev) => (prev[parsed.id] === parsed.count ? prev : { ...prev, [parsed.id]: parsed.count }));
    };
    window.addEventListener('message', onCount);
    return () => window.removeEventListener('message', onCount);
  }, []);

  // 批次54：三个角标只读真实账本 / 接入后端；刷新或登录态变化时重读，失败不显示角标。
  const [realNavCounts, setRealNavCounts] = useState<NavCounts>({});
  const [navCountsSeq, setNavCountsSeq] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await loadNavCounts();
      if (alive) setRealNavCounts(next);
    })();
    return () => { alive = false; };
  }, [navCountsSeq, sessionActive]);

  /** 真账本预读 + 页面同源回传（如个人记忆待确认数）合并；页面回传优先，便于动作后即时刷新。 */
  const mergedNavCounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(realNavCounts)) if (typeof v === 'number') out[k] = v;
    for (const [k, v] of Object.entries(navCounts)) out[k] = v;
    return out;
  }, [realNavCounts, navCounts]);

  // 缩放由 .shell 的 CSS zoom 统一承担（含 iframe），不再单独改写子页面文档，避免双重缩放

  const openView = useCallback((item: NavItem) => {
    // T3：任何经导航入口的切换都算「用户已选定视图」——管理台默认视图只在会话身份首次解析时
    // 应用一次，绝不覆盖用户（或 Ribbon/快捷键）主动做出的选择。
    userNavigatedRef.current = true;
    setActiveId(item.id);
    setOpenTabs((tabs) => tabs.some((t) => t.id === item.id)
      ? tabs
      : [...tabs, { id: item.id, label: item.label, page: item.page, href: item.href, unavailable: item.unavailable }]);
    setMessage(`已切换到「${item.label}」。`);
  }, []);

  // T3（§14.1）管理台默认视图：管理员登录后默认落「管理台」（复用 security.html 检查摘要页签）；
  // 成员与未登录保持首页。只在会话身份首次解析时决定，且用户已手动切换过则不插手。
  useEffect(() => {
    if (adminDefaultAppliedRef.current || !identity) return;
    adminDefaultAppliedRef.current = true;
    if (identity.role === 'admin' && !userNavigatedRef.current) {
      const admin = NAV.find((n): n is NavItem => n.kind === 'item' && n.id === 'admin-console');
      if (admin) openView(admin);
    }
  }, [identity, openView]);

  // 概览页快捷胶囊 / 编号洞察 → 壳层导航（只接受本壳嵌入的 iframe 发来的请求）
  useEffect(() => {
    const onGoto = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;
      const id = data[SHELL_GOTO_MSG];
      if (typeof id !== 'string') return;
      const fromOurs = Object.values(frameRefs.current)
        .some((f) => f?.contentWindow === (e.source as unknown as Window | null));
      if (!fromOurs) return;
      // login 不占主导航（views.ts），页面发来的登录请求打开壳层登录弹窗
      if (id === 'login') { setLoginOpen(true); return; }
      const target = findNav(id);
      if (target) openView(target);
    };
    window.addEventListener('message', onGoto);
    return () => window.removeEventListener('message', onGoto);
  }, [openView]);

  const closeTab = useCallback((id: string) => {
    setOpenTabs((tabs) => {
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return tabs;
      const next = tabs.filter((t) => t.id !== id);
      if (next.length === 0) return [{ id: 'home', label: '首页', page: 'home' }];
      if (id === activeId) setActiveId(next[Math.min(idx, next.length - 1)].id);
      return next;
    });
  }, [activeId]);

  const runShellAction = useCallback((action: ShellAction, _label: string) => {
    switch (action) {
      case 'toggleTaskPane':
        setTaskOpen((v) => !v);
        break;
      case 'toggleNav':
        setNavCollapsed((v) => !v);
        break;
      case 'openPalette':
        setPalOpen(true);
        break;
      case 'theme':
        setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'));
        break;
      case 'toggleDock':
        setDockOpen((v) => !v);
        break;
      case 'toggleStatus':
        setStatusVisible((v) => !v);
        break;
      case 'density':
        setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'));
        break;
      case 'zoom':
        setZoom((z) => (z >= 125 ? 80 : z + 5));
        break;
      case 'resetLayout':
        setNavWidth(250); setInspWidth(318); setDockHeight(190);
        // 重置布局 = 回到默认：属性检查器默认收起（2026-11-16）
        setNavCollapsed(false); setInspCollapsed(true); setTaskOpen(false); setDockOpen(true);
        setZoom(100); setDensity('comfortable'); setStatusVisible(true);
        break;
      case 'refresh':
        setReloadNonce((n) => n + 1);
        // 底部面板、状态栏、导航角标同样重读；层级刻度与概览页共用同一份真实账本快照
        setDockLog(null); setDockTasks(null); setDockAudit(null);
        setStatus({}); setLayerPanel(null);
        refreshOverview();
        setRealNavCounts({}); setNavCountsSeq((n) => n + 1);
        setMessage('已刷新全部打开的真实页面（整页重挂）、概览账本/层级刻度、底部面板/状态栏与导航角标读数。');
        break;
      default:
        break;
    }
  }, [refreshOverview]);

  // ── 批次49：右键菜单（全域接管；四类专门区域 + 壳层其余任意位置）──
  // 任何可右键位置都必须给出非空菜单：要么真实动作，要么禁用并写原因；不漏出浏览器原生菜单。
  const copyText = useCallback((text: string, okMsg: string) => {
    const write = navigator.clipboard?.writeText(text);
    if (!write) { setMessage('复制失败：当前环境未提供剪贴板 API。'); return; }
    write.then(() => setMessage(okMsg)).catch(() => setMessage('复制失败：剪贴板未授权。'));
  }, []);

  const openCtxMenu = useCallback((x: number, y: number, title: string, testId: string, items: ContextMenuItem[]) => {
    const scale = zoomRef.current / 100;
    setCtxMenu({ x: x / scale, y: y / scale, title, testId, items });
    setPalOpen(false);
  }, []);

  const openNavContext = useCallback((item: NavItem, e: ReactMouseEvent) => {
    e.preventDefault();
    const hasKids = Boolean(item.children?.length);
    openCtxMenu(e.clientX, e.clientY, `导航：${item.label}`, 'navmenu', [
      {
        id: 'open', icon: 'chev', label: `打开「${item.label}」`,
        disabled: Boolean(item.unavailable), reason: item.unavailable,
        run: () => openView(item),
      },
      {
        id: 'toggle', icon: hasKids ? (openParents[item.id] ? 'caret' : 'chev') : 'dot',
        label: openParents[item.id] ? '折叠子项' : '展开子项',
        disabled: !hasKids, reason: '该导航项没有子项',
        run: () => setOpenParents((p) => ({ ...p, [item.id]: !(p[item.id] ?? false) })),
      },
      { id: 'sep1', sep: true },
      { id: 'copy', icon: 'copy', label: '复制导航名称', run: () => copyText(item.label, `已复制导航名称：${item.label}`) },
      {
        id: 'source', icon: 'info', label: '查看页面来源',
        disabled: !item.page, reason: '该导航项没有对应页面',
        run: () => {
          if (!item.page) return;
          setMessage(`「${item.label}」页面 ${PAGES[item.page].file} · 数据来源：${PAGES[item.page].source}`);
        },
      },
    ]);
  }, [openCtxMenu, openParents, openView, copyText]);

  const closeOthers = useCallback((keepId: string) => {
    setOpenTabs((tabs) => {
      const keep = tabs.find((t) => t.id === keepId);
      if (!keep) return tabs;
      setActiveId(keepId);
      return [keep];
    });
  }, []);

  const openTabContext = useCallback((t: OpenTab, e: ReactMouseEvent) => {
    e.preventDefault();
    const others = openTabs.filter((x) => x.id !== t.id);
    openCtxMenu(e.clientX, e.clientY, `标签：${t.label}`, 'tabmenu', [
      {
        id: 'close', icon: 'x', label: '关闭此标签',
        disabled: openTabs.length <= 1, reason: '至少保留一个标签（概览）',
        run: () => closeTab(t.id),
      },
      {
        id: 'closeOthers', icon: 'x', label: `关闭其它标签（${others.length}）`,
        disabled: others.length === 0, reason: '没有其它标签',
        run: () => closeOthers(t.id),
      },
      { id: 'sep1', sep: true },
      { id: 'refresh', icon: 'refresh', label: '刷新全部页面与底部读数（F5）', run: () => runShellAction('refresh', '刷新') },
      {
        id: 'copyUrl', icon: 'copy', label: '复制标签页地址',
        disabled: !t.page, reason: t.unavailable ? `该标签不可用：${t.unavailable}` : '该标签没有页面地址',
        run: () => { if (t.page) copyText(pageUrl(t.page, t.href), `已复制标签地址：${pageUrl(t.page, t.href)}`); },
      },
    ]);
  }, [openTabs, closeTab, closeOthers, openCtxMenu, runShellAction, copyText]);

  const openInspContext = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    openCtxMenu(e.clientX, e.clientY, '属性检查器', 'inspmenu', [
      {
        id: 'copyId', icon: 'copy', label: '复制选中记忆 ID',
        disabled: !selectionId, reason: '中心页未选中记忆',
        run: () => { if (selectionId) copyText(selectionId, `已复制记忆 ID：${selectionId}`); },
      },
      {
        id: 'copyAll', icon: 'copy', label: '复制选中项全部字段',
        disabled: !selection, reason: '中心页尚未回传选中项',
        run: () => {
          if (!selection) return;
          const lines = [`标题：${selection.title}`, `页面：${selection.page}`, ...selection.fields.map((f) => `${f.k}：${f.v}`)];
          copyText(lines.join('\n'), `已复制选中项 ${lines.length} 行字段。`);
        },
      },
      { id: 'sep1', sep: true },
      {
        id: 'copyFile', icon: 'db', label: '复制页面文件',
        disabled: !active?.page, reason: '当前标签没有对应页面',
        run: () => { if (active?.page) copyText(PAGES[active.page].file, `已复制页面文件：${PAGES[active.page].file}`); },
      },
      {
        id: 'collapse', icon: 'panel',
        label: inspCollapsed ? '展开属性检查器' : '折叠属性检查器',
        run: () => setInspCollapsed((v) => !v),
      },
    ]);
  }, [openCtxMenu, selectionId, selection, active?.page, copyText, inspCollapsed]);

  /**
   * 全域右键兜底：标题栏 / 命令条 / 导航树 / 状态栏 / 底部面板 / 中心空白
   * 命中的区域决定标题，动作全部是壳层真实能力（刷新、回概览、命令面板、复制、切主题、登录会话）。
   * 这样壳层可视范围内不存在「右键没反应」或漏原生菜单的位置。
   */
  const openDefaultContext = useCallback((x: number, y: number, target: HTMLElement | null) => {
    const zone = target?.closest('.tree') ? '功能导航'
      : target?.closest('.statusbar') ? '状态栏'
        : target?.closest('.bottom-panel') ? '底部面板'
          : target?.closest('.inspector-pane') ? '属性检查器'
            : target?.closest('.center-pane') ? '中心区'
              : target?.closest('.cmdbar') ? '命令条'
                : target?.closest('.titlebar') ? '标题栏'
                  : '工作台';
    // 输入框的选区不走 DOM Selection，单独取 selectionStart/End
    const field = target?.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
    const selected = field && typeof field.selectionStart === 'number'
      ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
      : (window.getSelection()?.toString() ?? '');
    const selectedText = selected.trim();
    // 批次50：右键不补登录入口 —— 只有该区域本身已有登录入口才出现「登录 / 会话」
    // 批次51：登录入口集中在标题栏头像与状态栏会话格，按 testid 精确命中。
    const hasLoginEntry = !!target?.closest(
      '[data-testid="shell-avatar"], [data-testid="sb-session"]',
    );
    const items: ContextMenuItem[] = [
      { id: 'refresh', icon: 'refresh', label: '刷新全部页面与底部/状态栏读数（F5）', run: () => runShellAction('refresh', '刷新') },
      {
        id: 'home', icon: 'spark', label: '回到首页',
        run: () => { const home = findNav('home'); if (home) openView(home); },
      },
      { id: 'palette', icon: 'search', label: '打开命令面板（Ctrl+K）', run: () => setPalOpen(true) },
      { id: 'sep1', sep: true },
      {
        id: 'copySel', icon: 'copy', label: `复制选中文本（${selectedText.length} 字）`,
        disabled: !selectedText, reason: field ? '输入框内没有选中文本' : '当前页面上没有选中文本',
        run: () => copyText(selected, `已复制选中文本（${selectedText.length} 字）。`),
      },
      {
        id: 'copyFile', icon: 'db', label: '复制当前页面文件',
        disabled: !active?.page, reason: '当前标签没有对应页面',
        run: () => { if (active?.page) copyText(PAGES[active.page].file, `已复制页面文件：${PAGES[active.page].file}`); },
      },
      { id: 'sep2', sep: true },
      {
        id: 'theme', icon: 'sun', label: '切换主题（跟随系统 → 浅色 → 深色）',
        run: () => setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system')),
      },
    ];
    if (hasLoginEntry) items.push({ id: 'login', icon: 'user', label: '登录 / 会话…', run: () => setLoginOpen(true) });
    openCtxMenu(x, y, `右键：${zone}`, 'shellmenu', items);
  }, [openCtxMenu, active?.page, copyText, runShellAction, openView]);

  /** 壳层根节点兜底监听：子区域已自行处理并 preventDefault 的直接放行，其余一律由壳层接管 */
  const onShellContextMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    openDefaultContext(e.clientX, e.clientY, e.target as HTMLElement | null);
  }, [openDefaultContext]);

  /** 中心页表格行右键：行必须是 `tr[data-testid^="row-"]`（真实账本行）才有行菜单，其余位置给页面菜单 */
  const openRowContext = useCallback((frame: HTMLIFrameElement, row: HTMLElement, ev: MouseEvent) => {
    const testId = row.getAttribute('data-testid') ?? '';
    const rowId = testId.startsWith('row-') ? testId.slice(4) : '';
    const text = (row.textContent ?? '').replace(/\s+/g, ' ').trim();
    const rect = frame.getBoundingClientRect();
    const scale = zoomRef.current / 100;
    const items: ContextMenuItem[] = [
      { id: 'select', icon: 'check', label: '选中该行（同步到属性检查器）', run: () => row.click() },
      {
        id: 'copyId', icon: 'copy', label: '复制记忆 ID',
        disabled: !rowId, reason: '该行没有 data-testid 记忆 ID',
        run: () => { if (rowId) copyText(rowId, `已复制记忆 ID：${rowId}`); },
      },
      {
        id: 'details', icon: 'info', label: '打开详情与回执',
        disabled: true, reason: '详情与回执由记忆管理页渲染（双击行打开）；壳层不复制页面详情面板',
      },
      {
        id: 'edit', icon: 'pen', label: '编辑正文',
        disabled: true, reason: '正文写操作在记忆管理页执行（需未锁定并二次确认）；壳层不代行写操作',
      },
      {
        id: 'layers', icon: 'layers', label: '查看分层内容',
        disabled: true, reason: '分层 L1–L6 内容由记忆管理页的分层视图读取；壳层不代读页面数据',
      },
      {
        id: 'audit', icon: 'book', label: '在审计面板查看该记忆',
        disabled: !rowId, reason: '该行没有记忆 ID，无法查审计',
        run: () => {
          if (!rowId) return;
          setDockOpen(true);
          setDockTab('audit');
          void refreshDockAudit(rowId);
        },
      },
      {
        id: 'copyRow', icon: 'copy', label: `复制该行文本（${text.length} 字）`,
        disabled: !text, reason: '该行为空，没有可复制文本',
        run: () => copyText(text, `已复制表格行文本（${text.length} 字）。`),
      },
      { id: 'sep1', sep: true },
      { id: 'forget', icon: 'x', label: '删除此记忆', disabled: true, reason: '壳层不代行页面写操作；请在记忆管理页内删除（保留二次确认）' },
    ];
    setCtxMenu({
      x: rect.left / scale + ev.clientX,
      y: rect.top / scale + ev.clientY,
      title: `表格行：${rowId || '未标注 ID'}`,
      testId: 'rowmenu',
      items,
    });
  }, [copyText, refreshDockAudit]);

  /** 中心页 iframe 内的非表格行右键：同样由壳层接管，给页面级真实动作，不漏原生菜单 */
  const openPageContext = useCallback((frame: HTMLIFrameElement, ev: MouseEvent) => {
    const rect = frame.getBoundingClientRect();
    const scale = zoomRef.current / 100;
    let doc: Document | null = null;
    try { doc = frame.contentDocument; } catch { doc = null; }
    const sel = (doc?.getSelection()?.toString() ?? '').trim();
    const page = active?.page;
    setCtxMenu({
      x: rect.left / scale + ev.clientX,
      y: rect.top / scale + ev.clientY,
      title: '中心页（iframe）',
      testId: 'framemenu',
      items: [
        { id: 'refresh', icon: 'refresh', label: '刷新全部页面（F5）', run: () => runShellAction('refresh', '刷新') },
        {
          id: 'home', icon: 'spark', label: '回到首页',
          run: () => { const home = findNav('home'); if (home) openView(home); },
        },
        { id: 'sep1', sep: true },
        {
          id: 'copySel', icon: 'copy', label: `复制页内选中文本（${sel.length} 字）`,
          disabled: !sel, reason: '页面内没有选中文本',
          run: () => copyText(sel, `已复制页内选中文本（${sel.length} 字）。`),
        },
        {
          id: 'copyFile', icon: 'db', label: '复制页面文件',
          disabled: !page, reason: '当前标签没有对应页面',
          run: () => { if (page) copyText(PAGES[page].file, `已复制页面文件：${PAGES[page].file}`); },
        },
        {
          id: 'source', icon: 'info', label: '查看页面来源',
          disabled: !page, reason: '当前标签没有对应页面',
          run: () => { if (page) setMessage(`页面 ${PAGES[page].file} · 数据来源：${PAGES[page].source}`); },
        },
      ],
    });
  }, [active?.page, copyText, runShellAction, openView]);

  /** 给同源 iframe 文档挂一次 contextmenu：全域接管（行→行菜单，其余→页面菜单），不留原生菜单；
   *  批次57：页面已自行 preventDefault 的右键（如记忆库行右键常驻详情菜单）壳层不再接管。 */
  const attachFrameContextMenu = useCallback((frame: HTMLIFrameElement) => {
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch {
      return;
    }
    if (!doc || bridgedDocs.current.has(doc)) return;
    bridgedDocs.current.add(doc);
    doc.addEventListener('contextmenu', (ev: Event) => {
      const target = ev.target as HTMLElement | null;
      // 先拦：iframe 内任何位置都不允许漏出原生菜单
      ev.preventDefault();
      // 批次57：页面已 preventDefault 的右键按页面自己的菜单走，壳层不再叠加
      if (ev.defaultPrevented && target?.closest?.('[data-testid^="memory-row-"]')) return;
      const row = target?.closest?.('tr[data-testid^="row-"]') as HTMLElement | null;
      if (row) openRowContext(frame, row, ev as MouseEvent);
      else openPageContext(frame, ev as MouseEvent);
    });
  }, [openRowContext, openPageContext]);

  const onCmdItem = useCallback((item: CmdItem) => {
    if (item.go) {
      const target = NAV.find((e): e is NavItem => e.kind === 'item' && (e.page === item.go || Boolean(e.children?.some((c) => c.page === item.go))));
      const base = target?.page === item.go ? target : target?.children?.find((c) => c.page === item.go) ?? {
        kind: 'item' as const, id: `page-${item.go}`, label: PAGES[item.go].label, icon: 'db' as IconName, page: item.go,
      };
      // 带 href 的命令要开新标签（例如「归档」与「全部记忆」是同一页面的不同初值），
      // 否则会复用旧标签把 iframe 留在未筛选的地址上。
      const withHref: NavItem = item.href
        ? { ...base, id: `${base.id}${item.href}`, label: item.label, href: item.href }
        : base;
      openView(withHref);
      return;
    }
    if (item.action) runShellAction(item.action, item.label);
  }, [openView, runShellAction]);

  // 顶部默认应用菜单已删除：快捷键动作由壳层执行（复制/粘贴/全选仍走 Chromium 原生编辑命令）。
  // 桌面端按键由主进程 before-input-event 捕获后发来（焦点在中心区 iframe 里也能生效）；
  // 浏览器模式没有这道桥，则由壳层自己监听 keydown。两条路径互斥，避免同一按键执行两次。
  const runShellShortcut = useCallback((action: ShellShortcutAction) => {
    if (action === 'refresh') { runShellAction('refresh', '刷新'); return; }
    if (action === 'search') { setPalOpen(true); return; }
    if (action === 'dock') { runShellAction('toggleDock', '底部面板'); return; }
    if (action === 'nav') { runShellAction('toggleNav', '功能导航'); return; }
    // v5-BC：Ctrl+Shift+I 折叠/展开属性检查器（与 QAT 按钮、右键菜单同一状态）
    if (action === 'inspector') { setInspCollapsed((v) => !v); return; }
    if (action.startsWith('quick')) {
      const idx = Number(action.slice(5)) - 1;
      const navId = QUICK_VIEWS[idx];
      const target = navId ? findNav(navId) : undefined;
      if (target) openView(target);
      return;
    }
    if (action === 'security') {
      const sec = NAV.find((n): n is NavItem => n.kind === 'item' && n.id === 'security');
      if (sec) openView(sec);
      return;
    }
    setKeysOpen(true);
  }, [openView, runShellAction]);

  useEffect(() => {
    const off = shellWindowBridge()?.onShortcut?.(runShellShortcut);
    return () => { off?.(); };
  }, [runShellShortcut]);

  useEffect(() => {
    if (IS_ELECTRON || typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      // 命令面板 / 快捷键帮助开着时：Esc 关闭，其余按键交给面板自身的键盘导航
      if (palOpen || keysOpen) {
        if (e.key === 'Escape') { e.preventDefault(); setPalOpen(false); setKeysOpen(false); }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === '?' || (e.shiftKey && key === '/')) { e.preventDefault(); setKeysOpen(true); return; }
      if (e.altKey) return;
      if (key === 'f5') { e.preventDefault(); runShellShortcut('refresh'); return; }
      if (key === 'f9') { e.preventDefault(); runShellShortcut('security'); return; }
      if (key === 'f1') { e.preventDefault(); runShellShortcut('help'); return; }
      if (mod && (key === 'f' || key === 'k')) { e.preventDefault(); runShellShortcut('search'); return; }
      if (mod && key === 'b') { e.preventDefault(); runShellShortcut('nav'); return; }
      if (mod && (key === '`' || key === '~')) { e.preventDefault(); runShellShortcut('dock'); return; }
      // v5-BC：浏览器模式同样支持 Ctrl+Shift+I 检查器（桌面端该键由主进程捕获，不走这里）
      if (mod && e.shiftKey && key === 'i') { e.preventDefault(); runShellShortcut('inspector'); return; }
      if (mod && key >= '1' && key <= '8') { e.preventDefault(); runShellShortcut(`quick${key}` as ShellShortcutAction); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runShellShortcut, palOpen, keysOpen]);

  const navEntries = useMemo(() => {
    // T3（§14.1）：「管理台」仅管理员可见；身份未确认（null）前同样不显示，避免成员登录前闪现。
    // 剔除后若治理组变孤立分组则一并清理。
    if (identity?.role !== 'admin') {
      return NAV
        .filter((e) => e.kind !== 'item' || e.id !== 'admin-console')
        .filter((e, i, all) => e.kind !== 'group' || (i + 1 < all.length && all[i + 1].kind === 'item'));
    }
    return NAV;
  }, [identity]);
  // v5 命令条面包屑：当前标签所属的导航分组名（按 NAV 顺序扫描，未命中时显示「工作台」）
  const activeNavGroup = useMemo(() => {
    let group = '';
    for (const e of navEntries) {
      if (e.kind === 'group') { group = e.label; continue; }
      if (e.id === activeId || e.page === active?.page
        || e.children?.some((c) => c.id === activeId || c.page === active?.page)) return group;
    }
    return '';
  }, [navEntries, activeId, active?.page]);

  /** 底部标签角标：只在真实读到数据后显示计数；未读/不可用一律不显示，绝不用 0 冒充 */
  const dockCounts: Record<BottomTabId, number | null> = {
    output: dockLog?.status === 'ok' ? dockLog.view.lines.length : null,
    problems: dockLog?.status === 'ok' ? problemsFromLog(dockLog.view).length : null,
    audit: selectionId && dockAudit?.status === 'ok' ? dockAudit.view.length : null,
    tasks: dockTasks?.status === 'ok' ? dockTasks.view.length : null,
  };

  // S7：状态栏各单元格的真实文案与可追溯 title
  const locView = status?.location?.status === 'ok' ? shortLocation(status.location.view) : null;
  const locText = !status?.location ? '读取中' : locView ? locView.text : '未知';
  const locTitle = status?.location?.status === 'ok' ? locView?.title ?? '' : status?.location ? status.location.detail : '尚未读取';

  const collector = status?.collector;
  const collectorText = !collector ? '读取中'
    : collector.status === 'ok' ? (collector.view.running ? '运行中' : '空闲')
    : collector.status === 'unavailable' ? '不可用' : '异常';
  const collectorTitle = !collector ? '尚未读取'
    : collector?.status === 'ok'
      ? `采集器${collector.view.running ? '正在跑' : '空闲'}${collector.view.intervalMs ? ` · 间隔 ${collector.view.intervalMs} ms` : ''}${collector.view.lastAt ? ` · 最近一轮 ${new Date(collector.view.lastAt).toLocaleString('zh-CN')}` : ' · 暂无已完成轮次'}${collector.view.lastCollected != null ? ` · 上轮采集 ${collector.view.lastCollected} 条` : ''}${collector.view.autoRetryStopped ? ` · 自动重试已停（连续失败 ${collector.view.consecutiveFails ?? '?'} 轮）` : ''}`
      : collector ? collector.detail : '尚未读取';

  const l0 = status?.l0;
  const l0w = status?.l0Write;
  // L0 有两把独立的锁（§4.4.4，互不替代），且**读它们的通道不同**：
  //   查阅锁 active_sessions（解密查阅会话）—— 走 l0:status，requireAdmin，成员读不到；
  //   写锁 write_unlocked（写密钥）—— 走 shared/l0WriteState → 内核 getWriteStatus，**成员也读得到**。
  // 口径一（2026-11-17 用户拍板）：解锁写密钥后本人可免审批直读自己的 L0 ——
  // 所以成员读不到查阅锁全貌时，只要写密钥已解锁就显示「本人可直读」，不对成员谎报「不可用」。
  const selfReadable = l0?.status !== 'ok' && l0w?.status === 'ok' && l0w.view.unlocked;
  const l0Text = !l0 && !l0w ? '读取中'
    : `查阅${!l0 ? '读取中'
      : l0.status === 'ok'
        ? (l0.view.active_sessions > 0 ? `${l0.view.active_sessions}会话` : '锁')
        : selfReadable ? '本人可直读' : '不可用'} · 写${!l0w ? '读取中'
      : l0w.status === 'ok' ? (l0w.view.unlocked ? '已解' : '锁') : '不可用'}`;
  const l0Title = !l0 && !l0w ? '尚未读取'
    : `L0 保险库：查阅锁（解密查阅会话）${l0?.status === 'ok'
      ? (l0.view.active_sessions > 0 ? `已开 ${l0.view.active_sessions} 个会话` : '锁定（无活跃查阅会话）')
      : selfReadable
        ? '全貌仅管理员可读；写密钥已解锁，本人条目可直读（免审批，归属校验在主进程）'
        : `读不到${l0 && 'detail' in l0 ? `（${l0.detail}）` : ''}`} · 写锁（写密钥）${l0w?.status === 'ok'
      ? (l0w.view.unlocked ? '已解锁' : '锁定')
      : `读不到${l0w && 'detail' in l0w ? `（${l0w.detail}）` : ''}`}${l0?.status === 'ok'
      ? ` · 有效授权 ${l0.view.active_grants} · 管理密钥${l0.view.has_admin_wrap ? '已设置' : '未设置'}`
      : ''}（两把锁互不替代，只读，不含任何密钥材料）`;

  const openNav = (id: string) => {
    const target = findNav(id);
    if (target) openView(target);
  };
  /** 批次54：L0 等不再占主导航的深链，仍从「记忆库」派生真实标签打开，不伪造独立页面。 */
  const openMemoryTab = (href: string, label: string) => {
    const base = findNav('memory-bank');
    if (base) openView({ ...base, id: `memory-bank${href}`, href, label });
  };
  // ── Ctrl+K 命令面板条目（v5）：原「文件/编辑/视图/工具/帮助」菜单 + Ribbon 全量命令收进面板；
  //    分组顺序见 views.ts PALETTE_GROUPS；无对应能力的命令置灰并写原因，绝不伪造执行结果。
  const paletteItems: PaletteItem[] = useMemo(() => {
    // 「转到页面」：全量导航项（含管理台按当前身份过滤后的口径），前 8 个快捷视图带 Ctrl+N 提示
    const goItems: PaletteItem[] = navEntries
      .filter((e): e is NavItem => e.kind === 'item')
      .map((n) => ({
        id: `nav-${n.id}`,
        group: '转到页面',
        label: n.label,
        icon: n.icon,
        desc: n.page ? PAGES[n.page].label : undefined,
        kbd: QUICK_VIEWS.includes(n.id) ? `Ctrl+${QUICK_VIEWS.indexOf(n.id) + 1}` : undefined,
        disabled: Boolean(n.unavailable),
        reason: n.unavailable,
        run: () => openView(n),
      }));
    const copyId = () => {
      if (!selectionId) return;
      const write = navigator.clipboard?.writeText(selectionId);
      if (!write) { setMessage('复制失败：剪贴板不可用。'); return; }
      write.then(() => setMessage(`已复制记忆 ID：${selectionId}`))
        .catch(() => setMessage('复制失败：剪贴板未授权。'));
    };
    const themeItems: PaletteItem[] = [
      { id: 'theme-system', group: '视图 · 布局', label: '主题：跟随系统', icon: 'system', disabled: theme === 'system', reason: '当前已是跟随系统', run: () => setTheme('system') },
      { id: 'theme-light', group: '视图 · 布局', label: '主题：浅色', icon: 'sun', disabled: theme === 'light', reason: '当前已是浅色', run: () => setTheme('light') },
      { id: 'theme-dark', group: '视图 · 布局', label: '主题：深色', icon: 'moon', disabled: theme === 'dark', reason: '当前已是深色', run: () => setTheme('dark') },
    ];
    return [
      ...goItems,
      // 原「文件」菜单
      { id: 'new-memory', group: '执行', label: '新建记忆', icon: 'plus', kbd: 'Ctrl+1 后选写入', run: () => openNav('write') },
      { id: 'open-library', group: '执行', label: '打开记忆库…', icon: 'folder', disabled: true, reason: '程序未提供库切换指令；数据根位置在「全局参数」页查看' },
      { id: 'login-session', group: '执行', label: '登录 / 会话…', icon: 'user', run: () => setLoginOpen(true) },
      { id: 'close-view', group: '执行', label: '关闭当前视图', icon: 'x', disabled: openTabs.length <= 1, reason: openTabs.length <= 1 ? '至少保留一个标签（概览）' : undefined, run: () => closeTab(activeId) },
      { id: 'quit', group: '执行', label: '退出', icon: 'x', disabled: true, reason: '请使用窗口右上角关闭按钮（系统覆盖层）' },
      // 原「编辑」菜单
      { id: 'undo', group: '执行', label: '撤销', icon: 'undo', kbd: 'Ctrl+Z', disabled: true, reason: '壳层不保存编辑历史' },
      { id: 'copy-id', group: '执行', label: '复制记忆 ID', icon: 'copy', disabled: !selectionId, reason: selectionId ? undefined : '中心页未选中记忆；先在列表选中一条记录', run: copyId },
      { id: 'select-all', group: '执行', label: '全选', icon: 'check', kbd: 'Ctrl+A', disabled: true, reason: '请在输入框内使用 Ctrl+A（系统编辑命令）' },
      { id: 'find', group: '执行', label: '查找（命令面板）', icon: 'search', kbd: 'Ctrl+F', run: () => setPalOpen(true) },
      { id: 'dispute', group: '工具 · 诊断直达', label: '冲突裁决', icon: 'warn', run: () => openNav('dispute') },
      { id: 'prefs', group: '工具 · 诊断直达', label: '首选项…', icon: 'gear', run: () => openNav('params') },
      // 布局动作（原「视图」菜单）
      { id: 'taskpane', group: '执行', label: taskOpen ? '隐藏任务窗格' : '显示任务窗格', icon: 'panel', run: () => runShellAction('toggleTaskPane', '任务窗格') },
      { id: 'inspector', group: '执行', label: inspCollapsed ? '显示属性检查器' : '隐藏属性检查器', icon: 'panel', kbd: 'Ctrl+Shift+I', run: () => setInspCollapsed((v) => !v) },
      { id: 'fold-nav', group: '执行', label: navCollapsed ? '展开功能导航' : '折叠功能导航', icon: 'chev', kbd: 'Ctrl+B', run: () => runShellAction('toggleNav', '功能导航') },
      { id: 'reset-layout', group: '执行', label: '重置布局', icon: 'refresh', run: () => runShellAction('resetLayout', '重置布局') },
      { id: 'refresh', group: '执行', label: '刷新', icon: 'refresh', kbd: 'F5', run: () => runShellAction('refresh', '刷新') },
      { id: 'dock', group: '执行', label: dockOpen ? '隐藏底部面板' : '显示底部面板', icon: 'panel', kbd: 'Ctrl+`', run: () => runShellAction('toggleDock', '底部面板') },
      { id: 'status', group: '执行', label: statusVisible ? '隐藏状态栏' : '显示状态栏', icon: 'info', run: () => runShellAction('toggleStatus', '状态栏') },
      { id: 'density', group: '执行', label: '紧凑密度', icon: 'table', run: () => runShellAction('density', '紧凑密度') },
      { id: 'zoom', group: '执行', label: '缩放（80%–125% 循环）', icon: 'gear', run: () => runShellAction('zoom', '缩放') },
      ...themeItems,
      { id: 'fold-ribbon', group: '视图 · 布局', label: '折叠功能区', icon: 'fold', kbd: 'Ctrl+F1', disabled: true, reason: '功能区已重构为 44px 上下文命令条，该命令不再需要' },
      // 原「工具」菜单
      { id: 'retrieval', group: '工具 · 诊断直达', label: '运行检索（只读）', icon: 'search', kbd: 'F6', run: () => openNav('retrieval') },
      { id: 'security-check', group: '工具 · 诊断直达', label: '安全体检', icon: 'shield', kbd: 'F9', run: () => openNav('security') },
      { id: 'growth-status', group: '工具 · 诊断直达', label: '生长调度状态', icon: 'layers', run: () => openNav('growth') },
      { id: 'agent-probe', group: '工具 · 诊断直达', label: 'Agent 通道探针', icon: 'agent', run: () => openNav('agent') },
      { id: 'write-receipt', group: '工具 · 诊断直达', label: '查看写入回执', icon: 'receipt', kbd: 'Ctrl+R', run: () => openNav('write') },
      { id: 'diag-logs', group: '工具 · 诊断直达', label: '打开诊断日志', icon: 'list', kbd: 'Ctrl+L', run: () => openNav('logs') },
      { id: 'balance-probe', group: '工具 · 诊断直达', label: '余额探测', icon: 'scale', kbd: 'F7', disabled: true, reason: '探测在「大模型配置」页内执行' },
      { id: 'sync-check', group: '工具 · 诊断直达', label: '同步检查', icon: 'sync', kbd: 'F8', disabled: true, reason: '同步检查在「同步中枢」视图执行' },
      { id: 'write-precheck', group: '工具 · 诊断直达', label: '写入预检', icon: 'check', disabled: true, reason: '程序未提供独立预检指令；在写入页内执行' },
      { id: 'dedup', group: '工具 · 诊断直达', label: '去重策略', icon: 'filter', disabled: true, reason: '程序未提供独立去重策略命令' },
      // 原「视图」菜单的深链
      { id: 'l0-cipher', group: '视图 · 布局', label: '显示 L0 密文', icon: 'lock', run: () => openMemoryTab('?tab=l0', 'L0 密文（需解锁）') },
      { id: 'layers-view', group: '视图 · 布局', label: '分层内容', icon: 'layers', run: () => openMemoryTab('?tab=layers', '分层内容') },
      { id: 'locked-rows', group: '视图 · 布局', label: '记忆列表（全部）', icon: 'list', run: () => openMemoryTab('?tab=all', '记忆库 · 全部') },
      { id: 'archived', group: '视图 · 布局', label: '归档（需登录）', icon: 'archive', disabled: !sessionActive, reason: sessionActive ? undefined : '未登录（会话 401）：该动作需要登录后才能执行', run: () => openMemoryTab('?tab=all&status=archived', '已归档') },
      // 原「帮助」菜单
      { id: 'keys-help', group: '帮助', label: '快捷键参考', icon: 'help', kbd: 'F1', run: () => setKeysOpen(true) },
      { id: 'caps', group: '帮助', label: '产品能力与限制', icon: 'info', run: () => setMessage('壳层只提供导航与布局；中心区为本机真实页面。未接线的部位会明确标注原因，不显示推测值。') },
      { id: 'cmd-list', group: '帮助', label: '命令清单', icon: 'list', run: () => setMessage('原菜单与功能区命令已全量收进命令面板（Ctrl+K）；无对应能力的项已置灰并在提示中写明原因。') },
      { id: 'demo-declare', group: '帮助', label: '演示数据声明', icon: 'check', run: () => setMessage('本程序全站零演示数据：读数来自本机真实链路，缺失或不可用一律如实标注。') },
      { id: 'check-update', group: '帮助', label: '检查更新', icon: 'refresh', disabled: true, reason: '程序未提供更新检查通道' },
      { id: 'about', group: '帮助', label: '关于 MemoryDesk 记忆工作台', icon: 'spark', run: () => setMessage('MemoryDesk 记忆工作台（多Agent记忆助手）。') },
    ];
  }, [navEntries, openView, selectionId, theme, taskOpen, inspCollapsed, navCollapsed, dockOpen,
    statusVisible, sessionActive, openTabs.length, activeId, closeTab, openNav, setMessage, runShellAction]);

  return (
    <div
      className={`shell${IS_ELECTRON ? ' electron' : ''}`}
      onContextMenu={onShellContextMenu}
      style={{
        // 导航折叠后不再归零宽度，改为窄图标栏（--nav-collapsed-w），树项只显示图标、悬停显示名称
        '--nav-w': `${navCollapsed ? NAV_COLLAPSED_W : navWidth}px`,
        '--nav-collapsed-w': `${NAV_COLLAPSED_W}px`,
        '--insp-w': `${inspCollapsed ? 0 : inspWidth}px`,
        '--dock-h': `${dockHeight}px`,
        '--shell-zoom': String(zoom / 100),
      } as CSSProperties}
    >
      {/* 顶部两段（STRATUM 1:1）：
          ① 46px 标题栏（strata 徽标 + 应用名 + 「层析 STRATUM」 / 中央命令框 Ctrl K /
             右侧三联主题 + ⚙ 首启向导 + 头像·角色 + 系统三按钮覆盖层；批次51 起工具簇整簇取消，
             登录/登出入口集中在头像弹窗与首页页头）
          ② 44px 上下文命令条（导航折叠 + 面包屑 + 当前视图高频命令；批次53 命令面板按钮取消）
          原菜单与 Ribbon 的全量命令收进 Ctrl+K 命令面板 */}
      <div className="titlebar" data-testid="shell-titlebar">
        <div className="tb-left">
          <span className="strata-logo" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
          <span className="app-name">MultiAgent Memory</span>
          <span className="tb-sub">层析 STRATUM</span>
          {/* T3（§14.1）：管理员登录后非首页给一键切回工作台（不改变任何数据权限） */}
          {identity?.role === 'admin' && activeId !== 'home' && (
            <button
              type="button"
              className="tb-tag ok"
              data-testid="shell-back-workbench"
              title="回到工作台首页（不改变数据可用性与权限）"
              onClick={() => {
                const homeNav = NAV.find((n): n is NavItem => n.kind === 'item' && n.id === 'home');
                if (homeNav) openView(homeNav);
              }}
            >回到工作台</button>
          )}
        </div>
        <button
          type="button"
          className="cmd-entry"
          data-testid="shell-cmd-entry"
          title="搜索页面或命令（Ctrl+K）：原菜单与功能区全量命令入口"
          aria-label="打开命令面板"
          onClick={() => setPalOpen(true)}
        >
          <Icon name="search" size={12} />
          <span>搜索页面或命令…</span>
          <span className="ce-hint">Ctrl K</span>
        </button>
        <div className="tb-right">
          {/* STRATUM：右侧三联主题切换（浅色/深色/随系统，选中项 accent 底 accent-ink 字） */}
          <span className="tb-themes" role="group" aria-label="主题" data-testid="shell-themes">
            {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
              <button
                key={m}
                className="tb-tbtn"
                aria-pressed={theme === m}
                aria-label={m === 'system' ? '随系统' : m === 'light' ? '浅色' : '深色'}
                title={m === 'system' ? '随系统（跟随系统深浅色）' : m === 'light' ? '浅色主题' : '深色主题'}
                onClick={() => setTheme(m)}
                type="button"
              >{m === 'system' ? '随系统' : m === 'light' ? '浅色' : '深色'}</button>
            ))}
          </span>
          {/* STRATUM：⚙ 首启向导入口直达 setup */}
          <button
            type="button"
            className="tb-wizard"
            data-testid="shell-wizard"
            title="打开首启向导（setup）：两库位置 / L0 管理密码 / 恢复卡"
            onClick={() => { const w = findNav('setup'); if (w) openView(w); }}
          >⚙ 首启向导</button>
          {/* STRATUM：头像 24px 圆（accent 底白字）+ 「admin · 管理员」；点击打开登录 / 会话弹窗 */}
          <button
            type="button"
            className="tb-avatar"
            data-testid="shell-avatar"
            aria-label={identity
              ? `账号 ${identity.user_id} · 团队 ${identity.team_id} · 角色 ${identity.role === 'admin' ? '管理员' : '成员'}`
              : sessionActive ? '本机会话标记存在，身份尚未经 /api/me 确认' : '未登录'}
            title={identity
              ? `账号 ${identity.user_id} · 团队 ${identity.team_id} · 角色 ${identity.role === 'admin' ? '管理员' : '成员'}（点击查看 / 登出）`
              : sessionActive
                ? '本机会话标记存在（localStorage），身份尚未经 /api/me 确认（点击打开登录 / 会话弹窗）'
                : '未登录：点击打开登录弹窗（真实 POST /api/login）'}
            onClick={() => setLoginOpen(true)}
          >{(identity?.user_id || (sessionActive ? 'U' : '?')).slice(0, 1).toUpperCase()}</button>
          <span
            className="tb-role"
            data-testid="shell-role"
            title={identity ? `账号 ${identity.user_id} · 团队 ${identity.team_id}` : '未确认身份'}
          >{identity
            ? `${identity.role === 'admin' ? 'admin · 管理员' : 'member · 成员'}`
            : (sessionActive ? '已登录 · 待确认' : '只读会话')}</span>
        </div>
        {/* 右端留给系统三按钮覆盖层：这里只占位，不重复造窗口按钮 */}
        <div className="win-space" aria-hidden="true" />
      </div>

      {/* 44px 上下文命令条：只放当前视图的高频命令（壳层真实能力：跳转 / 壳层动作），不伪造业务结果 */}
      <div className="cmdbar" data-testid="shell-cmdbar" aria-label="上下文命令条">
        <button
          type="button"
          className="cb-icon"
          data-testid="cmdbar-nav-toggle"
          title={navCollapsed ? '展开功能导航（Ctrl+B）' : '折叠功能导航（Ctrl+B）'}
          aria-label={navCollapsed ? '展开功能导航' : '折叠功能导航'}
          onClick={() => setNavCollapsed((v) => !v)}
        ><Icon name={navCollapsed ? 'chev' : 'fold'} size={13} /></button>
        <div className="cb-crumbs">
          <span className="cb-crumb">{activeNavGroup || '工作台'}</span>
          <span className="cb-crumb-sep" aria-hidden="true">/</span>
          <span className="cb-crumb cur">{active?.label ?? '首页'}</span>
        </div>
        <span className="cb-div" aria-hidden="true" />
        {(active?.page ? CMDS[active.page] ?? [] : []).map((c) => (
          <button
            key={c.label}
            type="button"
            className={`cb-cmd${c.primary ? ' primary' : ''}`}
            data-testid={`cb-cmd-${c.label}`}
            title={c.go ? `打开「${PAGES[c.go].label}」` : `${c.label}${c.kbd ? `（${c.kbd}）` : ''} · 壳层动作`}
            onClick={() => onCmdItem(c)}
          >
            <Icon name={c.icon} size={13} />
            {c.label}
            {c.kbd && <span className="cb-kbd">{c.kbd}</span>}
          </button>
        ))}
        {/* 批次53：命令条右侧「命令 Ctrl K」按钮已取消（用户 2026-11-21）；命令面板仍由 Ctrl+K 与标题栏搜索框打开 */}
      </div>

      <div className={`workspace${dockOpen ? '' : ' dock-closed'}`}>
        <aside className={`nav-pane${navCollapsed ? ' collapsed' : ''}`} aria-label="功能导航">
          <div className="pane-head">
            功能导航
            <span className="ph-tools">
              {/* v5 设计稿：头部工具 = 新建记忆 + 折叠（无前置图标） */}
              <button className="ph-btn" onClick={() => openNav('write')} title="新建记忆（打开写入页）" type="button" data-testid="nav-new-memory">
                <Icon name="plus" size={14} />
              </button>
              <button className="ph-btn" onClick={() => setNavCollapsed((v) => !v)} title="折叠导航窗格" type="button" data-testid="nav-collapse-toggle">
                <Icon name="chev" size={12} />
              </button>
            </span>
          </div>
          <div className="tree">
            {navEntries.map((entry) => entry.kind === 'group' ? (
              // 折叠态：组标题退化为一条细分隔线（不占文字宽度），组内项靠图标区分
              navCollapsed
                ? <div className="tree-group collapsed" key={`g-${entry.label}`} title={entry.label} />
                : <div className="tree-group" key={`g-${entry.label}`}>{entry.label}</div>
            ) : (
              <NavTreeItem
                key={entry.id}
                item={entry}
                activeId={activeId}
                open={openParents[entry.id] ?? false}
                counts={mergedNavCounts}
                collapsed={navCollapsed}
                onToggle={() => setOpenParents((p) => ({ ...p, [entry.id]: !(p[entry.id] ?? false) }))}
                onSelect={openView}
                onMenu={openNavContext}
              />
            ))}
            {navEntries.length === 0 && <div className="tree-note">没有匹配的功能项。</div>}
          </div>
          {/* 批次53：层级刻度固定在功能导航栏最下面，不随导航树滚动 */}
          {/* REQ-014 / T7：真实状态卡（写入兜底 / 补炼队列 / 采集），空闲时整块不渲染 */}
          {!navCollapsed && (
            <ShellStatusCard />
          )}
          {!navCollapsed && (
            <StrataScale data={strataScale} onRefresh={refreshOverview} />
          )}
          {!navCollapsed && (
            <div className="splitter" role="separator" aria-label="调整导航宽度" onPointerDown={(e) => startDrag('nav', e)} />
          )}
        </aside>

        {navCollapsed && (
          <button
            className="nav-reopen" type="button"
            title="展开功能导航（Ctrl+B）" aria-label="展开功能导航"
            data-testid="nav-reopen"
            onClick={() => setNavCollapsed(false)}
          ><Icon name="chev" size={14} /></button>
        )}

        <main className="center-pane" aria-label="工作区中心">
          <div className="tabstrip">
            {openTabs.map((t) => (
              <div
                key={t.id}
                className={`vtab${t.id === activeId ? ' active' : ''}`}
                onClick={() => setActiveId(t.id)}
                onContextMenu={(e) => openTabContext(t, e)}
                data-testid={`shell-tab-${t.id}`}
              >
                {t.label}
                <button
                  className="vtab-close"
                  title="关闭标签"
                  onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                  type="button"
                ><Icon name="x" size={9} /></button>
              </div>
            ))}
          </div>

          {/* 未登录只读提示只由概览读取失败条统一给出：storage IPC 未登录一律拒绝，
              旧灰条「本地账本仍可读」与真实能力矛盾，已移除，避免同屏重复提醒（2026-11-16） */}
          {active?.page === 'home' && overview?.storageError && (
            <div className="ov-error-strip" data-testid="overview-storage-error">
              账本暂时读不到（不是空的）：{humanErrorText(overview.storageError)}。请登录或稍后重试。
            </div>
          )}

          {showLayerStrip && (
            <div className="layer-strip" data-testid="layer-strip" title="与中心层级页同源：storage.listMemories + storage.browse(L1–L6) + l0Status">
              <Icon name="layers" size={12} />
              <b>分层 L1–L6</b>
              {!layerPanel ? (
                <span className="ls-note">读取中…</span>
              ) : layerPanel.status !== 'ok' ? (
                <span className="ls-note err" data-testid="layer-strip-error">读取失败：{humanErrorText(layerPanel.detail)}</span>
              ) : (
                <>
                  <span className="ls-total">账本 <b>{layerPanel.view.total}</b> 条</span>
                  <span className="ls-note">{layerPanel.view.kernelMode === 'browser' ? '浏览器内存账本（非本机库）' : '本机账本'}</span>
                  {layerPanel.view.layers.map((l) => (
                    <span className={`ls-cell${l.count == null ? ' err' : ''}`} key={l.layer}
                      title={l.count == null ? `storage.browse(${l.layer}) 读取失败（不是 0 条）` : `${l.layer} 有内容的记忆数（storage.browse ${l.layer}）`}>
                      {l.layer} <b>{l.count == null ? '读取失败' : l.count}</b>
                    </span>
                  ))}
                  <span className={`ls-cell${layerPanel.view.l0.status === 'ok' && layerPanel.view.l0.view.active_sessions > 0 ? ' ok' : ''}`}
                    data-testid="layer-strip-l0"
                    title={layerPanel.view.l0.status === 'ok'
                      ? `L0 保险库：活动会话 ${layerPanel.view.l0.view.active_sessions} · 有效授权 ${layerPanel.view.l0.view.active_grants} · 写锁${layerPanel.view.l0Write.status === 'ok' ? (layerPanel.view.l0Write.view.unlocked ? '已解锁' : '锁定') : '读不到'}`
                      : layerPanel.view.l0.detail}>
                    L0 <b>{layerPanel.view.l0.status === 'ok'
                      ? (layerPanel.view.l0.view.active_sessions > 0 ? `${layerPanel.view.l0.view.active_sessions} 会话` : '已锁定')
                      : '不可用'}</b>
                  </span>
                  <span className="ls-note">失败层显示「读取失败」而非 0；L0 只读状态，不含密钥材料</span>
                  <button className="ls-refresh" type="button" onClick={() => setLayerPanel(null)} title="重新读取分层计数">
                    <Icon name="refresh" size={11} />重读
                  </button>
                </>
              )}
            </div>
          )}

          <div className="center-body">
            {openTabs.map((t) => {
              if (t.unavailable) {
                return (
                  <div key={t.id} className={`page-pane${t.id === activeId ? ' active' : ''}`}>
                    <div className="shell-empty">
                      <Icon name="lock" size={26} />
                      <div className="se-title">{t.label} · 不可用</div>
                      <div className="se-body">{t.unavailable}</div>
                      <div className="se-note">此处不显示任何计数或回执，避免把不可用状态伪装成有效数据。</div>
                    </div>
                  </div>
                );
              }
              if (!t.page) return null;
              return (
                <div key={t.id} className={`page-pane${t.id === activeId ? ' active' : ''}`}>
                  <iframe
                    key={t.id === 'home' ? `${t.id}-${reloadNonce}-${homeReloadNonce}` : `${t.id}-${reloadNonce}`}
                    ref={(el) => { frameRefs.current[t.id] = el; }}
                    className="page-frame"
                    title={`${t.label} · ${PAGES[t.page].file}`}
                    src={pageUrl(t.page, t.href)}
                    onLoad={(e) => attachFrameContextMenu(e.currentTarget)}
                  />
                </div>
              );
            })}
          </div>

          <div className="center-foot">
            <span className="cf-strong">同源真实页面</span>
            <span>{active?.page ? PAGES[active.page].file : `${active?.label ?? '未选择'} · 不可用`}</span>
            <span className="cf-right">数据来源：{active?.page ? PAGES[active.page].source : '程序暂无该数据模型'}</span>
          </div>
        </main>

        {inspCollapsed && (
          <button
            className="insp-reveal"
            type="button"
            data-testid="qa-inspector-expand"
            aria-label="展开属性检查器"
            title="展开属性检查器：查看中心页回传的真实字段与审计联动"
            onClick={() => setInspCollapsed(false)}
          >
            <Icon name="panel" size={12} />
            <span>属性检查器</span>
          </button>
        )}
        {!inspCollapsed && (
          <div className="splitter" role="separator" aria-label="调整检查器宽度" onPointerDown={(e) => startDrag('insp', e)} />
        )}
        <div className={`right-col${inspCollapsed ? ' collapsed' : ''}`}>
          {taskOpen && (
            <section className="taskpane" aria-label="任务窗格">
              <div className="tp-head">
                <span className="ph-ic"><Icon name="panel" /></span>
                任务窗格
                <span className="tp-spring" />
                <button className="tp-x" onClick={() => setTaskOpen(false)} title="关闭任务窗格" type="button">✕</button>
              </div>
              <div className="tp-body">
                <div className="tp-sec">
                  <div className="tp-sec-title">
                    <b>待重放写入</b>
                    <button className="tp-mini" onClick={() => { void refreshPending(); }} disabled={pendingBusy} type="button">
                      {pendingBusy ? '读取中' : '刷新'}
                    </button>
                  </div>
                  {!pending ? (
                    <div className="tp-note">尚未读取：打开任务窗后经宿主桥读取一次主进程返回值（只读，不产生任何写入）。</div>
                  ) : pending.status === 'unavailable' ? (
                    <div className="tp-note" data-testid="pending-unavailable">{pending.detail}</div>
                  ) : pending.status === 'error' ? (
                    <div className="tp-note red" data-testid="pending-error">读取失败：{humanErrorText(pending.detail)}</div>
                  ) : (
                    <>
                      <div className="tp-count" data-testid="pending-count">
                        共 <b>{pending.view.count}</b> 条待重放
                        {pending.view.truncated ? `（仅展示最近 ${pending.view.items.length} 条）` : ''}
                      </div>
                      {pending.view.count === 0 ? (
                        <div className="tp-note">队列为空：当前没有因 L0 写密钥未解锁而暂存的写入。</div>
                      ) : (
                        <div className="tp-list">
                          {pending.view.items.map((it) => (
                            <div className="tp-item" key={it.id} data-testid="pending-item">
                              <div className="tp-item-id">{it.id}</div>
                              <div className="tp-item-meta">
                                {new Date(it.created_at).toLocaleString('zh-CN')} · 项目 {it.project_id} · 来源 {it.source_agent ?? '未标注（请求无 source_agent）'} · {it.category}
                              </div>
                              <div className="tp-item-meta">
                                正文 {it.content_chars} 字 · 标签 {it.tags} 个
                                {it.importance != null ? ` · 重要度 ${it.importance}` : ''}
                                {it.confidence != null ? ` · 置信度 ${it.confidence}` : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="tp-note">
                        {pending.view.source}；{pending.view.note}（读取于 {new Date(pending.view.captured_at).toLocaleString('zh-CN')}）
                      </div>
                    </>
                  )}
                </div>
                <div className="tp-sec">
                  <div className="tp-sec-title"><b>写入草稿</b></div>
                  <div className="tp-note">程序没有可在壳内编辑的写入草稿模型；新建记忆请在「写入」页完成（同一真实链路）。</div>
                  <button className="btn" onClick={() => {
                    const write = findNav('write');
                    if (write) openView(write);
                  }} type="button">打开写入页</button>
                </div>
              </div>
            </section>
          )}
          <aside className={`inspector-pane${inspCollapsed ? ' collapsed' : ''}`} aria-label="属性检查器" onContextMenu={openInspContext} data-testid="shell-inspector">
            <div className="pane-head">
              <span className="ph-ic"><Icon name="panel" /></span>
              属性检查器
              <span className="ph-tools">
                <button
                  className="ph-btn"
                  data-testid="qa-inspector-collapse"
                  aria-label="收起属性检查器"
                  onClick={() => setInspCollapsed(true)}
                  title="收起属性检查器（Ctrl+Shift+I）：把右侧空间让给中心页（选中与审计联动保留）"
                  type="button"
                >
                  <Icon name="chev" size={12} />
                </button>
              </span>
            </div>
            <div className="insp">
              {activeNav?.unavailable ? (
                <div className="insp-head">
                  <div className="insp-bc">工作区 / {activeNav.label}</div>
                  <div className="insp-title">{activeNav.label}</div>
                  <div className="insp-sub"><Icon name="warn" size={12} /> 不可用</div>
                </div>
              ) : active ? (
                <div className="insp-head">
                  <div className="insp-bc">工作区 / {active.label}</div>
                  <div className="insp-title">{active.label}</div>
                  <div className="insp-sub">真实页面 · iframe 嵌入</div>
                </div>
              ) : null}
              {activeNav?.unavailable ? (
                <div className="insp-note red">{activeNav.unavailable}</div>
              ) : active?.page ? (
                <>
                  <div className="insp-sec">
                    <div className="insp-sec-title">页面</div>
                    <Prop k="页面文件" v={PAGES[active.page].file} mono />
                    <Prop k="数据来源" v={PAGES[active.page].source} />
                    <Prop k="嵌入方式" v="同源 iframe" />
                    <Prop k="地址参数" v={location.search ? '已透传 backend 参数' : '未带后端参数'} />
                  </div>
                  <div className="insp-sec">
                    <div className="insp-sec-title">选中项</div>
                    {selection ? (
                      <>
                        <div className="insp-note">
                          <b>{selection.title}</b>
                          {selection.subtitle ? ` · ${selection.subtitle}` : ''}
                        </div>
                        {selection.fields.map((f) => (
                          <Prop key={f.k} k={f.k} v={f.v} mono={f.mono} />
                        ))}
                        <div className="insp-note">来源：{selection.page} 回传的真实账本字段，壳层未加工。</div>
                      </>
                    ) : (
                      <div className="insp-note">中心页尚未回传选中项：在真实页面选中一条记录后，其账本字段会原样显示在此；没有回传时此处保持为空，不做推测。</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="insp-note">未选择视图。</div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {dockOpen && <div className="dock-resizer" role="separator" aria-label="调整底部面板高度" onPointerDown={(e) => startDrag('dock', e)} />}
      <section className={`bottom-panel${dockOpen ? '' : ' collapsed'}`} aria-label="输出与诊断面板">
        <div className="bp-head">
          {BOTTOM_TABS.map((t) => (
            <button
              key={t.id}
              className={`bp-tab${dockTab === t.id ? ' active' : ''}`}
              onClick={() => { setDockTab(t.id); setDockOpen(true); }}
              type="button"
            >
              <Icon name={t.icon} size={12} />{t.label}
              {dockCounts[t.id] != null && <span className="bn">{dockCounts[t.id]}</span>}
            </button>
          ))}
          <span className="bp-spring" />
          <button className="bp-tool" onClick={() => setDockOpen((v) => !v)} title="折叠 / 展开底部面板" type="button">
            <Icon name="panel" size={12} />
          </button>
        </div>
        {dockOpen && (
          <div className="bp-body">{renderDockBody()}</div>
        )}
      </section>

      {statusVisible && (
        <div className="statusbar">
          <span
            className="sb-cell sb-accent click"
            data-testid="sb-session"
            onClick={() => setLoginOpen(true)}
            title={identity
              ? `账号 ${identity.user_id} · 团队 ${identity.team_id} · 角色 ${identity.role === 'admin' ? '管理员' : '成员'}（点击查看 / 登出）`
              : sessionActive
                ? '本机会话标记存在；身份未经 /api/me 确认（点击打开登录 / 会话弹窗）'
                : '未登录：点击打开登录弹窗（真实 POST /api/login）'}
          >
            <span className={`dot ${sessionActive ? 'ok' : 'err'}`} />
            会话 <b>{identity ? `${identity.user_id} · ${identity.team_id}` : (sessionActive ? '已登录' : '未登录')}</b>{sessionActive ? '' : ' · 只读'}
          </span>
          <span className="sb-cell sb-msg" data-testid="sb-msg">{message}</span>
          <span className="sb-cell" title={locTitle} data-testid="sb-storage">库 <b>{locText}</b></span>
          <span className="sb-cell click" onClick={refreshOverview}
            title={`重新读取真实账本/健康/成本${overview ? ` · 上次 ${new Date(overview.loadedAt).toLocaleTimeString('zh-CN')}` : ''}`}
            data-testid="sb-overview-refresh">
            概览 <b>{overviewBusy ? '读取中' : overview ? '已读' : '未读'}</b>
          </span>
          <span className={`sb-cell${overview?.billing.status === 'unavailable' ? ' warn' : ''}`}
            title={overview?.billing.detail ?? '尚未查询'} data-testid="sb-billing">
            成本 <b>{overview?.billing.status === 'ok' ? `${overview.billing.live ?? 0}/${overview.billing.total ?? 0}` : '不可用'}</b>
          </span>
          <span className={`sb-cell${collector?.status === 'ok' && collector.view.autoRetryStopped ? ' warn' : ''}`}
            title={collectorTitle} data-testid="sb-bg">后台 <b>{collectorText}</b></span>
          <span className={`sb-cell${l0?.status === 'ok' && l0.view.active_sessions > 0 ? ' ok' : ''}`}
            title={l0Title} data-testid="sb-l0">L0 <b>{l0Text}</b></span>
          <span className="sb-spring" />
          <span className="sb-cell" title={selectionId ? `已选记忆 ${selectionId}` : '中心页未选中任何记忆'} data-testid="sb-selected">
            已选 <b>{selectionId ? '1 条' : '无'}</b>
          </span>
          <span className="sb-cell" title="壳层实际行高（CSS --row-h）">行高 <b>{density === 'compact' ? 22 : 26}</b> px</span>
          <span className="sb-cell">{zoom}%</span>
          <span className="sb-cell click" onClick={() => setDockOpen((v) => !v)} title="折叠 / 展开底部面板">面板 <b>{dockOpen ? '开' : '收'}</b></span>
          <span className="sb-cell click" onClick={() => setTaskOpen((v) => !v)} title="任务窗格">任务窗 <b>{taskOpen ? '开' : '收'}</b></span>
        </div>
      )}

      {/* 登录改弹窗：标题栏工具簇 / 登录状态处两处入口共用这一个实例 */}
      <ShellLoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} onSession={onLoginSession} />
      {/* v5：Ctrl+K 命令面板 —— 原菜单栏 + Ribbon 全量命令的常驻入口 */}
      <CommandPalette open={palOpen} items={paletteItems} onClose={() => setPalOpen(false)} />
      {/* v5：快捷键帮助浮层（F1 / ?） */}
      {keysOpen && (
        <div className="keys-mask" data-testid="shell-keys" onPointerDown={(e) => { if (e.target === e.currentTarget) setKeysOpen(false); }}>
          <div className="keys-box" role="dialog" aria-label="快捷键参考">
            <div className="keys-head">
              <Icon name="help" size={14} />
              快捷键参考
              <span className="pal-esc" style={{ marginLeft: 'auto' }}>Esc 关闭</span>
            </div>
            <div className="keys-body">
              {([
                ['Ctrl K', '命令面板：搜索页面或命令（原菜单 + Ribbon 全量入口）'],
                ['Ctrl 1..8', '切换前 8 个视图：首页 / 记忆库 / 写入 / 检索 / 大模型配置 / 账号与安全 / 审计日志 / 日志记录'],
                ['Ctrl B', '折叠 / 展开左侧功能导航'],
                ['Ctrl `', '显示 / 隐藏底部面板'],
                ['Ctrl Shift I', '折叠 / 展开右侧属性检查器'],
                ['F5', '刷新全部页面与读数'],
                ['F6', '打开「检索」视图（只读检索）'],
                ['F9', '打开「账号与安全」视图'],
                ['F1 或 ?', '本快捷键参考'],
                ['Esc', '关闭面板 / 浮层 / 弹窗'],
              ] as const).map(([k, d]) => (
                <div className="keys-row" key={k}>
                  <span className="kkbd">{k}</span>
                  <span>{d}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* 右键菜单：导航树 / 标签条 / 检查器 / 中心页表格行共用同一个渲染器 */}
      <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
    </div>
  );

  /** S6：底部面板正文（四标签，只渲染真实读取结果；不可用就说原因，不补数字） */
  function renderDockBody() {
    if (dockTab === 'output' || dockTab === 'problems') return renderLogTab(dockTab === 'problems');
    if (dockTab === 'tasks') return renderTasksTab();
    return renderAuditTab();
  }

  function renderLogTab(isProblems: boolean) {
    const data = dockLog;
    return (
      <>
        <div className="bp-note">
          <Icon name={isProblems ? 'warn' : 'receipt'} size={11} />
          {isProblems
            ? '最近运行中发生的事：先看发生了什么、对你有什么影响、要不要处理；原始技术字段收在「技术详情」里'
            : `最近 ${data?.status === 'ok' ? data.view.scanLines : 50} 条运行记录 · 只读，不修改任何数据`}
          <span className="bp-spring" />
          <button className="bp-tool" type="button" onClick={() => { void refreshDockLog(); }} disabled={dockLogBusy}>
            <Icon name="refresh" size={11} />{dockLogBusy ? '读取中' : '刷新'}
          </button>
        </div>
        {!data ? (
          <div className="bp-empty">尚未读取：首次打开该标签时经宿主桥尾读一次真实日志。</div>
        ) : data.status === 'unavailable' ? (
          <div className="bp-empty" data-testid="dock-log-unavailable"><Icon name="broken" size={20} /><div>{data.detail}</div></div>
        ) : data.status === 'error' ? (
          <div className="bp-empty err" data-testid="dock-log-error"><Icon name="warn" size={20} /><div>读取失败：{humanErrorText(data.detail)}</div></div>
        ) : isProblems ? renderProblems(data.view) : renderLogLines(data.view)}
      </>
    );
  }

  function renderProblems(view: OutputLogView) {
    const rows = problemsFromLog(view);
    if (rows.length === 0) {
      return (
        <div className="bp-empty" data-testid="dock-problems-empty">
          <Icon name="check" size={20} />
          <div>{problemsIntro(0, 0)}</div>
        </div>
      );
    }
    const actionable = countActionableProblems(rows);
    return (
      <>
        <div className="bp-note" data-testid="dock-problems-intro">
          <Icon name="warn" size={11} />
          {problemsIntro(rows.length, actionable)}
        </div>
        {rows.map((r, i) => {
          const h = humanizeLogLine(r);
          return (
            <div className={`bp-row hb sev-${h.severity} lv-${r.level}`} data-testid="dock-problem-row" key={`${r.ts ?? i}-${i}`}>
              <span className="bpr-time">{formatLogClock(r.ts)}</span>
              <span className={`bpr-lv ${h.severity}`}>{h.severity === 'action' ? '需处理' : '提醒'}</span>
              <span className="bpr-body">
                <span className="bpr-title" data-testid="dock-problem-title">{h.title}</span>
                <span className="bpr-sub">影响：{h.effect} · 处理：{h.todo}</span>
                {h.hasTech && (
                  <details className="bpr-tech" data-testid="dock-tech-details">
                    <summary>技术详情</summary>
                    <code>{h.tech}</code>
                  </details>
                )}
              </span>
            </div>
          );
        })}
        <div className="bp-foot">以上来自最近 {view.lines.length} 条真实运行记录；只是提醒的条目不会影响数据，也不需要你操作。</div>
      </>
    );
  }

  function renderLogLines(view: OutputLogView) {
    if (view.lines.length === 0) {
      return (
        <div className="bp-empty" data-testid="dock-log-empty">
          <Icon name="receipt" size={20} />
          <div>最近还没有运行记录（有操作后会自动留痕）。</div>
        </div>
      );
    }
    return (
      <>
        {view.lines.map((l, i) => {
          // 技术详情保留原始行；若解析行的 raw 不含 message（单测/异常解析），补上真实 message
          const tech = l.message && !l.raw.includes(l.message) ? `${l.raw} · ${l.message}` : l.raw;
          return (
            <div className={`bp-row hb out lv-${l.level}`} data-testid="dock-log-row" key={`${l.ts ?? i}-${i}`}>
              <span className="bpr-time">{formatLogClock(l.ts)}</span>
              <span className={`bpr-lv ${l.level}`}>{l.level === 'unknown' ? '记录' : l.level === 'error' ? '异常' : l.level === 'warn' ? '提醒' : '正常'}</span>
              <span className="bpr-title" data-testid="dock-log-title">{humanActionLabel(l.scope, l.action)}</span>
              <details className="bpr-tech inline" data-testid="dock-tech-details">
                <summary>技术详情</summary>
                <code>{tech}</code>
              </details>
            </div>
          );
        })}
        <div className="bp-foot">
          共 {view.lines.length} 条 · 读取于 {new Date(view.capturedAt).toLocaleTimeString('zh-CN')} · 展开「技术详情」可看原始记录
          {view.path && (
            <details className="bpr-tech inline">
              <summary>日志文件</summary>
              <code>{view.path}</code>
            </details>
          )}
        </div>
      </>
    );
  }

  function renderTasksTab() {
    return (
      <>
        <div className="bp-note">
          <Icon name="clock" size={11} />
          调度与运行记录 · 账本 action=schedule_run · 最多 20 条 · 没有记录=尚未运行（不补演示任务）
          <span className="bp-spring" />
          <button className="bp-tool" type="button" onClick={() => { void refreshDockTasks(); }} disabled={dockTasksBusy}>
            <Icon name="refresh" size={11} />{dockTasksBusy ? '读取中' : '刷新'}
          </button>
        </div>
        {!dockTasks ? (
          <div className="bp-empty">尚未读取。</div>
        ) : dockTasks.status === 'unavailable' ? (
          <div className="bp-empty" data-testid="dock-tasks-unavailable"><Icon name="broken" size={20} /><div>{dockTasks.detail}</div></div>
        ) : dockTasks.status === 'error' ? (
          <div className="bp-empty err" data-testid="dock-tasks-error"><Icon name="warn" size={20} /><div>读取失败：{humanErrorText(dockTasks.detail)}</div></div>
        ) : dockTasks.view.length === 0 ? (
          <div className="bp-empty" data-testid="dock-tasks-empty">
            <Icon name="clock" size={20} />
            <div>账本里暂无 schedule_run 记录（调度尚未触发或已在生长配置中停用）——这是真实空集。</div>
          </div>
        ) : (
          <>
            {dockTasks.view.map((r) => (
              <div className={`bp-row${r.status === 'error' ? ' lv-error' : ''}`} data-testid="dock-task-row" key={r.requestId}>
                <span className="bpr-time">{r.startedAt ? new Date(r.startedAt).toLocaleString('zh-CN') : '未记录时间'}</span>
                <span className="bpr-tag">{r.label}</span>
                <span className="bpr-msg">
                  触发 {r.trigger} · 状态 {r.status}
                  {r.durationMs != null ? ` · 耗时 ${r.durationMs} ms` : ' · 耗时未记录'}
                  {r.nextDueAt != null ? ` · 下次到期 ${new Date(r.nextDueAt).toLocaleString('zh-CN')}` : ' · 下次到期未记录'}
                  {r.error ? ` · 错误 ${r.error}` : ''}
                </span>
              </div>
            ))}
            <div className="bp-foot">来源：内核审计 action=schedule_run（主进程 cron 真实执行记录）。</div>
          </>
        )}
      </>
    );
  }

  function renderAuditTab() {
    if (!selectionId) {
      return (
        <>
          <div className="bp-note"><Icon name="book" size={11} />审计 = 当前选中对象的账本审计行 · 未选中对象</div>
          <div className="bp-empty" data-testid="dock-audit-no-selection">
            <Icon name="book" size={20} />
            <div>在「全部记忆」或「分层 L1–L6」选中一条记录后，这里只显示提及该记忆 ID 的真实审计行；没有选中就不查询、不显示任何计数。</div>
          </div>
        </>
      );
    }
    return (
      <>
        <div className="bp-note">
          <Icon name="book" size={11} />当前对象 <b>{selectionId}</b> · 只显示提及该 ID 的审计行
          <span className="bp-spring" />
          <button className="bp-tool" type="button" onClick={() => { void refreshDockAudit(selectionId); }} disabled={dockAuditBusy}>
            <Icon name="refresh" size={11} />{dockAuditBusy ? '读取中' : '刷新'}
          </button>
        </div>
        {!dockAudit ? (
          <div className="bp-empty">尚未读取。</div>
        ) : dockAudit.status === 'unavailable' ? (
          <div className="bp-empty" data-testid="dock-audit-unavailable"><Icon name="broken" size={20} /><div>{dockAudit.detail}</div></div>
        ) : dockAudit.status === 'error' ? (
          <div className="bp-empty err" data-testid="dock-audit-error"><Icon name="warn" size={20} /><div>读取失败：{humanErrorText(dockAudit.detail)}</div></div>
        ) : dockAudit.view.length === 0 ? (
          <div className="bp-empty" data-testid="dock-audit-empty">
            <Icon name="list" size={20} />
            <div>账本里没有提及 {selectionId} 的审计行（真实为空，不是捞不到）。</div>
          </div>
        ) : (
          <>
            {dockAudit.view.map((r) => (
              <div className="bp-row" data-testid="dock-audit-row" key={r.requestId}>
                <span className="bpr-time">{new Date(r.ts).toLocaleString('zh-CN')}</span>
                <span className="bpr-tag">{r.action}</span>
                <span className="bpr-msg">{r.summary}</span>
                <span className="bpr-id">{r.requestId}</span>
              </div>
            ))}
            <div className="bp-foot">来源：storage.queryAudit；浏览器未登录时为进程内内存账本，桌面端为本机账本。</div>
          </>
        )}
      </>
    );
  }

  /** 分栏拖拽：只改壳层尺寸，不触碰页面数据 */
  function startDrag(kind: 'nav' | 'insp' | 'dock', ev: ReactPointerEvent<HTMLDivElement>) {
    ev.preventDefault();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const base = kind === 'nav' ? navWidth : kind === 'insp' ? inspWidth : dockHeight;
    const onMove = (e: PointerEvent) => {
      if (kind === 'nav') setNavWidth(Math.max(160, Math.min(480, base + (e.clientX - startX))));
      else if (kind === 'insp') setInspWidth(Math.max(220, Math.min(520, base - (e.clientX - startX))));
      else setDockHeight(Math.max(90, Math.min(420, base - (e.clientY - startY))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
}

function Prop({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="prop-row"><span className="prop-k">{k}</span><span className={`prop-v${mono ? ' mono' : ''}`}>{v}</span></div>;
}

/** 批次54：角标只显示真实读数，title 写清来源，避免被误认成参考图里的示例数字。 */
const NAV_COUNT_TITLES: Record<string, string> = {
  'memory-bank': '真实账本记忆条数（coreListMemories，非参考图示例数）',
  dispute: '内核真实 pending 冲突队列长度（coreConflicts）',
  agent: '接入后端真实 Agent 卡片数（GET /agents）',
};

/** 徽标变体（对齐 v5 设计稿 .badge.hot/.warn/.soft）：hot=待裁决、warn=告警类、soft=软计数，其余默认灰底。 */
const NAV_COUNT_VARIANTS: Record<string, 'hot' | 'warn' | 'soft'> = {
  dispute: 'hot',
  monitor: 'warn',
  sync: 'warn',
  personal: 'soft',
};

function NavTreeItem({ item, activeId, open, counts, collapsed, onToggle, onSelect, onMenu }: {
  item: NavItem;
  activeId: string;
  open: boolean;
  counts: Record<string, number>;
  /** 折叠态：只显示图标（名称走 title 提示），不显示文字与角标 */
  collapsed?: boolean;
  onToggle: () => void;
  onSelect: (i: NavItem) => void;
  onMenu: (i: NavItem, e: ReactMouseEvent) => void;
}) {
  const hasKids = Boolean(item.children?.length);
  const count = counts[item.id] ?? 0;
  return (
    <>
      <div
        className={`tree-row${item.id === activeId ? ' active' : ''}${item.child ? ' child' : ''}${collapsed ? ' icon-only' : ''}`}
        onClick={() => onSelect(item)}
        onContextMenu={(e) => onMenu(item, e)}
        role="treeitem"
        aria-selected={item.id === activeId}
        title={collapsed ? item.label : undefined}
        data-testid={`nav-item-${item.id}`}
      >
        {hasKids ? (
          <span className="tw" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            <Icon name={open ? 'caret' : 'chev'} size={9} />
          </span>
        ) : <span className="tw" />}
        <span className="tico">{item.emoji
          ? <span className="tico-emoji" aria-hidden="true">{item.emoji}</span>
          : <Icon name={item.icon} size={item.child ? 12 : 16} />}</span>
        <span className="tlabel">{item.label}</span>
        {item.unavailable ? <span className="tcount">不可用</span> : null}
        {count > 0 ? (
          <span
            className={`tcount${NAV_COUNT_VARIANTS[item.id] ? ` ${NAV_COUNT_VARIANTS[item.id]}` : ''}`}
            data-testid={`nav-count-${item.id}`}
            title={NAV_COUNT_TITLES[item.id] ?? '页面同源回传的真实计数'}>{count}</span>
        ) : null}
      </div>
      {hasKids && open && item.children?.map((c) => (
        <NavTreeItem key={c.id} item={c} activeId={activeId} open={false} counts={counts} collapsed={collapsed} onToggle={() => {}} onSelect={onSelect} onMenu={onMenu} />
      ))}
    </>
  );
}


