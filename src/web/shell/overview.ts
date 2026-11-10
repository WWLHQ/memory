// 壳层「概览」数据条（批次48 S2）：只从真实链路取值，逐项标明来源与失败原因。
//
// 数据源：
//   · 内核账本 getHomeFeed(getKernelStorage()) —— 累计记忆 / 累计动作（审计条数）/ 近 1h 调用 / 待裁决
//   · home server /api/health —— 后端可达性（HTTP 状态）
//   · 本机会话标记 hasActiveSession() —— 是否登录（只读布尔）
//   · llm:billing —— 需要会话；非桌面壳/未登录/未初始化一律给原因，不显示编造余额
//
// 绝不在此处做「近似值」：任一来源失败就保留该字段的失败原因，不拿 0 冒充成功读数。

import { homeBaseUrl } from '../backend.ts';
import { hasActiveSession } from '../Home/crossTabAuth.ts';
import { getHomeFeed, emptySync } from '../Home/coreHome.ts';
import { emptyLayerGraph, type LayerGraph } from '../Home/layerGraph.ts';
import { FULL_BUDGET } from '../AgentOnboard/coreOnboard.ts';
import type { RawHomeFeed } from '../../home/dashboard.ts';
import { getKernelStorage } from '../kernel.ts';
import { currentSessionId } from '../shared/session.ts';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import type { Gain } from '../../types/agentOnboard.ts';
import type { HomeFacts, HomeStrataCount } from '../Home/coreHome.ts';
import type { AuditRecord } from '../../core/memagent/types.ts';
import { refineQueueState, refineQueueAvailable, type RefineQueueView } from '../params/refineQueue.ts';
import { hostLlmAvailable, type LlmEngineView } from '../hostLlm.ts';
import { getDataRoot } from '../memory/dataRoot.ts';
import type { McpWireState } from '../../agentOnboard/mcpClients.ts';

export interface OverviewHealth {
  status: 'ok' | 'down';
  detail: string;
  checkedAt: number;
}

export interface OverviewBilling {
  /** ok = 拿到了真实视图；unavailable = 有明确原因（未登录/非桌面壳/未初始化） */
  status: 'ok' | 'unavailable';
  detail: string;
  /** 视图中 vendor_live 的引擎数 / 总引擎数；仅 status=ok 时有值 */
  live?: number;
  total?: number;
}

/** 最近审计一行（UTC+08:00 时钟 + 动作 + 人话摘要，均来自内核审计账本） */
export interface OverviewAuditRow {
  t: string;
  action: string;
  memo: string;
}

export interface OverviewRecentAudits {
  ok: boolean;
  rows: OverviewAuditRow[];
  /** 全量审计行数（提示「查看全部」口径）；读不到为 0 */
  total: number;
  error: string | null;
}

/** 今日概览（UTC+08:00 今日起内核审计实算；四类真实计数，读不到给原因不冒充 0） */
export interface OverviewTodayPanel {
  ok: boolean;
  /** 今日入库成功（write 且 dedup≠filtered） */
  write: number;
  /** 今日召回 */
  recall: number;
  /** 今日分支嫁接 */
  graft: number;
  /** 今日被质量门拦下（write 且 dedup=filtered） */
  filtered: number;
  error: string | null;
}

/** TOKEN 节省率（今日召回 payload 相对 2.4.1 全量预算 FULL_BUDGET；sparkline 取近 N 次 payload） */
export interface OverviewTokenPanel {
  ok: boolean;
  /** 今日平均 payload 相对 FULL_BUDGET 的节省比例（0–100）；无今日召回为 null */
  savedPct: number | null;
  /** 今日召回次数 */
  recallCount: number;
  /** 今日累计相对 FULL_BUDGET 基线省下的 token */
  savedTokens: number;
  /** 近 N 次召回 payload_tokens 序列（倒序取末尾，供 sparkline 画真实曲线） */
  series: number[];
  error: string | null;
}

/** 补炼队列面板（主进程真队列；非桌面壳诚实不可用） */
export interface OverviewRefinePanel {
  ok: boolean;
  /** 桌面壳内可探主进程（含「没加载/不可用」的网关实况）；浏览器 = false */
  available: boolean;
  view: RefineQueueView | null;
  error: string | null;
}

/** MCP 客户端接入面板（主进程读本机配置；非桌面壳诚实不可用） */
export interface OverviewMcpRow {
  id: string;
  name: string;
  state: McpWireState;
  label: string;
  detail: string;
}

export interface OverviewMcpPanel {
  ok: boolean;
  available: boolean;
  endpoint: string | null;
  clients: OverviewMcpRow[];
  error: string | null;
}

/** 引擎延迟排行（llm:config 引擎 lastLatencyMs；未拨测 = null，不编造） */
export interface OverviewEngineRow {
  name: string;
  model: string;
  latencyMs: number | null;
}

export interface OverviewEnginePanel {
  ok: boolean;
  available: boolean;
  engines: OverviewEngineRow[];
  error: string | null;
}

/** 数据根（dataRoot:get）；非桌面壳诚实不可用 */
export interface OverviewDataRoot {
  available: boolean;
  root: string | null;
  error: string | null;
}

export interface OverviewSnapshot {
  loadedAt: number;
  /** host = 桌面壳经 IPC 读主进程账本；browser = 浏览器内存账本（非本机库） */
  kernelMode: 'host' | 'browser';
  storageError: string | null;
  gains: Gain[];
  /** 异常速览（真实账本派生；概览页编号洞察用） */
  raw: RawHomeFeed;
  /** 待回传条数（sync.wired=false 的诚实标注） */
  pendingSync: number;
  health: OverviewHealth;
  session: boolean;
  billing: OverviewBilling;
  /** 同一次账本读取得到的数值快照；读不到时 null（概览页统计卡直接显示真实数字） */
  facts: HomeFacts | null;
  /** 批次55：同一次账本读取派生的 L0–L6 计数，供层级刻度直接复用；读不到时 null */
  strata: HomeStrataCount[] | null;
  /** 批次57-B：层级图谱 / 效果证据四卡（来自 getHomeFeed，同一次账本读取） */
  effectGains: Gain[];
  graph: LayerGraph;
  /** 批次57-B：以下面板各自独立取数，任一失败只影响自身面板 */
  recentAudits: OverviewRecentAudits;
  /** 批次57-C：今日概览 / TOKEN 节省率（同一份全量审计实算，与 recentAudits 同源一次读取） */
  today: OverviewTodayPanel;
  token: OverviewTokenPanel;
  refine: OverviewRefinePanel;
  mcp: OverviewMcpPanel;
  engines: OverviewEnginePanel;
  dataRoot: OverviewDataRoot;
}

interface RawBillingEngine {
  provenance?: string;
}

interface McpClientRaw {
  id: string;
  name: string;
  state: McpWireState;
  installed: boolean;
  displayPath: string | null;
}

interface McpScanReply {
  endpoint: string;
  clients: McpClientRaw[];
}

const MCP_STATE_LABEL: Record<string, string> = {
  wired: '已接入',
  missing_auth: '缺令牌',
  missing_entry: '未配置',
  conflict: '冲突',
  invalid: '无法解析',
  no_config: '无配置',
  manual: '需手工',
};

function describeError(e: unknown): string {
  const msg = (e as { message?: string })?.message;
  return msg && msg.trim() ? msg : String(e);
}

/** UTC+08:00 时钟（审计 ts 是 epoch；用户可见时间统一本地时区） */
function fmtClock(ts: number): string {
  const d = new Date(ts + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function asRecord(detail: unknown): Record<string, unknown> {
  return (detail && typeof detail === 'object' ? detail : {}) as Record<string, unknown>;
}

/** 把一条审计翻译成人话摘要（recall 命中数 / write 结果 / 其余取 detail 关键字段，绝不编造） */
function auditMemo(a: AuditRecord): string {
  const d = asRecord(a.detail);
  switch (a.action) {
    case 'recall': {
      const hits = String(d.hits ?? 0);
      const q = typeof d.query === 'string' && d.query ? ` · ${d.query.slice(0, 24)}` : '';
      return `命中 ${hits}${q}`;
    }
    case 'write':
      return typeof d.error === 'string' && d.error ? d.error : '入库成功';
    case 'llm_fallback':
      return `${String(d.reason ?? '?')}（${String(d.code ?? '?')}）`;
    default: {
      const parts: string[] = [];
      for (const k of ['project_id', 'mem_id', 'model', 'engine', 'source']) {
        const v = d[k];
        if (typeof v === 'string' && v) parts.push(v);
      }
      return parts.length ? parts.slice(0, 2).join(' · ') : '账本无明细字段';
    }
  }
}

async function probeHealth(): Promise<OverviewHealth> {
  const base = homeBaseUrl();
  if (!base) return { status: 'down', detail: '未配置 home 后端地址', checkedAt: Date.now() };
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 3000) : null;
  try {
    const r = await fetch(`${base}/api/health`, { signal: ctrl?.signal });
    return {
      status: r.ok ? 'ok' : 'down',
      detail: `HTTP ${r.status}${r.ok ? '' : '（后端未就绪）'}`,
      checkedAt: Date.now(),
    };
  } catch (e) {
    return { status: 'down', detail: `不可达：${describeError(e)}`, checkedAt: Date.now() };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeBilling(session: boolean): Promise<OverviewBilling> {
  if (hostCapability() === 'none') return { status: 'unavailable', detail: '非桌面壳：无 llm:billing 通道' };
  if (!session) return { status: 'unavailable', detail: '需登录后查询（余额视图按会话鉴权）' };
  try {
    // 统一走宿主调用：桌面壳主 frame 与中心区 iframe 都能拿到真实结果
    const r = await hostCall<{ ok: boolean; engines?: unknown[]; error?: string }>(
      'llm:billing',
      [{ force: false }, currentSessionId()],
    );
    if (!r?.ok) return { status: 'unavailable', detail: `查询失败：${r?.error ?? '未知原因'}` };
    const engines = (r.engines ?? []) as RawBillingEngine[];
    const live = engines.filter((e) => e.provenance === 'vendor_live').length;
    return {
      status: 'ok',
      detail: live === 0 ? '无可查余额引擎（未配置或厂商无接口）' : `${live} 个引擎厂商实时可查`,
      live,
      total: engines.length,
    };
  } catch (e) {
    return { status: 'unavailable', detail: `查询异常：${describeError(e)}` };
  }
}

/** UTC+08:00 今日起点（epoch ms）：审计 ts 是 epoch，用户口径统一东八区 */
function todayStartUtc8(): number {
  const nowUtc8 = new Date(Date.now() + 8 * 3600_000);
  return Date.UTC(nowUtc8.getUTCFullYear(), nowUtc8.getUTCMonth(), nowUtc8.getUTCDate()) - 8 * 3600_000;
}

/** 一次全量审计读取，同口径派生三块面板（最近审计 / 今日概览 / TOKEN 节省率），任一失败共用同一原因 */
async function loadAuditPanels(recentLimit: number): Promise<{
  recent: OverviewRecentAudits;
  today: OverviewTodayPanel;
  token: OverviewTokenPanel;
}> {
  const emptyRecent: OverviewRecentAudits = { ok: false, rows: [], total: 0, error: null };
  const emptyToday: OverviewTodayPanel = { ok: false, write: 0, recall: 0, graft: 0, filtered: 0, error: null };
  const emptyToken: OverviewTokenPanel = { ok: false, savedPct: null, recallCount: 0, savedTokens: 0, series: [], error: null };
  try {
    const audits = await getKernelStorage().queryAudit({});
    const dayStart = todayStartUtc8();
    const isToday = (a: AuditRecord) => typeof a.ts === 'number' && a.ts >= dayStart;
    const recallToday = audits.filter((a) => a.action === 'recall' && isToday(a));
    const writeRec = audits.filter((a) => a.action === 'write' && isToday(a));
    // 质量门拦下的写入 detail.action='filtered_l0_to_l1'（qualityGate.filteredAuditDetail）；其余 write = 入库成功
    const today: OverviewTodayPanel = {
      ok: true,
      write: writeRec.filter((a) => asRecord(a.detail).action !== 'filtered_l0_to_l1').length,
      recall: recallToday.length,
      graft: audits.filter((a) => a.action === 'graft' && isToday(a)).length,
      filtered: writeRec.filter((a) => asRecord(a.detail).action === 'filtered_l0_to_l1').length,
      error: null,
    };
    // TOKEN 节省率：今日召回 payload_tokens vs FULL_BUDGET（2.4.1）；sparkline 取今日召回倒序 payload
    const payloads = recallToday
      .map((a) => Number(asRecord(a.detail).payload_tokens))
      .filter((n) => Number.isFinite(n) && n >= 0);
    const series = [...payloads].reverse().slice(-12);
    const avg = payloads.length ? payloads.reduce((s, n) => s + n, 0) / payloads.length : 0;
    const savedPct = payloads.length > 0 ? Math.max(0, Math.round((1 - avg / FULL_BUDGET) * 100)) : null;
    const savedTokens = payloads.reduce((s, n) => s + Math.max(0, FULL_BUDGET - n), 0);
    const token: OverviewTokenPanel = {
      ok: true,
      savedPct,
      recallCount: recallToday.length,
      savedTokens,
      series,
      error: null,
    };
    const rows = audits.slice(-recentLimit).reverse().map((a) => ({
      t: typeof a.ts === 'number' ? fmtClock(a.ts) : '无时间戳',
      action: a.action,
      memo: auditMemo(a),
    }));
    const recent: OverviewRecentAudits = { ok: true, rows, total: audits.length, error: null };
    return { recent, today, token };
  } catch (e) {
    const reason = `账本读不到：${describeError(e)}`;
    emptyRecent.error = reason;
    emptyToday.error = reason;
    emptyToken.error = reason;
    return { recent: emptyRecent, today: emptyToday, token: emptyToken };
  }
}

/** 补炼队列：主进程真队列（refine:state）；非桌面壳诚实不可用 */
async function loadRefinePanel(): Promise<OverviewRefinePanel> {
  if (!refineQueueAvailable()) {
    return { ok: false, available: false, view: null, error: '非桌面壳：补炼队列由主进程维护，浏览器模式没有它' };
  }
  const r = await refineQueueState();
  return { ok: r.ok, available: true, view: r.view, error: r.error };
}

/** MCP 接入：主进程读本机客户端配置（mcp:clients）；非桌面壳诚实不可用 */
async function loadMcpPanel(sid: string | null): Promise<OverviewMcpPanel> {
  if (hostCapability() === 'none') {
    return { ok: false, available: false, endpoint: null, clients: [], error: '非桌面壳：无法读取本机 MCP 客户端配置' };
  }
  try {
    const r = await hostCall<McpScanReply>('mcp:clients', [sid]);
    const clients = (r.clients ?? [])
      .filter((c) => c.installed !== false)
      .map((c) => ({
        id: c.id,
        name: c.name,
        state: c.state,
        label: MCP_STATE_LABEL[c.state] ?? c.state,
        detail: c.displayPath ?? '',
      }));
    return { ok: true, available: true, endpoint: r.endpoint ?? null, clients, error: null };
  } catch (e) {
    return { ok: false, available: true, endpoint: null, clients: [], error: `读取本机配置失败：${describeError(e)}` };
  }
}

/** 引擎延迟排行：llm:config 各引擎 lastLatencyMs（未拨测 = null，不编造） */
async function loadEnginePanel(sid: string | null): Promise<OverviewEnginePanel> {
  if (!hostLlmAvailable()) {
    return { ok: false, available: false, engines: [], error: '非桌面壳：无 llm:config 通道' };
  }
  try {
    const r = await hostCall<{ ok: boolean; engines?: LlmEngineView[]; error?: string }>(
      'llm:config',
      [sid],
    );
    if (!r.ok || !Array.isArray(r.engines)) {
      return { ok: false, available: true, engines: [], error: r.error ?? '主进程未返回引擎列表' };
    }
    const rows = r.engines.map((e) => ({
      name: e.name || e.id,
      model: e.model,
      latencyMs: typeof e.lastLatencyMs === 'number' ? e.lastLatencyMs : null,
    }));
    return { ok: true, available: true, engines: rows, error: null };
  } catch (e) {
    return { ok: false, available: true, engines: [], error: describeError(e) };
  }
}

/** 数据根：dataRoot:get 真目录；非桌面壳诚实不可用 */
async function loadDataRoot(): Promise<OverviewDataRoot> {
  if (hostCapability() === 'none') {
    return { available: false, root: null, error: '非桌面壳：无数据根' };
  }
  const r = await getDataRoot();
  return r.ok ? { available: true, root: r.info.root, error: null } : { available: true, root: null, error: r.error };
}

/** 真实加载：所有来源并行，任一失败都只影响自身字段，不影响其它读数 */
export async function loadOverview(): Promise<OverviewSnapshot> {
  const session = hasActiveSession();
  const sid = currentSessionId();
  const [
    feed,
    health,
    billing,
    auditPanels,
    refine,
    mcp,
    engines,
    dataRoot,
  ] = await Promise.all([
    getHomeFeed(getKernelStorage()).catch((e) => ({
      raw: { gains: [], anomalies: [], activeMemories: [], todos: [] } as RawHomeFeed,
      sync: emptySync(),
      graph: emptyLayerGraph(),
      effectGains: [] as Gain[],
      storageError: describeError(e),
      facts: null as HomeFacts | null,
      strata: null as HomeStrataCount[] | null,
    })),
    probeHealth(),
    probeBilling(session),
    loadAuditPanels(8),
    loadRefinePanel(),
    loadMcpPanel(sid),
    loadEnginePanel(sid),
    loadDataRoot(),
  ]);

  const f = feed as typeof feed & {
    storageError?: string | null;
    graph?: LayerGraph | null;
    effectGains?: Gain[];
    facts?: HomeFacts | null;
    strata?: HomeStrataCount[] | null;
    sync?: { pendingSync?: number };
  };
  return {
    loadedAt: Date.now(),
    kernelMode: hostCapability() === 'none' ? 'browser' : 'host',
    storageError: f.storageError ?? null,
    gains: (f.raw.gains ?? []) as Gain[],
    effectGains: f.effectGains ?? [],
    graph: f.graph ?? emptyLayerGraph(),
    raw: f.raw,
    pendingSync: f.sync?.pendingSync ?? 0,
    health,
    session,
    billing,
    facts: f.facts ?? null,
    strata: f.strata ?? null,
    recentAudits: auditPanels.recent,
    today: auditPanels.today,
    token: auditPanels.token,
    refine,
    mcp,
    engines,
    dataRoot,
  };
}
