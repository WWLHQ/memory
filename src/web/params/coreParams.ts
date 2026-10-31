// 全局参数页（REQ-006 / P5）接真内核：参数快照存内核 preference 记忆（params:v1: JSON，
// pinned 防 gc），保存真写 storage 账本 + param_save 审计，加载 getPrefs 口径回填。
import type { MemAgent, Memory } from '../../core/memagent/types.ts';
import type { InMemoryStorage } from '../../core/memagent/storage.ts';
import { getKernel, getKernelStorage, getTenant, newRequestId } from '../kernel.ts';
import { PARAMS_PREF_PREFIX as PREF_PREFIX, parseParamsSnapshot } from '../../core/memagent/paramsSnapshot.ts';
import { normalizeUnitPrice } from '../../core/memagent/recallInsight.ts';
import type { DevParams, KbPolicyRow, NormalConfig } from './types.ts';

interface ParamsCtx {
  ma: MemAgent;
  storage: InMemoryStorage;
}

function getCtx(): ParamsCtx {
  return { ma: getKernel(), storage: getKernelStorage() };
}

function packContent(payload: { cfg: NormalConfig; kbs: KbPolicyRow[]; dev: DevParams }): string {
  return PREF_PREFIX + JSON.stringify(payload);
}

function tryParsePayload(content: string): { cfg: NormalConfig; kbs: KbPolicyRow[]; dev: DevParams } | null {
  return parseParamsSnapshot(content) as { cfg: NormalConfig; kbs: KbPolicyRow[]; dev: DevParams } | null;
}

async function findParamsMemory(storage: InMemoryStorage): Promise<Memory | null> {
  const mems = await storage.listMemories({});
  return mems.find((m) => m.category === 'preference' && m.user_id === 'system' && m.content.startsWith(PREF_PREFIX)) ?? null;
}

/** 加载：内核 preference 记忆回填；无已保存快照 → null（页面用默认值） */
export async function coreLoadParams(): Promise<{ cfg: NormalConfig; kbs: KbPolicyRow[]; dev: DevParams } | null> {
  const { storage } = await getCtx();
  const m = await findParamsMemory(storage);
  const saved = m ? tryParsePayload(m.content) : null;
  if (!saved) return null;
  // 旧快照没有 cost_cny_per_mtok 字段：归一为 null（不显示金额），避免页面拿到 undefined
  return { ...saved, cfg: { ...saved.cfg, cost_cny_per_mtok: normalizeUnitPrice(saved.cfg?.cost_cny_per_mtok) } };
}

/** 保存：快照写内核（旧快照 delete + 新快照 put，pinned 豁免 gc）+ param_save 审计落账本 */
export async function coreSaveParams(
  cfg: NormalConfig, kbs: KbPolicyRow[], dev: DevParams, requestId: string,
): Promise<{ request_id: string; mem_id: string; version: number }> {
  const { storage } = await getCtx();
  const tenant = getTenant();
  const old = await findParamsMemory(storage);
  if (old) await storage.deleteMemory(old.mem_id);
  const mem: Memory = {
    mem_id: newRequestId('params'),
    project_id: 'P_SYSTEM', user_id: 'system', enterprise_id: tenant.enterprise_id, team_id: tenant.team_id,
    category: 'preference', layer: 'L2',
    content: packContent({ cfg, kbs, dev }),
    decay_class: 'hot', pinned: true, locked: false,
    version: (old?.version ?? 0) + 1, created_at: Date.now(), updated_at: Date.now(),
  };
  await storage.putMemory(mem);
  await storage.appendAudit({
    request_id: requestId, action: 'param_save', form: 'web', project_id: 'P_SYSTEM', user_id: 'system',
    ts: Date.now(), detail: { cfg, kbs, dev, version: mem.version },
  });
  return { request_id: requestId, mem_id: mem.mem_id, version: mem.version };
}
