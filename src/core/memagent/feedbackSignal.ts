// 批次61 GAP-2：反馈信号回灌净化因果链。
//
// 断点（2026-11-12 审查 §3.1 实证）：
//  · `coreFeedback` 只改 confidence（reject −0.05），从默认 0.5 到 hardFilter 的 0.05 需连续 9 次
//    reject —— 实际近乎不触发，反馈等于没有下游动作；
//  · `disputed` 只挂单条 `conflict_id`，而 `conflict.ts` 路径 1 要求**恰好两条**共享同一 id
//    → 永远造不出可裁决的冲突对；
//  · `runForgettingCycle` 只读 `listMemories`，从不读 recall / memory_op 审计。
//
// 本模块只提供纯函数与只读聚合，**不自己写任何记忆**：写动作仍留在 `memories.ts:coreFeedback`
// 与 `forgetting.ts:runForgettingCycle`，便于归因与逐条审计。
//
// 红线：
// ① 阈值缺省为「不启用」（`FeedbackPolicy.enabled=false`）——默认行为必须与改造前逐字一致；
// ② 降档只降不升，且不把 cold 推进 dormant（dormant 没有自动回温路径，误推即等于丢失召回）；
// ③ 冲突配对只认真实账本与真实向量，找不到对手就如实不配，不伪造；
// ④ 审计读不到时如实返回错误，不拿 0 冒充「没有反馈」。
import { DEFAULT_VECTOR_DIM, cosine, embedSync } from './vector.ts';
import { growthConfigFromLedger } from './paramsSnapshot.ts';
import type { AuditRecord, DecayClass, FeedbackKind, Memory, StorageBackend } from './types.ts';
import { DEFAULT_FEEDBACK_POLICY, type FeedbackPolicy } from '../../shared/growthConfig.ts';

const DAY = 24 * 3600_000;

/** 与 conflict.ts 完全同口径：archived / dormant / deleted 不参与配对，否则配上也会被队列丢弃 */
export function isLiveForConflict(m: Memory): boolean {
  return !m.deleted && m.decay_class !== 'archived' && m.decay_class !== 'dormant';
}

/**
 * 配对相似度下限。取 0.75 与 `forgetting.ts:MERGE_SIM_THRESHOLD` 同值：
 * 两处都在判「是不是同主题的另一种说法」，口径不一致会让「既能合并又不能配对」变得无法解释。
 */
export const CONFLICT_PAIR_MIN_SIM = 0.75;

/** 降档表：hot→warm→cold，cold 到底为止 */
const DOWNGRADE: Partial<Record<DecayClass, DecayClass>> = { hot: 'warm', warm: 'cold' };

/** 下一档；已是 cold/archived/dormant → null（不推 dormant：没有自动回温路径） */
export function downgradeClass(c: DecayClass): DecayClass | null {
  return DOWNGRADE[c] ?? null;
}

/** 行上向量优先；历史行缺向量时按正文现算（纯函数、不落盘，与 clusterSimilar 同源） */
function vectorOf(m: Memory): number[] {
  if (m.embedding && m.embedding.length > 0) return m.embedding;
  return embedSync(m.content_l1 ?? m.content ?? '', DEFAULT_VECTOR_DIM);
}

/** 从 growth:v1 账本读反馈策略（缺省 → 关闭；旧账本读出来与改造前等价） */
export function feedbackPolicyFromLedger(mems: Memory[]): FeedbackPolicy {
  return growthConfigFromLedger(mems).feedback_policy;
}

export interface RejectTally {
  policy: FeedbackPolicy;
  /** 窗口内累计 reject 次数（含本次） */
  rejects: number;
  /** 是否达到降档阈值 */
  reached: boolean;
}

/** 统计某条记忆在窗口内的 reject 次数（只认 memory_op 审计里的 op/mem_id，不猜正文） */
export function countRejects(audits: AuditRecord[], memId: string, since: number): number {
  let n = 0;
  for (const a of audits) {
    if (a.action !== 'memory_op' || a.ts < since) continue;
    const d = a.detail as { op?: unknown; mem_id?: unknown } | undefined;
    if (d?.op === 'reject' && d.mem_id === memId) n += 1;
  }
  return n;
}

/**
 * 本次 reject 之后的降档判定。
 * `prior` 只数**之前**落账的 reject，本次由调用方 +1——否则审计尚未写入，永远差一次够不到阈值。
 */
export function tallyRejects(
  audits: AuditRecord[], memId: string, now: number, policy: FeedbackPolicy,
): RejectTally {
  const since = now - policy.window_days * DAY;
  const rejects = countRejects(audits, memId, since) + 1;
  return { policy, rejects, reached: policy.enabled && rejects >= policy.reject_downgrade_threshold };
}

export interface ConflictCounterpart {
  mem_id: string;
  sim: number;
  /** true = 该对手本来就在同一 conflict_id 里（幂等，不重复写） */
  existing: boolean;
}

export interface ConflictPairing {
  conflict_id: string;
  counterpart: ConflictCounterpart | null;
  /** 未配上时的诚实原因，便于页面显示「为什么这条没有对手」 */
  reason?: string;
}

/**
 * 为 `disputed` 的记忆找配对对手，使 `conflict.ts` 路径 1（恰好两条共享 conflict_id）真能命中。
 * 规则：
 *  · 同项目、live、非自身；跨项目绝不配（裁决会串档）；
 *  · 已经有**另一个** conflict_id 的行不碰（塞进去会变成三条 → 队列按歧义丢弃，等于白配）；
 *  · 相似度 ≥ CONFLICT_PAIR_MIN_SIM 才配；找不到就如实返回 null 与原因，不伪造。
 */
export function findConflictCounterpart(
  target: Memory,
  mems: Memory[],
  cid: string,
  minSim = CONFLICT_PAIR_MIN_SIM,
): { counterpart: ConflictCounterpart | null; reason?: string } {
  const mate = mems.find(
    (m) => m.mem_id !== target.mem_id && m.conflict_id === cid && isLiveForConflict(m),
  );
  if (mate) return { counterpart: { mem_id: mate.mem_id, sim: 1, existing: true } };

  const tv = vectorOf(target);
  let best: { m: Memory; sim: number } | null = null;
  for (const m of mems) {
    if (m.mem_id === target.mem_id) continue;
    if (!isLiveForConflict(m)) continue;
    if (m.project_id !== target.project_id) continue;
    if (m.conflict_id) continue;                       // 已在别的冲突对里，不制造三方歧义
    const sim = cosine(tv, vectorOf(m));
    if (sim < minSim) continue;
    if (!best || sim > best.sim) best = { m, sim };
  }
  if (!best) {
    return { counterpart: null, reason: `无相似度 ≥ ${minSim} 的同项目候选，保留单条待人工裁决` };
  }
  return { counterpart: { mem_id: best.m.mem_id, sim: Math.round(best.sim * 1000) / 1000, existing: false } };
}

// ─── 只读聚合（供 runForgettingCycle / 页面共用） ────────────────────────────────

export interface FeedbackSignalSummary {
  window_days: number;
  recalls: number;
  evidence_thin: number;
  verdicts: Record<FeedbackKind, number>;
  reject_ratio: number;
  /** 窗口内被 reject 过的不同记忆条数（去重，不是 reject 次数） */
  rejected_mem_ids: number;
}

export type FeedbackSignalRead =
  | { ok: true; summary: FeedbackSignalSummary }
  | { ok: false; error: string };

/** 纯函数：审计 → 窗口内反馈画像（不估算、不补零；没有样本时各计数如实为 0） */
export function summarizeFeedbackSignals(
  audits: AuditRecord[],
  now: number,
  windowDays = DEFAULT_FEEDBACK_POLICY.window_days,
): FeedbackSignalSummary {
  const since = now - windowDays * DAY;
  const verdicts: Record<FeedbackKind, number> = { confirm: 0, reject: 0, disputed: 0 };
  const rejected = new Set<string>();
  let recalls = 0;
  let thin = 0;
  for (const a of audits) {
    if (a.ts < since) continue;
    if (a.action === 'recall') {
      recalls += 1;
      if ((a.detail as { evidence_thin?: unknown } | undefined)?.evidence_thin === true) thin += 1;
      continue;
    }
    if (a.action !== 'memory_op') continue;
    const d = a.detail as { op?: unknown; mem_id?: unknown } | undefined;
    const op = d?.op;
    if (op !== 'confirm' && op !== 'reject' && op !== 'disputed') continue;
    verdicts[op as FeedbackKind] += 1;
    if (op === 'reject' && typeof d?.mem_id === 'string') rejected.add(d.mem_id);
  }
  const total = verdicts.confirm + verdicts.reject + verdicts.disputed;
  return {
    window_days: windowDays,
    recalls,
    evidence_thin: thin,
    verdicts,
    reject_ratio: total ? Math.round((verdicts.reject / total) * 1000) / 1000 : 0,
    rejected_mem_ids: rejected.size,
  };
}

/**
 * 读审计失败**不得阻断净化**（AC B4）：调用方拿到 ok:false 只记告警字段，继续跑衰减。
 * 返回 0 会是「没有反馈」的假象，故这里必须区分「空」和「读不到」。
 */
export async function readFeedbackSignals(
  storage: StorageBackend,
  now: number,
  windowDays = DEFAULT_FEEDBACK_POLICY.window_days,
): Promise<FeedbackSignalRead> {
  try {
    const audits = await storage.queryAudit({});
    return { ok: true, summary: summarizeFeedbackSignals(audits, now, windowDays) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
