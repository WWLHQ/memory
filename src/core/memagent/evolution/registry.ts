// M3：参数族注册。每族提供「提议（propose）/ 护栏（guard）/ 应用（apply 由 loop 执行）」。
// 说明：dedup_weights / dedup_thresholds 的采纳仍由既有 runGrowthRegression 负责（写入期闭环，行为不变）；
// 本注册表主要驱动**读取期**的 recall_weights（可验证）与 feedback_policy（保守）两族。
import {
  DEFAULT_RECALL_WEIGHTS, type EvolutionConfig, type RecallWeights,
} from '../../../shared/growthConfig.ts';
import type { AuditRecord } from '../types.ts';
import { suggestRecallWeights, type RecallSuggestionMetrics } from '../regression.ts';

export type Family = 'recall_weights' | 'feedback_policy' | 'dedup_weights' | 'dedup_thresholds' | 'mode_dispatch';
/** 进化轮实际驱动的族（dedup 由既有回归负责，不在此重复采纳） */
export const EVOLUTION_FAMILIES: Family[] = ['recall_weights', 'feedback_policy', 'mode_dispatch'];

const DAY = 24 * 3600 * 1000;
const KEYS: Array<keyof RecallWeights> = ['w_f', 'w_i', 'w_c', 'w_a'];
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export interface Proposal {
  family: Family;
  from: RecallWeights;
  to: RecallWeights;
  reason: string;
}

/** recall_weights 提议：复用既有启发式（reject/evidence_thin 占比），不做语义推断。 */
export function proposeRecallWeights(
  audits: AuditRecord[],
  current: RecallWeights,
  now: number,
): { proposal: Proposal | null; metrics: RecallSuggestionMetrics } {
  const { suggestion, metrics } = suggestRecallWeights(audits, current, now);
  if (!suggestion) return { proposal: null, metrics };
  return {
    proposal: {
      family: 'recall_weights', from: suggestion.from, to: suggestion.to, reason: suggestion.reason,
    },
    metrics,
  };
}

export interface GuardOutcome {
  pass: boolean;
  reason: string;
}

/**
 * recall_weights 护栏（§7 M3-3 / M3-4）：
 * ① 冷却期（同族上次自动采纳至今 < cooldown_days）→ 不重复调；
 * ② 单次步长 |to−from| ≤ max_step（每维）；
 * ③ 累计漂移 |to−默认| ≤ max_drift（每维）。
 */
export function guardRecallWeights(
  from: RecallWeights,
  to: RecallWeights,
  cfg: EvolutionConfig,
  lastAdoptAt: number | undefined,
  now: number,
): GuardOutcome {
  if (lastAdoptAt !== undefined && now - lastAdoptAt < cfg.guard.cooldown_days * DAY) {
    return { pass: false, reason: `冷却期内（${cfg.guard.cooldown_days} 天）不重复自动调整` };
  }
  for (const k of KEYS) {
    if (Math.abs(to[k] - from[k]) > cfg.guard.max_step + 1e-9) {
      return { pass: false, reason: `单次步长 ${k}=${round3(Math.abs(to[k] - from[k]))} 超 max_step=${cfg.guard.max_step}` };
    }
  }
  for (const k of KEYS) {
    if (Math.abs(to[k] - DEFAULT_RECALL_WEIGHTS[k]) > cfg.guard.max_drift + 1e-9) {
      return { pass: false, reason: `累计漂移 ${k}=${round3(Math.abs(to[k] - DEFAULT_RECALL_WEIGHTS[k]))} 超 max_drift=${cfg.guard.max_drift}` };
    }
  }
  return { pass: true, reason: '护栏通过' };
}

/** 采纳时刻算死的回诊计划（§2.2：不跟配置走，写进 growth_op.rollback_plan）。 */
export interface RollbackPlan {
  family: Family;
  adopted_ts: number;
  due_at: number;
  min_recalls: number;
  max_drop: number;
  /** 采纳时在当窗口样本上的 NDCG 基线（用于回诊比较） */
  baseline_mean_ndcg: number;
  /** 采纳后的权重（回诊时用它重算当前 NDCG） */
  adopted_weights: RecallWeights;
  /** 采纳前的权重（回滚目标） */
  previous_weights: RecallWeights;
}

export function computeRollbackPlan(
  now: number,
  rb: EvolutionConfig['rollback'],
  adoptedWeights: RecallWeights,
  previousWeights: RecallWeights,
  baselineMeanNdcg: number,
): RollbackPlan {
  return {
    family: 'recall_weights',
    adopted_ts: now,
    due_at: now + rb.after_days * DAY,
    min_recalls: rb.min_recalls,
    max_drop: rb.max_drop,
    baseline_mean_ndcg: baselineMeanNdcg,
    adopted_weights: { ...adoptedWeights },
    previous_weights: { ...previousWeights },
  };
}

/** 回诊是否到期（只读计划里的 due_at，**不跟当前配置走** → M3-6）。 */
export function isRollbackDue(plan: RollbackPlan, now: number, force = false): boolean {
  return force || now >= plan.due_at;
}

/** 回诊：当前 NDCG 相对基线的跌幅是否超过 max_drop（跌破即回滚）。 */
export function rollbackDropExceeded(plan: RollbackPlan, currentMeanNdcg: number): boolean {
  return plan.baseline_mean_ndcg - currentMeanNdcg > plan.max_drop + 1e-9;
}

// 判重族的回诊计划（DedupRollbackPlan / computeDedupRollbackPlan / dedupDropExceeded）定义在
// `core/memagent/regression.ts`：那边是判重的家，且本文件已 import 它，放在这里会形成循环依赖。
