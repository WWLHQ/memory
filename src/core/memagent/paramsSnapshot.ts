// 全局参数快照（params:v1: preference 记忆）的共享读取口。
// Web 参数页负责写入；主进程遗忘调度读取 auto_organize（AC-14：自动策略可关闭）。
import type { Memory } from './types.ts';

export const PARAMS_PREF_PREFIX = 'params:v1:';

export interface ParamsSnapshot {
  cfg: {
    auto_organize?: boolean;
    /** 成本单价（¥ / 百万 token）；缺省/非法 = 未设置（旧快照兼容，不显示金额） */
    cost_cny_per_mtok?: number | null;
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
  return findParamsSnapshot(mems)?.cfg?.auto_organize !== false;
}
