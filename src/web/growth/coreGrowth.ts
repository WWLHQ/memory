// 自我净化与生长页（REQ-009 / P14）接真内核：优化/调度动作审计真写 storage 账本
// （action='growth_op'，detail.entry 保真），挂载回放。
// 与记忆库管理页一致：复用 InMemoryStorage 单例（桌面 Electron 下自动绑定主进程
// FileStorage 持久账本；浏览器降级内存态）。数据真相 = 内核账本，无种子兜底。
import type { MemAgent } from '../../core/memagent/types.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { getKernel, getKernelStorage, getTenant, newRequestId } from '../kernel.ts';
import {
  growthConfigFromLedger, saveGrowthConfigToLedger,
} from '../../core/memagent/paramsSnapshot.ts';
import {
  runGrowthRegression, type RegressionRunResult,
} from '../../core/memagent/regression.ts';
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
 * 保存生长配置：唯一写入口在 core（saveGrowthConfigToLedger），页面与主进程回归采纳共用。
 * 写 growth:v1: preference 记录（旧记录 delete + 新记录 put，pinned 豁免 gc）+ param_save 审计。
 */
export async function coreSaveGrowthConfig(
  cfg: Omit<GrowthConfig, 'recall_weights' | 'feedback_policy'>
    & Partial<Pick<GrowthConfig, 'recall_weights' | 'feedback_policy'>>,
  requestId: string,
): Promise<{ request_id: string; mem_id: string; version: number }> {
  const { storage } = await getCtx();
  const tenant = getTenant();
  // 批次61 GAP-1/GAP-2：页面保存判重参数时不传这两块 → 一律继承账本现值。
  // 否则「改判重权重」会顺手把召回权重清回默认、还能把用户已启用的反馈策略悄悄关掉。
  const ledger = growthConfigFromLedger(await storage.listMemories({}));
  const merged: GrowthConfig = {
    ...cfg,
    recall_weights: cfg.recall_weights ?? ledger.recall_weights,
    feedback_policy: cfg.feedback_policy ?? ledger.feedback_policy,
  };
  const saved = await saveGrowthConfigToLedger(storage, merged, {
    requestId, form: 'web', enterpriseId: tenant.enterprise_id, teamId: tenant.team_id,
  });
  return { request_id: requestId, mem_id: saved.mem_id, version: saved.version };
}

/**
 * 批次48 A23.3：页面「立即执行」= 跑**真实**回归（同一核心算法，与主进程 cron 一致），
 * 结果由 core 写 insufficient_samples / weight_regression / weight_tuned 审计；
 * 采纳时才落新配置。页面据返回 status 如实提示，不再写假的 weight_tuned。
 * 同时回传真实审计回执（request_id / 写入的 action / 该动作账本累计条数）。
 */
export interface RegressionReceipt {
  requestId: string;
  action: 'insufficient_samples' | 'weight_regression' | 'weight_tuned';
  total: number;
  at: number;
}

export async function coreRunGrowthRegression(): Promise<{
  result: RegressionRunResult;
  receipt: RegressionReceipt;
}> {
  const { storage } = await getCtx();
  const tenant = getTenant();
  const requestId = newRequestId('reg');
  const result = await runGrowthRegression(storage, {
    requestId, form: 'web',
    enterpriseId: tenant.enterprise_id, teamId: tenant.team_id,
  });
  const action = result.status === 'insufficient_samples'
    ? 'insufficient_samples'
    : result.status === 'not_adopted' ? 'weight_regression' : 'weight_tuned';
  const total = (await storage.queryAudit({ action })).length;
  return { result, receipt: { requestId, action, total, at: Date.now() } };
}
