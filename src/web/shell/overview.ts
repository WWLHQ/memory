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
import { getHomeFeed } from '../Home/coreHome.ts';
import { getKernelStorage } from '../kernel.ts';
import { currentSessionId } from '../shared/session.ts';
import { hostCapability } from '../../desktop/hostBridge.ts';
import type { Gain } from '../../types/agentOnboard.ts';

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

export interface OverviewSnapshot {
  loadedAt: number;
  /** host = 桌面壳经 IPC 读主进程账本；browser = 浏览器内存账本（非本机库） */
  kernelMode: 'host' | 'browser';
  storageError: string | null;
  gains: Gain[];
  health: OverviewHealth;
  session: boolean;
  billing: OverviewBilling;
}

interface RawBillingEngine {
  provenance?: string;
}

function describeError(e: unknown): string {
  const msg = (e as { message?: string })?.message;
  return msg && msg.trim() ? msg : String(e);
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
  interface BillingApi {
    llm?: { billing?: (req?: { force?: boolean }, sid?: string | null) => Promise<{ ok: boolean; engines?: unknown[]; error?: string }> };
  }
  const api = (window as unknown as { api?: BillingApi }).api;
  if (!api?.llm?.billing) return { status: 'unavailable', detail: '桌面桥未暴露 llm.billing' };
  try {
    const r = await api.llm.billing({ force: false }, currentSessionId());
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

/** 真实加载：所有来源并行，任一失败都只影响自身字段，不影响其它读数 */
export async function loadOverview(): Promise<OverviewSnapshot> {
  const session = hasActiveSession();
  const [feed, health, billing] = await Promise.all([
    getHomeFeed(getKernelStorage()).catch((e) => ({
      raw: { gains: [] },
      storageError: describeError(e),
    })),
    probeHealth(),
    probeBilling(session),
  ]);
  return {
    loadedAt: Date.now(),
    kernelMode: hostCapability() === 'none' ? 'browser' : 'host',
    storageError: (feed as { storageError?: string | null }).storageError ?? null,
    gains: (feed.raw.gains ?? []) as Gain[],
    health,
    session,
    billing,
  };
}
