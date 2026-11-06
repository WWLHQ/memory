// 全局参数快照（params:v1: preference 记忆）的共享读取口。
// Web 参数页负责写入；主进程遗忘调度读取普通配置（AC-14 / 17.6）。
// 批次48 A17：此前只读 auto_organize，遗忘速度/保留时长/重要程度保存后不改变任何行为；
// 现由 forgettingPrefsFromSnapshot 统一折算成内核调度参数（折算表在 shared/normalParams.ts）。
import type { Memory } from './types.ts';
import { autoArchiveDaysOf, halfLifeDaysOf } from '../../shared/normalParams.ts';

export const PARAMS_PREF_PREFIX = 'params:v1:';

export interface ParamsSnapshot {
  cfg: {
    auto_organize?: boolean;
    /** 成本单价（¥ / 百万预算单位 t）；缺省/非法 = 未设置（旧快照兼容，不显示金额） */
    cost_cny_per_mtok?: number | null;
    /** 17.6 普通配置（旧快照可能缺字段 → 不覆盖内核默认） */
    forget_speed?: string;
    retention?: string;
    importance?: string;
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
