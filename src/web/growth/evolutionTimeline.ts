// M4（收尾）：进化时间线 + 参数漂移仪表 的纯数据层。
// 数据真相 = growth_op 审计（M3 写入的是扁平 detail.event；旧式 detail.entry 包装的走既有 growthAudit，不在此重复）。
// 红线：逐条对应真实审计（带 requestId），空账本返回 []（页面显「暂无进化记录」，不显示 0）。
// 本文件是**纯投影**：只搬运审计里真有的字段，不推算、不补零、不给缺失项编默认值。
import type { AuditRecord } from '../../core/memagent/types.ts';
import type { DimKey, DimWeights, LayerThresholds, RecallWeights } from '../../shared/growthConfig.ts';

export type TimelineDecision =
  | 'adopted' | 'suggested' | 'rejected' | 'insufficient' | 'guarded' | 'rolled_back'
  /** M5-1：回诊通过、保留当前权重（不写配置） */
  | 'kept';

export interface EvolutionTimelineEntry {
  /** 与该条 growth_op 审计逐字对应的 request_id（M4-1 可回查） */
  requestId: string;
  ts: number;
  family: string;
  decision: TimelineDecision;
  /** 审计里真实写了原因才有值；没有 → ''（页面显「—」，不编原因） */
  reason: string;
  /** M5-1：审计里的阶段（evolution=进化轮 / rollback=回诊）；旧记录无此字段 */
  phase?: 'evolution' | 'rollback';
  applied?: boolean;
  from?: RecallWeights;
  to?: RecallWeights;
  /** 以下均来自 detail.eval（离线评估结果），缺失则 undefined */
  gain?: number;
  p?: number;
  meanFrom?: number;
  meanTo?: number;
  samples?: number;
  /** detail.rollback_plan.due_at：采纳时写死的回诊到期时间 */
  rollbackDueAt?: number;
  historySaved?: boolean;
  /** 回诊重算结果（仅 rolled_back 记录带）：当前均 NDCG 与相对基线的跌幅 */
  currentMeanNdcg?: number;
  drop?: number;
}

const DECISION_OF: Record<string, TimelineDecision> = {
  adopted: 'adopted',
  suggest_recall_weights: 'suggested',
  guarded: 'guarded',
  rolled_back: 'rolled_back',
  rollback_kept: 'kept',
  not_adopted: 'rejected',
  insufficient: 'insufficient',
};

/**
 * suggest_recall_weights 的审计 detail 里 `status` 才是真裁决。
 * 注意 'rejected' 不是事件名（事件名是 not_adopted），所以必须单独一张表，
 * 否则「评估判拒绝」会被兜成「已建议」——这是会误导用户的错标。
 */
const STATUS_DECISION: Record<string, TimelineDecision> = {
  suggested: 'suggested',
  insufficient: 'insufficient',
  rejected: 'rejected',
};

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * 结构检查（四键都是数即可）。
 * 这里**故意不用** shared 的 validRecallWeights（它要求四维和 = 1）：
 * 时间线是只读展示，历史/边界数据不该因为不满足当前校验口径就整条消失。
 */
function isRecallWeights(v: unknown): v is RecallWeights {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return ['w_f', 'w_i', 'w_c', 'w_a'].every((k) => typeof r[k] === 'number');
}

/**
 * growth_op 审计 → 时间线（最新在前）。
 * 只认 M3 的扁平 `detail.event`；带 `detail.entry` 的旧式记录交回既有 growthAudit 展示，避免双份。
 */
export function evolutionTimelineFromLedger(audits: AuditRecord[]): EvolutionTimelineEntry[] {
  const out: EvolutionTimelineEntry[] = [];
  for (const a of audits) {
    if (a.action !== 'growth_op') continue;
    const d = a.detail as Record<string, unknown>;
    const ev = d.event;
    if (typeof ev !== 'string' || !(ev in DECISION_OF)) continue;
    if (d.entry) continue; // 旧式包装：走既有 growthAudit

    // suggest_recall_weights 的审计里 status 才是真裁决（suggested / insufficient / rejected），
    // 只有 status 缺失时才退回事件名本身的含义 —— 否则会把「评估判不足」误标成「已建议」。
    const statusOf = typeof d.status === 'string' ? STATUS_DECISION[d.status] : undefined;
    const decision = (ev === 'suggest_recall_weights' ? (statusOf ?? DECISION_OF[ev]) : DECISION_OF[ev]);

    // 原因优先级：审计直接写的 > 评估结论 > 护栏结论。
    // （adopted 记录同时带 eval 与 guard，guard.reason 恒为「护栏通过」，压在评估原因前面会丢掉真正的理由。）
    const guardReason = (d.guard as { reason?: unknown } | undefined)?.reason;
    const evalReason = (d.eval as { reason?: unknown } | undefined)?.reason;
    const reason = [d.reason, evalReason, guardReason]
      .find((x): x is string => typeof x === 'string' && x.length > 0) ?? '';

    const entry: EvolutionTimelineEntry = {
      requestId: a.request_id,
      ts: a.ts,
      family: typeof d.family === 'string' ? d.family : 'recall_weights',
      decision,
      reason,
    };
    if (typeof d.applied === 'boolean') entry.applied = d.applied;
    if (d.phase === 'evolution' || d.phase === 'rollback') entry.phase = d.phase;
    if (isRecallWeights(d.from)) entry.from = d.from;
    if (isRecallWeights(d.to)) entry.to = d.to;

    const ev2 = d.eval as Record<string, unknown> | undefined;
    if (ev2) {
      for (const [k, v] of [
        ['gain', num(ev2.gain)], ['p', num(ev2.p)],
        ['meanFrom', num(ev2.meanFrom)], ['meanTo', num(ev2.meanTo)], ['samples', num(ev2.samples)],
      ] as const) {
        if (v !== undefined) entry[k] = v;
      }
    }
    // 计划在两种事件上：采纳时写 `rollback_plan`，回诊时原样带 `plan`（同一份对象）
    const plan = (d.rollback_plan ?? d.plan) as { due_at?: unknown } | undefined;
    if (plan && typeof plan.due_at === 'number') entry.rollbackDueAt = plan.due_at;
    if (typeof d.history_saved === 'boolean') entry.historySaved = d.history_saved;
    const cur = num(d.current_mean_ndcg);
    if (cur !== undefined) entry.currentMeanNdcg = cur;
    const drop = num(d.drop);
    if (drop !== undefined) entry.drop = drop;
    out.push(entry);
  }
  return out.sort((x, y) => y.ts - x.ts);
}

// ── 回诊三态（M5-3）────────────────────────────────────────────────

export type RollbackState = 'none' | 'pending' | 'overdue' | 'done';

export interface RollbackStateView {
  state: RollbackState;
  dueAt?: number;
  /** pending 时有意义：距到期还有多少天（向上取整，0 表示今天） */
  daysLeft?: number;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * 某条记录的「回诊点」处于什么状态。
 * - 无 `due_at` → `none`（该记录本就不带计划，不显示 0 天）
 * - 同一族、本记录之后已出现 `phase='rollback'` 的 `rolled_back`/`kept` → `done`（回诊有结论）
 * - 未到 `due_at` → `pending`（带剩余天数）
 * - 已过 `due_at` 且尚无结论 → `overdue`（到期未回诊，如实暴露，不假装完成）
 */
export function rollbackStateOf(
  entry: EvolutionTimelineEntry,
  all: EvolutionTimelineEntry[],
  now: number,
): RollbackStateView {
  const dueAt = entry.rollbackDueAt;
  if (dueAt === undefined) return { state: 'none' };
  const pendingOrOverdue = (): RollbackStateView => (now < dueAt
    ? { state: 'pending', dueAt, daysLeft: Math.max(0, Math.ceil((dueAt - now) / DAY_MS)) }
    : { state: 'overdue', dueAt });

  // 回诊阶段的记录本身：有结论 → done；跑了但样本不足 → 计划仍未完成（按时间如实判定）
  if (entry.phase === 'rollback') {
    return entry.decision === 'rolled_back' || entry.decision === 'kept'
      ? { state: 'done', dueAt }
      : pendingOrOverdue();
  }

  const concluded = all.some((e) => e.family === entry.family
    && e.phase === 'rollback'
    && e.ts >= entry.ts
    && (e.decision === 'rolled_back' || e.decision === 'kept'));
  if (concluded) return { state: 'done', dueAt };
  return pendingOrOverdue();
}

// ── 漂移仪表 ────────────────────────────────────────────────────────

export interface DriftRow {
  key: string;
  label: string;
  current: number;
  baseline: number;
  /** 当前 − 基准（正=上调，负=下调）；M4-3：必须等于真实差，不做归一化或四舍五入掩盖 */
  drift: number;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** 参数族当前值 vs 基准值 → 逐维漂移（缺键按基准值，不把「未配置」当 0）。 */
export function driftRows(
  current: Record<string, number | undefined>,
  baseline: Record<string, number>,
  labels: Record<string, string>,
): DriftRow[] {
  return Object.keys(baseline).map((k) => {
    const b = baseline[k];
    const c = typeof current[k] === 'number' && Number.isFinite(current[k]) ? (current[k] as number) : b;
    return { key: k, label: labels[k] ?? k, current: round3(c), baseline: round3(b), drift: round3(c - b) };
  });
}

export const RECALL_LABELS: Record<keyof RecallWeights, string> = {
  w_f: '新鲜度 w_f', w_i: '重要度 w_i', w_c: '置信度 w_c', w_a: '强化数 w_a',
};

export const DEDUP_LABELS: Record<DimKey, string> = {
  semantic: '语义', keyword: '关键词', entity: '实体', structure: '结构', llm_judge: 'LLM 仲裁',
};

export const THRESHOLD_LABELS: Record<keyof LayerThresholds, string> = {
  L1: 'L1', L2: 'L2', L3: 'L3', L4: 'L4', L5: 'L5', L6: 'L6',
};

/** 召回权重漂移（基准 = DEFAULT_RECALL_WEIGHTS） */
export function recallDrift(current: RecallWeights, baseline: RecallWeights): DriftRow[] {
  return driftRows(
    current as unknown as Record<string, number>,
    baseline as unknown as Record<string, number>,
    RECALL_LABELS,
  );
}

/** 判重五维权重漂移（基准 = DEFAULT_WEIGHTS） */
export function dedupDrift(current: DimWeights, baseline: DimWeights): DriftRow[] {
  return driftRows(
    current as unknown as Record<string, number>,
    baseline as unknown as Record<string, number>,
    DEDUP_LABELS,
  );
}

/** 阈值漂移（基准 = DEFAULT_THRESHOLDS），用于「六层阈值」族。 */
export function thresholdDrift(current: LayerThresholds, baseline: LayerThresholds): DriftRow[] {
  return driftRows(
    current as unknown as Record<string, number>,
    baseline as unknown as Record<string, number>,
    THRESHOLD_LABELS,
  );
}
