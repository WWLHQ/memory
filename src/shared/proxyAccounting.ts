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
