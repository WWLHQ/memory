// 全局参数快照（params:v1: preference 记忆）的共享读取口。
// Web 参数页负责写入；主进程遗忘调度读取普通配置（AC-14 / 17.6）。
// 批次48 A17：此前只读 auto_organize，遗忘速度/保留时长/重要程度保存后不改变任何行为；
// 现由 forgettingPrefsFromSnapshot 统一折算成内核调度参数（折算表在 shared/normalParams.ts）。
import type { Memory } from './types.ts';
import { autoArchiveDaysOf, halfLifeDaysOf } from '../../shared/normalParams.ts';
import {
  UNSET_PROXY_ACCOUNTING, normalizeAccountingPrice, normalizeAccountingQuota, type ProxyAccounting,
} from '../../shared/proxyAccounting.ts';
import { normalizeGrowthConfig, type GrowthConfig } from '../../shared/growthConfig.ts';

export const PARAMS_PREF_PREFIX = 'params:v1:';
/**
 * 批次48 A23：生长配置（权重/阈值/调度）独立 preference 记录。
 * 不塞进 params:v1: 的理由：参数页保存是「整条 delete + put」，两个页面共用一条记录会互相覆盖；
 * 独立前缀让生长页只读写自己那段，参数页与生长页任一保存都不会清掉对方的数据。
 */
export const GROWTH_PREF_PREFIX = 'growth:v1:';

export interface ParamsSnapshot {
  cfg: {
    auto_organize?: boolean;
    /** 成本单价（¥ / 百万预算单位 t）；缺省/非法 = 未设置（旧快照兼容，不显示金额） */
    cost_cny_per_mtok?: number | null;
    /** 17.6 普通配置（旧快照可能缺字段 → 不覆盖内核默认） */
    forget_speed?: string;
    retention?: string;
    importance?: string;
    /** 批次48 A16 反代理记账（旧快照可能缺字段 → 未设置） */
    proxy_price_cny_per_kcall?: number | null;
    proxy_daily_quota?: number | null;
    [key: string]: unknown;
  };
  kbs: unknown[];
  dev: unknown;
}

export function parseParamsSnapshot(content: string): ParamsSnapshot | null {
  if (!content.startsWith(PARAMS_PREF_PREFIX)) return null;
  try {
    return JSON.parse(content.slice(PARAMS_PREF_PREFIX.length)) as ParamsSnapshot;
  } catch {
    return null;
  }
}

export function findParamsSnapshot(mems: Memory[]): ParamsSnapshot | null {
  const pref = mems.find(
    (m) => m.category === 'preference' && m.user_id === 'system' && m.content.startsWith(PARAMS_PREF_PREFIX),
  );
  return pref ? parseParamsSnapshot(pref.content) : null;
}

/** 无快照 = 默认开启（与参数页默认值一致）；显式 false 才停用 */
export function autoOrganizeEnabled(mems: Memory[]): boolean {
  return forgettingPrefsFromSnapshot(mems).enabled;
}

/** 遗忘调度真实生效的普通配置（批次48 A17） */
export interface ForgettingPrefs {
  /** auto_organize=false → 调度只记 skipped 审计（AC-14） */
  enabled: boolean;
  /** 全局半衰期覆盖（天）；undefined = 按类别内核默认（17.5） */
  halfLifeDays?: number;
  /** 全局归档阈值（天）；undefined = 按类别内核默认 */
  autoArchiveDays?: number;
  /** 重要程度=locked → 全局豁免后台任务（17.6 文案承诺） */
  exemptAll: boolean;
}

export function forgettingPrefsFromSnapshot(mems: Memory[]): ForgettingPrefs {
  const cfg = findParamsSnapshot(mems)?.cfg;
  return {
    enabled: cfg?.auto_organize !== false,
    halfLifeDays: halfLifeDaysOf(cfg?.forget_speed),
    autoArchiveDays: autoArchiveDaysOf(cfg?.retention),
    exemptAll: cfg?.importance === 'locked',
  };
}

/**
 * 批次48 A16：反代理记账单价/配额 —— 参数页写入、模型页/内核路由读取（同一份参数快照）。
 * 无快照或字段缺失 → 未设置（不伪造 0.01 / 100000 之类占位数字）。
 */
export function proxyAccountingFromSnapshot(mems: Memory[]): ProxyAccounting {
  const cfg = findParamsSnapshot(mems)?.cfg;
  if (!cfg) return { ...UNSET_PROXY_ACCOUNTING };
  return {
    price_cny_per_kcall: normalizeAccountingPrice(cfg.proxy_price_cny_per_kcall),
    daily_quota: normalizeAccountingQuota(cfg.proxy_daily_quota),
  };
}

/** 生长页只认自己的 preference 记录（preference / system / growth:v1: 前缀） */
export function findGrowthMemory(mems: Memory[]): Memory | null {
  return mems.find(
    (m) => m.category === 'preference' && m.user_id === 'system' && m.content.startsWith(GROWTH_PREF_PREFIX),
  ) ?? null;
}

/** 账本记录 → 合法生长配置；无记录/坏记录一律回退默认（旧账本兼容，不做猜测性迁移） */
export function growthConfigFromLedger(mems: Memory[]): GrowthConfig {
  const m = findGrowthMemory(mems);
  if (!m) return normalizeGrowthConfig(null);
  try {
    return normalizeGrowthConfig(JSON.parse(m.content.slice(GROWTH_PREF_PREFIX.length)));
  } catch {
    return normalizeGrowthConfig(null);
  }
}
