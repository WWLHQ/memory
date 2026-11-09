// 工作台壳层（批次48 S1）：Ribbon + 导航树 + 标签条 + 属性检查器 + 任务窗 + 底部五标签 + 状态栏。
//
// 设计边界（与定稿 D1 一致）：
// - 壳只提供「导航与布局」，中心区用同源 iframe 承载已真实落地的页面；
// - 壳内任何数字都必须能追到真实来源：S1 阶段尚未接线的部位一律写「未接入」并给出原因，
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
import { MemoryAssistant } from './MemoryAssistant.tsx';
import { loadOverview, type OverviewSnapshot } from './overview.ts';
import { loadPendingWrites, type PendingWritesResult } from './taskpane.ts';
import {
  BOTTOM_TABS, NAV, PAGES, RIBBON, findNav, flattenNav,
  type BottomTabId, type IconName, type NavEntry, type NavItem, type PageKey,
  type RibbonItem, type ShellAction,
} from './views.ts';
import {
  loadAuditForMemory, loadOutputLog, loadScheduleRuns, problemsFromLog,
  type AuditRow, type DockResult, type OutputLogView, type ScheduleRun,
} from './dock.ts';
import { loadStatusbar, shortLocation, type StatusSnapshot } from './statusbar.ts';
import { loadLayerPanel, type LayerPanelView } from './layers.ts';
import { strataViewFromOverview, type StrataScaleView } from './strataScale.ts';
import { StrataScale } from './StrataScale.tsx';
import { loadNavCounts, type NavCounts } from './navCounts.ts';
import { SELECTION_MSG, parseSelection, type SelectionPayload } from '../shared/selectionChannel.ts';
import { NAV_COUNT_MSG, parseNavCount } from '../shared/navCountChannel.ts';
import { SHELL_GOTO_MSG } from '../shared/shellNavigate.ts';

const STORE_THEME = 'memdesk.shell.theme.v1';
const STORE_DENSITY = 'memdesk.shell.density.v1';
const STORE_ZOOM = 'memdesk.shell.zoom.v1';

/** Electron 壳（preload 暴露 __ELECTRON__）：只有桌面端才需要为系统窗口按钮预留右上角、才走拖拽区 */
const IS_ELECTRON = typeof window !== 'undefined' && Boolean((window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__);
/** 窗口按钮覆盖层主题同步通道（浏览器模式无此桥） */
interface ShellWindowBridge {
  setTitleBarTheme?: (theme: 'light' | 'dark') => Promise<{ ok: boolean }>;
  onShortcut?: (cb: (action: 'refresh' | 'search' | 'help' | 'security') => void) => () => void;
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

/** 菜单栏同行最右侧的快速访问工具条（定稿 12 个位置；无对应能力的置灰并写明原因） */
interface QaSpec {
  id?: string;
  sep?: boolean;
  icon?: IconName;
  title?: string;
  /** 可见文字标签：纯图标按钮在 15 个同形图标里不可辨认，登录态入口必须带字 */
  text?: string;
  /** 开关态（记忆助手）：true 时按钮高亮并写 aria-pressed */
  active?: boolean;
  disabled?: boolean;
  run?: () => void;
}

/** 顶部第 2 段自建中文菜单：命令行与 Ribbon 命令同源，无能力项置灰并带原因 */
interface MenuRowSpec {
  head?: string;
  sep?: boolean;
  label?: string;
  icon?: IconName;
  kbd?: string;
  checked?: boolean;
  disabled?: boolean;
  reason?: string;
  run?: () => void;
}

interface MenuSpec {
  id: string;
  label: string;
  rows: MenuRowSpec[];
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

/** 导航过滤：父项自身或任一子项命中即保留，子项自身再按关键词过滤 */
function filterEntries(entries: NavEntry[], q: string): NavEntry[] {
  if (!q) return entries;
  const hit = (n: NavItem) => n.label.toLowerCase().includes(q);
  const out: NavEntry[] = [];
  for (const e of entries) {
    if (e.kind === 'group') {
      out.push(e);
      continue;
    }
    const kids = e.children?.filter(hit);
    if (hit(e) || (kids && kids.length)) out.push({ ...e, children: kids ?? e.children });
  }
  // 去掉没有任何命中项的孤立分组
  return out.filter((e, i, all) => e.kind !== 'group' || (i + 1 < all.length && all[i + 1].kind === 'item'));
}

export function Workspace() {
  const [activeId, setActiveId] = useState<string>('home');
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([
    { id: 'home', label: '首页', page: 'home' },
  ]);
  const [openParents, setOpenParents] = useState<Record<string, boolean>>({});
  const [navQuery, setNavQuery] = useState('');
  const [ribbonTab, setRibbonTab] = useState<string>('start');
  const [ribbonFolded, setRibbonFolded] = useState(false);
  /** 第 2 段中文菜单当前展开项（null = 全部收起） */
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [inspCollapsed, setInspCollapsed] = useState(false);
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
  const [navWidth, setNavWidth] = useState(250);
  const [inspWidth, setInspWidth] = useState(318);
  const [dockHeight, setDockHeight] = useState(190);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [message, setMessage] = useState('工作台已就绪：中心区为同源真实页面，壳层尚未接线的部位会明确标注原因。');
  const [sessionActive, setSessionActive] = useState(() => hasActiveSession());
  /** 当前会话真实身份（/api/me 确认；null = 未确认，绝不按 localStorage 冒充身份） */
  const [identity, setIdentity] = useState<TenantContext | null>(null);
  /** 壳层登录弹窗（菜单栏 / QAT / 登录状态处三处入口共用同一实例） */
  const [loginOpen, setLoginOpen] = useState(false);
  /** 记忆助手（问账本）：开闭状态挂在壳层，切换中心标签不重置；会话在面板组件内（常驻不卸载） */
  const [assistantOpen, setAssistantOpen] = useState(false);
  const closeAssistant = useCallback(() => setAssistantOpen(false), []);
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
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
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
  /** 顶部自绘标题栏里的查找框（Ctrl+F / Ctrl+K / Ribbon「在库中查找」共用同一个焦点目标） */
  const navSearchRef = useRef<HTMLInputElement | null>(null);

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
    if (!dockOpen || dockTab === 'term' || dockTab === 'tasks' || dockTab === 'audit') return;
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
    setStatus(await loadStatusbar());
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

  // 启动时用本机 sessionId 向 /api/me 核对真实身份：查不到就不写身份（状态栏只显示「已登录/未登录」）
  useEffect(() => {
    const sid = getStoredSessionId();
    if (!sid) { setIdentity(null); return; }
    let alive = true;
    fetchSessionContext(sid)
      .then((ctx) => { if (alive) setIdentity(ctx); })
      .catch(() => { if (alive) setIdentity(null); });
    return () => { alive = false; };
  }, []);

  /** 登录弹窗回传会话变化：更新身份与只读门禁；概览/状态栏随 sessionActive 自动重读真实数据 */
  const onLoginSession = useCallback((ctx: TenantContext | null) => {
    setIdentity(ctx);
    setSessionActive(hasActiveSession());
  }, []);

  const active = useMemo(() => openTabs.find((t) => t.id === activeId) ?? openTabs[0], [activeId, openTabs]);
  /** Ribbon 深链会派生 id（如 memory-bank?tab=layers），按 page + href 兜底回查 NAV，属性检查器不丢标题。 */
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
    setActiveId(item.id);
    setOpenTabs((tabs) => tabs.some((t) => t.id === item.id)
      ? tabs
      : [...tabs, { id: item.id, label: item.label, page: item.page, href: item.href, unavailable: item.unavailable }]);
    setMessage(`已切换到「${item.label}」。`);
  }, []);

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

  const runShellAction = useCallback((action: ShellAction, label: string) => {
    switch (action) {
      case 'toggleTaskPane':
        setTaskOpen((v) => !v);
        break;
      case 'foldRibbon':
        setRibbonFolded((v) => !v);
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
        setNavCollapsed(false); setInspCollapsed(false); setTaskOpen(false); setDockOpen(true);
        setRibbonFolded(false); setZoom(100); setDensity('comfortable'); setStatusVisible(true);
        break;
      case 'refresh':
        setReloadNonce((n) => n + 1);
        // 底部面板、状态栏、导航角标同样重读；层级刻度与概览页共用同一份真实账本快照
        setDockLog(null); setDockTasks(null); setDockAudit(null);
        setStatus(null); setLayerPanel(null);
        refreshOverview();
        setRealNavCounts({}); setNavCountsSeq((n) => n + 1);
        setMessage('已刷新中心区真实页面、概览账本/层级刻度、底部面板/状态栏与导航角标读数。');
        break;
      case 'focusFilter':
        // 顶部自绘标题栏的查找框只过滤左侧功能导航；它不跨页检索记忆，因此不产出任何伪造结果。
        navSearchRef.current?.focus();
        navSearchRef.current?.select();
        setMessage(`已聚焦顶部查找框（${label}）：按名称过滤左侧功能导航。`);
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
    setMenuOpen(null);
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
      { id: 'refresh', icon: 'refresh', label: '刷新中心区与底部读数（F5）', run: () => runShellAction('refresh', '刷新') },
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
      { id: 'collapse', icon: 'panel', label: '折叠属性检查器', run: () => setInspCollapsed(true) },
    ]);
  }, [openCtxMenu, selectionId, selection, active?.page, copyText]);

  /**
   * 全域右键兜底：标题栏 / 菜单栏 / QAT / Ribbon / 导航搜索框 / 状态栏 / 底部面板 / 中心空白
   * 命中的区域决定标题，动作全部是壳层真实能力（刷新、回概览、聚焦查找、复制、切主题、登录会话）。
   * 这样壳层可视范围内不存在「右键没反应」或漏原生菜单的位置。
   */
  const openDefaultContext = useCallback((x: number, y: number, target: HTMLElement | null) => {
    const zone = target?.closest('.tree') ? '功能导航'
      : target?.closest('.statusbar') ? '状态栏'
        : target?.closest('.bottom-panel') ? '底部面板'
          : target?.closest('.inspector-pane') ? '属性检查器'
            : target?.closest('.center-pane') ? '中心区'
              : target?.closest('.ribbon-body, .ribbon-tabs') ? '功能区'
                : target?.closest('.qa') ? '快速访问工具条'
                  : target?.closest('.menubar') ? '菜单栏'
                    : target?.closest('.titlebar') ? '标题栏'
                      : '工作台';
    // 输入框的选区不走 DOM Selection，单独取 selectionStart/End
    const field = target?.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
    const selected = field && typeof field.selectionStart === 'number'
      ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
      : (window.getSelection()?.toString() ?? '');
    const selectedText = selected.trim();
    // 批次50：右键不补登录入口 —— 只有该区域本身已有登录入口才出现「登录 / 会话」
    // 批次51：QAT 移进菜单栏后，不能让 QAT 空白区借 .menubar 白捡一个登录入口；
    // 菜单项区域仍算自带「文件 → 登录 / 会话」，QAT 登录按钮与两处会话格按 testid 精确命中。
    const inQa = !!target?.closest('.qa');
    const hasLoginEntry = !!target?.closest(
      '[data-testid="qa-login"], [data-testid="shell-session-btn"], [data-testid="sb-session"]',
    ) || (!inQa && !!target?.closest('.menubar'));
    const items: ContextMenuItem[] = [
      { id: 'refresh', icon: 'refresh', label: '刷新中心区与底部/状态栏读数（F5）', run: () => runShellAction('refresh', '刷新') },
      {
        id: 'home', icon: 'spark', label: '回到首页',
        run: () => { const home = findNav('home'); if (home) openView(home); },
      },
      { id: 'find', icon: 'search', label: '聚焦导航查找框（Ctrl+F）', run: () => runShellAction('focusFilter', '查找') },
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
    setMenuOpen(null);
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
        { id: 'refresh', icon: 'refresh', label: '刷新中心区（F5）', run: () => runShellAction('refresh', '刷新') },
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
    setMenuOpen(null);
  }, [active?.page, copyText, runShellAction, openView]);

  /** 给同源 iframe 文档挂一次 contextmenu：全域接管（行→行菜单，其余→页面菜单），不留原生菜单 */
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
      const row = target?.closest?.('tr[data-testid^="row-"]') as HTMLElement | null;
      if (row) openRowContext(frame, row, ev as MouseEvent);
      else openPageContext(frame, ev as MouseEvent);
    });
  }, [openRowContext, openPageContext]);

  const onRibbonItem = useCallback((item: RibbonItem) => {
    if (item.unavailable) return;
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
  const runShellShortcut = useCallback((action: 'refresh' | 'search' | 'help' | 'security') => {
    if (action === 'refresh') { runShellAction('refresh', '刷新'); return; }
    if (action === 'search') { navSearchRef.current?.focus(); navSearchRef.current?.select(); return; }
    if (action === 'security') {
      const sec = NAV.find((n): n is NavItem => n.kind === 'item' && n.id === 'security');
      if (sec) openView(sec);
      return;
    }
    setMessage('快捷键：F5 刷新 · F9 打开「安全与账号」· Ctrl+F / Ctrl+K 聚焦顶部查找框 · F1 本说明；复制/粘贴/全选由系统编辑命令处理。');
  }, [openView, runShellAction, setMessage]);

  useEffect(() => {
    const off = shellWindowBridge()?.onShortcut?.(runShellShortcut);
    return () => { off?.(); };
  }, [runShellShortcut]);

  useEffect(() => {
    if (IS_ELECTRON || typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.shiftKey) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (key === 'f5') { e.preventDefault(); runShellShortcut('refresh'); return; }
      if (key === 'f9') { e.preventDefault(); runShellShortcut('security'); return; }
      if (key === 'f1') { e.preventDefault(); runShellShortcut('help'); return; }
      if (mod && (key === 'f' || key === 'k')) { e.preventDefault(); runShellShortcut('search'); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runShellShortcut]);

  const navEntries = useMemo(() => filterEntries(NAV, navQuery.trim().toLowerCase()), [navQuery]);

  // 菜单收起：点菜单栏以外或按 Esc。只做收起，不吞其它按键。
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest('.menubar')) return;
      setMenuOpen(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const activeRibbon = RIBBON.find((r) => r.id === ribbonTab) ?? RIBBON[0];

  /** 底部标签角标：只在真实读到数据后显示计数；未读/不可用一律不显示，绝不用 0 冒充 */
  const dockCounts: Record<BottomTabId, number | null> = {
    output: dockLog?.status === 'ok' ? dockLog.view.lines.length : null,
    problems: dockLog?.status === 'ok' ? problemsFromLog(dockLog.view).length : null,
    audit: selectionId && dockAudit?.status === 'ok' ? dockAudit.view.length : null,
    tasks: dockTasks?.status === 'ok' ? dockTasks.view.length : null,
    term: null,
  };

  // S7：状态栏各单元格的真实文案与可追溯 title
  const locView = status?.location.status === 'ok' ? shortLocation(status.location.view) : null;
  const locText = !status ? '读取中' : locView ? locView.text : '未知';
  const locTitle = status?.location.status === 'ok' ? locView?.title ?? '' : status ? status.location.detail : '尚未读取';

  const collector = status?.collector;
  const collectorText = !status ? '读取中'
    : collector?.status === 'ok' ? (collector.view.running ? '运行中' : '空闲')
    : collector?.status === 'unavailable' ? '不可用' : '异常';
  const collectorTitle = !status ? '尚未读取'
    : collector?.status === 'ok'
      ? `采集器${collector.view.running ? '正在跑' : '空闲'}${collector.view.intervalMs ? ` · 间隔 ${collector.view.intervalMs} ms` : ''}${collector.view.lastAt ? ` · 最近一轮 ${new Date(collector.view.lastAt).toLocaleString('zh-CN')}` : ' · 暂无已完成轮次'}${collector.view.lastCollected != null ? ` · 上轮采集 ${collector.view.lastCollected} 条` : ''}${collector.view.autoRetryStopped ? ` · 自动重试已停（连续失败 ${collector.view.consecutiveFails ?? '?'} 轮）` : ''}`
      : collector ? collector.detail : '尚未读取';

  const l0 = status?.l0;
  const l0Text = !status ? '读取中'
    : l0?.status === 'ok' ? (l0.view.active_sessions > 0 ? `${l0.view.active_sessions} 会话` : '已锁定')
    : '不可用';
  const l0Title = !status ? '尚未读取'
    : l0?.status === 'ok'
      ? `L0 保险库：活动会话 ${l0.view.active_sessions} · 有效授权 ${l0.view.active_grants} · 管理密钥${l0.view.has_admin_wrap ? '已设置' : '未设置'} · 写入锁${l0.view.write_unlocked ? '已解锁' : '锁定'}（只读，不含任何密钥材料）`
      : l0 ? l0.detail : '尚未读取';

  // 第 1 段「当前库/文档」：只放真实的账本文件名（定稿里的 mem-prod-cn — 记忆库.mem 是演示名）。
  const docLabel = locView ? locView.text : (status ? '库位置未知' : '库读取中');
  const docTitle = `当前库：${locText}（${locTitle}） · 当前视图：${active?.label ?? '未选择'}`;

  // ── 菜单栏右端：快速访问工具条（12 个位置照定稿保留；无能力项置灰并写明原因）──
  const themeIcon: IconName = theme === 'system' ? 'system' : theme === 'light' ? 'sun' : 'moon';
  const themeTip = theme === 'system'
    ? '主题：跟随系统（点击切到浅色）'
    : theme === 'light' ? '主题：浅色（点击切到深色）' : '主题：深色（点击切回跟随系统）';
  const cycleTheme = () => setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'));
  const openNav = (id: string) => {
    const target = findNav(id);
    if (target) openView(target);
  };
  /** 批次54：L0 等不再占主导航的深链，仍从「记忆库」派生真实标签打开，不伪造独立页面。 */
  const openMemoryTab = (href: string, label: string) => {
    const base = findNav('memory-bank');
    if (base) openView({ ...base, id: `memory-bank${href}`, href, label });
  };
  const demoOnly = '定稿演示命令：本程序概览未提供该动作，不伪造执行结果';
  const qaSpecs: QaSpec[] = [
    { id: 'save', icon: 'save', title: '保存（只读）：本程序无文档编辑，保存不适用', disabled: true },
    { id: 'undo', icon: 'undo', title: '撤销（无历史）：壳层不保存编辑历史', disabled: true },
    { id: 'refresh', icon: 'refresh', title: '刷新中心区与底部/状态栏读数（F5）', run: () => runShellAction('refresh', '刷新') },
    { id: 'find', icon: 'search', title: '查找左侧功能导航（Ctrl+F / Ctrl+K）', run: () => runShellAction('focusFilter', '查找') },
    {
      id: 'login', icon: 'user',
      // 可见文字：未登录写「登录」，已确认会话写账号（纯图标用户找不到入口）
      text: sessionActive && identity ? identity.user_id : '登录',
      title: sessionActive
        ? '登录 / 会话：查看当前账号、团队、角色或登出（真实 /api/me）'
        : '登录 / 会话：打开登录弹窗（真实 POST /api/login）',
      run: () => setLoginOpen(true),
    },
    { sep: true },
    { id: 'syncCheck', icon: 'sync', title: '同步检查：程序未提供独立指令；请在「同步」视图查看通道状态', disabled: true },
    { id: 'balance', icon: 'scale', title: '余额探测：程序未提供独立指令；请在「模型与成本」视图查看计费状态', disabled: true },
    { sep: true },
    { id: 'theme', icon: themeIcon, title: themeTip, run: cycleTheme },
    { sep: true },
    {
      id: 'assistant', icon: 'spark', text: '记忆助手', active: assistantOpen,
      title: '记忆助手：问账本（成本/异常/冲突/同步/记忆条数）。点击展开/收起；切换中心标签不丢会话',
      run: () => setAssistantOpen((v) => !v),
    },
    { id: 'metrics', icon: 'chart', title: `指标明细（概览）：${demoOnly}`, disabled: true },
    { id: 'pending', icon: 'archive', title: '待处理（概览）：定稿演示命令；待重放写入请在「任务窗格」只读查看', disabled: true },
    { id: 'exportCsv', icon: 'export', title: `导出概览 CSV（概览）：${demoOnly}`, disabled: true },
    { id: 'more', icon: 'more', title: '更多命令：暂无；命令入口以菜单栏为准', disabled: true },
  ];

  // ── 第 2 段：自建中文菜单（命令与 Ribbon 同源；无能力项置灰并写原因）──
  const menuSpecs: MenuSpec[] = [
    {
      id: 'file', label: '文件', rows: [
        { label: '新建记忆', icon: 'plus', kbd: 'Ctrl+N', run: () => openNav('write') },
        { label: '打开记忆库…', icon: 'folder', kbd: 'Ctrl+O', disabled: true, reason: '程序未提供库切换指令；数据根位置在「参数」页查看' },
        { head: '最近打开' },
        { label: `当前库：${locView ? locView.text : '未选择'}`, icon: 'db', disabled: true, reason: '仅展示当前账本文件；切换库需改数据根并重启' },
        { label: '登录 / 会话…', icon: 'user', run: () => setLoginOpen(true) },
        { sep: true },
        { label: '打印回执…', icon: 'receipt', kbd: 'Ctrl+P', disabled: true, reason: '程序未提供打印通道' },
        { label: '关闭当前视图', icon: 'x', run: () => closeTab(activeId) },
        { sep: true },
        { label: '退出', icon: 'x', disabled: true, reason: '请使用窗口右上角关闭按钮（系统覆盖层）' },
      ],
    },
    {
      id: 'edit', label: '编辑', rows: [
        { label: '撤销', icon: 'undo', kbd: 'Ctrl+Z', disabled: true, reason: '壳层不保存编辑历史' },
        {
          label: '复制记忆 ID', icon: 'copy',
          disabled: !selectionId,
          reason: '中心页未选中记忆；先在列表选中一条记录',
          run: () => {
            if (!selectionId) return;
            const copy = navigator.clipboard?.writeText(selectionId);
            if (!copy) { setMessage('复制失败：剪贴板不可用。'); return; }
            copy.then(() => setMessage(`已复制记忆 ID：${selectionId}`))
              .catch(() => setMessage('复制失败：剪贴板未授权。'));
          },
        },
        { label: '全选', icon: 'check', kbd: 'Ctrl+A', disabled: true, reason: '请在输入框内使用 Ctrl+A（系统编辑命令）' },
        { sep: true },
        { label: '查找', icon: 'search', kbd: 'Ctrl+F', run: () => runShellAction('focusFilter', '查找') },
        { label: '冲突裁决', icon: 'warn', run: () => openNav('dispute') },
        { label: '首选项…', icon: 'gear', run: () => openNav('params') },
      ],
    },
    {
      id: 'view', label: '视图', rows: [
        { label: '任务窗格', icon: 'panel', checked: taskOpen, run: () => runShellAction('toggleTaskPane', '任务窗格') },
        { label: '折叠功能区', icon: 'fold', kbd: 'Ctrl+F1', checked: ribbonFolded, run: () => runShellAction('foldRibbon', '折叠功能区') },
        { label: '折叠详情面板', icon: 'panel', checked: inspCollapsed, run: () => setInspCollapsed((v) => !v) },
        { label: '层级管理', icon: 'layers', run: () => openNav('layered') },
        { label: '折叠功能导航', icon: 'chev', kbd: 'Ctrl+B', checked: navCollapsed, run: () => setNavCollapsed((v) => !v) },
        { sep: true },
        { label: '重置布局', icon: 'refresh', run: () => runShellAction('resetLayout', '重置布局') },
        { label: '刷新', icon: 'refresh', kbd: 'F5', run: () => runShellAction('refresh', '刷新') },
        { sep: true },
        { label: '显示 L0 密文', icon: 'lock', run: () => openMemoryTab('?tab=l0', 'L0 密文（需解锁）') },
        { label: '显示底部面板', icon: 'panel', checked: dockOpen, run: () => runShellAction('toggleDock', '底部面板') },
        { label: '显示状态栏', icon: 'info', checked: statusVisible, run: () => runShellAction('toggleStatus', '状态栏') },
        { label: '紧凑密度', icon: 'panel', checked: density === 'compact', run: () => runShellAction('density', '紧凑密度') },
        { sep: true },
        { label: '主题：跟随系统', icon: 'system', checked: theme === 'system', run: () => setTheme('system') },
        { label: '主题：浅色', icon: 'sun', checked: theme === 'light', run: () => setTheme('light') },
        { label: '主题：深色', icon: 'moon', checked: theme === 'dark', run: () => setTheme('dark') },
      ],
    },
    {
      id: 'tools', label: '工具', rows: [
        { label: '运行检索（只读）', icon: 'search', kbd: 'F6', run: () => openNav('retrieval') },
        { label: '安全体检', icon: 'shield', kbd: 'F9', run: () => openNav('security') },
        { label: '生长调度状态', icon: 'layers', run: () => openNav('growth') },
        { label: 'Agent 通道探针', icon: 'agent', run: () => openNav('agent') },
        { label: '查看写入回执', icon: 'receipt', kbd: 'Ctrl+R', run: () => openNav('write') },
        { label: '打开诊断日志', icon: 'list', kbd: 'Ctrl+L', run: () => openNav('logs') },
        { sep: true },
        { label: '余额探测', icon: 'scale', kbd: 'F7', disabled: true, reason: '探测在「模型与成本」页内执行' },
        { label: '同步检查', icon: 'sync', kbd: 'F8', disabled: true, reason: '同步检查在「同步」视图执行' },
        { label: '写入预检', icon: 'check', disabled: true, reason: '程序未提供独立预检指令；在写入页内执行' },
        { label: '去重策略', icon: 'filter', disabled: true, reason: '程序未提供独立去重策略命令' },
      ],
    },
    {
      id: 'help', label: '帮助', rows: [
        { label: '快捷键参考', icon: 'help', kbd: 'F1', run: () => runShellShortcut('help') },
        { label: '产品能力与限制', icon: 'info', run: () => setMessage('壳层只提供导航与布局；中心区为本机真实页面。未接线的部位会明确标注原因，不显示推测值。') },
        { label: '命令清单', icon: 'list', run: () => setMessage('菜单命令与 Ribbon 项同源；无对应能力的项已置灰并在提示中写明原因。') },
        { sep: true },
        { label: '演示数据声明', icon: 'check', run: () => setMessage('本程序全站零演示数据：读数来自本机真实链路，缺失或不可用一律如实标注。') },
        { label: '检查更新', icon: 'refresh', disabled: true, reason: '程序未提供更新检查通道' },
        { label: '关于 MemoryDesk 记忆工作台', icon: 'spark', run: () => setMessage('MemoryDesk 记忆工作台（多Agent记忆助手）。') },
      ],
    },
  ];

  // 第 2 段右侧范围读数：库位置与会话态取真实值；总条数壳层未接线，按既有口径显示「—」。
  const scopeText = `库：${locView ? locView.text : (status ? '未知' : '读取中')} · — 条 · 会话 ${sessionActive ? '已登录' : '只读'}`;
  const scopeTitle = `${locTitle} · 条数：壳层未读取总条数，按既有口径显示「—」 · 会话：${sessionActive ? '已登录' : '只读（未登录）'}`;

  return (
    <div
      className={`shell${IS_ELECTRON ? ' electron' : ''}`}
      onContextMenu={onShellContextMenu}
      style={{
        '--nav-w': `${navCollapsed ? 0 : navWidth}px`,
        '--insp-w': `${inspCollapsed ? 0 : inspWidth}px`,
        '--dock-h': `${dockHeight}px`,
        '--shell-zoom': String(zoom / 100),
      } as CSSProperties}
    >
      <div className="ribbon">
        {/* 顶部四段（批次52 布局校正）：
            ① 32px 标题行（品牌与真实库文档名 / 会话状态整组居中 / 系统三按钮覆盖层）
            ② 26px 自建中文菜单行（菜单项 → 紧随其后的快速访问工具条 → 右端范围信息）
            ③ 94px 功能区（命令分组）
            ④ 31px Ribbon 标签行（8 标签 + 查找框 + 折叠，整行下移到功能区下方） */}
        <div className="titlebar" data-testid="shell-titlebar" data-brand-align="center">
          <div className="tb-left">
            <span className="app-mark"><Icon name="layers" size={11} /></span>
            <span className="app-name">MemoryDesk 记忆工作台</span>
            <span className="tb-sep" />
            <span className="tb-doc" title={docTitle}>{docLabel}</span>
            <button
              type="button"
              className={`tb-tag${sessionActive ? ' ok' : ' ro'}`}
              data-testid="shell-session-btn"
              title={identity
                ? `账号 ${identity.user_id} · 团队 ${identity.team_id} · 角色 ${identity.role === 'admin' ? '管理员' : '成员'}（点击查看 / 登出）`
                : sessionActive
                  ? '本机会话标记存在（localStorage），身份尚未经 /api/me 确认（点击打开登录 / 会话弹窗）'
                  : '未登录：点击打开登录弹窗（真实 POST /api/login）'}
              onClick={() => setLoginOpen(true)}
            >{identity ? identity.user_id : (sessionActive ? '已登录' : '只读会话')}</button>
          </div>
          {/* 右端留给系统三按钮覆盖层：这里只占位，不重复造窗口按钮 */}
          <div className="win-space" aria-hidden="true" />
        </div>

        <div className="menubar" data-testid="shell-menubar" role="menubar" aria-label="主菜单">
          {menuSpecs.map((m) => (
            <div className="menu-wrap" key={m.id}>
              <button
                className={`menu-item${menuOpen === m.id ? ' open' : ''}`}
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen === m.id}
                onClick={() => setMenuOpen((v) => (v === m.id ? null : m.id))}
              >{m.label}</button>
              {menuOpen === m.id && (
                <div className="menu-pop" role="menu" aria-label={`${m.label}菜单`}>
                  {m.rows.map((row, i) => {
                    if (row.sep) return <div className="menu-sep" key={`sep-${i}`} aria-hidden="true" />;
                    if (row.head) return <div className="menu-row head" key={`head-${i}`}>{row.head}</div>;
                    const showCheck = row.checked && !row.disabled;
                    return (
                      <button
                        key={`row-${i}`}
                        className={`menu-row${row.disabled ? ' disabled' : ''}`}
                        type="button"
                        role="menuitem"
                        aria-disabled={row.disabled || undefined}
                        title={row.reason ?? row.label}
                        onClick={() => {
                          if (row.disabled) return;
                          row.run?.();
                          setMenuOpen(null);
                        }}
                      >
                        <span className="mi-ic">
                          <Icon name={showCheck ? 'check' : (row.icon ?? 'dot')} size={12} />
                        </span>
                        <span>{row.label}</span>
                        {row.kbd && <span className="mi-kbd">{row.kbd}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {/* 批次52：快速访问工具条紧跟菜单项之后；右端范围信息由弹簧顶到最右 */}
          <div className="qa" aria-label="快速访问工具条">
            {qaSpecs.map((q, i) => q.sep ? (
              <span className="qa-sep" key={`qa-sep-${i}`} aria-hidden="true" />
            ) : (
              <span className="qa-slot" key={q.id}>
                <button
                  className={`qa-btn${q.disabled ? ' off' : ''}${q.text ? ' labeled' : ''}${q.active ? ' on' : ''}`}
                  type="button"
                  data-testid={`qa-${q.id}`}
                  aria-label={q.title}
                  aria-pressed={q.active}
                  aria-disabled={q.disabled || undefined}
                  title={q.title}
                  onClick={q.disabled ? undefined : q.run}
                ><Icon name={q.icon ?? 'dot'} size={15} />{q.text ? <span className="qa-label">{q.text}</span> : null}</button>
                {/* 记忆助手面板常驻壳层：收起只是不渲染，问答会话不随中心标签切换丢失 */}
                {q.id === 'assistant' && (
                  <MemoryAssistant
                    open={assistantOpen}
                    onClose={closeAssistant}
                    overview={overview}
                    overviewBusy={overviewBusy}
                    onRefresh={refreshOverview}
                  />
                )}
              </span>
            ))}
          </div>
          <span className="rib-spring" />
          <span className="menu-scope" title={scopeTitle}>{scopeText}</span>
        </div>

        {!ribbonFolded && (
          <div className="ribbon-body">
            {activeRibbon.groups.map((g) => (
              <RibbonGroupView
                key={g.label}
                group={!sessionActive
                  ? {
                      ...g,
                      items: g.items.map((it) => (it.label.includes('需登录')
                        ? { ...it, unavailable: '未登录（会话 401）：该动作需要登录后才能执行' }
                        : it)),
                    }
                  : g}
                onItem={onRibbonItem}
              />
            ))}
          </div>
        )}

        <div className="ribbon-tabs">
          <div className="rib-tabs">
            {RIBBON.map((tab) => (
              <button
                key={tab.id}
                className={`rib-tab${tab.id === activeRibbon.id ? ' active' : ''}`}
                onClick={() => setRibbonTab(tab.id)}
                onDoubleClick={() => setRibbonFolded((v) => !v)}
                type="button"
              >{tab.label}</button>
            ))}
          </div>
          <span className="rib-spring" />
          <label className="rib-search" title="按名称过滤左侧功能导航（Ctrl+F / Ctrl+K）">
            <Icon name="search" size={11} />
            <input
              ref={navSearchRef}
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder="在当前视图查找（Ctrl+F）"
              spellCheck={false}
              aria-label="查找功能导航"
            />
          </label>
          <button className="rib-fold" onClick={() => setRibbonFolded((v) => !v)} title="折叠功能区" type="button">
            <Icon name="fold" size={12} />
          </button>
        </div>
      </div>

      <div className={`workspace${dockOpen ? '' : ' dock-closed'}`}>
        <aside className={`nav-pane${navCollapsed ? ' collapsed' : ''}`} aria-label="功能导航">
          <div className="pane-head">
            <span className="ph-ic"><Icon name="folder" /></span>
            功能导航
            <span className="ph-tools">
              <button className="ph-btn" onClick={() => setNavCollapsed((v) => !v)} title="折叠导航窗格" type="button">
                <Icon name="chev" size={12} />
              </button>
            </span>
          </div>
          <div className="tree">
            {navEntries.map((entry) => entry.kind === 'group' ? (
              <div className="tree-group" key={`g-${entry.label}`}>{entry.label}</div>
            ) : (
              <NavTreeItem
                key={entry.id}
                item={entry}
                activeId={activeId}
                open={openParents[entry.id] ?? false}
                counts={mergedNavCounts}
                onToggle={() => setOpenParents((p) => ({ ...p, [entry.id]: !(p[entry.id] ?? false) }))}
                onSelect={openView}
                onMenu={openNavContext}
              />
            ))}
            {navEntries.length === 0 && <div className="tree-note">没有匹配的功能项。</div>}
          </div>
          {/* 批次53：层级刻度固定在功能导航栏最下面，不随导航树滚动 */}
          {!navCollapsed && (
            <StrataScale data={strataScale} onRefresh={refreshOverview} />
          )}
          {!navCollapsed && (
            <div className="splitter" role="separator" aria-label="调整导航宽度" onPointerDown={(e) => startDrag('nav', e)} />
          )}
        </aside>

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

          {!sessionActive && (
            <div className="auth-strip" role="status" data-testid="auth-readonly-strip">
              <Icon name="lock" size={11} />
              <span>
                未登录 · 按程序实际能力只读：成本余额、同步、账号等需会话的后端接口不可用；本地账本仍可读。
              </span>
              <button type="button" data-testid="auth-strip-login" onClick={() => setLoginOpen(true)}>去登录（打开登录弹窗）</button>
            </div>
          )}

          {active?.page === 'home' && overview?.storageError && (
            <div className="ov-error-strip" data-testid="overview-storage-error">
              账本读取失败：{overview.storageError}（这不是空账本，概览页会如实标注）
            </div>
          )}

          {showLayerStrip && (
            <div className="layer-strip" data-testid="layer-strip" title="与中心层级页同源：storage.listMemories + storage.browse(L1–L6) + l0Status">
              <Icon name="layers" size={12} />
              <b>分层 L1–L6</b>
              {!layerPanel ? (
                <span className="ls-note">读取中…</span>
              ) : layerPanel.status !== 'ok' ? (
                <span className="ls-note err" data-testid="layer-strip-error">读取失败：{layerPanel.detail}</span>
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
                      ? `L0 保险库：活动会话 ${layerPanel.view.l0.view.active_sessions} · 有效授权 ${layerPanel.view.l0.view.active_grants} · 写锁${layerPanel.view.l0.view.write_unlocked ? '已解锁' : '锁定'}`
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
                    key={`${t.id}-${reloadNonce}`}
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
                    <div className="tp-note red" data-testid="pending-error">读取失败：{pending.detail}</div>
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
                <button className="ph-btn" onClick={() => setInspCollapsed((v) => !v)} title="折叠属性检查器" type="button">
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
              className={`bp-tab${dockTab === t.id ? ' active' : ''}${t.id === 'term' ? ' unavailable' : ''}`}
              onClick={() => { setDockTab(t.id); setDockOpen(true); }}
              title={t.unavailable}
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
          <span className="sb-theme" role="group" aria-label="主题">
            {(['system', 'light', 'dark'] as ThemeMode[]).map((m) => (
              <button
                key={m}
                className="sb-tbtn"
                aria-pressed={theme === m}
                aria-label={m === 'system' ? '跟随系统' : m === 'light' ? '浅色' : '深色'}
                title={m === 'system' ? '跟随系统' : m === 'light' ? '浅色' : '深色'}
                onClick={() => setTheme(m)}
                type="button"
              ><Icon name={m === 'system' ? 'system' : m === 'light' ? 'sun' : 'moon'} size={11} /></button>
            ))}
          </span>
        </div>
      )}

      {/* 登录改弹窗：菜单栏 / QAT / 登录状态处三处入口共用这一个实例 */}
      <ShellLoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} onSession={onLoginSession} />
      {/* 右键菜单：导航树 / 标签条 / 检查器 / 中心页表格行共用同一个渲染器 */}
      <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
    </div>
  );

  /** S6：底部面板正文（五标签，只渲染真实读取结果；不可用就说原因，不补数字） */
  function renderDockBody() {
    const tab = BOTTOM_TABS.find((t) => t.id === dockTab);
    if (dockTab === 'term') {
      return (
        <div className="bp-empty" data-testid="dock-term-unavailable">
          <Icon name="terminal" size={20} />
          <div>{tab?.unavailable}</div>
        </div>
      );
    }
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
            ? '校验与错误告警 · 由最近的动作日志派生（不是独立问题库）；0 条表示这段时间的日志里确实没有错误/警告'
            : `程序动作日志 actions.log · 最近 ${data?.status === 'ok' ? data.view.scanLines : 50} 条 · 只读尾读`}
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
          <div className="bp-empty err" data-testid="dock-log-error"><Icon name="warn" size={20} /><div>读取失败：{data.detail}</div></div>
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
          <div>最近 {view.lines.length} 条程序日志里没有错误或警告（真实结果，不是隐藏）。</div>
        </div>
      );
    }
    return (
      <>
        {rows.map((r, i) => (
          <div className={`bp-row lv-${r.level}`} data-testid="dock-problem-row" key={`${r.ts ?? i}-${i}`}>
            <span className="bpr-time">{formatLogClock(r.ts)}</span>
            <span className={`bpr-lv ${r.level}`}>{r.level === 'error' ? '错误' : '警告'}</span>
            <span className="bpr-tag">{r.scope ? `${r.scope}:${r.action}` : '未解析行'}</span>
            <span className="bpr-msg">{r.message}</span>
          </div>
        ))}
        <div className="bp-foot">统计口径：最近 {view.lines.length} 条真实日志中的 warn/error 行；只展示，不提供批量忽略（程序无该动作）。</div>
      </>
    );
  }

  function renderLogLines(view: OutputLogView) {
    if (view.lines.length === 0) {
      return (
        <div className="bp-empty" data-testid="dock-log-empty">
          <Icon name="receipt" size={20} />
          <div>日志为空：主进程尚无动作记录（有操作后自动留痕）。</div>
        </div>
      );
    }
    return (
      <>
        {view.lines.map((l, i) => (
          <div className={`bp-row lv-${l.level}`} data-testid="dock-log-row" key={`${l.ts ?? i}-${i}`} title={l.raw}>
            <span className="bpr-time">{formatLogClock(l.ts)}</span>
            <span className={`bpr-lv ${l.level}`}>{l.level === 'unknown' ? 'LOG' : l.level.toUpperCase()}</span>
            <span className="bpr-tag">{l.scope ? `${l.scope}:${l.action}` : '未解析行'}</span>
            <span className="bpr-msg">{l.message}</span>
          </div>
        ))}
        <div className="bp-foot">
          日志文件：{view.path ?? '未初始化（主进程尚未写日志）'} · 读取于 {new Date(view.capturedAt).toLocaleTimeString('zh-CN')}
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
          <div className="bp-empty err" data-testid="dock-tasks-error"><Icon name="warn" size={20} /><div>读取失败：{dockTasks.detail}</div></div>
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
          <div className="bp-empty err" data-testid="dock-audit-error"><Icon name="warn" size={20} /><div>读取失败：{dockAudit.detail}</div></div>
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

function RibbonGroupView({ group, onItem }: { group: { label: string; items: RibbonItem[] }; onItem: (i: RibbonItem) => void }) {
  const bigs = group.items.filter((i) => i.big);
  const smalls = group.items.filter((i) => !i.big);
  // 批次55：用户要求功能区命令由 3 行收成 2 行，单列最多 2 个小按钮；命令数量不变，只改排布。
  const chunks: RibbonItem[][] = [];
  for (let i = 0; i < smalls.length; i += 2) chunks.push(smalls.slice(i, i + 2));
  return (
    <div className="rgroup">
      <div className="rgroup-main">
        {bigs.map((it) => <RibbonButton key={it.label} item={it} onItem={onItem} />)}
        {chunks.map((c, i) => (
          <div className="rcol" key={`c-${i}`}>
            {c.map((it) => <RibbonButton key={it.label} item={it} onItem={onItem} />)}
          </div>
        ))}
      </div>
      <div className="rgroup-label">{group.label}</div>
    </div>
  );
}

function RibbonButton({ item, onItem }: { item: RibbonItem; onItem: (i: RibbonItem) => void }) {
  const tip = `${item.label}${item.kbd ? ` (${item.kbd})` : ''}${item.unavailable ? ` · 不可用：${item.unavailable}` : ''}`;
  return (
    <button
      className={item.big ? 'rbig' : 'rsmall'}
      onClick={() => onItem(item)}
      disabled={Boolean(item.unavailable)}
      title={tip}
      type="button"
    >
      <Icon name={item.icon} size={item.big ? 18 : 13} />
      <span>{item.label}</span>
      {!item.big && item.kbd ? <span className="rsk">{item.kbd}</span> : null}
    </button>
  );
}

/** 批次54：角标只显示真实读数，title 写清来源，避免被误认成参考图里的示例数字。 */
const NAV_COUNT_TITLES: Record<string, string> = {
  'memory-bank': '真实账本记忆条数（coreListMemories，非参考图示例数）',
  dispute: '内核真实 pending 冲突队列长度（coreConflicts）',
  agent: '接入后端真实 Agent 卡片数（GET /agents）',
};

function NavTreeItem({ item, activeId, open, counts, onToggle, onSelect, onMenu }: {
  item: NavItem;
  activeId: string;
  open: boolean;
  counts: Record<string, number>;
  onToggle: () => void;
  onSelect: (i: NavItem) => void;
  onMenu: (i: NavItem, e: ReactMouseEvent) => void;
}) {
  const hasKids = Boolean(item.children?.length);
  const count = counts[item.id] ?? 0;
  return (
    <>
      <div
        className={`tree-row${item.id === activeId ? ' active' : ''}${item.child ? ' child' : ''}`}
        onClick={() => onSelect(item)}
        onContextMenu={(e) => onMenu(item, e)}
        role="treeitem"
        aria-selected={item.id === activeId}
      >
        {hasKids ? (
          <span className="tw" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            <Icon name={open ? 'caret' : 'chev'} size={9} />
          </span>
        ) : <span className="tw" />}
        <span className="tico"><Icon name={item.icon} size={item.child ? 12 : 14} /></span>
        <span className="tlabel">{item.label}</span>
        {item.unavailable ? <span className="tcount">不可用</span> : null}
        {count > 0 ? (
          <span className="tcount" data-testid={`nav-count-${item.id}`}
            title={NAV_COUNT_TITLES[item.id] ?? '页面同源回传的真实计数'}>{count}</span>
        ) : null}
      </div>
      {hasKids && open && item.children?.map((c) => (
        <NavTreeItem key={c.id} item={c} activeId={activeId} open={false} counts={counts} onToggle={() => {}} onSelect={onSelect} onMenu={onMenu} />
      ))}
    </>
  );
}
