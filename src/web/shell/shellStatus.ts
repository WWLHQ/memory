// REQ-014 / T7（C8）：侧栏状态卡的真实数据加载器。
//
// 口径（与 statusbar.ts 同一套「读不到就如实说」）：
// - 每个来源独立判定，任一失败只影响自己，不拿 0 / "空闲" 冒充成功读数；
// - 只读既有通道（collector:status / l0:pendingWrites / refine:state），**不新增 HostMethod**；
// - 轮询是轻量的 12s 定时拉取（不是 Hindsight 的 25s 长轮询），Electron 桌面端自带服务，无需部署向导。
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';
import type { DockResult } from './dock.ts';
import { loadCollectorStatus, type CollectorView } from './statusbar.ts';
import { loadPendingWrites } from './taskpane.ts';
import type { NavStatusSource } from '../shared/navStatusChannel.ts';
import { listMcpPending } from '../shared/mcpPending.ts';

/** 精炼队列摘要里本卡真正用到的字段（其余字段不取，避免把无关细节带进 UI） */
export interface RefineBrief {
  pending: number;
  failed: number;
  enabled: boolean;
}

interface RawRefineState {
  ok?: boolean;
  error?: string;
  summary?: { pending?: number; failed?: number; enabled?: boolean };
}

/** T3 落点③：客户端 MCP 开关（只读扫描，不返回令牌） */
export interface McpSwitchBrief {
  id: string;
  name: string;
  disabled: boolean;
  /** ①三处一致：一键已清标记、但客户端尚未重开 → 待生效（与首页/接入页同源） */
  pending?: boolean;
  /** 2026-11-24：配置面异常计数（fast 扫描可读；实测失败要完整探活，状态栏不读，故不含） */
  conflict: number;
  invalid: number;
}

/** 2026-11-24：网页接入异常摘要（需重新登录 / 采集失败），来自 webchatAuto:state 真回执 */
export interface WebIssueBrief {
  needRelogin: number;
  failed: number;
}

export interface ShellStatusSnapshot {
  pendingWrites: DockResult<number>;
  refine: DockResult<RefineBrief>;
  collector: DockResult<CollectorView>;
  mcpSwitch: DockResult<McpSwitchBrief>;
  webIssue: DockResult<WebIssueBrief>;
}

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

/** MCP 写入兜底队列：只取真实计数（正文不在返回值里，壳内也拿不到） */
export async function loadPendingCount(): Promise<DockResult<number>> {
  const r = await loadPendingWrites();
  if (r.status !== 'ok') return { status: r.status, detail: r.detail };
  return { status: 'ok', view: r.view.count };
}

/** L2–L6 补炼队列：主进程 summarizeRefineQueue 的真实摘要 */
export async function loadRefineBrief(): Promise<DockResult<RefineBrief>> {
  if (hostCapability() === 'none') {
    return { status: 'unavailable', detail: '浏览器模式：补炼队列由主进程维护，浏览器读不到。' };
  }
  try {
    const r = await hostCall<RawRefineState>('refine:state', []);
    if (!r?.ok) return { status: 'error', detail: r?.error ?? '主进程未返回 ok（补炼状态不可读）' };
    const s = r.summary;
    if (!s || typeof s.pending !== 'number') {
      return { status: 'error', detail: '主进程返回结构不完整（缺少 summary.pending）' };
    }
    return {
      status: 'ok',
      view: {
        pending: s.pending,
        failed: typeof s.failed === 'number' ? s.failed : 0,
        enabled: s.enabled === true,
      },
    };
  } catch (e) {
    return { status: 'error', detail: errText(e) };
  }
}

/** 客户端 MCP 开关：复用只读 mcp:clients；读不到就如实 unavailable/error，
 *  绝不把「没读到」当成「开关已打开」。 */
export async function loadMcpSwitchBrief(): Promise<DockResult<McpSwitchBrief>> {
  if (hostCapability() === 'none') {
    return { status: 'unavailable', detail: '浏览器模式：读不到本机客户端配置。' };
  }
  try {
    const r = await hostCall<{
      clients?: Array<{ id: string; name?: string; disabled?: boolean; state?: string }>;
    }>('mcp:clients', [currentSessionId(), { fast: true }]);
    if (!Array.isArray(r?.clients)) {
      return { status: 'error', detail: '主进程未返回客户端列表（开关状态不可读）' };
    }
    // 2026-11-24：顺带统计配置面异常（conflict / invalid），与接入页「错误码/异常」同源。
    // fast 扫描跳过实测探活 → failed（实测失败）这里读不到，不虚构，文案也不提。
    const conflict = r.clients.filter((c) => c.state === 'conflict').length;
    const invalid = r.clients.filter((c) => c.state === 'invalid').length;
    const issues = { conflict, invalid };
    const hit = r.clients.find((c) => c.disabled === true);
    if (hit) return { status: 'ok', view: { id: hit.id, name: hit.name ?? hit.id, disabled: true, ...issues } };
    // ①三处一致：真禁用的已清掉，但共享信号记录着「待生效」→ 壳层也保持提醒，不退回正常
    const pendingIds = listMcpPending();
    if (pendingIds.length > 0) {
      const pid = pendingIds[0];
      const pc = r.clients.find((c) => c.id === pid);
      return { status: 'ok', view: { id: pid, name: pc?.name ?? pid, disabled: false, pending: true, ...issues } };
    }
    return { status: 'ok', view: { id: '', name: '', disabled: false, ...issues } };
  } catch (e) {
    return { status: 'error', detail: errText(e) };
  }
}

/** 网页接入异常：复用 webchatAuto:state，按页面同源口径从 lastRound.results 派生（需会话；无会话如实 unavailable） */
export async function loadWebIssueBrief(): Promise<DockResult<WebIssueBrief>> {
  if (hostCapability() === 'none') {
    return { status: 'unavailable', detail: '浏览器模式：读不到本机网页采集状态。' };
  }
  try {
    const r = await hostCall<{
      ok?: boolean; error?: string;
      lastRound?: { at?: number; results?: Array<{ site?: string; status?: string }> } | null;
      relogins?: Record<string, number>;
    }>('webchatAuto:state', [currentSessionId()]);
    if (!r?.ok) return { status: 'error', detail: r?.error ?? '主进程未返回网页采集状态' };
    const results = r.lastRound?.results ?? [];
    const roundAt = r.lastRound?.at ?? 0;
    const relogins = r.relogins ?? {};
    // 与网页端接入页同一口径：重新登录晚于该轮快照的 need_relogin 视为已处理，计数剔除
    const needRelogin = results.filter(
      (x) => x.status === 'need_relogin' && !(x.site && relogins[x.site] && relogins[x.site] > roundAt),
    ).length;
    return {
      status: 'ok',
      view: {
        needRelogin,
        failed: results.filter((x) => x.status === 'error' || x.status === 'dom_changed').length,
      },
    };
  } catch (e) {
    return { status: 'error', detail: errText(e) };
  }
}

export async function loadShellStatus(): Promise<ShellStatusSnapshot> {
  const [pendingWrites, refine, collector, mcpSwitch, webIssue] = await Promise.all([
    loadPendingCount(),
    loadRefineBrief(),
    loadCollectorStatus(),
    loadMcpSwitchBrief(),
    loadWebIssueBrief(),
  ]);
  return { pendingWrites, refine, collector, mcpSwitch, webIssue };
}

/**
 * 快照 → 状态通道的输入：**只有 ok 的源才进**，其余留 undefined。
 * 这一步是「读不到就不显示」的唯一收口点——不在组件里各自判断，避免两处口径漂移。
 */
export function toNavStatusSource(snap: ShellStatusSnapshot): NavStatusSource {
  return {
    pendingWrites: snap.pendingWrites.status === 'ok' ? { count: snap.pendingWrites.view } : undefined,
    refine: snap.refine.status === 'ok'
      ? { queued: snap.refine.view.pending, running: false }
      : undefined,
    collector: snap.collector.status === 'ok'
      ? {
        running: snap.collector.view.running,
        consecutiveFails: snap.collector.view.consecutiveFails ?? undefined,
        autoRetryStopped: snap.collector.view.autoRetryStopped,
      }
      : undefined,
    // 只有真实读到「已禁用」或共享信号里的「待生效」才产出条目；读不到/失败留 undefined（守「读不到不显示」）
    mcpSwitch: snap.mcpSwitch.status === 'ok' && snap.mcpSwitch.view.disabled
      ? { name: snap.mcpSwitch.view.name }
      : snap.mcpSwitch.status === 'ok' && snap.mcpSwitch.view.pending
        ? { name: snap.mcpSwitch.view.name, pending: true }
        : undefined,
    // 2026-11-24：MCP 配置面异常（冲突/解析失败）与网页接入异常（重新登录/失败）
    mcpIssue: snap.mcpSwitch.status === 'ok'
      ? { conflict: snap.mcpSwitch.view.conflict, invalid: snap.mcpSwitch.view.invalid }
      : undefined,
    webIssue: snap.webIssue.status === 'ok'
      ? { needRelogin: snap.webIssue.view.needRelogin, failed: snap.webIssue.view.failed }
      : undefined,
  };
}

/** 轻量轮询间隔：12s（10–15s 区间内；不采用长轮询，也不做秒级抖动） */
export const SHELL_STATUS_POLL_MS = 12_000;
