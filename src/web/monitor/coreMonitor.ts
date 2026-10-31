// 监控仪表盘（REQ-006 / P6）接真内核：告警时间线读真实账本（action='monitor_alert'，只读回放，不再灌种子）。
// 数据真相 = 内核账本（桌面 Electron 下 = 主进程 FileStorage 持久库；浏览器降级内存态，无告警诚实空态）。
// 与记忆库管理页一致：禁止注入演示/种子告警 —— 时间线只反映真实账本 monitor_alert 审计；
// 无告警 → 诚实空态（引导去真实操作产生告警，不伪造）。
import type { MemAgent } from '../../core/memagent/types.ts';
import { ulid } from '../../core/memagent/ulid.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { getKernel, getKernelStorage } from '../kernel.ts';
import type { AlertItem } from './types.ts';

interface MonitorCtx {
  ma: MemAgent;
  storage: StorageBackend;
}

function getCtx(): MonitorCtx {
  return { ma: getKernel(), storage: getKernelStorage() };
}

/** 挂载回放：真实账本中的告警（仅读，不写入；无告警 → 空数组诚实空态） */
export async function coreLoadAlerts(): Promise<AlertItem[]> {
  const { storage } = await getCtx();
  const audits = await storage.queryAudit({ action: 'monitor_alert' });
  return audits
    .map((a) => (a.detail as { entry?: AlertItem }).entry)
    .filter((e): e is AlertItem => Boolean(e));
}

/** 运行时新增告警（供真实指标探测接入；页面只读回放，当前无真实探测源 → 不调用） */
export async function coreRaiseAlert(entry: AlertItem): Promise<{ total: number }> {
  const { storage } = await getCtx();
  await storage.appendAudit({
    request_id: entry.request_id ?? `req_mon_${ulid()}`, action: 'monitor_alert', form: 'web',
    ts: Date.parse(entry.ts) || Date.now(), detail: { entry },
  });
  const total = (await storage.queryAudit({ action: 'monitor_alert' })).length;
  return { total };
}
