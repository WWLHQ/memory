// 自我净化与生长页（REQ-009 / P14）接真内核：优化/调度动作审计真写 storage 账本
// （action='growth_op'，detail.entry 保真），挂载回放；指标卡保留演示快照（诚实标注）。
import type { MemAgent } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';
import type { GrowthAuditEntry } from './types.ts';

interface GrowthCtx {
  ma: MemAgent;
  storage: InMemoryStorage;
}

let ctxP: Promise<GrowthCtx> | null = null;

function getCtx(): Promise<GrowthCtx> {
  if (!ctxP) {
    ctxP = (async () => {
      const storage = new InMemoryStorage();
      const ma = createMemAgent({
        form: 'web', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
      });
      return { ma, storage };
    })();
  }
  return ctxP;
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
