// 记忆管理统一视图（批次：记忆管理组）：六标签 + 9 列账本 + 分层策略 + L0 + 四模式冲突裁决。
//
// 数据口径：
// - 列表 / 分层计数 / 最近写入 / 到龄 / L0 条目 / 冲突队列全部读真实账本与内核；
// - 账本没有的字段（按条成本、同步游标、端别）如实写「未记录 / 未提供」，不用演示值冒充；
// - 个人记忆按 D2 保持「程序暂无数据模型」的标签内不可用态，不显示任何计数；
// - 冲突裁决以内核返回的 ok/resolved 为准，拒绝或未落定一律不当成功。

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { hostCapability } from '../../desktop/hostBridge.ts';
import { coreConflicts, coreVerdict } from '../dispute/coreDispute.ts';
import { VERDICTS } from '../dispute/DisputeVerdict.tsx';
import type { ConflictRecord, Verdict } from '../dispute/types.ts';
import { useDisputeMirror } from '../dispute/useDisputeMirror.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import { kernelErrorText, useKernelLoad } from '../shared/kernelLoad.tsx';
import { PAGE_SIZES, DEFAULT_PAGE_SIZE } from '../shared/paginate.ts';
import { publishSelection } from '../shared/selectionChannel.ts';
import { useSessionContext } from '../shared/session.ts';
import { requestShellView } from '../shared/shellNavigate.ts';
import { formatRemaining, useL0Session } from '../shared/useL0Session.ts';
import { loadPendingWrites, type PendingWritesResult } from '../shell/taskpane.ts';
import {
  coreBrowse, coreLayerPolicy, coreListMemories, openMemoryFile, storageLocation,
  type LayerPolicySnapshot,
} from './coreMemoryOps.ts';
import { filterAndPaged, initialMemoryFilter, type MemoryFilter } from './memoryFilter.ts';
import type { MemoryRecord } from './types.ts';

type TabId = 'all' | 'personal' | 'layers' | 'conflict' | 'review' | 'l0';
const TAB_IDS: TabId[] = ['all', 'personal', 'layers', 'conflict', 'review', 'l0'];

const TAB_LABEL: Record<TabId, string> = {
  all: '全部记忆',
  personal: '个人记忆',
  layers: '分层 L1–L6',
  conflict: '冲突',
  review: '待重放写入',
  l0: 'L0 密文（需解锁）',
};

const LAYER_IDS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const;
type LayerId = typeof LAYER_IDS[number];

const STATUS_LABEL: Record<string, string> = {
  active: '活跃',
  hibernating: '蛰伏',
  archived: '已归档',
  deprecated: '弃用',
  stale: '陈旧',
  dormant: '休眠',
};

const TYPE_LABEL: Record<string, string> = {
  decision: '决策',
  pitfall: '踩坑',
  preference: '偏好',
  fact: '事实',
  project: '项目',
  feedback: '反馈',
};

const CONFLICT_TYPE_LABEL: Record<string, string> = {
  direct_contradiction: '直接矛盾',
  partial_overlap: '部分重叠',
  context_dependent: '依赖上下文',
  uncertain: '不确定',
};

const loadMemories = () => coreListMemories();
const loadLayerPolicy = () => coreLayerPolicy();
const loadConflicts = () => coreConflicts();
const loadPending = () => loadPendingWrites();
const loadStorage = () => storageLocation();

function initialTab(): TabId {
  try {
    const raw = new URLSearchParams(location.search).get('tab') ?? '';
    if ((TAB_IDS as string[]).includes(raw)) return raw as TabId;
    if (location.hash.includes('l0bar')) return 'l0';
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
  return n === 0 ? '0' : String(n).replace(/^0/, '');
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

/** 9 列账本（ID / 摘要 / 层级 / 状态 / 重要度 / 访问 / 最近更新 / 成本来源 / 同步）+ 动作位 */
function MemoryGrid({
  paged, selectedId, onSelect, onOpenFile, canOpenFile,
}: {
  paged: ReturnType<typeof filterAndPaged>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenFile: (rec: MemoryRecord) => void;
  canOpenFile: boolean;
}) {
  return (
    <div className="table-wrap mm-table-wrap">
      <table className="grid mm-grid" data-testid="memory-table">
        <colgroup>
          <col style={{ width: 96 }} />
          <col />
          <col style={{ width: 72 }} />
          <col style={{ width: 84 }} />
          <col style={{ width: 66 }} />
          <col style={{ width: 60 }} />
          <col style={{ width: 78 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 58 }} />
        </colgroup>
        <thead>
          <tr>
            <th>ID</th>
            <th>摘要</th>
            <th>层级</th>
            <th>状态</th>
            <th className="num">重要度</th>
            <th className="num">访问</th>
            <th>最近更新</th>
            <th>成本来源</th>
            <th>同步</th>
            <th className="ra">动作</th>
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
                      title={canOpenFile ? '在系统里打开本条记忆文件' : '桌面端才可打开记忆文件'}
                      aria-label="打开记忆文件"
                      disabled={!canOpenFile}
                      onClick={(e) => { e.stopPropagation(); onOpenFile(m); }}
                    >
                      <Glyph name="open" />
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Glyph({ name }: { name: 'search' | 'refresh' | 'layers' | 'lock' | 'unlock' | 'eye' | 'open' | 'warn' | 'info' | 'user' | 'shield' | 'check' | 'x' | 'chev' }) {
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
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [selectedLayer, setSelectedLayer] = useState<LayerId | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<Date | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const memories = useKernelLoad('memory-management-list', loadMemories);
  const layerPolicy = useKernelLoad('memory-management-layers', loadLayerPolicy);
  const conflictLoad = useKernelLoad('memory-management-conflicts', loadConflicts);
  const pending = useKernelLoad<PendingWritesResult>('memory-management-pending', loadPending);
  const storage = useKernelLoad('memory-management-storage', loadStorage);
  const session = useSessionContext();
  const mirror = useDisputeMirror();

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
    return list;
  }, [memories.data, tab, selectedLayer]);

  const paged = useMemo(() => filterAndPaged(tableSource, filter, { page, pageSize }), [tableSource, filter, page, pageSize]);

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

  // L0 连续查阅会话（5 分钟；失焦不续期，到期自动上锁）
  const l0 = useL0Session({
    onExpired: (reason) => {
      setL0Notice(null);
      setL0Error(reason === 'idle_5min' ? 'L0 已自动上锁：空闲满 5 分钟。' : `L0 已自动上锁：${reason}`);
    },
  });
  const [l0Password, setL0Password] = useState('');
  const [l0Grant, setL0Grant] = useState('');
  const [l0Error, setL0Error] = useState<string | null>(null);
  const [l0Notice, setL0Notice] = useState<string | null>(null);
  const [l0Rows, setL0Rows] = useState<{ rows: { mem_id: string; content: string }[]; l0_masked: boolean } | null>(null);
  const [l0Loading, setL0Loading] = useState(false);
  const l0SessionId = l0.session?.l0_session_id ?? null;
  const lockL0 = l0.lock;

  useEffect(() => {
    if (!l0SessionId) { setL0Rows(null); return; }
    let alive = true;
    setL0Loading(true);
    coreBrowse('L0', l0SessionId)
      .then((r) => {
        if (!alive) return;
        if (!r) {
          setL0Error('L0 会话失效，或授权未覆盖任何项目；已要求重新解锁。');
          setL0Rows(null);
          void lockL0();
          return;
        }
        setL0Rows(r);
      })
      .catch((e: unknown) => { if (alive) setL0Error(kernelErrorText(e)); })
      .finally(() => { if (alive) setL0Loading(false); });
    return () => { alive = false; };
  }, [l0SessionId, lockL0]);

  async function unlockL0() {
    setL0Error(null);
    setL0Notice(null);
    if (!l0Password.trim()) {
      setL0Error('请输入解锁密码：管理员用管理员密码，成员用一次性授权密码。');
      return;
    }
    const r = await l0.unlock(l0Password.trim(), l0Grant.trim() || undefined);
    if (!r.ok) {
      setL0Error(r.error);
      return;
    }
    setL0Password('');
    setL0Grant('');
    setL0Notice('已解锁：本次查阅会话 5 分钟；页面失焦不续期，到期自动上锁。');
  }

  // 冲突
  const [conflictId, setConflictId] = useState<string | null>(null);
  const [verdictMode, setVerdictMode] = useState<Verdict | null>(null);
  const [verdictBusy, setVerdictBusy] = useState(false);
  const [verdictMsg, setVerdictMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (conflictLoad.phase !== 'ok') { setConflictId(null); return; }
    const list = conflictLoad.data ?? [];
    setConflictId((prev) => (prev && list.some((c) => c.id === prev) ? prev : (list[0]?.id ?? null)));
  }, [conflictLoad.phase, conflictLoad.data]);

  const selectedConflict: ConflictRecord | null = useMemo(
    () => (conflictLoad.data ?? []).find((c) => c.id === conflictId) ?? null,
    [conflictLoad.data, conflictId],
  );

  useEffect(() => { setVerdictMode(null); setVerdictMsg(null); }, [conflictId]);

  async function runVerdict() {
    if (!selectedConflict || !verdictMode || verdictBusy) return;
    setVerdictBusy(true);
    setVerdictMsg(null);
    const rec = selectedConflict;
    const mode = verdictMode;
    try {
      const out = await coreVerdict(rec, mode);
      const requestId = out.kernel_request_ids[0] ?? '';
      if (requestId) mirror.audit(`verdict_${mode}`, rec, mode, requestId);
      let refreshError: string | null = null;
      try {
        const next = await coreConflicts();
        conflictLoad.replace(next);
        if (!next.some((c) => c.id === rec.id)) setConflictId(next[0]?.id ?? null);
      } catch (e: unknown) {
        refreshError = kernelErrorText(e);
      }
      if (!out.ok) {
        setVerdictMsg({ kind: 'err', text: `内核拒绝本次裁决：${out.reason ?? out.note}${requestId ? `（request_id ${requestId}）` : ''}` });
      } else if (out.resolved) {
        setVerdictMsg({ kind: 'ok', text: `内核已落定：${out.note}${requestId ? ` · request_id ${requestId}` : ''}${refreshError ? ` · 队列重读失败：${refreshError}` : ''}` });
        setVerdictMode(null);
      } else {
        setVerdictMsg({ kind: 'warn', text: `内核已记录裁决但未落定：${out.note}${requestId ? ` · request_id ${requestId}` : ''}${refreshError ? ` · 队列重读失败：${refreshError}` : ''}` });
        setVerdictMode(null);
      }
    } catch (e: unknown) {
      setVerdictMsg({ kind: 'err', text: `裁决调用失败：${kernelErrorText(e)}` });
    } finally {
      setVerdictBusy(false);
    }
  }

  const tabCount = (id: TabId): string | null => {
    if (id === 'all') return memories.phase === 'ok' ? String(memories.data?.length ?? 0) : null;
    if (id === 'layers') return layerPolicy.phase === 'ok' ? '6' : null;
    if (id === 'conflict') return conflictLoad.phase === 'ok' ? String(conflictLoad.data?.length ?? 0) : null;
    if (id === 'review') return pending.phase === 'ok' && pending.data?.status === 'ok' ? String(pending.data.view.count) : null;
    if (id === 'l0') return l0.session ? '已开' : '锁';
    return null;
  };

  const storageText = storage.phase === 'loading'
    ? '账本位置读取中'
    : storage.phase === 'error'
      ? '账本位置读取失败'
      : storage.data?.kind === 'file'
        ? `账本文件 ${storage.data.path ? storage.data.path.split(/[\\/]/).pop() : '（路径未返回）'}`
        : storage.data?.kind === 'memory'
          ? '浏览器内存账本（无磁盘）'
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

      {(tab === 'all' || tab === 'layers') ? (
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
          {tab === 'layers' && selectedLayer ? (
            <button type="button" className="mm-btn mm-layer-filter" onClick={() => { setSelectedLayer(null); setPage(1); }}>
              {selectedLayer} · 清除层筛选
            </button>
          ) : null}
          <span className="mm-spacer" />
          <span className="mm-filter-count">{paged.total} / {tableSource.length} 条</span>
          <label className="mm-size">
            每页
            <select className="mm-in" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button type="button" className="mm-btn" onClick={resetFilter} disabled={!filtersActive}>重置</button>
        </div>
      ) : null}

      <div className="table-meta mm-truthbar" data-testid="mm-truthbar">
        <span className="tm-strong">记忆管理</span>
        <span className="tm-chip"><i className={`dot ${storage.phase === 'error' || storage.data?.kind === 'unknown' ? 'err' : storage.data?.kind === 'memory' ? 'warn' : 'ok'}`} />{storageText}</span>
        <span className="tm-chip"><i className={`dot ${session.role === 'admin' ? 'ok' : session.role === 'member' ? 'info' : 'neutral'}`} />会话 {sessionText}</span>
        <span className="tm-chip"><i className={`dot ${l0.session ? 'ok' : 'warn'}`} />L0 {l0Text}</span>
        <span className="tm-chip"><i className={`dot ${conflictLoad.phase === 'error' ? 'err' : conflictLoad.data?.length ? 'warn' : 'neutral'}`} />冲突 {conflictText}</span>
        <span className="tm-right">{snapshotAt ? `快照 ${fmtWhen(snapshotAt.toISOString(), false)}` : '尚未读取'}</span>
      </div>

      <div className={`mm-body mm-body-${tab}`}>
        {(tab === 'all' || tab === 'layers') ? (
          <>
            {tab === 'layers' ? (
              <div className="layer-pane mm-layerpane">
                <div className="mm-layer-head">
                  <b>分层 L1–L6 策略</b>
                  <span className="mm-layer-sub">条数 / 占比 / 最近写入 / 到龄来自当前账本快照；半衰期与阈值来自内核 LAYER_SPECS 与参数快照</span>
                  <span className="mm-spacer" />
                  <div className="mm-layer-tools">
                    <button type="button" className="mm-btn" onClick={() => { memories.retry(); layerPolicy.retry(); }}><Glyph name="refresh" />刷新快照</button>
                    <button type="button" className="mm-btn" onClick={() => goView('params', 'params.html')}>查看参数</button>
                    <button type="button" className="mm-btn" disabled title="本组只读：批量归档需在生命周期页逐条执行">批量归档</button>
                    <button type="button" className="mm-btn primary" onClick={() => goTab('l0')}><Glyph name="unlock" />解锁 L0</button>
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
                      <col style={{ width: 158 }} />
                      <col style={{ width: 64 }} />
                      <col style={{ width: 122 }} />
                      <col style={{ width: 132 }} />
                      <col style={{ width: 96 }} />
                      <col style={{ width: 96 }} />
                      <col style={{ width: 64 }} />
                      <col />
                      <col style={{ width: 58 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>层级 / 名称</th>
                        <th className="num">条数</th>
                        <th>占比</th>
                        <th>半衰期</th>
                        <th>阈值上限</th>
                        <th>最近写入</th>
                        <th className="num">到龄</th>
                        <th>策略键</th>
                        <th className="ra">查看</th>
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
                          <td><span className="lay-chip">{row.id}</span> <span className="mm-layer-name">{row.name}</span></td>
                          <td className="num">{row.count}</td>
                          <td>
                            <div className="lay-bar">
                              <span style={{ width: `${Math.min(100, Math.round(row.share * 100))}%` }} />
                            </div>
                            <span className="mm-share-num">{layerTotal > 0 ? `${(row.share * 100).toFixed(1)}%` : '无分层记录'}</span>
                          </td>
                          <td>{row.halfLife}</td>
                          <td>{row.limit}</td>
                          <td title={row.lastWrite ?? ''}>{fmtWhen(row.lastWrite)}</td>
                          <td className="num">{row.aged}</td>
                          <td className="mono mm-policy-key" title="单一真源：src/core/memagent/layerRules.ts LAYER_SPECS">{row.policyKey}</td>
                          <td className="ra">
                            <button
                              type="button"
                              className="mm-icon-btn"
                              title="筛选/取消筛选该层"
                              aria-label="筛选该层"
                              onClick={(e) => { e.stopPropagation(); setSelectedLayer((prev) => (prev === row.id ? null : row.id)); setPage(1); }}
                            >
                              <Glyph name="chev" />
                            </button>
                          </td>
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

            <div className="mm-table-area">
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
                  />
                  <div className="center-foot">
                    <span className="cf-strong">{paged.total}</span>
                    <span>条 · 账本共 {(memories.data ?? []).length} 条</span>
                    <span>{selectedLayer ? `层 ${selectedLayer}` : '全部层'}</span>
                    <span className="lf-sp" />
                    <span>{selectedId ? '已选中 1 行' : '未选中行'} · {sessionText} · {canOpenFile ? '桌面端' : '浏览器只读'}</span>
                    <span>成本来源：账本无逐条金额，按精炼来源如实标注</span>
                    <button type="button" className="mm-page-btn" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)} aria-label="上一页">‹</button>
                    <span className="mm-page-no">{paged.page} / {paged.totalPages}</span>
                    <button type="button" className="mm-page-btn" disabled={paged.page >= paged.totalPages} onClick={() => setPage(paged.page + 1)} aria-label="下一页">›</button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}

        {tab === 'personal' ? (
          <div className="mm-scrollpane" data-testid="mm-personal-unavailable">
            <div className="p0-banner warn">
              <span><b>D2 · 个人记忆暂不可用：程序暂无该数据模型。</b> 这里保留记忆管理内的标签形态，但不显示任何条目、计数或确认动作。</span>
            </div>
            <div className="p0-hd">
              <h3>个人记忆</h3>
              <span className="p0-sub">个人/团队双窗与确认流在内核中尚无数据模型；不可用态如实展示，不做演示填充。</span>
              <span className="p0-right">
                <span className="p0-tag mono">personal=unavailable</span>
              </span>
            </div>
            <div className="pm-wrap mm-pm">
              <div className="pm-col pm-confirmed">
                <div className="pm-head">
                  <div className="pm-title"><Glyph name="user" />个人已确认<span className="n">无数据模型</span></div>
                  <div className="pm-sub">没有个人侧已确认记忆表，也没有可展示计数。</div>
                </div>
                <div className="pm-body">
                  <div className="pm-empty">
                    <b>程序暂无个人记忆数据模型</b>
                    <div>没有个人/团队双窗，也没有「已确认 / 待确认」流转；任何条目都会是编造，故不展示。</div>
                    <div className="em-mono">src/core/memagent · no personal memory model</div>
                  </div>
                </div>
              </div>
              <div className="pm-div" />
              <div className="pm-col pm-inbox">
                <div className="pm-head">
                  <div className="pm-title"><Glyph name="info" />个人收件箱<span className="n">未接入</span></div>
                  <div className="pm-sub">无采集确认流、无来源标注、无计数。</div>
                </div>
                <div className="pm-body">
                  <div className="pm-empty">
                    <b>收件箱不可用</b>
                    <div>个人记忆的采集确认流尚未实现；不使用假条目占位。</div>
                    <div className="em-mono">unavailable · 0 actions</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'review' ? (
          <div className="mm-scrollpane">
            <div className="p0-hd">
              <h3>待重放写入</h3>
              <span className="p0-sub">只读队列：MCP 写入兜底条目（不向渲染层返回正文、密钥材料或 token）。</span>
              <span className="p0-right">
                <button type="button" className="mm-btn" onClick={pending.retry}><Glyph name="refresh" />刷新</button>
              </span>
            </div>
            {pending.phase === 'loading' ? (
              <div className="p0-empty">正在读取待重放队列…</div>
            ) : pending.phase === 'error' ? (
              <div className="p0-empty dashed"><b>待重放队列没读到</b><div>原因：{pending.error}</div></div>
            ) : pending.data?.status === 'unavailable' ? (
              <div className="p0-empty dashed" data-testid="mm-review-unavailable">
                <b>暂不可读（不是空队列）</b>
                <div>{pending.data.detail}</div>
              </div>
            ) : pending.data?.status === 'error' ? (
              <div className="p0-empty dashed"><b>主进程返回错误</b><div>{pending.data.detail}</div></div>
            ) : pending.data?.status === 'ok' ? (
              pending.data.view.count === 0 ? (
                <div className="p0-empty dashed"><b>待重放队列为空（真实 0 条）</b><div>主进程 {pending.data.view.source} · 采集于 {fmtWhen(pending.data.view.captured_at)}</div></div>
              ) : (
                <div data-testid="mm-review-list">
                  <div className="p0-banner">
                    <span>{pending.data.view.note} 共 <b>{pending.data.view.count}</b> 条{pending.data.view.truncated ? `（仅展示最近 ${pending.data.view.items.length} 条）` : ''}；来源 {pending.data.view.source} · 采集于 {fmtWhen(pending.data.view.captured_at)}</span>
                  </div>
                  <table className="p0-table">
                    <thead>
                      <tr><th>入队 ID</th><th>项目</th><th>来源 Agent</th><th>类别</th><th className="right">正文字符</th><th className="right">标签</th><th className="right">重要度</th><th>入队时间</th></tr>
                    </thead>
                    <tbody>
                      {pending.data.view.items.map((it) => (
                        <tr key={it.id}>
                          <td className="mono">{shortId(it.id, 18)}</td>
                          <td className="mono">{it.project_id}</td>
                          <td>{it.source_agent ?? '未记录'}</td>
                          <td>{it.category}</td>
                          <td className="right">{it.content_chars}</td>
                          <td className="right">{it.tags}</td>
                          <td className="right">{it.importance === null ? '未记录' : fmtImportance(it.importance)}</td>
                          <td>{fmtWhen(new Date(it.created_at).toISOString())}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : null}
          </div>
        ) : null}

        {tab === 'l0' ? (
          <div className="mm-scrollpane" data-testid="mm-l0">
            <div className="p0-hd">
              <h3>L0 密文</h3>
              <span className="p0-sub">AES-256-GCM 原始层：不参与检索、不注入、不同步；查阅写 l0_view 审计。</span>
              <span className="p0-right">
                {l0.session ? (
                  <>
                    <span className="p0-tag ok">{`已解锁 · 剩余 ${formatRemaining(l0.remainingMs)}`}</span>
                    <button type="button" className="mm-btn" onClick={() => void l0.lock()}><Glyph name="lock" />立即锁定</button>
                  </>
                ) : (
                  <span className="p0-tag warn"><Glyph name="lock" />已锁定</span>
                )}
              </span>
            </div>

            {l0Notice ? <div className="p0-banner ok">{l0Notice}</div> : null}
            {l0Error ? <div className="p0-banner err">{l0Error}</div> : null}

            {!l0.session ? (
              <div className="mm-l0-gate">
                <div className="p0-card">
                  <div className="p0-card-h"><Glyph name="shield" />管理员门禁<span className="p0-right p0-tag mono">l0_session</span></div>
                  <div className="p0-card-b">
                    <div className="p0-note">
                      <b>解锁需要管理员密码，或管理员为成员发放的 grant_id + 一次性授权密码。</b>
                      <div>未登录时不能解锁；角色为普通成员时，admin 需先在「安全与账号」批准并发放授权。L0 查阅会话 5 分钟，失焦不心跳续期。</div>
                    </div>
                    <div className="mm-l0-form">
                      {session.role === 'member' ? (
                        <label className="mm-field">
                          <span>grant_id</span>
                          <input className="mm-in" value={l0Grant} onChange={(e) => setL0Grant(e.target.value)} placeholder="管理员发放的授权 ID" autoComplete="off" />
                        </label>
                      ) : null}
                      <label className="mm-field">
                        <span>{session.role === 'member' ? '一次性授权密码' : '管理员密码'}</span>
                        <input
                          className="mm-in"
                          type="password"
                          value={l0Password}
                          onChange={(e) => setL0Password(e.target.value)}
                          placeholder={session.role === 'member' ? '一次性授权密码' : '管理员密码'}
                          disabled={session.role === null || session.loading}
                          autoComplete="off"
                        />
                      </label>
                      <button
                        type="button"
                        className="mm-btn primary"
                        onClick={() => void unlockL0()}
                        disabled={l0.busy || session.role === null || session.loading}
                      >
                        <Glyph name="unlock" />{l0.busy ? '解锁中…' : '解锁查阅'}
                      </button>
                      {session.role === null ? (
                        <button type="button" className="mm-btn" onClick={() => goView('login', 'login.html')}>去登录</button>
                      ) : null}
                    </div>
                    <div className="p0-note mm-l0-note">
                      会话：{sessionText}{session.loading ? '（读取中）' : ''} · 角色：{session.role ?? '无'}.
                      {session.role === null ? ' 未登录时不会尝试解锁，也不会伪造成功。' : ''}
                      {session.role === 'member' ? ' 成员缺少 grant_id 时，内核会如实拒绝。' : ''}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {l0Loading ? <div className="p0-empty">正在读取 L0 条目…</div> : null}
                {l0Rows && l0Rows.rows.length === 0 ? (
                  <div className="p0-empty dashed"><b>L0 暂无可查阅条目（真实 0 条）</b><div>解锁会话有效，但当前授权项目没有 L0 记录。</div></div>
                ) : null}
                {l0Rows && l0Rows.rows.length > 0 ? (
                  <>
                    <div className="p0-banner">
                      <span>本次授权查阅 <b>{l0Rows.rows.length}</b> 条；{l0Rows.l0_masked ? '内核返回 l0_masked=true，内容仍为密文/脱敏。' : '内核返回已解密内容，仅在本次 5 分钟会话内可见。'}</span>
                    </div>
                    <table className="p0-table mm-l0-table">
                      <thead>
                        <tr><th>记忆 ID</th><th>内容片段</th><th className="right">字符数</th><th>查阅状态</th></tr>
                      </thead>
                      <tbody>
                        {l0Rows.rows.map((r) => (
                          <tr key={r.mem_id}>
                            <td className="mono">{shortId(r.mem_id, 18)}</td>
                            <td className="mm-l0-content" title={r.content}>{r.content}</td>
                            <td className="right">{r.content.length}</td>
                            <td>{l0Rows.l0_masked ? <span className="tag red">密文（未解密）</span> : <span className="tag green">已授权查阅</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {tab === 'conflict' ? (
          <div className="mm-scrollpane" data-testid="mm-conflict">
            <div className="p0-hd">
              <h3>冲突裁决</h3>
              <span className="p0-sub">队列来自内核冲突配对；类型/分数内核未检测字段如实为空，不猜测。</span>
              <span className="p0-right">
                <button type="button" className="mm-btn" onClick={conflictLoad.retry}><Glyph name="refresh" />重读队列</button>
              </span>
            </div>
            {conflictLoad.phase === 'loading' ? (
              <div className="p0-empty">正在读取冲突队列…</div>
            ) : conflictLoad.phase === 'error' ? (
              <div className="p0-empty dashed"><b>冲突队列没读到</b><div>原因：{conflictLoad.error}</div></div>
            ) : (conflictLoad.data?.length ?? 0) === 0 ? (
              <div className="p0-empty dashed" data-testid="mm-conflict-empty"><b>账本暂无待裁决冲突（真实 0 条）</b><div>内核只把有效配对入队；对手缺失或跨项目冲突不会在这里显示。</div></div>
            ) : (
              <div className="mm-conf-layout">
                <div className="mm-conf-list" data-testid="mm-conflict-list">
                  {(conflictLoad.data ?? []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`mm-conf-item ${conflictId === c.id ? 'sel' : ''}`}
                      onClick={() => setConflictId(c.id)}
                    >
                      <span className="mm-conf-item-t">
                        <i className={`dot ${c.overdue_days >= 7 ? 'err' : c.overdue_days >= 2 ? 'warn' : 'neutral'}`} />
                        <b>{shortId(c.id, 18)}</b>
                      </span>
                      <span className="mm-conf-item-m">
                        <span className="mono">旧 {shortId(c.old_id, 12)}</span>
                        <span className="mono">新 {shortId(c.new_id, 12)}</span>
                      </span>
                      <span className="mm-conf-item-m">
                        <span>{c.conflict_type ? (CONFLICT_TYPE_LABEL[c.conflict_type] ?? c.conflict_type) : '类型未检测'}</span>
                        <span>{c.overdue_days} 天</span>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="mm-conf-detail">
                  {selectedConflict ? (
                    <>
                      <div className="p0-card">
                        <div className="p0-card-h">
                          <b>冲突 {shortId(selectedConflict.id, 24)}</b>
                          <span className="p0-right">
                            <span className="p0-tag mono">{selectedConflict.conflict_type ?? 'type=null'}</span>
                            <span className="p0-tag mono">{selectedConflict.conflict_score === null ? 'score=null' : `score=${selectedConflict.conflict_score.toFixed(2)}`}</span>
                            <span className="p0-tag warn">{selectedConflict.overdue_days} 天未裁决</span>
                          </span>
                        </div>
                        <div className="p0-card-b">
                          <div className="mm-cmp-grid">
                            <div className="mm-cmp-card">
                              <div className="mm-cmp-h"><span className="tag blue">旧值 · 本端记录</span><span className="mono">{selectedConflict.old_id}</span><span className="mm-cmp-conf">置信度 {selectedConflict.old_confidence.toFixed(2)}</span></div>
                              <div className="mm-cmp-body">{selectedConflict.old_content || '内容为空（账本真实为空）'}</div>
                            </div>
                            <div className="mm-cmp-card">
                              <div className="mm-cmp-h"><span className="tag amber">新值 · 对端记录</span><span className="mono">{selectedConflict.new_id}</span><span className="mm-cmp-conf">置信度 {selectedConflict.new_confidence.toFixed(2)}</span></div>
                              <div className="mm-cmp-body">{selectedConflict.new_content || '内容为空（账本真实为空）'}</div>
                            </div>
                          </div>
                          <div className="p0-note mm-cmp-note">端别说明：内核只提供 old/new，不提供「本端/镜像」字段；这里按定稿顺序展示为旧值/新值，不对同步端别做断言。</div>
                        </div>
                      </div>

                      <div className="p0-card">
                        <div className="p0-card-h"><b>四模式裁决</b><span className="p0-right p0-tag mono">write=coreResolveConflict</span></div>
                        <div className="p0-card-b">
                          <div className="mm-modes" role="radiogroup" aria-label="裁决模式">
                            {VERDICTS.map((v) => (
                              <button
                                key={v.key}
                                type="button"
                                role="radio"
                                aria-checked={verdictMode === v.key}
                                data-testid={`mm-verdict-${v.key}`}
                                className={`mm-mode ${verdictMode === v.key ? 'active' : ''}`}
                                onClick={() => setVerdictMode(v.key)}
                                disabled={verdictBusy}
                              >
                                <span className="mm-mode-title">{v.label}<code>{v.key}</code></span>
                                <span className="mm-mode-desc">{v.desc}</span>
                              </button>
                            ))}
                          </div>
                          <div className="mm-verdict-actions">
                            <button
                              type="button"
                              className="mm-btn primary"
                              data-testid="mm-verdict-run"
                              onClick={() => void runVerdict()}
                              disabled={!verdictMode || verdictBusy}
                            >
                              <Glyph name="check" />{verdictBusy ? '内核裁决中…' : '执行内核裁决'}
                            </button>
                            <span className="p0-note">动作只在点按后调用内核；不预置 request_id、不乐观置成功。user_confirm / hold 内核会记录但保持待处理。</span>
                          </div>
                          {verdictMsg ? (
                            <div className={`p0-banner ${verdictMsg.kind}`} data-testid="mm-verdict-msg">{verdictMsg.text}</div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="p0-empty dashed">请选择左侧冲突。</div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {selectedRecord && (tab === 'all' || tab === 'layers') ? (
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
