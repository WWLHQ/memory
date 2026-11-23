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
}

export interface ShellStatusSnapshot {
  pendingWrites: DockResult<number>;
  refine: DockResult<RefineBrief>;
  collector: DockResult<CollectorView>;
  mcpSwitch: DockResult<McpSwitchBrief>;
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
      clients?: Array<{ id: string; name?: string; disabled?: boolean }>;
    }>('mcp:clients', [currentSessionId(), { fast: true }]);
    if (!Array.isArray(r?.clients)) {
      return { status: 'error', detail: '主进程未返回客户端列表（开关状态不可读）' };
    }
    const hit = r.clients.find((c) => c.disabled === true);
    if (hit) return { status: 'ok', view: { id: hit.id, name: hit.name ?? hit.id, disabled: true } };
    // ①三处一致：真禁用的已清掉，但共享信号记录着「待生效」→ 壳层也保持提醒，不退回正常
    const pendingIds = listMcpPending();
    if (pendingIds.length > 0) {
      const pid = pendingIds[0];
      const pc = r.clients.find((c) => c.id === pid);
      return { status: 'ok', view: { id: pid, name: pc?.name ?? pid, disabled: false, pending: true } };
    }
    return { status: 'ok', view: { id: '', name: '', disabled: false } };
  } catch (e) {
    return { status: 'error', detail: errText(e) };
  }
}

export async function loadShellStatus(): Promise<ShellStatusSnapshot> {
  const [pendingWrites, refine, collector, mcpSwitch] = await Promise.all([
    loadPendingCount(),
    loadRefineBrief(),
    loadCollectorStatus(),
    loadMcpSwitchBrief(),
  ]);
  return { pendingWrites, refine, collector, mcpSwitch };
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
  };
}

/** 轻量轮询间隔：12s（10–15s 区间内；不采用长轮询，也不做秒级抖动） */
export const SHELL_STATUS_POLL_MS = 12_000;
