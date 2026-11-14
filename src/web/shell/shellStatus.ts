// REQ-014 / T7（C8）：侧栏状态卡的真实数据加载器。
//
// 口径（与 statusbar.ts 同一套「读不到就如实说」）：
// - 每个来源独立判定，任一失败只影响自己，不拿 0 / "空闲" 冒充成功读数；
// - 只读既有通道（collector:status / l0:pendingWrites / refine:state），**不新增 HostMethod**；
// - 轮询是轻量的 12s 定时拉取（不是 Hindsight 的 25s 长轮询），Electron 桌面端自带服务，无需部署向导。
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import type { DockResult } from './dock.ts';
import { loadCollectorStatus, type CollectorView } from './statusbar.ts';
import { loadPendingWrites } from './taskpane.ts';
import type { NavStatusSource } from '../shared/navStatusChannel.ts';

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

export interface ShellStatusSnapshot {
  pendingWrites: DockResult<number>;
  refine: DockResult<RefineBrief>;
  collector: DockResult<CollectorView>;
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

export async function loadShellStatus(): Promise<ShellStatusSnapshot> {
  const [pendingWrites, refine, collector] = await Promise.all([
    loadPendingCount(),
    loadRefineBrief(),
    loadCollectorStatus(),
  ]);
  return { pendingWrites, refine, collector };
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
  };
}

/** 轻量轮询间隔：12s（10–15s 区间内；不采用长轮询，也不做秒级抖动） */
export const SHELL_STATUS_POLL_MS = 12_000;
