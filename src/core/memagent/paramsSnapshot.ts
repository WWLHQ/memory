// 全局参数快照（params:v1: preference 记忆）的共享读取口。
// Web 参数页负责写入；主进程遗忘调度读取普通配置（AC-14 / 17.6）。
// 批次48 A17：此前只读 auto_organize，遗忘速度/保留时长/重要程度保存后不改变任何行为；
// 现由 forgettingPrefsFromSnapshot 统一折算成内核调度参数（折算表在 shared/normalParams.ts）。
import type { Memory, StorageBackend, Form } from './types.ts';
import { ulid } from './ulid.ts';
import { autoArchiveDaysOf, halfLifeDaysOf } from '../../shared/normalParams.ts';
import {
  UNSET_PROXY_ACCOUNTING, UNSET_PROXY_CAPS, normalizeAccountingPrice, normalizeAccountingQuota,
  normalizeProxyCap, type ProxyAccounting, type ProxyCaps,
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
    /** 批次48 A24 反代理封顶（旧快照可能缺字段 → 未设置，不回落 0.01 / 2） */
    proxy_price_cap?: number | null;
    proxy_cost_cap?: number | null;
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

/**
 * 批次48 A24：反代理封顶 —— 页面模拟与内核真实路由共用这一份快照取值。
 * 无快照/字段缺失 → 未设置（null），不回落到旧的 0.01 / 2。
 */
export function proxyCapsFromSnapshot(mems: Memory[]): ProxyCaps {
  const cfg = findParamsSnapshot(mems)?.cfg;
  if (!cfg) return { ...UNSET_PROXY_CAPS };
  return { price_cap: normalizeProxyCap(cfg.proxy_price_cap), cost_cap: normalizeProxyCap(cfg.proxy_cost_cap) };
}

export interface ProxyCapsSaveOptions {
  requestId: string;
  form: Form;
  enterpriseId?: string;
  teamId?: string;
}

/**
 * A24：封顶落参数快照（读旧快照 → 只改 cfg 两个字段 → delete + put，保留 kbs/dev 等其它字段）。
 * 单条不累积；写 `param_save` 审计（kind='proxy_caps'）便于回放与排查。
 */
export async function saveProxyCapsToLedger(
  storage: StorageBackend, caps: ProxyCaps, opts: ProxyCapsSaveOptions,
): Promise<{ mem_id: string; version: number }> {
  const mems = await storage.listMemories({});
  const old = mems.find(
    (m) => m.category === 'preference' && m.user_id === 'system' && m.content.startsWith(PARAMS_PREF_PREFIX),
  );
  let snapshot: ParamsSnapshot;
  if (old) {
    snapshot = parseParamsSnapshot(old.content) ?? { cfg: {}, kbs: [], dev: {} };
    await storage.deleteMemory(old.mem_id);
  } else {
    snapshot = { cfg: {}, kbs: [], dev: {} };
  }
  const price_cap = normalizeProxyCap(caps.price_cap);
  const cost_cap = normalizeProxyCap(caps.cost_cap);
  snapshot.cfg = { ...snapshot.cfg, proxy_price_cap: price_cap, proxy_cost_cap: cost_cap };
  const now = Date.now();
  const mem: Memory = {
    mem_id: `params_${ulid(now)}`,
    project_id: 'P_SYSTEM', user_id: 'system',
    enterprise_id: opts.enterpriseId ?? '', team_id: opts.teamId ?? '',
    category: 'preference', layer: 'L2',
    content: `${PARAMS_PREF_PREFIX}${JSON.stringify(snapshot)}`,
    decay_class: 'hot', pinned: true, locked: false,
    version: (old?.version ?? 0) + 1, created_at: old?.created_at ?? now, updated_at: now,
  };
  await storage.putMemory(mem);
  await storage.appendAudit({
    request_id: opts.requestId, action: 'param_save', form: opts.form,
    project_id: 'P_SYSTEM', user_id: 'system', ts: now,
    detail: { kind: 'proxy_caps', price_cap, cost_cap, version: mem.version },
  });
  return { mem_id: mem.mem_id, version: mem.version };
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

export interface GrowthConfigSaveOptions {
  requestId: string;
  /** 写入方形态（web 页面 / desktop 主进程回归任务） */
  form: Form;
  enterpriseId?: string;
  teamId?: string;
}

/**
 * 批次48 A23.3：生长配置落账本的**唯一写入口**（页面保存与主进程回归采纳共用）。
 * 语义与 A23.1 保持一致：旧记录 delete + 新记录 put（pinned 豁免 gc、单条不累积），
 * 并写 `param_save` 审计（detail.kind='growth_config' + 完整配置快照，可回放）。
 */
export async function saveGrowthConfigToLedger(
  storage: StorageBackend, cfg: GrowthConfig, opts: GrowthConfigSaveOptions,
): Promise<{ mem_id: string; version: number }> {
  const old = findGrowthMemory(await storage.listMemories({}));
  if (old) await storage.deleteMemory(old.mem_id);
  const now = Date.now();
  const mem: Memory = {
    mem_id: `growth_${ulid(now)}`,
    project_id: 'P_SYSTEM', user_id: 'system',
    enterprise_id: opts.enterpriseId ?? '', team_id: opts.teamId ?? '',
    category: 'preference', layer: 'L2',
    content: `${GROWTH_PREF_PREFIX}${JSON.stringify(cfg)}`,
    decay_class: 'hot', pinned: true, locked: false,
    version: (old?.version ?? 0) + 1, created_at: now, updated_at: now,
  };
  await storage.putMemory(mem);
  await storage.appendAudit({
    request_id: opts.requestId, action: 'param_save', form: opts.form,
    project_id: 'P_SYSTEM', user_id: 'system', ts: now,
    detail: { kind: 'growth_config', growth: cfg, version: mem.version },
  });
  return { mem_id: mem.mem_id, version: mem.version };
}
