// MCP 自进化工具编排（批次 B/C/D）：growth_evolve = status | adopt | profile | policy。
// TCP(8202) 与 HTTP(8204) 共用同一份校验与审计口径，避免两端漂移。
//
// 红线：
// ① status/profile 只读（不写任何记忆与审计）；adopt/policy 走 growth:v1 显式链路（存历史 + growth_op 审计）；
// ② adopt 只采纳审计里真实存在的建议 + 重过护栏，绝不现场现算建议替用户决定；
// ③ profile 是召回审计的只读派生物，可删（删审计即消失），只提示不改配置；
// ④ policy 仍是**全局** FeedbackPolicy（growth:v1 单实例真源）——按项目粒度需多实例配置，本轮不做，
//    如实记录（诚实边界，不假装已按项目隔离）。
import { ulid } from './ulid.ts';
import { growthConfigFromLedger, saveGrowthConfigToLedger } from './paramsSnapshot.ts';
import { adoptSuggestedModeDispatch, adoptSuggestedRecallWeights, runDispatchRollbackCheck, type DispatchRollbackResult } from './evolution/loop.ts';
import { validDispatchProposal, type DispatchProposal } from './evolution/modeDispatchRegression.ts';
import { buildSceneProfile, type SceneProfile } from './evolution/sceneProfile.ts';
import { McpToolError } from './mcpRecall.ts';
import type { AuditRecord, Form, Memory, StorageBackend } from './types.ts';
import { validFeedbackPolicy, type FeedbackPolicy, type GrowthConfig, type ModeDispatchSnapshot } from '../../shared/growthConfig.ts';

const ACTIONS = ['status', 'adopt', 'profile', 'policy', 'rollback'] as const;
type GrowthAction = (typeof ACTIONS)[number];

/** adopt 可定向的进化族；缺省 recall_weights（与历史行为逐字一致） */
const ADOPT_FAMILIES = ['recall_weights', 'mode_dispatch'] as const;
type AdoptFamily = (typeof ADOPT_FAMILIES)[number];

const DAY = 24 * 3600_000;

/** growth_op 里 recall_weights 进化条目的中文事件表（唯一真源，别处不得再写第二套） */
const EV_EVENT_ZH: Record<string, string> = {
  adopted: '已采纳',
  suggest_recall_weights: '已产建议待采纳',
  insufficient: '样本不足',
  not_adopted: '未触发调整',
  guarded: '护栏拦截',
  rolled_back: '已回滚',
  rollback_kept: '回诊通过',
};

/** 近窗 reject 降档计数（growth_op.reject_downgrade，payload JSON 里的 mem_id/from/to） */
export function countRejectDowngrades(growthAudits: AuditRecord[], since: number): number {
  let n = 0;
  for (const a of growthAudits) {
    if (a.ts < since) continue;
    const d = a.detail as { entry?: { event?: unknown } } | undefined;
    if (d?.entry?.event === 'reject_downgrade') n += 1;
  }
  return n;
}

/**
 * 批次 B：卡片 summary 的「进化」行（富媒体宿主专用，纯函数）。
 * 数字与状态全部来自 growth:v1 配置与 growth_op 真实审计：取不到如实写「暂无」，绝不编造。
 */
export function growthCardSummary(
  mems: Memory[],
  growthAudits: AuditRecord[],
  now: number,
): { label: string; value: string } {
  const cfg: GrowthConfig = growthConfigFromLedger(mems);
  const latest = latestEvolutionEntry(growthAudits);
  const evalZh = latest ? (EV_EVENT_ZH[latest.event] ?? latest.event) : '暂无评估记录';
  const downgrades = countRejectDowngrades(growthAudits, now - 7 * DAY);
  const value = `模式 ${cfg.evolution.mode} ｜ 上轮评估：${evalZh}`
    + (downgrades > 0 ? ` ｜ 近 7 天反馈降档 ${downgrades} 条` : '');
  return { label: '进化', value };
}

/** 最近一条 recall_weights 进化族 growth_op（phase=evolution），无则 null */
function latestEvolutionEntry(growthAudits: AuditRecord[]): { event: string; status?: unknown; reason?: unknown; ts: number } | null {
  let latest: { event: string; status?: unknown; reason?: unknown; ts: number } | null = null;
  for (const a of growthAudits) {
    const d = a.detail as { phase?: unknown; family?: unknown; event?: unknown; status?: unknown; reason?: unknown } | undefined;
    if (d?.phase !== 'evolution' || d.family !== 'recall_weights') continue;
    const event = typeof d.event === 'string' ? d.event : 'unknown';
    if (!latest || a.ts > latest.ts) latest = { event, status: d.status, reason: d.reason, ts: a.ts };
  }
  return latest;
}

export interface GrowthEvolveResult {
  action: GrowthAction;
  request_id: string;
  // status
  mode?: string;
  weights?: Record<string, number>;
  latest_eval?: { event: string; status?: unknown; reason?: unknown; ts: number } | null;
  suggestion?: { from: Record<string, number>; to: Record<string, number>; ts: number; reason?: unknown } | null;
  /** status：最近一条分流建议（来自审计，不现算）+ 采纳时的基底来源 */
  dispatch_suggestion?: { dispatch: DispatchProposal; ts: number } | null;
  dispatch_baseline?: 'ledger' | 'kernel';
  // adopt
  family?: AdoptFamily;
  applied?: boolean;
  reason?: string;
  from?: Record<string, number>;
  to?: Record<string, number>;
  history_saved?: boolean;
  /** adopt(family=mode_dispatch)：被采纳的建议 + 采纳后的整块快照 */
  dispatch?: DispatchProposal;
  to_snapshot?: ModeDispatchSnapshot;
  baseline_source?: 'ledger' | 'kernel';
  // profile
  profile?: SceneProfile;
  // policy
  feedback_policy?: FeedbackPolicy;
  // rollback
  force?: boolean;
  rollback?: DispatchRollbackResult;
}

/** 用户反馈策略启用/停用（批次 C3；全局真源，与参数页同一份 growth:v1） */
export async function runGrowthEvolveTool(
  storage: StorageBackend,
  args: Record<string, unknown>,
  opts: { form: Form; now?: number },
): Promise<GrowthEvolveResult> {
  const action = args.action;
  if (typeof action !== 'string' || !ACTIONS.includes(action as GrowthAction)) {
    throw new McpToolError(`growth_evolve.action 非法：${String(action)}（允许：${ACTIONS.join('/')}）`);
  }
  const act = action as GrowthAction;
  const requestId = `req_${ulid()}`;
  const now = opts.now ?? Date.now();
  const loopOpts = { requestId, form: opts.form, now } as const;

  if (act === 'status') {
    const cfg = growthConfigFromLedger(await storage.listMemories({}));
    const growthAudits = await storage.queryAudit({ action: 'growth_op' });
    const latest = latestEvolutionEntry(growthAudits);
    let suggestion: GrowthEvolveResult['suggestion'] = null;
    let dispatchSuggestion: GrowthEvolveResult['dispatch_suggestion'] = null;
    for (const a of growthAudits) {
      const d = a.detail as { event?: unknown; family?: unknown; from?: unknown; to?: unknown; reason?: unknown; dispatch?: unknown } | undefined;
      if (d?.family === 'recall_weights' && d.event === 'suggest_recall_weights') {
        if (d.from && d.to && typeof d.from === 'object' && typeof d.to === 'object') {
          suggestion = { from: d.from as Record<string, number>, to: d.to as Record<string, number>, ts: a.ts, reason: d.reason };
        }
        continue;
      }
      // 分流族：只回放审计里真实存在的建议；形状不过就当没有（不猜、不现算）
      if (d?.family === 'mode_dispatch' && d.event === 'suggest_mode_dispatch' && validDispatchProposal(d.dispatch)) {
        if (!dispatchSuggestion || a.ts > dispatchSuggestion.ts) {
          dispatchSuggestion = { dispatch: d.dispatch, ts: a.ts };
        }
      }
    }
    return {
      action: act, request_id: requestId, mode: cfg.evolution.mode,
      weights: { ...cfg.recall_weights }, latest_eval: latest, suggestion,
      dispatch_suggestion: dispatchSuggestion,
      dispatch_baseline: cfg.mode_dispatch ? 'ledger' : 'kernel',
    };
  }

  if (act === 'adopt') {
    const rawFamily = args.family;
    const family = rawFamily === undefined ? 'recall_weights' : rawFamily;
    if (typeof family !== 'string' || !ADOPT_FAMILIES.includes(family as AdoptFamily)) {
      throw new McpToolError(
        `growth_evolve.family 非法：${String(rawFamily)}（允许：${ADOPT_FAMILIES.join('/')}；省略即 recall_weights）`,
      );
    }
    const fam = family as AdoptFamily;
    if (fam === 'mode_dispatch') {
      const r = await adoptSuggestedModeDispatch(storage, loopOpts);
      return {
        action: act, request_id: requestId, family: fam, applied: r.applied, reason: r.reason,
        ...(r.dispatch ? { dispatch: r.dispatch } : {}),
        ...(r.to ? { to_snapshot: r.to } : {}),
        ...(r.baseline_source ? { baseline_source: r.baseline_source } : {}),
        ...(r.history_saved !== undefined ? { history_saved: r.history_saved } : {}),
      };
    }
    const r = await adoptSuggestedRecallWeights(storage, loopOpts);
    return {
      action: act, request_id: requestId, family: fam, applied: r.applied, reason: r.reason,
      ...(r.from ? { from: r.from as Record<string, number> } : {}),
      ...(r.to ? { to: r.to as Record<string, number> } : {}),
      ...(r.history_saved !== undefined ? { history_saved: r.history_saved } : {}),
    };
  }

  if (act === 'rollback') {
    // 只支持 mode_dispatch 族（其它族回诊走既有 runRollbackCheck / runDedupRollbackCheck）
    if (args.family !== 'mode_dispatch') {
      throw new McpToolError('growth_evolve(action=rollback) 目前仅支持 family=mode_dispatch；recall_weights/dedup 回诊仍由进化轮自动执行');
    }
    if (args.force !== undefined && typeof args.force !== 'boolean') {
      throw new McpToolError('growth_evolve.force 须为布尔值（action=rollback 时）');
    }
    const result = await runDispatchRollbackCheck(storage, { ...loopOpts, force: args.force === true });
    return { action: act, request_id: requestId, family: 'mode_dispatch', force: args.force === true, rollback: result };
  }

  if (act === 'profile') {
    const rawDays = args.window_days;
    let windowDays = 30;
    if (rawDays !== undefined) {
      if (typeof rawDays !== 'number' || !Number.isInteger(rawDays) || rawDays < 1 || rawDays > 365) {
        throw new McpToolError('growth_evolve.window_days 须为 1–365 的整数（天）');
      }
      windowDays = rawDays;
    }
    const recallAudits = await storage.queryAudit({ action: 'recall' });
    return { action: act, request_id: requestId, profile: buildSceneProfile(recallAudits, now, windowDays) };
  }

  // action === 'policy'：批次 C3 反馈降档策略开关（全局真源，与参数页同源）
  const enabled = args.enabled;
  if (typeof enabled !== 'boolean') {
    throw new McpToolError('growth_evolve.enabled 必填且须为布尔值（action=policy 时）');
  }
  const cfg = growthConfigFromLedger(await storage.listMemories({}));
  const cur = cfg.feedback_policy;
  const next: FeedbackPolicy = {
    enabled,
    window_days: args.window_days !== undefined ? (args.window_days as number) : cur.window_days,
    reject_downgrade_threshold:
      args.reject_downgrade_threshold !== undefined ? (args.reject_downgrade_threshold as number) : cur.reject_downgrade_threshold,
  };
  if (!validFeedbackPolicy(next)) {
    throw new McpToolError('growth_evolve 反馈策略非法：window_days 须 1–365 整数、reject_downgrade_threshold 须 1–50 整数（整单拒绝，不静默钳制）');
  }
  if (typeof next.window_days !== 'number' || typeof next.reject_downgrade_threshold !== 'number') {
    throw new McpToolError('growth_evolve.window_days / reject_downgrade_threshold 须为数字');
  }
  const saved = await saveGrowthConfigToLedger(storage, { ...cfg, feedback_policy: next }, {
    requestId, form: opts.form,
  });
  await storage.appendAudit({
    request_id: requestId, action: 'growth_op', ts: now, project_id: 'P_SYSTEM', user_id: 'system',
    detail: {
      phase: 'evolution', event: 'policy_saved', family: 'feedback_policy', applied: true,
      reason: enabled
        ? `用户显式启用反馈降档（窗口 ${next.window_days} 天 / 阈值 ${next.reject_downgrade_threshold} 次）`
        : '用户显式停用反馈降档（reject 只改 confidence，行为与改造前一致）',
      from: cur, to: next, saved_mem_id: saved.mem_id,
    },
  });
  return {
    action: act, request_id: requestId, applied: true,
    reason: next.enabled
      ? `反馈降档已启用（窗口 ${next.window_days} 天 / 阈值 ${next.reject_downgrade_threshold} 次；只降不升、不推 dormant）`
      : '反馈降档已停用（reject 只改 confidence，行为与改造前一致）',
    feedback_policy: next,
  };
}
