// 监控仪表盘（REQ-006 / P6）接真内核：告警时间线存内核账本（action='monitor_alert'，
// detail.entry 保真），挂载回放；指标卡保留演示快照（诚实标注，内核无对应统计口径）。
import type { MemAgent } from '../../core/memagent/types.ts';
import { ulid } from '../../core/memagent/ulid.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';
import { SEED_ALERTS } from './seed.ts';
import type { AlertItem } from './types.ts';

interface MonitorCtx {
  ma: MemAgent;
  storage: InMemoryStorage;
}

let ctxP: Promise<MonitorCtx> | null = null;

function getCtx(): Promise<MonitorCtx> {
  if (!ctxP) {
    ctxP = (async () => {
      const storage = new InMemoryStorage();
      const ma = createMemAgent({
        form: 'web', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
      });
      // 种子告警 → 内核账本（detail.entry 全字段保真，回放零损失；request_id/ts 沿用条目）
      for (const e of SEED_ALERTS) {
        await storage.appendAudit({
          request_id: e.request_id ?? `req_mon_${ulid()}`, action: 'monitor_alert', form: 'web',
          ts: Date.parse(e.ts) || Date.now(), detail: { entry: e },
        });
      }
      return { ma, storage };
    })();
  }
  return ctxP;
}

/** 挂载回放：内核账本中的告警（种子 + 运行时新增），插入序 = 时间线序 */
export async function coreLoadAlerts(): Promise<AlertItem[]> {
  const { storage } = await getCtx();
  const audits = await storage.queryAudit({ action: 'monitor_alert' });
  return audits
    .map((a) => (a.detail as { entry?: AlertItem }).entry)
    .filter((e): e is AlertItem => Boolean(e));
}

/** 运行时新增告警（供后续接入真实指标探测；当前页面只读回放） */
export async function coreRaiseAlert(entry: AlertItem): Promise<{ total: number }> {
  const { storage } = await getCtx();
  await storage.appendAudit({
    request_id: entry.request_id ?? `req_mon_${ulid()}`, action: 'monitor_alert', form: 'web',
    ts: Date.parse(entry.ts) || Date.now(), detail: { entry },
  });
  const total = (await storage.queryAudit({ action: 'monitor_alert' })).length;
  return { total };
}
