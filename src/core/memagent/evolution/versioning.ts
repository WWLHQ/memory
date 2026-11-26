// M3：生长配置版本化与回滚。
// - 采纳（auto）前把「上一版」存 `growth:v1:history:<ulid>`（独立 preference，pinned 豁免 gc）；
// - 回滚 = 取最近一条历史版本 → 经唯一写入口 saveGrowthConfigToLedger 还原 → 删除已消费的历史。
// 纪律：历史记录**不是**现行配置，findGrowthMemory 已显式排除该前缀（见 paramsSnapshot.ts）。
import { normalizeGrowthConfig, type GrowthConfig, type RecallWeights } from '../../../shared/growthConfig.ts';
import type { Form, Memory, StorageBackend } from '../types.ts';
import {
  GROWTH_HISTORY_PREFIX, GROWTH_PREF_PREFIX, findGrowthMemory, growthConfigFromLedger, saveGrowthConfigToLedger,
} from '../paramsSnapshot.ts';
import { ulid } from '../ulid.ts';

export { GROWTH_HISTORY_PREFIX };

export interface HistoryWriteOptions {
  requestId: string;
  form: Form;
  enterpriseId?: string;
  teamId?: string;
  now?: number;
}

/** 采纳前存上一版，再落新配置。返回是否真的存了历史（无旧配置时不存）。 */
export async function saveConfigWithHistory(
  storage: StorageBackend,
  next: GrowthConfig,
  opts: HistoryWriteOptions,
): Promise<{ history_saved: boolean; version: number }> {
  const mems = await storage.listMemories({});
  const cur = findGrowthMemory(mems);
  let history_saved = false;
  if (cur) {
    const now = opts.now ?? Date.now();
    const json = cur.content.slice(GROWTH_PREF_PREFIX.length); // 旧配置 JSON 原样保留（可逐字还原）
    const h: Memory = {
      mem_id: `growth_h_${ulid(now)}`,
      project_id: 'P_SYSTEM', user_id: 'system',
      enterprise_id: opts.enterpriseId ?? '', team_id: opts.teamId ?? '',
      // 历史配置同属内部快照：只落 L1 原文，避免被误标层清理反复降级（2026-11-22）
      category: 'preference', layer: 'L1',
      content: `${GROWTH_HISTORY_PREFIX}${json}`,
      decay_class: 'hot', pinned: true, locked: false,
      version: 1, created_at: now, updated_at: now,
    };
    await storage.putMemory(h);
    history_saved = true;
  }
  const r = await saveGrowthConfigToLedger(storage, next, opts);
  return { history_saved, version: r.version };
}

/** 全部历史版本记录（按 created_at 升序）。 */
export function historyMemories(mems: Memory[]): Memory[] {
  return mems
    .filter((m) => m.category === 'preference' && m.user_id === 'system'
      && m.content.startsWith(GROWTH_HISTORY_PREFIX))
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
}

export function latestHistory(mems: Memory[]): Memory | null {
  const hs = historyMemories(mems);
  return hs.length ? hs[hs.length - 1] : null;
}

export function configFromHistoryMem(m: Memory): GrowthConfig | null {
  try {
    return normalizeGrowthConfig(JSON.parse(m.content.slice(GROWTH_HISTORY_PREFIX.length)));
  } catch {
    return null;
  }
}

export interface RollbackResult {
  rolledBack: boolean;
  from?: RecallWeights;
  to?: RecallWeights;
}

export interface RollbackOptions extends HistoryWriteOptions {
  /**
   * 局部回退目标（2026-11-26 分流回诊）：'mode_dispatch' 只把该块退回历史版本，
   * 其余配置（recall_weights / feedback_policy / 阈值…）保持现行值不动。
   * 省略 = 既有整份回退，行为逐字不变。
   */
  target?: 'mode_dispatch';
}

/**
 * 回滚到最近一条历史版本（并消费它）。无历史 / 历史坏块 → 如实 rolledBack:false，不猜。
 * 只用唯一写入口 saveGrowthConfigToLedger，确保 param_save 审计与版本号语义一致。
 */
export async function rollbackGrowthConfig(
  storage: StorageBackend,
  opts: RollbackOptions,
): Promise<RollbackResult> {
  const mems = await storage.listMemories({});
  const h = latestHistory(mems);
  if (!h) return { rolledBack: false };
  const cfg = configFromHistoryMem(h);
  if (!cfg) return { rolledBack: false };
  const cur = growthConfigFromLedger(mems);
  // 局部回退：仅用历史里的 mode_dispatch 块替换现行块的其余部分，绝不顺手退回别的族
  const next = opts.target === 'mode_dispatch'
    ? { ...cur, mode_dispatch: cfg.mode_dispatch ?? null }
    : cfg;
  await saveGrowthConfigToLedger(storage, next, opts);
  await storage.deleteMemory(h.mem_id); // 消费掉，避免反复回滚同一版
  return { rolledBack: true, from: cur.recall_weights, to: cfg.recall_weights };
}
