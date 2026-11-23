// 记忆管理统一视图（批次57 精简六页签）：全部记忆 / 活跃 / 休眠 / 归档 / 弃用 / 分层 L1–L6 + 9 列账本 + 分层策略。
//
// 数据口径：
// - 列表 / 分层计数 / 最近写入 / 到龄 / 库位置全部读真实账本与内核；
// - 状态四态语义派生（coreMemoryOps.deriveMemoryStatus）：弃用=merged_into、休眠=cold/dormant、归档=archived、其余=活跃；
// - 账本没有的字段（按条成本、同步游标、端别）如实写「未记录 / 未提供」，不用演示值冒充；
// - 冲突队列与 L0 会话只作页头/真源条读数；裁决在冲突裁决页（dispute.html）、L0 管理在安全页，本页不重复；
// - 批次57 起行右键 = 常驻详情菜单（点外部/滚动不关闭，Esc 或 × 关闭），行点击仍是右侧详情抽屉。

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { hostCapability } from '../../desktop/hostBridge.ts';
import { coreConflicts } from '../dispute/coreDispute.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import { useKernelLoad, useRefreshAll } from '../shared/kernelLoad.tsx';
import { pagerWindow } from '../shared/pagerWindow.ts';
import { autoPageSize, MIN_AUTO_PAGE_SIZE } from '../shared/paginate.ts';
import { publishSelection } from '../shared/selectionChannel.ts';
import { useSessionContext } from '../shared/session.ts';
import { requestShellView } from '../shared/shellNavigate.ts';
import { formatRemaining, useL0Session } from '../shared/useL0Session.ts';
import {
  coreApplyOp, coreLayerPolicy, coreListMemories, coreUpdateContent, openMemoryFile, storageLocation,
  type LayerPolicySnapshot,
} from './coreMemoryOps.ts';
import { filterAndPaged, initialMemoryFilter, type MemoryFilter } from './memoryFilter.ts';
import type { MemoryRecord } from './types.ts';

type TabId = 'all' | 'active' | 'dormant' | 'archived' | 'deprecated' | 'layers';
const TAB_IDS: TabId[] = ['all', 'active', 'dormant', 'archived', 'deprecated', 'layers'];

const TAB_LABEL: Record<TabId, string> = {
  all: '全部记忆',
  active: '活跃',
  dormant: '休眠',
  archived: '归档',
  deprecated: '弃用',
  layers: '分层 L1–L6',
};

/** 状态页签（批次57）：按 deriveMemoryStatus 语义派生的账本状态过滤 */
const STATUS_TABS: readonly TabId[] = ['active', 'dormant', 'archived', 'deprecated'];

const LAYER_IDS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const;
type LayerId = typeof LAYER_IDS[number];

/** 四态语义派生后的展示标签（批次57 起 status 只有这四种，蛰伏/陈旧不再出现在本页） */
const STATUS_LABEL: Record<string, string> = {
  active: '活跃',
  dormant: '休眠',
  archived: '归档',
  deprecated: '弃用',
};

const TYPE_LABEL: Record<string, string> = {
  decision: '决策',
  pitfall: '踩坑',
  preference: '偏好',
  fact: '事实',
  project: '项目',
  feedback: '反馈',
};

const loadMemories = () => coreListMemories();
const loadLayerPolicy = () => coreLayerPolicy();
const loadConflicts = () => coreConflicts();
const loadStorage = () => storageLocation();

function initialTab(): TabId {
  try {
    const raw = new URLSearchParams(location.search).get('tab') ?? '';
    if ((TAB_IDS as string[]).includes(raw)) return raw as TabId;
    // 旧深链兼容（批次57 前的 tab=conflict/review/l0/personal）→ 语义最近的新页签；
    // hash l0bar 同理。不做隐藏页签，页签条里没有的就是回 all。
    if (location.hash.includes('l0bar')) return 'all';
    if (raw === 'dormant' || raw === 'hibernating') return 'dormant';
    if (raw === 'archived' || raw === 'deprecated') return raw;
    if (raw === 'personal' || raw === 'l0' || raw === 'review' || raw === 'conflict') return 'all';
  } catch {
    /* 无 location（测试/SSR）→ 全部 */
  }
  return 'all';
}

function readDensity(): 'comfortable' | 'compact' {
  try {
    return localStorage.getItem('memdesk.shell.density.v1') === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function shortId(id: string, max = 14): string {
  if (id.length <= max) return id;
  return `${id.slice(0, max - 4)}…${id.slice(-3)}`;
}

function fmtWhen(value: string | null | undefined, withDate = true): string {
  if (!value) return '暂无记录';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '时间不可读';
  const p = (n: number) => String(n).padStart(2, '0');
  return withDate
    ? `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    : `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtImportance(v: number): string {
  const n = Math.round(v * 100) / 100;
  return n === 0 ? '0.00' : n.toFixed(2);
}

function statusView(m: MemoryRecord): { label: string; cls: string } {
  const label = STATUS_LABEL[m.status] ?? m.status;
  const cls = m.status === 'active'
    ? 'ok'
    : m.status === 'archived' || m.status === 'deprecated'
      ? 'neutral'
      : 'warn';
  return { label, cls };
}

function syncView(m: MemoryRecord): { label: string; cls: string; title: string } {
  if (m.conflict_id) return { label: '冲突', cls: 'red', title: `冲突 ${m.conflict_id}，待裁决` };
  if (m.pending_sync) return { label: '待上行', cls: 'amber', title: '内核 pending_sync=true，尚待回传' };
  if (m.version !== undefined) return { label: `本端 v${m.version}`, cls: 'gray', title: '本端账本版本号；页面不读取同步游标，不断言已同步' };
  return { label: '本端账本', cls: 'gray', title: '本端账本记录；同步游标页面未读取' };
}

function costSourceView(m: MemoryRecord): { label: string; title: string } {
  if (m.refined_by === 'llm') return { label: '厂商 LLM（按次）', title: 'refined_by=llm：本条内容由厂商 LLM 精炼，计费按调用次数；账本无逐条金额' };
  if (m.refined_by === 'llm_partial') return { label: '厂商 LLM（部分）', title: 'refined_by=llm_partial：部分层由厂商 LLM 精炼；账本无逐条金额' };
  if (m.refined_by === 'stub') return { label: '本地兜底', title: 'refined_by=stub：未接入 LLM，仅有本地层内容' };
  return { label: '未记录', title: '账本未记录本条的精炼来源；不伪造成本来源' };
}

function layerOf(m: MemoryRecord): string {
  return m.layer ?? '未标层';
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  return ta >= tb ? a : b;
}

interface LayerStat {
  id: LayerId;
  name: string;
  count: number;
  share: number;
  halfLife: string;
  limit: string;
  lastWrite: string | null;
  aged: number;
  policyKey: string;
}

/** 9 列账本（ID / 摘要 / 层级 / 状态 / 重要度 / 访问 / 最近更新 / 成本来源 / 同步）+ 动作位 + 行右键 */
export const COL_WIDTHS_DEFAULT = [84, 200, 52, 82, 64, 54, 96, 206, 82, 52];
export const COL_WIDTHS_KEY = 'mm.grid.colWidths.v1';

/** 列宽读盘：只接受与列数一致、且在 [44,520] 内的真实数值，异常时回落默认（不写坏账） */
function readColWidths(): number[] {
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(arr) && arr.length === COL_WIDTHS_DEFAULT.length
      && arr.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 44 && n <= 520)) {
      return arr as number[];
    }
  } catch {
    /* 隐私模式/损坏值：回落默认 */
  }
  return COL_WIDTHS_DEFAULT;
}

export function MemoryGrid({
  paged, selectedId, onSelect, onOpenFile, canOpenFile, onRowContext,
  onEdit, onDelete, onGotoLayer, onToast,
}: {
  paged: ReturnType<typeof filterAndPaged>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenFile: (rec: MemoryRecord) => void;
  canOpenFile: boolean;
  onRowContext: (rec: MemoryRecord, x: number, y: number) => void;
  onEdit: (rec: MemoryRecord) => void;
  onDelete: (rec: MemoryRecord) => void;
  onGotoLayer: (layer: string) => void;
  onToast: (msg: string) => void;
}) {
  // 列宽可拖拽 + 本地持久化（刷新 / 切页 / 重登 / 重启后仍生效）
  const [widths, setWidths] = useState<number[]>(readColWidths);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const dragRef = useRef<{ index: number; startX: number; startW: number } | null>(null);
  /** 「更多」菜单：fixed 定位，避免被滚动容器裁切；点外部 / Esc 关闭 */
  const [menu, setMenu] = useState<{ rec: MemoryRecord; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (ev: PointerEvent) => {
      const t = ev.target as HTMLElement;
      if (t.closest('.mm-more-menu') || t.closest('[data-mm-more]')) return;
      setMenu(null);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setMenu(null); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  function startResize(index: number, ev: React.PointerEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    dragRef.current = { index, startX: ev.clientX, startW: widthsRef.current[index] };
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = Math.max(44, Math.min(520, Math.round(d.startW + (e.clientX - d.startX))));
      setWidths((prev) => {
        if (prev[d.index] === w) return prev;
        const next = [...prev];
        next[d.index] = w;
        return next;
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dragRef.current = null;
      try {
        localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(widthsRef.current));
      } catch {
        /* 配额/隐私模式：本次仍生效，只是不跨会话 */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      onToast(`已复制${label}`);
    } catch {
      onToast(`复制${label}失败：当前环境未授权剪贴板`);
    }
  }

  function openMenu(rec: MemoryRecord, ev: React.MouseEvent<HTMLButtonElement>) {
    ev.stopPropagation();
    const r = ev.currentTarget.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.right - 168, window.innerWidth - 176));
    const y = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 270));
    setMenu({ rec, x, y });
  }

  const totalWidth = widths.reduce((a, b) => a + b, 0);
  const heads: { label: string; cls?: string }[] = [
    { label: 'ID' }, { label: '摘要' }, { label: '层级' }, { label: '状态' },
    { label: '重要度', cls: 'num' }, { label: '访问', cls: 'num' }, { label: '最近更新' },
    { label: '成本来源' }, { label: '同步' }, { label: '动作', cls: 'ra' },
  ];

  return (
    <div className="table-wrap mm-table-wrap">
      <table className="grid mm-grid" data-testid="memory-table" style={{ minWidth: totalWidth }}>
        <colgroup>
          {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <thead>
          <tr>
            {heads.map((h, i) => (
              <th key={h.label} className={h.cls} data-col={i}>
                {h.label}
                {i < heads.length - 1 && (
                  <span
                    className="mm-col-resizer"
                    data-testid={`mm-col-resizer-${i}`}
                    role="separator"
                    aria-orientation="vertical"
                    title="拖拽调整列宽（自动保存，刷新/重登后保持）"
                    onPointerDown={(e) => startResize(i, e)}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paged.items.map((m) => {
            const st = statusView(m);
            const sy = syncView(m);
            const cs = costSourceView(m);
            return (
              <tr
                key={m.id}
                data-testid={`memory-row-${m.id}`}
                className={`${selectedId === m.id ? 'selected' : ''} ${m.locked ? 'locked' : ''}`}
                onClick={() => onSelect(m.id)}
                onContextMenu={(e) => {
                  // 批次57：行右键 = 常驻详情菜单；preventDefault 让壳层不再接管本 iframe 事件
                  e.preventDefault();
                  onRowContext(m, e.clientX, e.clientY);
                }}
              >
                <td className="mono idc" title={m.id}>{shortId(m.id)}</td>
                <td className="mm-summary" title={m.content}>
                  <span className="trunc">{m.content}</span>
                  <span className="mm-type-chip">{TYPE_LABEL[m.type] ?? m.type}</span>
                </td>
                <td><span className="tag gray mm-layer-chip">{layerOf(m)}</span></td>
                <td>
                  <span className="cell-status">
                    <i className={`dot ${st.cls}`} />
                    {st.label}
                    {m.locked ? <span className="mm-lock-mark" title="locked：内核拒绝改写">锁</span> : null}
                  </span>
                </td>
                <td className="num">{fmtImportance(m.importance)}</td>
                <td className="num">{m.access_count}</td>
                <td title={m.updated_at}>{fmtWhen(m.updated_at)}</td>
                <td className="mm-cost" title={cs.title}>{cs.label}</td>
                <td><span className={`tag ${sy.cls}`} title={sy.title}>{sy.label}</span></td>
                <td className="ra">
                  <span className="mm-row-actions">
                    <button
                      type="button"
                      className="mm-icon-btn"
                      title="查看详情并同步到壳层属性检查器"
                      aria-label="查看详情"
                      onClick={(e) => { e.stopPropagation(); onSelect(m.id); }}
                    >
                      <Glyph name="eye" />
                    </button>
                    <button
                      type="button"
                      className="mm-icon-btn"
                      title="更多动作：编辑 / 复制 ID / 复制内容 / 跳分层 / 打开文件 / 删除"
                      aria-label="更多动作"
                      data-mm-more="1"
                      data-testid={`mm-more-${m.id}`}
                      onClick={(e) => openMenu(m, e)}
                    >
                      <Glyph name="more" />
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {menu ? (
        <div className="mm-more-menu" role="menu" style={{ left: menu.x, top: menu.y }} data-testid="mm-more-menu">
          <button type="button" role="menuitem" onClick={() => { setMenu(null); onSelect(menu.rec.id); }}>查看详情</button>
          <button type="button" role="menuitem" data-testid="mm-more-edit" disabled={menu.rec.locked} onClick={() => { setMenu(null); onEdit(menu.rec); }}>编辑内容</button>
          <button type="button" role="menuitem" data-testid="mm-more-copy-id" onClick={() => { void copyText(menu.rec.id, ' ID'); setMenu(null); }}>复制 ID</button>
          <button type="button" role="menuitem" data-testid="mm-more-copy-content" onClick={() => { void copyText(menu.rec.content, '内容'); setMenu(null); }}>复制内容</button>
          <button type="button" role="menuitem" data-testid="mm-more-goto-layer" onClick={() => { setMenu(null); onGotoLayer(layerOf(menu.rec)); }}>跳到分层 {layerOf(menu.rec)}</button>
          <button type="button" role="menuitem" disabled={!canOpenFile} onClick={() => { setMenu(null); onOpenFile(menu.rec); }}>打开记忆文件</button>
          <button type="button" role="menuitem" className="danger" data-testid="mm-more-delete" disabled={menu.rec.locked} onClick={() => { setMenu(null); onDelete(menu.rec); }}>删除</button>
        </div>
      ) : null}
    </div>
  );
}

function Glyph({ name }: { name: 'search' | 'refresh' | 'layers' | 'lock' | 'unlock' | 'eye' | 'open' | 'warn' | 'info' | 'user' | 'shield' | 'check' | 'x' | 'chev' | 'more' }) {
  const paths: Record<typeof name, ReactNode> = {
    search: <><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2l3.3 3.3" /></>,
    refresh: <><path d="M13.5 6.5A5.2 5.2 0 1 0 14 10" /><path d="M13.5 3.5v3h-3" /></>,
    layers: <><path d="M8 2.6l5.4 2.7L8 8 2.6 5.3z" /><path d="M2.6 8L8 10.7 13.4 8" /><path d="M2.6 10.7L8 13.4 13.4 10.7" /></>,
    lock: <><rect x="3.4" y="7" width="9.2" height="6.2" rx="1.2" /><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" /></>,
    unlock: <><rect x="3.4" y="7" width="9.2" height="6.2" rx="1.2" /><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0" /></>,
    eye: <><path d="M1.8 8S4.2 4.2 8 4.2 14.2 8 14.2 8 11.8 11.8 8 11.8 1.8 8 1.8 8z" /><circle cx="8" cy="8" r="1.9" /></>,
    open: <><path d="M6 3.6H3.2v9.2h9.2V10" /><path d="M8.4 3.2h4.4v4.4" /><path d="M12.6 3.4L7.2 8.8" /></>,
    warn: <><path d="M8 2.8l5.4 9.4H2.6z" /><path d="M8 6.2v3" /><circle cx="8" cy="11" r=".7" /></>,
    info: <><circle cx="8" cy="8" r="5.4" /><path d="M8 7.2v3.4" /><circle cx="8" cy="5.2" r=".7" /></>,
    user: <><circle cx="8" cy="5.2" r="2.4" /><path d="M3.8 13c.5-2.3 2.1-3.5 4.2-3.5s3.7 1.2 4.2 3.5" /></>,
    shield: <><path d="M8 2.8l4.4 1.6v3.4c0 2.6-1.7 4.4-4.4 5.4-2.7-1-4.4-2.8-4.4-5.4V4.4z" /></>,
    check: <><path d="M3 8.4l3.2 3.1 6.8-7.1" /></>,
    x: <><path d="M4 4l8 8" /><path d="M12 4L4 12" /></>,
    chev: <><path d="M5 6.4l3 3 3-3" /></>,
    more: <><circle cx="3.4" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.6" cy="8" r="1.1" /></>,
  };
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true" focusable="false">{paths[name]}</svg>
  );
}

export function MemoryManagementPage() {
  useHostTheme();
  const [density, setDensity] = useState(readDensity);
  const [tab, setTab] = useState<TabId>(initialTab);
  const [filter, setFilter] = useState<MemoryFilter>(() => initialMemoryFilter(location.search));
  const [page, setPage] = useState(1);
  // 分页容量不再写死 10：按账本滚动区真实可见高度自适应，最少 25 行（高度放大后不留空白）
  const [pageSize, setPageSize] = useState<number>(MIN_AUTO_PAGE_SIZE);
  const tableAreaRef = useRef<HTMLDivElement>(null);
  const [selectedLayer, setSelectedLayer] = useState<LayerId | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<Date | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const memories = useKernelLoad('memory-management-list', loadMemories);
  const layerPolicy = useKernelLoad('memory-management-layers', loadLayerPolicy);
  // 冲突队列只作页头/真源条读数（裁决在冲突裁决页 dispute.html，本页不再重复四模式 UI）
  const conflictLoad = useKernelLoad('memory-management-conflicts', loadConflicts);
  const storage = useKernelLoad('memory-management-storage', loadStorage);
  /**
   * 页面级「刷新」= 本页全部数据源一起重取（2026-11-10 统一刷新逻辑）。
   * 批次57：个人记忆/待重放页签已删除，不再加载对应数据源。
   */
  const refreshAll = useRefreshAll([memories, layerPolicy, conflictLoad, storage]);
  const session = useSessionContext();

  useEffect(() => {
    const onStorage = () => setDensity(readDensity());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (memories.phase === 'ok') setSnapshotAt(new Date());
    else setSnapshotAt(null);
  }, [memories.phase, memories.data]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  const canOpenFile = hostCapability() !== 'none';

  function goTab(next: TabId) {
    setTab(next);
    setPage(1);
    setSelectedId(null);
    setSelectedLayer(null);
    try {
      const params = new URLSearchParams(location.search);
      params.set('tab', next);
      const qs = params.toString();
      history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
    } catch {
      /* history 不可用不影响切换 */
    }
  }

  function goView(id: string, file: string) {
    requestShellView(id);
    try {
      if (window.parent === window) {
        const params = new URLSearchParams(location.search);
        const backend = params.get('backend');
        const qs = backend ? `?backend=${encodeURIComponent(backend)}` : '';
        location.href = `/${file}${qs}`;
      }
    } catch {
      /* 导航失败不编造成功 */
    }
  }

  const tableSource = useMemo(() => {
    const list = memories.data ?? [];
    if (tab === 'layers' && selectedLayer) return list.filter((m) => m.layer === selectedLayer);
    // 状态页签（批次57）：按语义派生状态过滤（status 已在 coreMemoryOps 派生）
    if (STATUS_TABS.includes(tab)) return list.filter((m) => m.status === tab);
    return list;
  }, [memories.data, tab, selectedLayer]);

  const paged = useMemo(() => filterAndPaged(tableSource, filter, { page, pageSize }), [tableSource, filter, page, pageSize]);

  // 每页行数跟随账本滚动区的真实可见高度（窗口/底栏开合/分辨率变化都会重新量）
  useEffect(() => {
    const el = tableAreaRef.current;
    if (!el) return;
    const measure = () => setPageSize(autoPageSize(el.clientHeight));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);

  const layerTotal = useMemo(
    () => (memories.data ?? []).filter((m) => m.layer && m.layer !== 'L0').length,
    [memories.data],
  );

  const layerStats = useMemo<LayerStat[]>(() => {
    const specs: LayerPolicySnapshot[] = layerPolicy.data ?? [];
    const rows = memories.data ?? [];
    return specs.map((s) => {
      const layerRows = rows.filter((m) => m.layer === s.layer);
      const count = layerRows.length;
      const share = layerTotal > 0 ? count / layerTotal : 0;
      let halfLife: string;
      if (s.halfLifeDays !== undefined) {
        halfLife = `${s.halfLifeDays} 天（全局覆盖）`;
      } else if (count > 0) {
        const hs = layerRows.map((m) => m.halfLifeDays).filter((n) => Number.isFinite(n) && n > 0);
        const min = Math.min(...hs);
        const max = Math.max(...hs);
        halfLife = Number.isFinite(min) ? (min === max ? `${min} 天（按类别）` : `${min}–${max} 天（按类别）`) : '按类别默认';
      } else {
        halfLife = '按类别默认';
      }
      const limit = s.maxChars !== null
        ? `${s.maxChars} 字`
        : s.maxKeywords !== undefined && s.maxKeywords !== null
          ? `${s.maxKeywords} 关键词`
          : '不限';
      let lastWrite: string | null = null;
      let aged = 0;
      for (const m of layerRows) {
        lastWrite = maxIso(lastWrite, m.updated_at);
        const half = s.halfLifeDays ?? m.halfLifeDays;
        if (m.status === 'archived' || m.status === 'dormant' || (Number.isFinite(half) && half > 0 && m.ageDays > half)) {
          aged += 1;
        }
      }
      const policyKey = s.maxChars !== null
        ? `layerSpecs.${s.layer}.maxChars`
        : s.maxKeywords !== undefined && s.maxKeywords !== null
          ? `layerSpecs.${s.layer}.maxKeywords`
          : `layerSpecs.${s.layer}.maxChars（不限）`;
      return { id: s.layer, name: s.name, count, share, halfLife, limit, lastWrite, aged, policyKey };
    });
  }, [layerPolicy.data, memories.data, layerTotal]);

  const selectedRecord = useMemo(
    () => (memories.data ?? []).find((m) => m.id === selectedId) ?? null,
    [memories.data, selectedId],
  );

  // 2026-11-22：详情抽屉内联编辑（真实 coreUpdateContent 写回原条目）；行「更多 → 编辑内容」直达
  const [drawerEdit, setDrawerEdit] = useState<{ id: string; text: string; busy: boolean } | null>(null);
  useEffect(() => {
    setDrawerEdit((prev) => (prev && prev.id !== selectedId ? null : prev));
  }, [selectedId]);

  useEffect(() => {
    if (!selectedRecord) {
      publishSelection(null);
      return;
    }
    const st = statusView(selectedRecord);
    publishSelection({
      v: 1,
      page: 'memory.html',
      title: `记忆 ${shortId(selectedRecord.id, 22)}`,
      subtitle: `${TYPE_LABEL[selectedRecord.type] ?? selectedRecord.type} · ${st.label} · ${layerOf(selectedRecord)}`,
      fields: [
        { k: 'ID', v: selectedRecord.id, mono: true },
        { k: '层级', v: layerOf(selectedRecord), mono: true },
        { k: '状态', v: st.label },
        { k: '重要度', v: fmtImportance(selectedRecord.importance), mono: true },
        { k: '置信度', v: selectedRecord.confidence.toFixed(2), mono: true },
        { k: '访问', v: String(selectedRecord.access_count), mono: true },
        { k: '最近更新', v: selectedRecord.updated_at },
        { k: '冲突', v: selectedRecord.conflict_id ?? '无记录' },
      ],
    });
  }, [selectedRecord]);

  useEffect(() => () => publishSelection(null), []);

  async function openFile(rec: MemoryRecord) {
    const r = await openMemoryFile(rec.id);
    if (r.ok) setToast(r.path ? `已在系统中打开：${r.path}` : '已请求系统打开记忆文件');
    else setToast(`打开失败：${r.error ?? '主进程未返回原因'}`);
  }

  /** 行「更多 → 编辑内容」/ 抽屉「编辑」：打开详情并进入内联编辑（locked 由内核拒绝，这里先提示） */
  function startDrawerEdit(rec: MemoryRecord) {
    if (rec.locked) {
      setToast('locked：内核拒绝改写该条记忆');
      return;
    }
    setSelectedId(rec.id);
    setCtxDetail({ rec, x: Math.max(12, window.innerWidth - 380), y: 96 });
    setDrawerEdit({ id: rec.id, text: rec.content, busy: false });
  }

  /** 内联编辑保存：真实 coreUpdateContent 写回原条目（版本 +1、落审计），成功后刷新账本 */
  async function saveDrawerEdit() {
    if (!selectedRecord || !drawerEdit || drawerEdit.id !== selectedRecord.id) return;
    const text = drawerEdit.text.trim();
    if (!text) {
      setToast('内容为空：未保存（原条目保持原样）');
      return;
    }
    setDrawerEdit({ ...drawerEdit, busy: true });
    try {
      const r = await coreUpdateContent(selectedRecord.id, text);
      if (!r?.ok) {
        setDrawerEdit({ ...drawerEdit, busy: false });
        setToast(`保存失败：${r?.error ?? '内核未返回原因'}`);
        return;
      }
      setDrawerEdit(null);
      setCtxDetail(null);
      refreshAll();
      setToast(`已保存：写回记忆 ${shortId(selectedRecord.id)}（v${r.rec?.version ?? '更新'}，未新增重复）`);
    } catch (e) {
      setDrawerEdit({ ...drawerEdit, busy: false });
      setToast(`保存失败：${String((e as Error)?.message ?? e)}`);
    }
  }

  /** 行「更多 → 删除」：二次确认后走内核真实 delete（写墓碑/审计），成功后退出详情并刷新 */
  async function deleteRecord(rec: MemoryRecord) {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`删除记忆 ${shortId(rec.id)}？\n\n删除后立即退出检索与召回；账本保留墓碑可追溯，页面不再显示。`)
      : false;
    if (!ok) {
      setToast('已取消删除：记忆未改动');
      return;
    }
    try {
      const r = await coreApplyOp(rec, 'delete');
      if (!r?.ok) {
        setToast(r?.audit === 'locked_blocked' ? '删除失败：locked 条目被内核拒绝改写' : '删除失败：内核未执行该操作');
        return;
      }
      if (selectedId === rec.id) setSelectedId(null);
      refreshAll();
      setToast(`已删除 ${shortId(rec.id)}（审计 ${r.audit}）`);
    } catch (e) {
      setToast(`删除失败：${String((e as Error)?.message ?? e)}`);
    }
  }

  function resetFilter() {
    setFilter({ search: '', type: 'all', status: 'all', source: 'all' });
    setSelectedLayer(null);
    setPage(1);
  }

  const filtersActive = Boolean(
    (filter.search ?? '').trim()
    || (filter.type && filter.type !== 'all')
    || (filter.status && filter.status !== 'all')
    || (filter.source && filter.source !== 'all')
    || selectedLayer,
  );

  // L0 会话状态只作页头/真源条读数；解锁与查阅已归安全页，本页不再承载解锁表单
  const l0 = useL0Session({
    onExpired: (reason) => {
      setToast(reason === 'idle_5min' ? 'L0 已自动上锁：空闲满 5 分钟。' : `L0 已自动上锁：${reason}`);
    },
  });

  // 常驻右键详情菜单（批次57）：右键行打开，点外部/滚动不关闭，Esc 或 × 关闭；右键另一行切换内容
  const [ctxDetail, setCtxDetail] = useState<{ rec: MemoryRecord; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!ctxDetail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxDetail(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ctxDetail]);

  const tabCount = (id: TabId): string | null => {
    if (id === 'all') return memories.phase === 'ok' ? String(memories.data?.length ?? 0) : null;
    if (id === 'layers') return layerPolicy.phase === 'ok' ? '6' : null;
    // 状态页签（批次57）：按语义派生状态计数，账本没读到就不显示数字，不编造
    if (STATUS_TABS.includes(id)) {
      return memories.phase === 'ok'
        ? String((memories.data ?? []).filter((m) => m.status === id).length)
        : null;
    }
    return null;
  };

  const storageText = storage.phase === 'loading'
    ? '账本位置读取中'
    : storage.phase === 'error'
      ? '账本位置读取失败'
      : storage.data?.kind === 'file'
        ? `账本文件 ${storage.data.path ? storage.data.path.split(/[\\/]/).pop() : '（路径未返回）'}`
        : storage.data?.kind === 'memory'
          ? (storage.data.source === 'http-backend'
            ? `登录后端账本 ${storage.data.path ?? ''}（只读镜像）`
            : '浏览器内存账本（无磁盘）')
          : '账本位置未知';

  const sessionText = session.loading ? '会话读取中' : session.role === 'admin' ? '管理员' : session.role === 'member' ? '普通成员' : '未登录';
  const l0Text = l0.session ? `已解锁 ${formatRemaining(l0.remainingMs)}` : '已锁定';
  const conflictText = conflictLoad.phase === 'ok'
    ? `${conflictLoad.data?.length ?? 0} 待裁决`
    : conflictLoad.phase === 'error'
      ? '读取失败'
      : '读取中';

  return (
    <div className="mm-app" data-density={density} data-testid="mm-page">
      {/* v5 页头（批次 B）：20px 标题 + 右侧主操作。
          2026-11-22 用户要求：删掉 tagline 描述文字，标题下只保留一行真实读数（原两行合并、不重复、不留空行）。 */}
      <div className="p0-pagehead" data-testid="mm-head">
        <div className="p0-ph-main">
          <div className="p0-ph-title">
            <h1>记忆库</h1>
            <span className="mm-truthline" data-testid="mm-truthline" title="本页六个页签读的是同一份内核账本快照；以下均为真实读数，不是示例数据">
              <span data-testid="mm-head-count">{(memories.data ?? []).length} 条记忆</span>
              <span className="mm-truth-sep">·</span>
              <span>{storage.phase === 'ok' ? storageText : '账本位置读取中…'}</span>
              <span className="mm-truth-sep">·</span>
              <span>会话 {sessionText}</span>
              <span className="mm-truth-sep">·</span>
              <span>L0 {l0Text}</span>
              <span className="mm-truth-sep">·</span>
              <span>冲突 {conflictText}</span>
              <span className="mm-truth-sep">·</span>
              <span>{`快照 ${snapshotAt ? fmtWhen(snapshotAt.toISOString(), false) : '尚未读取'}`}</span>
            </span>
          </div>
        </div>
        <div className="p0-ph-actions">
          <button type="button" className="mm-btn" onClick={refreshAll}
            title="重新读取本页全部数据（列表 / 分层策略 / 冲突队列 / 库位置）">
            刷新
          </button>
          <button type="button" className="mm-btn primary" onClick={() => goView('write', 'write.html')}>
            新建记忆
          </button>
        </div>
      </div>

      <div className="tabstrip mm-tabstrip" role="tablist" aria-label="记忆管理标签">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-testid={`mm-tab-${id}`}
            className={`vtab ${tab === id ? 'active' : ''}`}
            onClick={() => goTab(id)}
          >
            {TAB_LABEL[id]}
            {tabCount(id) ? <span className="vcount">{tabCount(id)}</span> : null}
          </button>
        ))}
      </div>

      {(tab === 'all' || STATUS_TABS.includes(tab)) ? (
        <div className="mm-filterbar" data-testid="mm-filter">
          <label className="mm-search">
            <Glyph name="search" />
            <input
              value={filter.search ?? ''}
              placeholder="搜索内容 / ID / 标签"
              aria-label="搜索记忆"
              onChange={(e) => { setFilter((f) => ({ ...f, search: e.target.value })); setPage(1); }}
            />
          </label>
          <select
            className="mm-in"
            aria-label="类型筛选"
            value={filter.type ?? 'all'}
            onChange={(e) => { setFilter((f) => ({ ...f, type: e.target.value })); setPage(1); }}
          >
            <option value="all">全部类型</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select
            className="mm-in"
            aria-label="状态筛选"
            value={filter.status ?? 'all'}
            onChange={(e) => { setFilter((f) => ({ ...f, status: e.target.value })); setPage(1); }}
          >
            <option value="all">全部状态</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select
            className="mm-in"
            aria-label="来源筛选"
            value={filter.source ?? 'all'}
            onChange={(e) => { setFilter((f) => ({ ...f, source: e.target.value })); setPage(1); }}
          >
            <option value="all">全部来源</option>
            <option value="collected">采集通道</option>
            <option value="manual">手动写入</option>
          </select>
          <span className="mm-spacer" />
          <span className="mm-filter-count">{paged.total} / {tableSource.length} 条</span>
          <label className="mm-size">
            每页
            <b className="mm-size-auto" data-testid="mm-page-size">{pageSize}</b>
            条（按可见高度自适应，最少 {MIN_AUTO_PAGE_SIZE}）
          </label>
          <button type="button" className="mm-btn" onClick={resetFilter} disabled={!filtersActive}>重置</button>
        </div>
      ) : null}

      <div className={`mm-body mm-body-${tab}`}>
        {(tab === 'all' || tab === 'layers' || STATUS_TABS.includes(tab)) ? (
          <>
            {tab === 'layers' ? (
              <div className="layer-pane mm-layerpane">
                <div className="mm-layer-head">
                  <b>分层 L1–L6 策略</b>
                  <span className="mm-layer-sub">条数 / 占比 / 最近写入 / 到龄来自当前账本快照；半衰期与阈值来自内核 LAYER_SPECS 与参数快照</span>
                  <span className="mm-spacer" />
                  <div className="mm-layer-tools">
                    <button type="button" className="mm-btn" onClick={refreshAll} title="重新读取本页全部数据（列表 / 分层策略 / 冲突队列 / 库位置）"><Glyph name="refresh" />刷新快照</button>
                    <button type="button" className="mm-btn" onClick={() => goView('params', 'params.html')}>查看参数</button>
                    <button type="button" className="mm-btn" disabled title="本组只读：批量归档需在生命周期页逐条执行">批量归档</button>
                    <button type="button" className="mm-btn primary" onClick={() => goView('security', 'security.html')} title="L0 解锁与管理已归安全页（批次57 起 L0 密文页签移除）"><Glyph name="unlock" />L0 与安全</button>
                  </div>
                </div>
                {layerPolicy.phase === 'loading' ? (
                  <div className="p0-empty">正在读取分层策略…</div>
                ) : layerPolicy.phase === 'error' ? (
                  <div className="p0-empty dashed">
                    <b>分层策略没读到</b>
                    <div>原因：{layerPolicy.error}</div>
                    <div className="p0-row-actions"><button type="button" className="mm-btn" onClick={layerPolicy.retry}>重试</button></div>
                  </div>
                ) : (
                  <table className="lay-matrix mm-layer-matrix" data-testid="mm-layer-matrix">
                    <colgroup>
                      <col style={{ width: 44 }} />
                      <col style={{ width: 42 }} />
                      <col style={{ width: 64 }} />
                      <col style={{ width: 104 }} />
                      <col style={{ width: 58 }} />
                      <col style={{ width: 78 }} />
                      <col style={{ width: 34 }} />
                      <col />
                    </colgroup>
                    <thead>
                      <tr className="lay-groups">
                        <th />
                        <th colSpan={2}>规模</th>
                        <th colSpan={2}>策略</th>
                        <th colSpan={2}>时效</th>
                        <th className="mm-policy-col">策略键</th>
                      </tr>
                      <tr>
                        <th title="层（悬停看中文名）">层</th>
                        <th className="num">条数</th>
                        <th>占比</th>
                        <th>半衰期</th>
                        <th>阈值上限</th>
                        <th>最近写入</th>
                        <th className="num">到龄</th>
                        <th className="mm-policy-col">策略键</th>
                      </tr>
                    </thead>
                    <tbody>
                      {layerStats.map((row) => (
                        <tr
                          key={row.id}
                          className={`${row.count === 0 ? 'zero' : ''} ${selectedLayer === row.id ? 'sel' : ''}`}
                          onClick={() => { setSelectedLayer((prev) => (prev === row.id ? null : row.id)); setPage(1); }}
                          title="点击筛选下方表格；再次点击取消"
                        >
                          <td title={`${row.id} ${row.name}`}><span className="lay-chip">{row.id}</span></td>
                          <td className="num">{row.count}</td>
                          <td className="mm-share-num">{layerTotal > 0 ? `${(row.share * 100).toFixed(1)}%` : '未取数'}</td>
                          <td>{row.halfLife}</td>
                          <td>{row.limit}</td>
                          <td title={row.lastWrite ?? ''}>{fmtWhen(row.lastWrite)}</td>
                          <td className="num">{row.aged}</td>
                          <td className="mono mm-policy-key mm-policy-col" title="单一真源：src/core/memagent/layerRules.ts LAYER_SPECS">{row.policyKey}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="lay-foot">
                  <span className="lf-strong">{selectedLayer ? `当前筛选 ${selectedLayer}` : '当前未筛选层'}</span>
                  <span>到龄 = 温度 archived/dormant 或 ageDays &gt; 半衰期（按行快照计算）</span>
                  <span className="lf-sp" />
                  <span>分层记录 {layerTotal} 条；L0 密文不计入此表</span>
                  {selectedLayer ? <button type="button" className="lay-all" onClick={() => { setSelectedLayer(null); setPage(1); }}>显示全部层</button> : null}
                </div>
              </div>
            ) : null}

            <div className="mm-table-area" ref={tableAreaRef}>
              {memories.phase === 'loading' ? (
                <div className="p0-empty">正在读取真实账本…</div>
              ) : memories.phase === 'error' ? (
                <div className="p0-empty dashed mm-error-panel">
                  <b>账本没读到</b>
                  <div>原因：{memories.error}</div>
                  <div className="p0-row-actions"><button type="button" className="mm-btn" onClick={memories.retry}>重试</button></div>
                </div>
              ) : (memories.data?.length ?? 0) === 0 ? (
                <div className="p0-empty dashed" data-testid="mm-empty-ledger">
                  <b>账本暂无记忆（真实 0 条）</b>
                  <div>这里没有注入种子或演示条目；写入页产生第一条真实记忆后，此表才出现行。</div>
                </div>
              ) : paged.total === 0 ? (
                <div className="p0-empty dashed" data-testid="mm-empty-filter">
                  <b>当前筛选无命中</b>
                  <div>{selectedLayer ? `层 ${selectedLayer} 在该筛选下没有记录。` : '筛选条件保留在筛选条里，可一键重置。'}</div>
                  <div className="p0-row-actions"><button type="button" className="mm-btn" onClick={resetFilter}>重置筛选</button></div>
                </div>
              ) : (
                <>
                  <MemoryGrid
                    paged={paged}
                    selectedId={selectedId}
                    onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
                    onOpenFile={openFile}
                    canOpenFile={canOpenFile}
                    onRowContext={(rec, x, y) => setCtxDetail({ rec, x, y })}
                    onEdit={startDrawerEdit}
                    onDelete={(rec) => void deleteRecord(rec)}
                    onGotoLayer={(layer) => { goTab('layers'); setSelectedLayer(layer as LayerId); }}
                    onToast={setToast}
                  />
                  <div className="center-foot p0-tblft">
                    <span className="cf-strong">{paged.total}</span>
                    <span>条 · 账本共 {(memories.data ?? []).length} 条</span>
                    <span>{selectedLayer ? `层 ${selectedLayer}` : '全部层'}</span>
                    <span className="lf-sp" />
                    <span>{selectedId ? '已选中 1 行' : '未选中行'} · {sessionText} · {canOpenFile ? '桌面端' : '浏览器只读'}</span>
                    <span>成本来源：账本无逐条金额，按精炼来源如实标注</span>
                    {/* v5 表底（批次 B）：紧凑数字 pager 窗口（‹ 1 … 4 5 6 … N ›） */}
                    <div className="p0-pager">
                      <button type="button" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)} aria-label="上一页" data-testid="mm-page-prev">‹</button>
                      {pagerWindow(paged.page, paged.totalPages).map((cell, i) =>
                        cell === '…' ? (
                          <span key={`gap-${i}`} aria-hidden="true">…</span>
                        ) : (
                          <button
                            key={cell}
                            type="button"
                            className={cell === paged.page ? 'on' : undefined}
                            data-testid={`mm-page-${cell}`}
                            onClick={() => setPage(cell)}
                            aria-label={`第 ${cell} 页`}
                          >
                            {cell}
                          </button>
                        ),
                      )}
                      <button type="button" disabled={paged.page >= paged.totalPages} onClick={() => setPage(paged.page + 1)} aria-label="下一页" data-testid="mm-page-next">›</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* 批次57：常驻右键详情菜单（点外部/滚动不关闭；Esc 或 × 关闭；右键另一行切换内容） */}
      {ctxDetail ? (() => {
        const rec = ctxDetail.rec;
        const top = Math.min(ctxDetail.y, Math.max(8, window.innerHeight - 90));
        const left = Math.min(ctxDetail.x, Math.max(8, window.innerWidth - 364));
        return (
          <div
            className="mm-ctx-detail"
            role="dialog"
            aria-label="记忆详情（右键常驻）"
            data-testid="mm-ctx-menu"
            style={{ left, top, maxHeight: `calc(100vh - ${top + 8}px)` }}
          >
            <div className="mm-ctx-head">
              <b>记忆详情</b>
              <span className="mm-spacer" />
              <span className="mm-ctx-hint">常驻 · 点外部不关闭</span>
              <button type="button" className="mm-icon-btn" onClick={() => setCtxDetail(null)} aria-label="关闭详情" data-testid="mm-ctx-close"><Glyph name="x" /></button>
            </div>
            <div className="mm-drawer-sub">
              <span className="tag gray">{TYPE_LABEL[rec.type] ?? rec.type}</span>
              <span className="tag blue">{layerOf(rec)}</span>
              <span>{statusView(rec).label}</span>
              {rec.locked ? <span className="tag red">locked</span> : null}
            </div>
            <dl className="mm-detail-list">
              <div><dt>ID</dt><dd className="mono">{rec.id}</dd></div>
              <div><dt>层级</dt><dd>{layerOf(rec)}</dd></div>
              <div><dt>温度</dt><dd>{rec.decay_class ?? '未记录'}</dd></div>
              <div><dt>重要度</dt><dd>{fmtImportance(rec.importance)}</dd></div>
              <div><dt>置信度</dt><dd>{rec.confidence.toFixed(2)}</dd></div>
              <div><dt>访问 / 强化</dt><dd>{rec.access_count} / {rec.reinforce_count}</dd></div>
              <div><dt>创建</dt><dd>{fmtWhen(rec.created_at)}</dd></div>
              <div><dt>最近更新</dt><dd>{fmtWhen(rec.updated_at)}</dd></div>
              <div><dt>半衰期</dt><dd>{rec.halfLifeDays} 天</dd></div>
              <div><dt>来源</dt><dd>{rec.source_agent ?? '手动写入'}</dd></div>
              <div><dt>版本</dt><dd>{rec.version ?? '未记录'}</dd></div>
              <div><dt>同步</dt><dd>{syncView(rec).label}</dd></div>
              <div><dt>冲突 ID</dt><dd className="mono">{rec.conflict_id ?? '无记录'}</dd></div>
              <div><dt>合并谱系</dt><dd className="mono">{rec.merged_from?.join(' , ') ?? rec.merged_into ?? '无记录'}</dd></div>
            </dl>
            {drawerEdit && drawerEdit.id === rec.id ? (
              <textarea
                className="mm-drawer-edit"
                value={drawerEdit.text}
                disabled={drawerEdit.busy}
                onChange={(e) => setDrawerEdit({ ...drawerEdit, text: e.target.value })}
                aria-label="编辑记忆正文"
                data-testid="mm-edit-input"
              />
            ) : (
              <div className="mm-drawer-content">{rec.content}</div>
            )}
            <div className="mm-drawer-actions">
              {drawerEdit && drawerEdit.id === rec.id ? (
                <>
                  <button type="button" className="mm-btn primary" disabled={drawerEdit.busy} onClick={() => void saveDrawerEdit()} data-testid="mm-edit-save">
                    {drawerEdit.busy ? '保存中…' : '保存'}
                  </button>
                  <button type="button" className="mm-btn" disabled={drawerEdit.busy} onClick={() => setDrawerEdit(null)}>取消</button>
                </>
              ) : (
                <>
                  <button type="button" className="mm-btn" disabled={rec.locked} title={rec.locked ? 'locked：内核拒绝改写' : '编辑正文并写回原条目'} onClick={() => startDrawerEdit(rec)} data-testid="mm-edit-btn">
                    编辑
                  </button>
                  <button type="button" className="mm-btn" disabled={!canOpenFile} title={canOpenFile ? '在系统中打开记忆文件' : '浏览器模式无法打开记忆文件'} onClick={() => void openFile(rec)}>
                    <Glyph name="open" />打开记忆文件
                  </button>
                  <button type="button" className="mm-btn" onClick={() => setCtxDetail(null)}>关闭</button>
                </>
              )}
            </div>
          </div>
        );
      })() : null}

      {selectedRecord ? (
        <aside className="mm-drawer" aria-label="记忆详情">
          <div className="mm-drawer-head">
            <b>记忆详情</b>
            <span className="mm-spacer" />
            <button type="button" className="mm-icon-btn" onClick={() => setSelectedId(null)} aria-label="关闭详情"><Glyph name="x" /></button>
          </div>
          <div className="mm-drawer-sub">
            <span className={`tag gray`}>{TYPE_LABEL[selectedRecord.type] ?? selectedRecord.type}</span>
            <span className="tag blue">{layerOf(selectedRecord)}</span>
            <span>{statusView(selectedRecord).label}</span>
            {selectedRecord.locked ? <span className="tag red">locked</span> : null}
          </div>
          <dl className="mm-detail-list">
            <div><dt>ID</dt><dd className="mono">{selectedRecord.id}</dd></div>
            <div><dt>层级</dt><dd>{layerOf(selectedRecord)}</dd></div>
            <div><dt>温度</dt><dd>{selectedRecord.decay_class ?? '未记录'}</dd></div>
            <div><dt>重要度</dt><dd>{fmtImportance(selectedRecord.importance)}</dd></div>
            <div><dt>置信度</dt><dd>{selectedRecord.confidence.toFixed(2)}</dd></div>
            <div><dt>访问 / 强化</dt><dd>{selectedRecord.access_count} / {selectedRecord.reinforce_count}</dd></div>
            <div><dt>创建</dt><dd>{fmtWhen(selectedRecord.created_at)}</dd></div>
            <div><dt>最近更新</dt><dd>{fmtWhen(selectedRecord.updated_at)}</dd></div>
            <div><dt>半衰期</dt><dd>{selectedRecord.halfLifeDays} 天</dd></div>
            <div><dt>来源</dt><dd>{selectedRecord.source_agent ?? '手动写入'}</dd></div>
            <div><dt>版本</dt><dd>{selectedRecord.version ?? '未记录'}</dd></div>
            <div><dt>同步</dt><dd>{syncView(selectedRecord).label}</dd></div>
            <div><dt>冲突 ID</dt><dd className="mono">{selectedRecord.conflict_id ?? '无记录'}</dd></div>
            <div><dt>合并谱系</dt><dd className="mono">{selectedRecord.merged_from?.join(' , ') ?? selectedRecord.merged_into ?? '无记录'}</dd></div>
          </dl>
          <div className="mm-drawer-content">{selectedRecord.content}</div>
          <div className="mm-drawer-actions">
            <button type="button" className="mm-btn" disabled={!canOpenFile} title={canOpenFile ? '在系统中打开记忆文件' : '浏览器模式无法打开记忆文件'} onClick={() => void openFile(selectedRecord)}>
              <Glyph name="open" />打开记忆文件
            </button>
            <button type="button" className="mm-btn" onClick={() => setSelectedId(null)}>关闭</button>
          </div>
        </aside>
      ) : null}

      {toast ? <div className="mm-toast" role="status">{toast}</div> : null}
    </div>
  );
}
