// 状态栏真实数据（S7）：账本位置 / L0 保险库状态 / 采集器后台状态。
//
// 口径：
// - storage:location 与 collector:status 走宿主桥；浏览器模式给原因；
// - L0 只读 l0Status（active_sessions / active_grants / 写锁），不解锁、不持有任何密钥；
// - 任一来源失败只影响自身单元格，绝不拿 0 或「—」冒充成功读数。

import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import type { L0VaultStatus } from '../../core/memagent/types.ts';
import { getKernel } from '../kernel.ts';
import { storageLocation } from '../memory/coreMemoryOps.ts';
import type { DockResult } from './dock.ts';

export interface StoragePlaceView {
  kind: 'file' | 'memory' | 'unknown';
  path?: string;
  source: string;
}

export interface CollectorView {
  running: boolean;
  intervalMs: number | null;
  lastAt: number | null;
  lastCollected: number | null;
  autoRetryStopped: boolean;
  consecutiveFails: number | null;
}

interface RawCollectorStatus {
  ok?: boolean;
  running?: boolean;
  intervalMs?: number;
  last?: { collected?: number; ts?: number } | null;
  autoRetryStopped?: boolean;
  consecutiveFails?: number;
}

export interface StatusSnapshot {
  location: DockResult<StoragePlaceView>;
  l0: DockResult<L0VaultStatus>;
  collector: DockResult<CollectorView>;
}

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

/** L0 保险库只读状态：桌面壳经 IPC；浏览器模式如实说明读不到 */
export async function loadL0Status(): Promise<DockResult<L0VaultStatus>> {
  if (hostCapability() === 'none') {
    return { status: 'unavailable', detail: '浏览器模式：L0 会话由桌面主进程的 L0Vault 保管，浏览器读不到。' };
  }
  try {
    return { status: 'ok', view: await getKernel().l0Status() };
  } catch (e) {
    return { status: 'error', detail: errText(e) };
  }
}

/** 采集器后台状态：主进程 cron 的真实运行/最近一轮计数 */
export async function loadCollectorStatus(): Promise<DockResult<CollectorView>> {
  if (hostCapability() === 'none') {
    return { status: 'unavailable', detail: '浏览器模式：采集器由主进程调度，浏览器读不到运行状态。' };
  }
  try {
    const r = await hostCall<RawCollectorStatus>('collector:status', []);
    if (!r?.ok) return { status: 'error', detail: '主进程未返回 ok（采集器状态不可读）' };
    return {
      status: 'ok',
      view: {
        running: !!r.running,
        intervalMs: typeof r.intervalMs === 'number' ? r.intervalMs : null,
        lastAt: typeof r.last?.ts === 'number' ? r.last.ts : null,
        lastCollected: typeof r.last?.collected === 'number' ? r.last.collected : null,
        autoRetryStopped: !!r.autoRetryStopped,
        consecutiveFails: typeof r.consecutiveFails === 'number' ? r.consecutiveFails : null,
      },
    };
  } catch (e) {
    return { status: 'error', detail: errText(e) };
  }
}

export async function loadStatusbar(): Promise<StatusSnapshot> {
  const [location, l0, collector] = await Promise.all([
    storageLocation()
      .then((v): DockResult<StoragePlaceView> => ({ status: 'ok', view: v }))
      .catch((e): DockResult<StoragePlaceView> => ({ status: 'error', detail: errText(e) })),
    loadL0Status(),
    loadCollectorStatus(),
  ]);
  return { location, l0, collector };
}

/** 账本位置 → 状态栏紧凑文案 */
export function shortLocation(loc: StoragePlaceView): { text: string; title: string } {
  if (loc.kind === 'file' && loc.path) {
    const sep = loc.path.includes('\\') ? '\\' : '/';
    const name = loc.path.split(sep).filter(Boolean).slice(-1)[0] ?? loc.path;
    return { text: name, title: `账本文件：${loc.path}（${loc.source}）` };
  }
  if (loc.kind === 'memory') {
    if (loc.source === 'http-backend') return { text: '只读镜像', title: `经登录后端直读本机账本：${loc.path ?? ''}` };
    return { text: '内存态', title: `无磁盘账本：${loc.source}` };
  }
  return { text: '位置未知', title: `来源不可读：${loc.source}` };
}
