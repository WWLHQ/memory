// 自我净化与生长页（REQ-009 / P14）接真内核：优化/调度动作审计真写 storage 账本
// （action='growth_op'，detail.entry 保真），挂载回放。
// 与记忆库管理页一致：复用 InMemoryStorage 单例（桌面 Electron 下自动绑定主进程
// FileStorage 持久账本；浏览器降级内存态）。数据真相 = 内核账本，无种子兜底。
import type { MemAgent } from '../../core/memagent/types.ts';
import type { Memory, StorageBackend } from '../../core/memagent/types.ts';
import { getKernel, getKernelStorage, getTenant, newRequestId } from '../kernel.ts';
import { GROWTH_PREF_PREFIX, findGrowthMemory, growthConfigFromLedger } from '../../core/memagent/paramsSnapshot.ts';
import type { GrowthConfig } from '../../shared/growthConfig.ts';
import type { GrowthAuditEntry } from './types.ts';

interface GrowthCtx {
  ma: MemAgent;
  storage: StorageBackend;
}

function getCtx(): GrowthCtx {
  return { ma: getKernel(), storage: getKernelStorage() };
}

/** 动作审计真写内核账本（weight_tuned / schedule_changed / …），返回回执 */
export async function coreGrowthAudit(
  entry: GrowthAuditEntry, requestId: string,
): Promise<{ request_id: string; total: number }> {
  const { storage } = await getCtx();
  await storage.appendAudit({
    request_id: requestId, action: 'growth_op', form: 'web', project_id: 'P1',
    ts: Date.now(), detail: { entry },
  });
  const total = (await storage.queryAudit({ action: 'growth_op' })).length;
  return { request_id: requestId, total };
}

/** 挂载回放：内核账本中的 growth_op 审计（P14 重进页面不丢历史） */
export async function coreLoadGrowthAudit(): Promise<GrowthAuditEntry[]> {
  const { storage } = await getCtx();
  const audits = await storage.queryAudit({ action: 'growth_op' });
  return audits
    .map((a) => (a.detail as { entry?: GrowthAuditEntry }).entry)
    .filter((e): e is GrowthAuditEntry => Boolean(e));
}

/** 加载生长配置：账本 preference 记录（无记录 → 默认值，不伪造“已保存”状态） */
export async function coreLoadGrowthConfig(): Promise<GrowthConfig> {
  const { storage } = await getCtx();
  return growthConfigFromLedger(await storage.listMemories({}));
}

/**
 * 保存生长配置：写 growth:v1: preference 记录（旧记录 delete + 新记录 put，pinned 豁免 gc），
 * 并落 param_save 审计（detail.kind='growth_config'）。内核下次写入即按新权重/阈值查重。
 */
export async function coreSaveGrowthConfig(
  cfg: GrowthConfig, requestId: string,
): Promise<{ request_id: string; mem_id: string; version: number }> {
  const { storage } = await getCtx();
  const tenant = getTenant();
  const old = findGrowthMemory(await storage.listMemories({}));
  if (old) await storage.deleteMemory(old.mem_id);
  const mem: Memory = {
    mem_id: newRequestId('growth'),
    project_id: 'P_SYSTEM', user_id: 'system', enterprise_id: tenant.enterprise_id, team_id: tenant.team_id,
    category: 'preference', layer: 'L2',
    content: `${GROWTH_PREF_PREFIX}${JSON.stringify(cfg)}`,
    decay_class: 'hot', pinned: true, locked: false,
    version: (old?.version ?? 0) + 1, created_at: Date.now(), updated_at: Date.now(),
  };
  await storage.putMemory(mem);
  await storage.appendAudit({
    request_id: requestId, action: 'param_save', form: 'web', project_id: 'P_SYSTEM', user_id: 'system',
    ts: Date.now(), detail: { kind: 'growth_config', growth: cfg, version: mem.version },
  });
  return { request_id: requestId, mem_id: mem.mem_id, version: mem.version };
}
