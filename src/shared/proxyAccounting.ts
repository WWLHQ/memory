// 批次48 A16：反代理记账单价 / 日配额。
// 各家云端厂商的真实余额与单价需要各自的计费 API，内核尚未接入，因此不再用 0.01 / 100000
// 这类占位数字冒充「声明额度」：改为用户在参数页填写、随参数快照真实持久化；
// 未填写 → 如实「未设置」，云端源不进入自动路由（本地源按定义记 0 元 / 不限量）。
import type { ModelInfo } from '../core/memagent/types.ts';

export interface ProxyAccounting {
  /** 云端引擎单价（¥/千次）；null = 未设置 */
  price_cny_per_kcall: number | null;
  /** 云端引擎声明日配额（次/日）；null = 未设置 */
  daily_quota: number | null;
}

export const UNSET_PROXY_ACCOUNTING: ProxyAccounting = { price_cny_per_kcall: null, daily_quota: null };

/** 单价：有限非负数；其余一律未设置（不把空串/NaN 悄悄当 0） */
export function normalizeAccountingPrice(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return v;
}

/** 配额：正整数（次/日）；其余一律未设置 */
export function normalizeAccountingQuota(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return null;
  return v;
}

/** 代理元数据：本地 = free/0 元/不限量；云端必须有用户配置的单价与配额，否则返回 null（不可路由） */
export function proxyModelMeta(local: boolean, acc: ProxyAccounting, used: number): Omit<ModelInfo, 'model'> | null {
  if (local) return { tier: 'free', price: 0, quota: Number.POSITIVE_INFINITY, used };
  const price = normalizeAccountingPrice(acc.price_cny_per_kcall);
  const quota = normalizeAccountingQuota(acc.daily_quota);
  if (price === null || quota === null) return null;
  return { tier: 'cheap', price, quota, used };
}

/** 余量展示口径：null = 未设置；Infinity = 不限量 */
export function remainingText(remain: number | null): string {
  if (remain === null) return '未设置';
  return Number.isFinite(remain) ? String(remain) : '不限';
}

// ---------- 批次48 A24：代理封顶（price_cap / cost_cap） ----------
// 封顶随参数快照持久化；null = 未设置。真实路由与页面模拟必须读同一个快照值，不得回落 0.01 / 2。

export interface ProxyCaps {
  /** 低价档单价上限（¥/千次）；null = 未设置 → 低价档不入选，仅免费可用 */
  price_cap: number | null;
  /** 当日成本封顶（¥/日）；null = 未设置 → 不封顶（不回落写死的 2） */
  cost_cap: number | null;
}

export const UNSET_PROXY_CAPS: ProxyCaps = { price_cap: null, cost_cap: null };

/** 封顶值：有限非负；其余一律未设置（不把空串/NaN 悄悄当 0） */
export function normalizeProxyCap(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return v;
}

export function proxyCapsFromCfg(cfg: unknown): ProxyCaps {
  const c = (cfg && typeof cfg === 'object' ? cfg : {}) as Record<string, unknown>;
  return {
    price_cap: normalizeProxyCap(c.proxy_price_cap),
    cost_cap: normalizeProxyCap(c.proxy_cost_cap),
  };
}

/** 代理当日花费窗口：与页面「已用」同源（滚动 24h；重启不归零） */
export const PROXY_COST_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 从账本实算当日（滚动 24h）代理花费：只统计真实发生的 `llm_proxy` 及其数值 cost。
 * 口径与模型页「已用」同源（重启不归零）；cost 为 null（usage/单价未设置）的条目跳过，不做估算。
 */
export function proxyCostToday(
  audits: readonly { ts: number; action: string; detail?: unknown }[],
  now: number = Date.now(),
): number {
  let sum = 0;
  for (const a of audits) {
    if (a.action !== 'llm_proxy') continue;
    if (!(now - a.ts >= 0 && now - a.ts < PROXY_COST_WINDOW_MS)) continue;
    const d = (a.detail && typeof a.detail === 'object' ? a.detail : {}) as Record<string, unknown>;
    const c = Number(d.cost);
    if (Number.isFinite(c) && c > 0) sum += c;
  }
  return sum;
}
