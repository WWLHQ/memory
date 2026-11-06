// 全局参数页（REQ-006 / P5）纯逻辑层
import type { DevParams, KbPolicyRow, NormalConfig } from './types.ts';
import { FORGET_SPEED_HALF_LIFE_DAYS, RETENTION_ARCHIVE_DAYS } from '../../shared/normalParams.ts';

// 批次48 A17：折算表与内核遗忘调度共用 shared/normalParams.ts（单一真源）。
/** 遗忘速度 → half_life 档位（17.6） */
export function speedToHalfLife(s: NormalConfig['forget_speed']): number {
  return FORGET_SPEED_HALF_LIFE_DAYS[s];
}

/** 保留时长 → 归档阈值档（17.6） */
export function retentionToArchive(r: NormalConfig['retention']): number {
  return RETENTION_ARCHIVE_DAYS[r];
}

/** 权重校验（2.4.3）：和=1.0（容差 1e-6）且各 ≥0 */
export function validateWeights(w: DevParams['weights']): string | null {
  const sum = w.w_f + w.w_i + w.w_c + w.w_a;
  if (Math.abs(sum - 1) > 1e-6) return `权重之和须为 1.0，当前 ${sum.toFixed(4)}`;
  if (Object.values(w).some((v) => v < 0)) return '权重不可为负';
  return null;
}

/** payload 三档递增校验（2.4.1） */
export function payloadOrdered(p: DevParams['payload']): string | null {
  if (!(p.soft < p.warn && p.warn < p.break)) return 'payload 三档须严格递增（软上限 < 告警 < 熔断）';
  return null;
}

/** 知识库策略行校验（17.6 保存前数值区间） */
export function validateKbRow(row: KbPolicyRow): string | null {
  if (!(row.half_life_days > 0)) return '半衰期须 > 0';
  if (!(row.archive_days > 0)) return '归档阈值须 > 0';
  return null;
}

/** N/M 校验（9.10）：N<M */
export function validateNM(n: number, m: number): string | null {
  return n < m ? null : 'N 天须小于 M 天';
}

/** 成本单价校验（批次11）：null = 未设置（合法）；否则须为有限非负数 */
export function validateUnitPrice(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v)) return '成本单价须为数字';
  if (v < 0) return '成本单价不可为负';
  return null;
}

/** 批次48 A16：反代理配额校验 —— null = 未设置（合法）；否则须为正整数（次/日） */
export function validateProxyQuota(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || !Number.isInteger(v)) return '反代理日配额须为正整数';
  if (v <= 0) return '反代理日配额须大于 0';
  return null;
}

/** 全量校验：返回错误文案数组（空=可保存） */
export function validateAll(cfg: NormalConfig, kbs: KbPolicyRow[], dev: DevParams): string[] {
  const errs: string[] = [];
  kbs.forEach((r) => {
    const e = validateKbRow(r);
    if (e) errs.push(`知识库[${r.kb}]：${e}`);
  });
  const w = validateWeights(dev.weights);
  if (w) errs.push(w);
  const p = payloadOrdered(dev.payload);
  if (p) errs.push(p);
  const nm = validateNM(dev.n_days, dev.m_days);
  if (nm) errs.push(nm);
  const price = validateUnitPrice(cfg.cost_cny_per_mtok);
  if (price) errs.push(price);
  const proxyPrice = validateUnitPrice(cfg.proxy_price_cny_per_kcall);
  if (proxyPrice) errs.push(`反代理${proxyPrice}`);
  const proxyQuota = validateProxyQuota(cfg.proxy_daily_quota);
  if (proxyQuota) errs.push(proxyQuota);
  if (!cfg.auto_organize) errs.push('⚠ 自动整理已关闭：合并/摘要后台任务将停用（15.2/17.10）');
  return errs;
}

/** 生成审计对象（G6）：params_change + request_id */
export function auditParams(requestId: string, changed: string[]): { action: string; request_id: string; note: string } {
  return {
    action: 'params_change',
    request_id: requestId,
    note: `调整：${changed.join('、') || '无'}`,
  };
}
