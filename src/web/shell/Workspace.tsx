// 工作台壳层（批次48 S1）：Ribbon + 导航树 + 标签条 + 属性检查器 + 任务窗 + 底部五标签 + 状态栏。
//
// 设计边界（与定稿 D1 一致）：
// - 壳只提供「导航与布局」，中心区用同源 iframe 承载已真实落地的页面；
// - 壳内任何数字都必须能追到真实来源：S1 阶段尚未接线的部位一律写「未接入」并给出原因，
//   绝不显示编造读数、假计数或「—」冒充真实值；
// - overview.html（演示通览）不进入主导航。

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { hasActiveSession } from '../Home/crossTabAuth.ts';
import { Icon } from './Icons.tsx';
import { loadOverview, type OverviewSnapshot } from './overview.ts';
import { loadPendingWrites, type PendingWritesResult } from './taskpane.ts';
import {
  BOTTOM_TABS, NAV, PAGES, RIBBON, findNav,
  type BottomTabId, type IconName, type NavEntry, type NavItem, type PageKey,
  type RibbonItem, type ShellAction,
} from './views.ts';
import { SELECTION_MSG, parseSelection, type SelectionPayload } from '../shared/selectionChannel.ts';

const STORE_THEME = 'memdesk.shell.theme.v1';
const STORE_DENSITY = 'memdesk.shell.density.v1';
const STORE_ZOOM = 'memdesk.shell.zoom.v1';

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
    { id: 'home', label: '概览', page: 'home' },
  ]);
  const [openParents, setOpenParents] = useState<Record<string, boolean>>({ ledger: true });
  const [navQuery, setNavQuery] = useState('');
  const [ribbonTab, setRibbonTab] = useState<string>('start');
  const [ribbonFolded, setRibbonFolded] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [inspCollapsed, setInspCollapsed] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
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
  const [overview, setOverview] = useState<OverviewSnapshot | null>(null);
  const [overviewBusy, setOverviewBusy] = useState(false);
  /** S4：中心区真实页面回传的选中项（null = 未选中/无回传，绝不推测） */
  const [selection, setSelection] = useState<SelectionPayload | null>(null);
  /** S5：任务窗「待重放写入」只读视图（null = 尚未读取） */
  const [pending, setPending] = useState<PendingWritesResult | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const pendingBusyRef = useRef(false);
  const frameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const activePageRef = useRef<PageKey | undefined>(undefined);

  const refreshOverview = useCallback(() => {
    setOverviewBusy(true);
    loadOverview()
      .then((s) => setOverview(s))
      .catch((e) => setOverview({
        loadedAt: Date.now(), kernelMode: 'browser', storageError: String(e),
        gains: [], health: { status: 'down', detail: '概览聚合异常', checkedAt: Date.now() },
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

  const resolvedTheme = theme === 'system' ? (darkSystem ? 'dark' : 'light') : theme;

  // 主题：写入 <html data-theme>，样式表按此切换（仅作用于壳层；21 页表现层本轮不改）
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', resolvedTheme);
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

  const active = useMemo(() => openTabs.find((t) => t.id === activeId) ?? openTabs[0], [activeId, openTabs]);
  const activeNav = active ? findNav(active.id) : undefined;

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

  // 缩放由 .shell 的 CSS zoom 统一承担（含 iframe），不再单独改写子页面文档，避免双重缩放

  const openView = useCallback((item: NavItem) => {
    setActiveId(item.id);
    setOpenTabs((tabs) => tabs.some((t) => t.id === item.id)
      ? tabs
      : [...tabs, { id: item.id, label: item.label, page: item.page, href: item.href, unavailable: item.unavailable }]);
    setMessage(`已切换到「${item.label}」。`);
  }, []);

  const closeTab = useCallback((id: string) => {
    setOpenTabs((tabs) => {
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return tabs;
      const next = tabs.filter((t) => t.id !== id);
      if (next.length === 0) return [{ id: 'home', label: '概览', page: 'home' }];
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
        setMessage('已刷新中心区真实页面。');
        break;
      case 'focusFilter':
        setMessage(`「${label}」请在页面内使用各自的筛选框；壳层未提供跨页搜索，不会伪造查找结果。`);
        break;
      default:
        break;
    }
  }, []);

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

  const navEntries = useMemo(() => filterEntries(NAV, navQuery.trim().toLowerCase()), [navQuery]);

  const activeRibbon = RIBBON.find((r) => r.id === ribbonTab) ?? RIBBON[0];

  return (
    <div
      className="shell"
      style={{
        '--nav-w': `${navCollapsed ? 0 : navWidth}px`,
        '--insp-w': `${inspCollapsed ? 0 : inspWidth}px`,
        '--dock-h': `${dockHeight}px`,
        '--shell-zoom': String(zoom / 100),
      } as CSSProperties}
    >
      <div className="ribbon">
        <div className="ribbon-tabs">
          {RIBBON.map((tab) => (
            <button
              key={tab.id}
              className={`rib-tab${tab.id === activeRibbon.id ? ' active' : ''}`}
              onClick={() => setRibbonTab(tab.id)}
              onDoubleClick={() => setRibbonFolded((v) => !v)}
              type="button"
            >{tab.label}</button>
          ))}
          <span className="rib-spring" />
          <label className="rib-search" title="按名称过滤左侧功能导航">
            <Icon name="search" size={11} />
            <input
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder="查找功能（左侧导航）"
              spellCheck={false}
              aria-label="查找功能导航"
            />
          </label>
          <button className="rib-fold" onClick={() => setRibbonFolded((v) => !v)} title="折叠功能区" type="button">
            <Icon name="fold" size={12} />
          </button>
        </div>
        {!ribbonFolded && (
          <div className="ribbon-body">
            {activeRibbon.groups.map((g) => (
              <RibbonGroupView key={g.label} group={g} onItem={onRibbonItem} />
            ))}
          </div>
        )}
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
                onToggle={() => setOpenParents((p) => ({ ...p, [entry.id]: !(p[entry.id] ?? false) }))}
                onSelect={openView}
              />
            ))}
            {navEntries.length === 0 && <div className="tree-note">没有匹配的功能项。</div>}
          </div>
          {!navCollapsed && (
            <div className="splitter" role="separator" aria-label="调整导航宽度" onPointerDown={(e) => startDrag('nav', e)} />
          )}
        </aside>

        <main className="center-pane" aria-label="工作区中心">
          <div className="tabstrip">
            {openTabs.map((t) => (
              <div key={t.id} className={`vtab${t.id === activeId ? ' active' : ''}`} onClick={() => setActiveId(t.id)}>
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

          {active?.page === 'home' && (
            <div className="ov-strip" aria-label="概览真实数据">
              <div className="ov-kpis">
                {overview ? overview.gains.map((g) => (
                  <div className="ov-kpi" key={g.title} title={`${g.desc}（来源：${g.src}）`}>
                    <span className="ov-t">{g.title}</span>
                    <b className="ov-b">{g.big}</b>
                    <span className="ov-s">{g.src}</span>
                  </div>
                )) : <span className="ov-loading">概览读取中…</span>}
              </div>
              <div className="ov-chips">
                <span className={`ov-chip${overview?.kernelMode === 'browser' ? ' warn' : ''}`}
                  title={overview?.kernelMode === 'browser' ? '浏览器模式使用的是进程内内存账本，不是本机记忆库' : '桌面壳经 IPC 读取主进程账本'}>
                  内核 {overview?.kernelMode === 'browser' ? '浏览器内存（非本机库）' : '桌面 IPC'}
                </span>
                <span className={`ov-chip${overview?.health.status === 'down' ? ' err' : ''}`}
                  title={overview ? `${overview.health.detail} · ${new Date(overview.health.checkedAt).toLocaleTimeString('zh-CN')}` : '尚未探测'}>
                  后端 {overview ? (overview.health.status === 'ok' ? '可达' : '不可达') : '探测中'}
                </span>
                <span className="ov-chip" title="本机会话标记（localStorage），仅表示是否登录">
                  会话 {overview?.session ? '已登录' : '未登录'}
                </span>
                <span className={`ov-chip${overview?.billing.status === 'unavailable' ? ' warn' : ''}`}
                  title={overview?.billing.detail ?? '尚未查询'}>
                  成本 {overview?.billing.status === 'ok' ? `余额可查 ${overview.billing.live}/${overview.billing.total}` : '不可用'}
                </span>
                {overview?.storageError && (
                  <span className="ov-chip err" title={overview.storageError}>账本读取失败</span>
                )}
              </div>
              <button className="ov-refresh" onClick={refreshOverview} disabled={overviewBusy} title="重新读取真实数据" type="button">
                <Icon name="refresh" size={11} />{overviewBusy ? '读取中' : '刷新'}
              </button>
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
          <aside className={`inspector-pane${inspCollapsed ? ' collapsed' : ''}`} aria-label="属性检查器">
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
            </button>
          ))}
          <span className="bp-spring" />
          <button className="bp-tool" onClick={() => setDockOpen((v) => !v)} title="折叠 / 展开底部面板" type="button">
            <Icon name="panel" size={12} />
          </button>
        </div>
        {dockOpen && (
          <div className="bp-body">
            <div className="bp-empty">
              <Icon name={BOTTOM_TABS.find((t) => t.id === dockTab)?.icon ?? 'receipt'} size={20} />
              <div>{BOTTOM_TABS.find((t) => t.id === dockTab)?.unavailable}</div>
            </div>
          </div>
        )}
      </section>

      {statusVisible && (
        <div className="statusbar">
          <span className="sb-cell sb-accent">
            <span className={`dot ${sessionActive ? 'ok' : 'err'}`} />
            会话 <b>{sessionActive ? '已登录' : '未登录'}</b>{sessionActive ? '' : ' · 只读'}
          </span>
          <span className="sb-cell sb-msg">{message}</span>
          <span className="sb-cell" title="账本位置将由 storage:location 提供（后续动作接入）">库 <b>待读取</b></span>
          <span className="sb-cell" title="余额与成本口径以「模型与成本」页为准（后续动作汇总）">成本 <b>未接入</b></span>
          <span className="sb-cell" title="程序暂无调度运行记录的持久化存储">后台 <b>未接入</b></span>
          <span className="sb-cell" title="L0 会话状态将在后续动作接入">L0 <b>未接入</b></span>
          <span className="sb-spring" />
          <span className="sb-cell">已选 <b>未接入</b></span>
          <span className="sb-cell">行高 <b>{density === 'compact' ? 24 : 28}</b> px</span>
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
    </div>
  );

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
  const chunks: RibbonItem[][] = [];
  for (let i = 0; i < smalls.length; i += 3) chunks.push(smalls.slice(i, i + 3));
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
      <Icon name={item.icon} size={item.big ? 24 : 13} />
      <span>{item.label}</span>
      {!item.big && item.kbd ? <span className="rsk">{item.kbd}</span> : null}
    </button>
  );
}

function NavTreeItem({ item, activeId, open, onToggle, onSelect }: {
  item: NavItem;
  activeId: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (i: NavItem) => void;
}) {
  const hasKids = Boolean(item.children?.length);
  return (
    <>
      <div
        className={`tree-row${item.id === activeId ? ' active' : ''}${item.child ? ' child' : ''}`}
        onClick={() => onSelect(item)}
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
      </div>
      {hasKids && open && item.children?.map((c) => (
        <NavTreeItem key={c.id} item={c} activeId={activeId} open={false} onToggle={() => {}} onSelect={onSelect} />
      ))}
    </>
  );
}
