// 自我净化与生长页（REQ-009 / P14）接真内核：优化/调度动作审计真写 storage 账本
// （action='growth_op'，detail.entry 保真），挂载回放。
// 与记忆库管理页一致：复用 InMemoryStorage 单例（桌面 Electron 下自动绑定主进程
// FileStorage 持久账本；浏览器降级内存态）。数据真相 = 内核账本，无种子兜底。
import type { MemAgent } from '../../core/memagent/types.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { getKernel, getKernelStorage } from '../kernel.ts';
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
