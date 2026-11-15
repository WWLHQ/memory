// M3：统一进化轮 + 回诊回滚。
// 决策五态：adopted | rejected | insufficient | guarded | rolled_back。
// 门控：mode='off' → 连审计都不产；'suggest'（默认）→ 只落建议审计、绝不写 growth:v1；
//       'auto' → 统计达标 + 护栏通过才写（采纳前存历史 + 写死回诊计划）。
import type { EvolutionMode, GrowthConfig, RecallWeights } from '../../../shared/growthConfig.ts';
import { validateAuditRecord } from '../../../shared/auditShape.ts';
import type { AuditRecord, Form, StorageBackend } from '../types.ts';
import { growthConfigFromLedger } from '../paramsSnapshot.ts';
import {
  classify, collectDedupSamples, dedupDropExceeded, splitSamples,
  type DedupRollbackPlan,
} from '../regression.ts';
import {
  DEFAULT_EVAL_K, evaluateRecallWeights, samplesFromAudits, type EvalSample, type RecallEvalResult,
} from './recallEval.ts';
import {
  computeRollbackPlan, guardRecallWeights, isRollbackDue, proposeRecallWeights, rollbackDropExceeded,
  type Family, type GuardOutcome, type RollbackPlan,
} from './registry.ts';
import { rollbackGrowthConfig, saveConfigWithHistory } from './versioning.ts';

export interface LoopOptions {
  requestId: string;
  form: Form;
  now: number;
  enterpriseId?: string;
  teamId?: string;
}

export type LoopStatus = 'adopted' | 'rejected' | 'insufficient' | 'guarded' | 'rolled_back';

export interface FamilyDecision {
  family: Family;
  status: LoopStatus;
  reason: string;
  applied: boolean;
  from?: RecallWeights;
  to?: RecallWeights;
  eval?: RecallEvalResult;
  guard?: GuardOutcome;
  history_saved?: boolean;
}

export interface LoopResult {
  mode: EvolutionMode;
  decisions: FamilyDecision[];
}

const latestAdoptTs = (audits: AuditRecord[], family: Family): number | undefined => {
  let ts: number | undefined;
  for (const a of audits) {
    if (a.action !== 'growth_op') continue;
    const d = a.detail as { event?: unknown; family?: unknown };
    if (d.event === 'adopted' && d.family === family) {
      if (ts === undefined || a.ts > ts) ts = a.ts;
    }
  }
  return ts;
};

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * M5-1：每条 growth_op 都带 `phase`（evolution=进化轮 / rollback=回诊）与非空 `reason`。
 * 理由：M4 时间线只能显示审计里真有的字段，M3 把 reason 只放在返回值里 → 页面上大量「未写原因」。
 *
 * 后缀只允许 `[A-Za-z0-9_-]`（见 shared/auditShape.ts）：主进程 IPC 与 home 数据面都会用
 * `validateAuditRecord` 校验 request_id。2026-11-14 真机事故：feedback_policy 族用了 `#fb`，
 * 渲染层 `InMemoryStorage` 不校验 → 单测全绿，桌面壳主进程整条拒收 → 进化轮在写第二条审计时抛错，
 * 页面只能报「内核暂不可达」。现在在这里**同源**过一遍形状闸门，非法即带 family 抛出可读原因。
 */
async function appendGrowthOp(
  storage: StorageBackend, opts: LoopOptions,
  detail: Record<string, unknown> & { phase: 'evolution' | 'rollback'; reason: string },
  requestIdSuffix?: string,
): Promise<void> {
  const record: AuditRecord = {
    // 同一轮会写多条审计（如 recall 族 + feedback_policy 族）：request_id 加后缀保证唯一，
    // 前缀仍能按本轮 requestId 检索（时间线「审计 ID」可回查）。
    request_id: requestIdSuffix ? `${opts.requestId}${requestIdSuffix}` : opts.requestId,
    action: 'growth_op', form: opts.form,
    project_id: 'P_SYSTEM', user_id: 'system', ts: opts.now, detail,
  };
  try {
    validateAuditRecord(record);
  } catch (e) {
    throw new Error(
      `growth_op 审计形状非法（family=${String(detail.family)}，request_id=${record.request_id}）：`
      + `${(e as Error).message}`,
    );
  }
  await storage.appendAudit(record);
}

/**
 * 跑一轮进化（当前默认只驱动 recall_weights；feedback_policy 保守无数值时如实留记录）。
 * 红线：本函数不碰 dedup 回归的采纳（那条由既有 runGrowthRegression 负责）。
 */
export async function runEvolutionRound(
  storage: StorageBackend,
  opts: LoopOptions,
): Promise<LoopResult> {
  const cfg: GrowthConfig = growthConfigFromLedger(await storage.listMemories({}));
  const mode = cfg.evolution.mode;
  // M3-8：off → 连建议都不产，不写任何审计。
  if (mode === 'off') return { mode, decisions: [] };

  const audits = await storage.queryAudit({});
  const recallAudits = audits.filter((a) => a.action === 'recall');
  const feedbackAudits = audits.filter((a) => a.action === 'recall_feedback');
  const decisions: FamilyDecision[] = [];

  // ── 族：recall_weights ────────────────────────────────────────────
  const { proposal, metrics } = proposeRecallWeights(audits, cfg.recall_weights, opts.now);
  const minRecalls = cfg.evolution.min_samples.recall_count;
  if (!proposal) {
    const insufficient = metrics.recalls < minRecalls;
    const need = Math.max(0, minRecalls - metrics.recalls);
    // M5-1：reason 落进审计（含真实计数），页面不再只能显示「未写原因」
    const reason = insufficient
      ? `样本不足：${metrics.recalls}/${minRecalls} 次召回（还需 ${need} 次）`
      : `未触发调整规则：reject 占比 ${round3(metrics.reject_ratio)}、evidence_thin 占比 ${round3(metrics.evidence_thin_ratio)} 均未越阈`;
    decisions.push({ family: 'recall_weights', status: insufficient ? 'insufficient' : 'rejected', reason, applied: false });
    if (metrics.recalls > 0) {
      await appendGrowthOp(storage, opts, {
        phase: 'evolution', reason, need, metrics,
        event: insufficient ? 'insufficient' : 'not_adopted', family: 'recall_weights',
        applied: false,
      });
    }
  } else {
    const built = samplesFromAudits(recallAudits, feedbackAudits);
    const ev = evaluateRecallWeights({
      samples: built.samples,
      wFrom: proposal.from,
      wTo: proposal.to,
      minSamples: minRecalls,
    });
    if (ev.status !== 'suggest') {
      decisions.push({
        family: 'recall_weights', status: ev.status, reason: ev.reason, applied: false,
        from: proposal.from, to: proposal.to, eval: ev,
      });
      await appendGrowthOp(storage, opts, {
        phase: 'evolution', reason: ev.reason,
        event: 'suggest_recall_weights', family: 'recall_weights', applied: false, status: ev.status,
        from: proposal.from, to: proposal.to, eval: ev, skipped_old: built.skippedOld,
      });
    } else {
      const guard = guardRecallWeights(
        proposal.from, proposal.to, cfg.evolution, latestAdoptTs(audits, 'recall_weights'), opts.now,
      );
      if (!guard.pass) {
        decisions.push({
          family: 'recall_weights', status: 'guarded', reason: guard.reason, applied: false,
          from: proposal.from, to: proposal.to, eval: ev, guard,
        });
        await appendGrowthOp(storage, opts, {
          phase: 'evolution', reason: guard.reason,
          event: 'guarded', family: 'recall_weights', applied: false,
          from: proposal.from, to: proposal.to, eval: ev, guard,
        });
      } else if (mode === 'suggest') {
        // M3-1：只产建议审计，绝不写 growth:v1。
        const reason = `${ev.reason}（mode=suggest：只产建议，未写配置）`;
        decisions.push({
          family: 'recall_weights', status: 'rejected', reason: 'mode=suggest：只产建议不写配置', applied: false,
          from: proposal.from, to: proposal.to, eval: ev, guard,
        });
        await appendGrowthOp(storage, opts, {
          phase: 'evolution', reason,
          event: 'suggest_recall_weights', family: 'recall_weights', applied: false, status: 'suggested',
          from: proposal.from, to: proposal.to, eval: ev, guard,
        });
      } else {
        // M3-2：auto 且统计达标 + 护栏通过 → 真写；采纳前存历史，并写死回诊计划。
        const nextCfg: GrowthConfig = { ...cfg, recall_weights: proposal.to };
        const { history_saved } = await saveConfigWithHistory(storage, nextCfg, {
          requestId: opts.requestId, form: opts.form, enterpriseId: opts.enterpriseId, teamId: opts.teamId, now: opts.now,
        });
        const plan = computeRollbackPlan(
          opts.now, cfg.evolution.rollback, proposal.to, proposal.from, ev.meanTo,
        );
        await appendGrowthOp(storage, opts, {
          phase: 'evolution', reason: ev.reason,
          event: 'adopted', family: 'recall_weights', applied: true,
          from: proposal.from, to: proposal.to, eval: ev, guard, history_saved, rollback_plan: plan,
        });
        decisions.push({
          family: 'recall_weights', status: 'adopted', reason: ev.reason, applied: true,
          from: proposal.from, to: proposal.to, eval: ev, guard, history_saved,
        });
      }
    }
  }

  // ── 族：feedback_policy（保守：暂无自动建议，如实记录，不改配置） ──
  // M5-1：该族也落一条审计，时间线才能看出「本轮评估过它、为什么没动」，而不是凭空消失。
  const fbReason = '反馈策略暂无自动建议：净化动作需人工确认，enabled 仍由用户显式开启';
  decisions.push({ family: 'feedback_policy', status: 'rejected', reason: fbReason, applied: false });
  await appendGrowthOp(storage, opts, {
    phase: 'evolution', reason: fbReason,
    event: 'not_adopted', family: 'feedback_policy', applied: false,
  }, '_fb');

  return { mode, decisions };
}

export interface RollbackCheckOptions extends LoopOptions {
  /** 用户「立即回诊」：忽略 due_at，但仍需满足 min_recalls（M3-7） */
  force?: boolean;
}

/**
 * M5-4：判重族回诊 —— 读最近一次「已采纳」的 `weight_tuned`（kind='dedup_regression'）写死的计划，
 * 到期且窗口样本达标时，用**当前**权重/阈值重算测试集 F1，跌破 `baseline_test_f1 − max_drop` → 回滚到上一版。
 * 样本口径与回归一致（同一确定性划分），因此结论只对评估窗口负责。
 */
export async function runDedupRollbackCheck(
  storage: StorageBackend,
  opts: RollbackCheckOptions,
): Promise<DedupRollbackResult> {
  const cfg: GrowthConfig = growthConfigFromLedger(await storage.listMemories({}));
  if (cfg.evolution.mode === 'off') return { status: 'none' };

  const audits = await storage.queryAudit({});
  let latest: { ts: number; plan: DedupRollbackPlan } | null = null;
  for (const a of audits) {
    if (a.action !== 'weight_tuned') continue;
    const d = a.detail as { kind?: unknown; rollback_plan?: unknown };
    if (d.kind !== 'dedup_regression' || !d.rollback_plan) continue;
    const plan = d.rollback_plan as DedupRollbackPlan;
    if (plan.family !== 'dedup_weights') continue;
    if (!latest || a.ts > latest.ts) latest = { ts: a.ts, plan };
  }
  if (!latest) return { status: 'none' };
  const { plan } = latest;
  if (!isRollbackDue({ due_at: plan.due_at } as RollbackPlan, opts.now, opts.force)) {
    return { status: 'not_due', plan };
  }

  const windowDays = cfg.evolution.window.dedup_days;
  const samples = collectDedupSamples(audits, opts.now, windowDays);
  if (samples.length < plan.min_samples) {
    const needed = plan.min_samples - samples.length;
    await appendGrowthOp(storage, opts, {
      phase: 'rollback', event: 'insufficient', family: 'dedup_weights', applied: false,
      plan, needed,
      reason: `判重回诊样本不足：窗口内 ${samples.length}/${plan.min_samples} 条（还需 ${needed} 条）`,
    });
    return { status: 'insufficient', plan, needed };
  }

  const { test } = splitSamples(samples);
  const f1 = classify(test, cfg.weights, cfg.thresholds).f1;
  const drop = round3(plan.baseline_test_f1 - f1);
  if (!dedupDropExceeded(plan, f1)) {
    await appendGrowthOp(storage, opts, {
      phase: 'rollback', event: 'rollback_kept', family: 'dedup_weights', applied: false,
      plan, current_test_f1: f1, drop,
      reason: `判重回诊通过：当前测试集 F1 ${round3(f1)}，相对基线 ${round3(plan.baseline_test_f1)} 跌幅 ${drop} ≤ 允许 ${plan.max_drop}`,
    });
    return { status: 'ok', plan, current_test_f1: f1, drop };
  }

  const rb = await rollbackGrowthConfig(storage, {
    requestId: opts.requestId, form: opts.form, enterpriseId: opts.enterpriseId, teamId: opts.teamId, now: opts.now,
  });
  await appendGrowthOp(storage, opts, {
    phase: 'rollback', event: 'rolled_back', family: 'dedup_weights', applied: rb.rolledBack,
    plan, current_test_f1: f1, drop,
    reason: `判重回诊未通过：当前测试集 F1 ${round3(f1)}，相对基线 ${round3(plan.baseline_test_f1)} 跌幅 ${drop} > 允许 ${plan.max_drop} → 回滚到上一版`,
  });
  return { status: 'rolled_back', plan, current_test_f1: f1, drop };
}

export type RollbackStatus = 'none' | 'not_due' | 'insufficient' | 'ok' | 'rolled_back';

export interface RollbackCheckResult {
  status: RollbackStatus;
  plan?: RollbackPlan;
  current_mean_ndcg?: number;
  drop?: number;
  needed?: number;
}

/** M5-4：判重回诊结果（同一套状态语义，指标换成测试集 F1） */
export interface DedupRollbackResult {
  status: RollbackStatus;
  plan?: DedupRollbackPlan;
  current_test_f1?: number;
  drop?: number;
  needed?: number;
}

/** 当前权重在一批样本上的平均 NDCG（wFrom=wTo → 只取 meanFrom，纯读）。 */
function meanNdcgOf(samples: EvalSample[], weights: RecallWeights, k = DEFAULT_EVAL_K): { mean: number; n: number } {
  const ev = evaluateRecallWeights({ samples, wFrom: weights, wTo: weights, minSamples: 1, k });
  return { mean: ev.meanFrom, n: ev.samples };
}

/**
 * 回诊：读最近一次「auto 采纳 recall_weights」写死的 rollback_plan，到期且样本足够时重算当前 NDCG，
 * 跌破 baseline − max_drop → 回滚到上一版（并落 growth_op.rolled_back）。
 * M3-6：due_at 只认计划里的值，不跟当前配置走。
 */
export async function runRollbackCheck(
  storage: StorageBackend,
  opts: RollbackCheckOptions,
): Promise<RollbackCheckResult> {
  const audits = await storage.queryAudit({});
  // M5-2：mode='off' = 关闭自我进化 → 回诊也不写任何审计（与 M3-8 同口径，不留隐式动作）。
  if (growthConfigFromLedger(await storage.listMemories({})).evolution.mode === 'off') {
    return { status: 'none' };
  }
  let latest: { ts: number; plan: RollbackPlan } | null = null;
  for (const a of audits) {
    if (a.action !== 'growth_op') continue;
    const d = a.detail as { event?: unknown; family?: unknown; rollback_plan?: unknown };
    if (d.event !== 'adopted' || d.family !== 'recall_weights' || !d.rollback_plan) continue;
    const plan = d.rollback_plan as RollbackPlan;
    if (!latest || a.ts > latest.ts) latest = { ts: a.ts, plan };
  }
  if (!latest) return { status: 'none' };
  const { plan } = latest;
  if (!isRollbackDue(plan, opts.now, opts.force)) return { status: 'not_due', plan };

  const recalls = audits.filter((a) => a.action === 'recall' && a.ts >= plan.adopted_ts);
  if (recalls.length < plan.min_recalls) {
    const needed = plan.min_recalls - recalls.length;
    await appendGrowthOp(storage, opts, {
      phase: 'rollback', event: 'insufficient', family: 'recall_weights', applied: false,
      plan, needed,
      reason: `回诊样本不足：采纳后召回 ${recalls.length}/${plan.min_recalls} 次（还需 ${needed} 次）`,
    });
    return { status: 'insufficient', plan, needed };
  }
  const feedback = audits.filter((a) => a.action === 'recall_feedback');
  const built = samplesFromAudits(recalls, feedback);
  if (built.samples.length === 0) {
    await appendGrowthOp(storage, opts, {
      phase: 'rollback', event: 'insufficient', family: 'recall_weights', applied: false,
      plan, needed: 0,
      reason: `回诊样本不足：采纳后 ${recalls.length} 次召回里没有带 mems_detail 的可用样本（旧召回无埋点）`,
    });
    return { status: 'insufficient', plan, needed: 0 };
  }

  const { mean } = meanNdcgOf(built.samples, plan.adopted_weights);
  const drop = Math.round((plan.baseline_mean_ndcg - mean) * 1000) / 1000;
  if (!rollbackDropExceeded(plan, mean)) {
    // M5-1/M5-3：回诊通过也要留痕 —— 否则该计划在时间线上会永远显示「已过期未回诊」。
    await appendGrowthOp(storage, opts, {
      phase: 'rollback', event: 'rollback_kept', family: 'recall_weights', applied: false,
      plan, current_mean_ndcg: mean, drop,
      reason: `回诊通过：当前 NDCG ${round3(mean)}，相对基线 ${round3(plan.baseline_mean_ndcg)} 跌幅 ${drop} ≤ 允许 ${plan.max_drop}`,
    });
    return { status: 'ok', plan, current_mean_ndcg: mean, drop };
  }
  const rb = await rollbackGrowthConfig(storage, {
    requestId: opts.requestId, form: opts.form, enterpriseId: opts.enterpriseId, teamId: opts.teamId, now: opts.now,
  });
  await appendGrowthOp(storage, opts, {
    phase: 'rollback', event: 'rolled_back', family: 'recall_weights', applied: rb.rolledBack,
    plan, current_mean_ndcg: mean, drop, from: rb.from, to: rb.to,
    reason: `回诊未通过：当前 NDCG ${round3(mean)}，相对基线 ${round3(plan.baseline_mean_ndcg)} 跌幅 ${drop} > 允许 ${plan.max_drop} → 回滚到上一版`,
  });
  return { status: 'rolled_back', plan, current_mean_ndcg: mean, drop };
}
