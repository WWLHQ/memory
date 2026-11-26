// M3：统一进化轮 + 回诊回滚。
// 决策五态：adopted | rejected | insufficient | guarded | rolled_back。
// 门控：mode='off' → 连审计都不产；'suggest'（默认）→ 只落建议审计、绝不写 growth:v1；
//       'auto' → 统计达标 + 护栏通过才写（采纳前存历史 + 写死回诊计划）。
import type { EvolutionMode, GrowthConfig, ModeDispatchSnapshot, RecallWeights } from '../../../shared/growthConfig.ts';
import { RECALL_KEYS } from '../../../shared/growthConfig.ts';
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
import {
  applyDispatchProposal, buildDispatchSamples, computeDispatchBackfill, computeDispatchRollbackPlan,
  dispatchBaseline, proposeModeDispatch, validDispatchProposal,
  type DispatchProposal, type DispatchRollbackPlan,
} from './modeDispatchRegression.ts';
import {
  buildRankSamples, proposeWeightStep, type WeightStepProposal,
} from './rankWeightStep.ts';
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
  /** 7.2 分流族：本轮产出的建议（只含一个模式的一处改动） */
  dispatch?: DispatchProposal;
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

  // ── 族：mode_dispatch（7.2 读取侧 · 2026-11-25 口径）────────────────
  // 只读账本：mode_feedback（👍/👎+原因）→ 关联 mode_dispatch（建议模式/命中词）→ 产「删一个词」的建议。
  // 窗口 30 天、最小有效标注 10 条；采纳后从上次采纳时刻重新计，避免同一批样本被连续周轮重复计。
  const dispatchBuilt = buildDispatchSamples(audits, {
    now: opts.now,
    windowDays: cfg.evolution.window.dispatch_days,
    since: latestAdoptTs(audits, 'mode_dispatch'),
  });
  const dm = dispatchBuilt.metrics;
  const minTagged = cfg.evolution.min_samples.dispatch_tagged;
  if (dm.tagged < minTagged) {
    const need = Math.max(0, minTagged - dm.tagged);
    const reason = `样本不足：${dm.tagged}/${minTagged} 条有效标注（还需 ${need} 条；`
      + `👎=召回内容不对 ${dm.ignored_content} 条不计入分流回归、关联不到分流记录 ${dm.unlinked} 条已跳过）`;
    decisions.push({ family: 'mode_dispatch', status: 'insufficient', reason, applied: false });
    // 与 recall 族同口径：窗口内一条反馈都没有 → 决策照常返回，但不写审计噪音
    if (dm.feedback > 0) {
      await appendGrowthOp(storage, opts, {
        phase: 'evolution', reason, need, metrics: dm,
        event: 'insufficient', family: 'mode_dispatch', applied: false,
      }, '_dp');
    }
  } else {
    const { proposal, reason: why } = proposeModeDispatch(dispatchBuilt.samples, cfg.mode_dispatch ?? null);
    if (!proposal) {
      decisions.push({ family: 'mode_dispatch', status: 'rejected', reason: why, applied: false });
      await appendGrowthOp(storage, opts, {
        phase: 'evolution', reason: why, metrics: dm,
        event: 'not_adopted', family: 'mode_dispatch', applied: false,
      }, '_dp');
    } else {
      const lastAdopt = latestAdoptTs(audits, 'mode_dispatch');
      const cooling = lastAdopt !== undefined
        && opts.now - lastAdopt < cfg.evolution.guard.cooldown_days * 24 * 3600 * 1000;
      if (cooling) {
        const reason = `冷却期内（上次采纳 ${new Date(lastAdopt!).toISOString().slice(0, 10)}，`
          + `冷却 ${cfg.evolution.guard.cooldown_days} 天），暂不改动`;
        decisions.push({ family: 'mode_dispatch', status: 'guarded', reason, applied: false, dispatch: proposal });
        await appendGrowthOp(storage, opts, {
          phase: 'evolution', reason, metrics: dm,
          event: 'guarded', family: 'mode_dispatch', applied: false, dispatch: proposal,
        }, '_dp');
      } else if (mode === 'suggest') {
        const reason = `${proposal.reason}（mode=suggest：只产建议，未写配置）`;
        decisions.push({
          family: 'mode_dispatch', status: 'rejected', reason: 'mode=suggest：只产建议不写配置',
          applied: false, dispatch: proposal,
        });
        await appendGrowthOp(storage, opts, {
          phase: 'evolution', reason, metrics: dm, status: 'suggested',
          event: 'suggest_mode_dispatch', family: 'mode_dispatch', applied: false, dispatch: proposal,
        }, '_dp');
      } else {
        // auto：必须以现行快照为基底整块重写，并由 normalizeModeDispatch 整块校验（失败不写半份）。
        // 账本没有快照时以内核基线为基底（三者都是内核真源，见 dispatchBaseline 注释），
        // 审计用 baseline_source 如实区分「相对账本」还是「相对内核基线」。
        const baseline = dispatchBaseline(cfg.mode_dispatch ?? null);
        const valid = baseline ? applyDispatchProposal(baseline.base, proposal) : null;
        if (!valid) {
          const reason = baseline
            ? '建议写入后整块校验失败（词表/阈值/权重和/类型），整单拒绝'
            : '内核基线快照未通过整块校验，拒绝写入（不写半份配置）';
          decisions.push({ family: 'mode_dispatch', status: 'rejected', reason, applied: false, dispatch: proposal });
          await appendGrowthOp(storage, opts, {
            phase: 'evolution', reason, metrics: dm,
            event: 'not_adopted', family: 'mode_dispatch', applied: false, dispatch: proposal,
          }, '_dp');
        } else {
          const { history_saved } = await saveConfigWithHistory(storage, { ...cfg, mode_dispatch: valid }, {
            requestId: opts.requestId, form: opts.form,
            enterpriseId: opts.enterpriseId, teamId: opts.teamId, now: opts.now,
          });
          // 回诊基线：采纳前 30 天窗口（不带 since）算一次命中率；样本不足则如实不挂计划。
          const beforeMetrics = buildDispatchSamples(audits, {
            now: opts.now, windowDays: cfg.evolution.window.dispatch_days,
          }).metrics;
          const plan = computeDispatchRollbackPlan(opts.now, beforeMetrics, {
            afterDays: cfg.evolution.rollback.after_days,
            minTagged: minTagged,
            maxDrop: cfg.evolution.rollback.mode_dispatch_max_drop,
            snapshot: valid,
          });
          await appendGrowthOp(storage, opts, {
            phase: 'evolution', reason: proposal.reason, metrics: dm, history_saved,
            event: 'adopted', family: 'mode_dispatch', applied: true, dispatch: proposal,
            baseline_source: baseline!.source,
            ...(plan ? { rollback_plan: plan } : { rollback_baseline_skipped: `基线样本 ${beforeMetrics.tagged}/${minTagged} 不足，未挂回诊计划` }),
          }, '_dp');
          decisions.push({
            family: 'mode_dispatch', status: 'adopted', reason: proposal.reason,
            applied: true, history_saved, dispatch: proposal,
          });
        }
      }
    }
  }

  // ── 排序反馈 → weight_step（2026-11-26，方案 MODE-FEEDBACK-TARGET-FIELD.md §2.2）──
  // 与 recall_weights 族的建议独立：来源是 recall_feedback.rank_wrong + expected_first_id，
  // 只在 ≥2 条不同请求指向同一可调维度时产建议；suggest 只审计，auto 过护栏才写。
  const rankBuilt = buildRankSamples(audits, cfg.recall_weights, {
    now: opts.now, windowDays: cfg.evolution.window.recall_days,
    since: latestAdoptTs(audits, 'recall_weights'),
  });
  const ws = proposeWeightStep(rankBuilt.samples, cfg.recall_weights, cfg.evolution.guard.max_step);
  if (ws.proposal) {
    const p = ws.proposal;
    if (mode === 'suggest') {
      await appendGrowthOp(storage, opts, {
        phase: 'evolution', reason: `${p.reason}（mode=suggest：只产建议，未写配置）`,
        event: 'suggest_weight_step', family: 'recall_weights', applied: false,
        status: 'suggested', kind: 'weight_step', weight_step: p, skipped: rankBuilt.skipped,
      }, '_ws');
    } else {
      const guardWs = guardRecallWeights(p.from, p.to, cfg.evolution, latestAdoptTs(audits, 'recall_weights'), opts.now);
      if (!guardWs.pass) {
        await appendGrowthOp(storage, opts, {
          phase: 'evolution', reason: guardWs.reason,
          event: 'guarded', family: 'recall_weights', applied: false,
          kind: 'weight_step', weight_step: p, guard: guardWs,
        }, '_ws');
      } else {
        const { history_saved } = await saveConfigWithHistory(storage, { ...cfg, recall_weights: p.to }, {
          requestId: opts.requestId, form: opts.form,
          enterpriseId: opts.enterpriseId, teamId: opts.teamId, now: opts.now,
        });
        await appendGrowthOp(storage, opts, {
          phase: 'evolution', reason: p.reason,
          event: 'adopted', family: 'recall_weights', applied: true,
          kind: 'weight_step', weight_step: p, history_saved,
        }, '_ws');
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

/* ── 批次 C1：一键采纳（suggest 模式下用户显式说「采纳」时的落库入口） ── */

export interface AdoptResult {
  applied: boolean;
  reason: string;
  from?: RecallWeights;
  to?: RecallWeights;
  history_saved?: boolean;
  request_id: string;
}

/** 召回权重形状校验：四维齐全、各 0–1（与 normalizeGrowthConfig 同口径的入参闸门） */
function validRecallWeights(w: unknown): w is RecallWeights {
  if (!w || typeof w !== 'object') return false;
  const r = w as Record<string, unknown>;
  return RECALL_KEYS.every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]) && r[k] >= 0 && r[k] <= 1);
}

/**
 * 一键采纳：读最近一条 suggest_recall_weights 建议审计，重过护栏（步长/漂移/冷却期）后
 * 走与 auto 采纳完全相同的落库链路（saveConfigWithHistory + 回诊计划 + growth_op.adopted）。
 * 红线：只采纳**审计里真实存在**的建议（绝不现场现算建议替用户决定）；护栏不过就拒绝，不静默放行；
 * mode='off' 拒绝；采纳与 auto 同样计入冷却期（latestAdoptTs 同源）。
 */
export async function adoptSuggestedRecallWeights(
  storage: StorageBackend,
  opts: LoopOptions,
): Promise<AdoptResult> {
  const cfg: GrowthConfig = growthConfigFromLedger(await storage.listMemories({}));
  const mode = cfg.evolution.mode;
  if (mode === 'off') {
    return { applied: false, reason: '进化模式为 off：不采纳任何建议（先在参数页开启 suggest/auto）', request_id: opts.requestId };
  }
  const audits = await storage.queryAudit({});
  let latest: { ts: number; from: RecallWeights; to: RecallWeights; ev?: RecallEvalResult } | null = null;
  for (const a of audits) {
    if (a.action !== 'growth_op') continue;
    const d = a.detail as {
      event?: unknown; family?: unknown; from?: unknown; to?: unknown; eval?: unknown;
    };
    if (d.event !== 'suggest_recall_weights' || d.family !== 'recall_weights') continue;
    if (!validRecallWeights(d.from) || !validRecallWeights(d.to)) continue;
    if (!latest || a.ts > latest.ts) {
      latest = { ts: a.ts, from: d.from, to: d.to, ev: d.eval as RecallEvalResult | undefined };
    }
  }
  if (!latest) {
    return {
      applied: false,
      reason: '没有可采纳的建议：账本里尚无 suggest_recall_weights 审计（先跑一轮进化产建议）',
      request_id: opts.requestId,
    };
  }
  const guard = guardRecallWeights(latest.from, latest.to, cfg.evolution, latestAdoptTs(audits, 'recall_weights'), opts.now);
  if (!guard.pass) {
    return { applied: false, reason: `护栏未通过，拒绝采纳：${guard.reason}`, from: latest.from, to: latest.to, request_id: opts.requestId };
  }
  const nextCfg: GrowthConfig = { ...cfg, recall_weights: latest.to };
  const { history_saved } = await saveConfigWithHistory(storage, nextCfg, {
    requestId: opts.requestId, form: opts.form, enterpriseId: opts.enterpriseId, teamId: opts.teamId, now: opts.now,
  });
  // 回诊计划只在建得了基线（建议审计带 eval.meanTo）时挂：没有基线就如实不挂（回诊会忽略无计划的采纳），
  // 绝不猜一个 baseline_mean_ndcg 凑数。
  const meanTo = latest.ev && typeof latest.ev.meanTo === 'number' && Number.isFinite(latest.ev.meanTo)
    ? latest.ev.meanTo : null;
  const rollbackPlan = meanTo !== null
    ? computeRollbackPlan(opts.now, cfg.evolution.rollback, latest.to, latest.from, meanTo)
    : undefined;
  await appendGrowthOp(storage, opts, {
    phase: 'evolution',
    reason: `用户一键采纳（suggest 模式建议 → 手动落库）${latest.ev?.reason ? `：${latest.ev.reason}` : ''}`
      + (rollbackPlan ? '' : '；建议审计无评估基线，未挂回诊计划'),
    event: 'adopted', family: 'recall_weights', applied: true, adopted_via: 'manual',
    from: latest.from, to: latest.to, eval: latest.ev, guard, history_saved,
    ...(rollbackPlan ? { rollback_plan: rollbackPlan } : {}),
  });
  return {
    applied: true, reason: '已采纳建议权重并写入 growth:v1（存历史、挂回诊计划）'
      + (rollbackPlan ? '' : '；无评估基线未挂回诊计划'),
    from: latest.from, to: latest.to, history_saved, request_id: opts.requestId,
  };
}

/* ── 7.2 分流族一键采纳（suggest 模式下用户显式说「采纳分流建议」时的落库入口） ── */

export interface DispatchAdoptResult {
  applied: boolean;
  reason: string;
  /** 被采纳的那条建议原样回传（来自审计，不是现算的） */
  dispatch?: DispatchProposal;
  /** 采纳后的分流快照（整块，已过 normalizeModeDispatch） */
  to?: ModeDispatchSnapshot;
  from?: ModeDispatchSnapshot;
  /** 改动相对谁：账本现行快照 / 内核基线（无快照时物化） */
  baseline_source?: 'ledger' | 'kernel';
  history_saved?: boolean;
  request_id: string;
}

/**
 * 手动采纳分流建议：读最近一条 `suggest_mode_dispatch` 审计 → 重过冷却期护栏 →
 * 以现行快照（无则内核基线）为基底整块重写 → 整块校验 → 存历史后写 growth:v1 → 记 adopted 审计。
 *
 * 红线与召回权重采纳同口径：
 * ① 只采纳**审计里真实存在**的建议（形状不过就拒绝，绝不现场现算一个）；
 * ② 护栏不过就拒绝，不静默放行；mode='off' 直接拒绝；
 * ③ 采纳计入冷却期（latestAdoptTs 同源），避免同批样本被连续周轮反复改。
 */
export async function adoptSuggestedModeDispatch(
  storage: StorageBackend,
  opts: LoopOptions,
): Promise<DispatchAdoptResult> {
  const cfg: GrowthConfig = growthConfigFromLedger(await storage.listMemories({}));
  if (cfg.evolution.mode === 'off') {
    return { applied: false, reason: '进化模式为 off：不采纳任何建议（先在参数页开启 suggest/auto）', request_id: opts.requestId };
  }
  const audits = await storage.queryAudit({});
  let latest: { ts: number; dispatch: DispatchProposal } | null = null;
  for (const a of audits) {
    if (a.action !== 'growth_op') continue;
    const d = a.detail as { event?: unknown; family?: unknown; dispatch?: unknown };
    if (d.event !== 'suggest_mode_dispatch' || d.family !== 'mode_dispatch') continue;
    if (!validDispatchProposal(d.dispatch)) continue;
    if (!latest || a.ts > latest.ts) latest = { ts: a.ts, dispatch: d.dispatch };
  }
  if (!latest) {
    return {
      applied: false,
      reason: '没有可采纳的分流建议：账本里尚无合法的 suggest_mode_dispatch 审计（先跑一轮进化产建议）',
      request_id: opts.requestId,
    };
  }
  const lastAdopt = latestAdoptTs(audits, 'mode_dispatch');
  const cooldownMs = cfg.evolution.guard.cooldown_days * 24 * 3600 * 1000;
  if (lastAdopt !== undefined && opts.now - lastAdopt < cooldownMs) {
    return {
      applied: false,
      reason: `护栏未通过，拒绝采纳：冷却期内（上次采纳 ${new Date(lastAdopt).toISOString().slice(0, 10)}，`
        + `冷却 ${cfg.evolution.guard.cooldown_days} 天）`,
      dispatch: latest.dispatch, request_id: opts.requestId,
    };
  }
  const baseline = dispatchBaseline(cfg.mode_dispatch ?? null);
  const nextSnap = baseline ? applyDispatchProposal(baseline.base, latest.dispatch) : null;
  if (!baseline || !nextSnap) {
    return {
      applied: false,
      reason: baseline
        ? '建议写入后整块校验失败（词表/阈值/权重和/类型），整单拒绝'
        : '内核基线快照未通过整块校验，拒绝写入（不写半份配置）',
      dispatch: latest.dispatch, request_id: opts.requestId,
    };
  }
  const { history_saved } = await saveConfigWithHistory(storage, { ...cfg, mode_dispatch: nextSnap }, {
    requestId: opts.requestId, form: opts.form,
    enterpriseId: opts.enterpriseId, teamId: opts.teamId, now: opts.now,
  });
  // 回诊基线：采纳前 30 天窗口命中率；样本不足如实不挂（与 recall_weights 同口径）
  const beforeMetrics = buildDispatchSamples(audits, {
    now: opts.now, windowDays: cfg.evolution.window.dispatch_days,
  }).metrics;
  const plan = computeDispatchRollbackPlan(opts.now, beforeMetrics, {
    afterDays: cfg.evolution.rollback.after_days,
    minTagged: cfg.evolution.min_samples.dispatch_tagged,
    maxDrop: cfg.evolution.rollback.mode_dispatch_max_drop,
    snapshot: nextSnap,
  });
  await appendGrowthOp(storage, opts, {
    phase: 'evolution',
    reason: `用户一键采纳分流建议（suggest 模式建议 → 手动落库）：${latest.dispatch.reason}`
      + (plan ? '' : '；基线样本不足，未挂回诊计划'),
    event: 'adopted', family: 'mode_dispatch', applied: true, adopted_via: 'manual',
    dispatch: latest.dispatch, from_snapshot: baseline.base, to_snapshot: nextSnap,
    baseline_source: baseline.source, history_saved,
    ...(plan ? { rollback_plan: plan } : {}),
  }, '_dp');
  return {
    applied: true,
    reason: '已采纳分流建议并写入 growth:v1.mode_dispatch（存历史，下次召回即按新词表分流）'
      + (baseline.source === 'kernel' ? '；账本原无快照，已以内核基线为基底落库' : '')
      + (plan ? '' : '；基线样本不足，未挂回诊计划'),
    dispatch: latest.dispatch, from: baseline.base, to: nextSnap,
    baseline_source: baseline.source, history_saved, request_id: opts.requestId,
  };
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

/* ── 分流族回诊（方案 MODE-DISPATCH-ROLLBACK.md，2026-11-26）── */

export type DispatchRollbackStatus = 'none' | 'not_due' | 'insufficient' | 'ok' | 'rolled_back' | 'skipped';
export interface DispatchRollbackResult {
  status: DispatchRollbackStatus;
  plan?: DispatchRollbackPlan;
  before_rate?: number;
  after_rate?: number;
  drop?: number;
  negative_growth?: number;
  needed?: number;
}

/**
 * 分流回诊：读最近一条 mode_dispatch 采纳写死的 rollback_plan，到期（或 force）后用
 * [T0, T0+after_days) 窗口的真实分流反馈算命中率，跌幅超阈值且 negatives 净增≥3 →
 * 局部回滚 mode_dispatch 块（不动 recall_weights/其它配置）。
 *
 * 三态前先校验快照：现行配置已被后续采纳替换 → rollback_skipped，绝不把用户的新配置退回旧版。
 */
export async function runDispatchRollbackCheck(
  storage: StorageBackend,
  opts: RollbackCheckOptions,
): Promise<DispatchRollbackResult> {
  const cfg = growthConfigFromLedger(await storage.listMemories({}));
  if (cfg.evolution.mode === 'off') return { status: 'none' };
  const audits = await storage.queryAudit({});
  let latest: { ts: number; plan: DispatchRollbackPlan } | null = null;
  for (const a of audits) {
    if (a.action !== 'growth_op') continue;
    const d = a.detail as { event?: unknown; family?: unknown; rollback_plan?: unknown };
    if (d.event !== 'adopted' || d.family !== 'mode_dispatch' || !d.rollback_plan) continue;
    const plan = d.rollback_plan as DispatchRollbackPlan;
    if (plan.family !== 'mode_dispatch' || typeof plan.due_at !== 'number') continue;
    if (!latest || a.ts > latest.ts) latest = { ts: a.ts, plan };
  }
  if (!latest) return { status: 'none' };
  const { plan } = latest;
  if (!opts.force && opts.now < plan.due_at) return { status: 'not_due', plan };

  // 快照比对：采纳后又被别的采纳替换 → 计划失效，跳过（绝不回滚用户更新的配置）
  const snapKey = JSON.stringify(plan.adopted_words_snapshot);
  if (JSON.stringify(cfg.mode_dispatch ?? null) !== snapKey) {
    await appendGrowthOp(storage, opts, {
      phase: 'rollback', event: 'rollback_skipped', family: 'mode_dispatch', applied: false, plan,
      reason: '分流回诊跳过：现行配置已被后续采纳替换，旧回诊计划失效（不回滚用户更新的配置）',
    }, '_dp');
    return { status: 'skipped', plan };
  }

  const before = buildDispatchSamples(audits, {
    now: plan.adopted_ts, windowDays: cfg.evolution.window.dispatch_days,
  }).metrics;
  const after = buildDispatchSamples(audits, {
    now: plan.adopted_ts + cfg.evolution.rollback.after_days * 24 * 3600 * 1000,
    windowDays: cfg.evolution.rollback.after_days,
    since: plan.adopted_ts,
  }).metrics;
  if (after.tagged < plan.min_tagged) {
    const needed = Math.max(0, plan.min_tagged - after.tagged);
    await appendGrowthOp(storage, opts, {
      phase: 'rollback', event: 'insufficient', family: 'mode_dispatch', applied: false,
      plan, needed, before_tagged: before.tagged, after_tagged: after.tagged,
      reason: `分流回诊样本不足：采纳后有效标注 ${after.tagged}/${plan.min_tagged} 条（还需 ${needed} 条）`,
    }, '_dp');
    return { status: 'insufficient', plan, needed };
  }
  const verdict = computeDispatchBackfill(before, after, plan.max_drop);
  const metrics = {
    before_rate: verdict.before_rate ?? undefined, after_rate: verdict.after_rate ?? undefined,
    drop: verdict.drop, negative_growth: verdict.negative_growth,
    before_tagged: before.tagged, after_tagged: after.tagged,
  };
  if (verdict.status !== 'rolled_back') {
    await appendGrowthOp(storage, opts, {
      phase: 'rollback', event: 'rollback_kept', family: 'mode_dispatch', applied: false,
      plan, metrics, reason: `分流回诊通过：命中率 ${round3(verdict.after_rate ?? 0)}，相对基线 ${round3(plan.baseline_rate)} 跌幅 ${round3(verdict.drop)} ≤ 允许 ${plan.max_drop}（负样本净增 ${verdict.negative_growth}）`,
    }, '_dp');
    return {
      status: 'ok', plan, before_rate: verdict.before_rate ?? undefined, after_rate: verdict.after_rate ?? undefined,
      drop: verdict.drop, negative_growth: verdict.negative_growth,
    };
  }
  const rb = await rollbackGrowthConfig(storage, {
    requestId: opts.requestId, form: opts.form,
    enterpriseId: opts.enterpriseId, teamId: opts.teamId, now: opts.now, target: 'mode_dispatch',
  });
  await appendGrowthOp(storage, opts, {
    phase: 'rollback', event: 'rolled_back', family: 'mode_dispatch', applied: rb.rolledBack,
    plan, metrics, reason: `分流回诊未通过：命中率 ${round3(verdict.after_rate ?? 0)} 相对基线 ${round3(plan.baseline_rate)} 跌幅 ${round3(verdict.drop)} > 允许 ${plan.max_drop} 且负样本净增 ${verdict.negative_growth} ≥ 3 → 局部回滚 mode_dispatch`,
  }, '_dp');
  return {
    status: 'rolled_back', plan, before_rate: verdict.before_rate ?? undefined, after_rate: verdict.after_rate ?? undefined,
    drop: verdict.drop, negative_growth: verdict.negative_growth,
  };
}

/* ── 排序反馈一键采纳（weight_step）：只认审计里真实存在的建议 ── */

export interface WeightStepAdoptResult {
  applied: boolean;
  reason: string;
  proposal?: WeightStepProposal;
  history_saved?: boolean;
  request_id: string;
}

/** 形状严格校验：权重和=1、步长受上限、维度合法，绝不凭字段存在就认 */
export function validWeightStepProposal(v: unknown): v is WeightStepProposal {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (r.family !== 'recall_weights' || r.kind !== 'weight_step') return false;
  if (!DETAIL_KEYS_LOCAL.includes(r.dimension as keyof RecallWeights)) return false;
  if (!validRecallWeights(r.from) || !validRecallWeights(r.to)) return false;
  if (typeof r.reason !== 'string' || r.reason.length === 0) return false;
  if (!Array.isArray(r.sample_request_ids) || !r.sample_request_ids.every((x) => typeof x === 'string')) return false;
  const sum = DETAIL_KEYS_LOCAL.reduce((s, k) => s + (r.to as RecallWeights)[k], 0);
  return Math.abs(sum - 1) < 0.005;
}
const DETAIL_KEYS_LOCAL: Array<keyof RecallWeights> = ['w_f', 'w_i', 'w_c', 'w_a'];

export async function adoptSuggestedWeightStep(
  storage: StorageBackend,
  opts: LoopOptions,
): Promise<WeightStepAdoptResult> {
  const cfg: GrowthConfig = growthConfigFromLedger(await storage.listMemories({}));
  if (cfg.evolution.mode === 'off') {
    return { applied: false, reason: '进化模式为 off：不采纳任何建议', request_id: opts.requestId };
  }
  const audits = await storage.queryAudit({});
  let latest: { ts: number; proposal: WeightStepProposal } | null = null;
  for (const a of audits) {
    if (a.action !== 'growth_op') continue;
    const d = a.detail as { event?: unknown; family?: unknown; weight_step?: unknown };
    if (d.event !== 'suggest_weight_step' || d.family !== 'recall_weights') continue;
    if (!validWeightStepProposal(d.weight_step)) continue;
    if (!latest || a.ts > latest.ts) latest = { ts: a.ts, proposal: d.weight_step };
  }
  if (!latest) {
    return { applied: false, reason: '没有可采纳的排序建议：账本里尚无合法的 suggest_weight_step 审计', request_id: opts.requestId };
  }
  const p = latest.proposal;
  const guard = guardRecallWeights(p.from, p.to, cfg.evolution, latestAdoptTs(audits, 'recall_weights'), opts.now);
  if (!guard.pass) return { applied: false, reason: `护栏未通过：${guard.reason}`, proposal: p, request_id: opts.requestId };
  const { history_saved } = await saveConfigWithHistory(storage, { ...cfg, recall_weights: p.to }, {
    requestId: opts.requestId, form: opts.form,
    enterpriseId: opts.enterpriseId, teamId: opts.teamId, now: opts.now,
  });
  await appendGrowthOp(storage, opts, {
    phase: 'evolution', reason: `用户一键采纳排序建议：${p.reason}`,
    event: 'adopted', family: 'recall_weights', applied: true,
    adopted_via: 'manual', kind: 'weight_step', weight_step: p, history_saved,
  }, '_ws');
  return { applied: true, reason: '已采纳排序建议（recall 打分权重微调，存历史）', proposal: p, history_saved, request_id: opts.requestId };
}
