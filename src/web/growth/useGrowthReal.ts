// 自我净化与生长页（REQ-009 / P14）· 真实数据接真层
// 设计约定（与记忆库管理页一致）：数据真相 = 内核账本（桌面 Electron 下 = 主进程
// FileStorage 持久库；浏览器降级 = 内存态，未写入过即空账本 → 诚实空态，绝不伪造数据）。
// 本页所有展示数字均由 loadRealGrowth() 从真实账本计算：
//   · 指标卡（7.1）= 真实召回审计（recall/cold_recall/recall_breach）+ 真实记忆表
//   · 判重样本 = 真实记忆内容（最近写入的 N 条）；五维只填有可信测量的维度，缺的记 null
//   · 24h 统计 = 真实 merge / filtered 审计条数
//   · Δ 曲线 = 真实 weight_tuned / growth_op 审计事件（无记录则空态）
//   · 调度 = 真实配置（非演示数据）
import type { Memory, AuditRecord } from '../../core/memagent/types.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { getKernelStorage } from '../kernel.ts';
import type {
  DedupSample, DeltaPoint, DimKey, DimWeights, GrowthMetrics, LayerThresholds,
  ScheduleItem, GrowthAuditEntry, ScheduleRunInfo, RegressionOutcome, RegressionRecord,
  RecallSuggestionView, FeedbackSignalView,
} from './types.ts';
import { DEFAULT_SCHEDULE, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from './spec.ts';
import { SCHEDULE_KEYS, validRecallWeights, type ScheduleKey } from '../../shared/growthConfig.ts';
import { summarizeAgentUsage, type AgentUsageSummary } from '../../core/memagent/agentUsage.ts';

export type RealStorage = Pick<StorageBackend, 'listMemories' | 'queryAudit'>;

const DAY = 24 * 3600 * 1000;

function getRealStorage(): RealStorage {
  // 全站同一份账本（桌面 = 主进程持久库；浏览器 = 进程内单例）。
  return getKernelStorage();
}

/** 真实记忆表 → 判重样本（取最近 N 条有内容者）。维度只填账本里真有的量，缺的记 null */
export function samplesFromMemories(mems: Memory[], n = 4): DedupSample[] {
  const withContent = mems
    .filter((m) => m.content && m.content.trim().length > 0)
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .slice(0, n);
  return withContent.map((m) => ({
    id: m.mem_id,
    label: `${truncate(m.content, 40)}（${m.category} · ${m.layer}）`,
    dims: dimsFromMemory(m),
    target: m.layer as DedupSample['target'],
  }));
}

/**
 * 批次42 阶段4（B4）：删掉旧实现的「兜底填数」。
 * 内核 `dedup.ts` 的 baseDimensionScores(a,b,dim) 是**两段文本的对比评分**，不适用于
 * 「单条记忆自己的五维分」这种展示语义（自己跟自己比会恒为 1.0），因此这里不冒充内核评分：
 * · semantic = 账本行上写时真实查重相似度 m.sim；无记录 → null（旧实现会硬填分值）
 * · keyword / entity = 由**真实内容**词面实算的本地启发式（明确非内核五维评分）
 * · structure = 无可信单条测量（旧实现按层号自造）→ null
 * · llm_judge = 内核未接 LLM 仲裁（findDuplicate 判 judge:'unavailable'）→ null，不是 0 分
 * 综合分由 weightedScore 按已测维度权重归一化，与内核 fourDimScore 的无 LLM 口径一致。
 */
function dimsFromMemory(m: Memory): Record<DimKey, number | null> {
  const kw = keywordsOf(m.content);
  const keyword = Math.min(1, kw.length / 8);
  const entities = (m.content.match(/\b[A-Z][A-Za-z0-9]+\b|\d+\b/g) ?? []).length;
  const entity = Math.min(1, entities / 4);
  return {
    semantic: m.sim ?? null,
    keyword,
    entity,
    structure: null,
    llm_judge: null,
  };
}

function keywordsOf(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
    .slice(0, 12);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 7.1 反馈指标：全部从真实账本实算（无记录则 null，UI 显示「—」，不伪造） */
export function metricsFromLedger(mems: Memory[], audits: AuditRecord[]): GrowthMetrics {
  // 命中率 = 真实 recall/cold_recall 审计中「本次有命中」的占比。
  // 批次47：此前用不存在的 action='recall_breach' 做分母（内核从不写该动作），等价于「只要有召回就算 100%」。
  const recalls = audits.filter((a) => a.action === 'recall' || a.action === 'cold_recall');
  const hitsOf = (a: AuditRecord): number => {
    const v = (a.detail as { hits?: unknown } | undefined)?.hits;
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  const recallHits = recalls.filter((a) => hitsOf(a) > 0).length;

  // 确认/拒绝：真实反馈审计（memory_op confirm/reject）；无记录则 0（诚实：尚无用户反馈）
  const confirmed = audits.filter((a) => a.action === 'memory_op' && (a.detail as { op?: string })?.op === 'confirm').length;
  const rejected = audits.filter((a) => a.action === 'memory_op' && (a.detail as { op?: string })?.op === 'reject').length;

  // 低质占比 = 真实衰减分层中 cold/dormant/archived 比例（记忆表实算）
  const lowQ = mems.filter((m) => ['cold', 'dormant', 'archived'].includes(m.decay_class)).length;
  const low_quality_ratio = mems.length ? lowQ / mems.length : 0;

  // L6 层占比 = 真实 L6 层记忆比例（记忆表实算）
  const l6 = mems.filter((m) => m.layer === 'L6').length;
  const level_stats_L6 = mems.length ? l6 / mems.length : 0;

  // 阶段5-F：4-I 起内核 recall 审计真写 detail.latency_ms（墙钟耗时）。
  // 只取有限非负数的真实样本；历史缺字段的行不计入分母（与 4-I 同口径，不拿 0 冒充）。
  const latencySamples = audits
    .filter((a) => a.action === 'recall')
    .map((a) => (a.detail as { latency_ms?: unknown } | undefined)?.latency_ms)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);

  return {
    hit_rate: recalls.length > 0 ? recallHits / recalls.length : 0,
    confirmed,
    rejected,
    low_quality_ratio,
    level_stats_L6,
    latency_ms: latencySamples.length > 0
      ? latencySamples.reduce((s, v) => s + v, 0) / latencySamples.length
      : 0,
    latency_samples: latencySamples.length,
  };
}

/** 24h 短路嫁接统计：只认真实 graft 审计与真实的查重/质量门拦截动作 */
export function dedupStatsFromLedger(audits: AuditRecord[]): {
  short_circuit_hits: number; merged: number; avg_cost_ms: number; avg_cost_samples: number;
} {
  const cutoff = Date.now() - DAY;
  // 嫁接数 = 内核真实 graft 审计（memories.ts 在 graft 成功后写 action='graft'）。
  // 批次47：此前统计 action='merge' —— 该动作只由冲突裁决 conflict.ts 写入，
  // 属于「冲突合并」而非「查重嫁接」，会把两个语义不同的数字混在一个卡面。
  const merged = audits.filter((a) => a.action === 'graft' && a.ts >= cutoff).length;
  // 短路命中 = 写时被真实拦截：命中重复→嫁接（detail.dedup='grafted'）或质量门过滤（detail.action='filtered_l0_to_l1'）。
  // 批次47：此前对整条 detail 做 /filter|dedup|dup/ 子串匹配，连「未命中/新建」的普通写入也会命中 → 短路数=全部写入数。
  const shortCircuit = audits.filter((a) => {
    if (a.action !== 'write' || a.ts < cutoff) return false;
    const d = a.detail as { dedup?: unknown; action?: unknown } | undefined;
    return d?.dedup === 'grafted' || d?.action === 'filtered_l0_to_l1';
  }).length;
  // 平均耗时 = 24h 内真实 write 审计里的 cost_ms 均值（批次48 A12：内核 coreWrite 实测写入路径耗时）。
  // 没有采样 → 0 + samples=0，UI 如实显示「—（账本未采样）」；绝不拿固定值冒充。
  const costs = audits
    .filter((a) => a.action === 'write' && a.ts >= cutoff)
    .map((a) => (a.detail as { cost_ms?: unknown } | undefined)?.cost_ms)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  const avg = costs.length > 0 ? Math.round((costs.reduce((s, v) => s + v, 0) / costs.length) * 10) / 10 : 0;
  return { short_circuit_hits: shortCircuit, merged, avg_cost_ms: avg, avg_cost_samples: costs.length };
}

/**
 * Δ 曲线：只取真实 **weight_tuned** 事件（7.2）。
 * 两个真实来源：
 *  · 回归采纳 audit（action='weight_tuned', detail.kind='dedup_regression'）→ Δ = 测试集 F1 提升；
 *  · 页面/历史优化审计（action='growth_op', entry.event='weight_tuned'）→ Δ = 调权重后命中率 − 调权重前命中率。
 * 无记录 → 空数组（UI 空态），不从 cron 反推、不造点。
 */
export function deltaSeriesFromLedger(audits: AuditRecord[]): DeltaPoint[] {
  const tuned = audits.filter((a) => {
    if (a.action === 'growth_op') {
      return (a.detail as { entry?: GrowthAuditEntry })?.entry?.event === 'weight_tuned';
    }
    if (a.action === 'weight_tuned') {
      const d = a.detail as Record<string, unknown> | undefined;
      return d?.kind === 'dedup_regression';
    }
    return false;
  }).sort((a, b) => a.ts - b.ts);
  if (tuned.length === 0) return [];
  const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return tuned.slice(-14).map((a) => {
    const d = new Date(a.ts);
    const gain = regressionF1GainOf(a);
    return { day: DAY_NAMES[d.getDay()], delta: gain ?? deltaBeforeOf(a), is_tuned: true };
  });
}

/** 调度：真实配置（衰减不可停 R5）；非演示数据 —— 内核调度口径如实呈现 */
export function scheduleReal(): ScheduleItem[] {
  return DEFAULT_SCHEDULE.map((s) => ({ ...s }));
}

const REGRESSION_ACTIONS = new Set<string>(['insufficient_samples', 'weight_regression', 'weight_tuned']);

function testMetricsOf(v: unknown): { f1: number; precision: number } | undefined {
  const t = (v as { test?: { f1?: unknown; precision?: unknown } } | undefined)?.test;
  if (!t || typeof t.f1 !== 'number' || typeof t.precision !== 'number') return undefined;
  return { f1: t.f1, precision: t.precision };
}

function countsOf(v: unknown): RegressionOutcome['counts'] | undefined {
  const c = v as { total?: unknown; positives?: unknown; negatives?: unknown; window_days?: unknown } | undefined;
  if (!c || typeof c.total !== 'number' || typeof c.positives !== 'number' || typeof c.negatives !== 'number') {
    return undefined;
  }
  return {
    total: c.total, positives: c.positives, negatives: c.negatives,
    window_days: typeof c.window_days === 'number' ? c.window_days : 30,
  };
}

/**
 * 批次48 A23.3：回归结果四态（只认 kind='dedup_regression' 的真实审计）。
 * 无任何记录 = never_run（未到运行时间）；有记录但字段缺失时保留缺失，
 * 不用默认值冒充「F1 0」之类的结论。
 */
export function regressionOutcomeFromLedger(audits: AuditRecord[]): RegressionOutcome {
  let latest: { a: AuditRecord; kind: RegressionOutcome['kind'] } | null = null;
  for (const a of audits) {
    if (!REGRESSION_ACTIONS.has(a.action)) continue;
    const d = a.detail as Record<string, unknown> | undefined;
    if (d?.kind !== 'dedup_regression') continue;
    if (!latest || a.ts > latest.a.ts) {
      latest = {
        a,
        kind: a.action === 'insufficient_samples' ? 'insufficient_samples'
          : a.action === 'weight_regression' ? 'not_adopted' : 'adopted',
      };
    }
  }
  if (!latest) return { kind: 'never_run', ts: null };

  const d = latest.a.detail as Record<string, unknown>;
  const out: RegressionOutcome = { kind: latest.kind, ts: latest.a.ts };
  const counts = countsOf(latest.kind === 'insufficient_samples' ? d : d.counts);
  if (counts) out.counts = counts;
  if (typeof d.reason === 'string') out.reason = d.reason;

  if (latest.kind === 'not_adopted') {
    const before = testMetricsOf(d.before);
    const after = testMetricsOf(d.after);
    if (before) out.before = before;
    if (after) out.after = after;
  } else if (latest.kind === 'adopted') {
    const m = d.metrics as Record<string, unknown> | undefined;
    const before = testMetricsOf(m?.before);
    const after = testMetricsOf(m?.after);
    if (before) out.before = before;
    if (after) out.after = after;
  }
  return out;
}

/**
 * 逐条回归记录（回归评估表）：只认 kind='dedup_regression' 的真实审计，
 * 最新在前；字段缺失保持 undefined（表格显示「未记录」），不编造 F1/精确率。
 */
export function regressionRecordsFromLedger(audits: AuditRecord[]): RegressionRecord[] {
  const out: RegressionRecord[] = [];
  for (const a of audits) {
    if (!REGRESSION_ACTIONS.has(a.action)) continue;
    const d = a.detail as Record<string, unknown> | undefined;
    if (d?.kind !== 'dedup_regression') continue;
    const kind: RegressionRecord['kind'] = a.action === 'insufficient_samples'
      ? 'insufficient_samples'
      : a.action === 'weight_regression' ? 'not_adopted' : 'adopted';
    const rec: RegressionRecord = {
      requestId: a.request_id,
      ts: a.ts,
      kind,
      applied: kind === 'adopted',
    };
    const counts = countsOf(kind === 'insufficient_samples' ? d : d.counts);
    if (counts) rec.counts = counts;
    if (typeof d.reason === 'string') rec.reason = d.reason;
    if (kind === 'not_adopted') {
      const before = testMetricsOf(d.before);
      const after = testMetricsOf(d.after);
      if (before) rec.before = before;
      if (after) rec.after = after;
    } else if (kind === 'adopted') {
      const m = d.metrics as Record<string, unknown> | undefined;
      const before = testMetricsOf(m?.before);
      const after = testMetricsOf(m?.after);
      if (before) rec.before = before;
      if (after) rec.after = after;
    }
    out.push(rec);
  }
  return out.sort((x, y) => y.ts - x.ts);
}

/**
 * 批次61 GAP-1：「召回权重建议」审计 → 页面视图（无建议 → null）。
 * 只认 `growth_op` 里 event='recall_weight_suggested' 的 entry.payload；
 * payload 解析失败 / suggestion 缺失 / 结构不合法一律跳过，不拿半截数据冒充建议。
 * 多条时取 `at` 最新的一条（同 at 取先出现者，保证确定性）。
 */
export function recallSuggestionFromLedger(audits: AuditRecord[]): RecallSuggestionView | null {
  let best: RecallSuggestionView | null = null;
  for (const a of audits) {
    if (a.action !== 'growth_op') continue;
    const entry = (a.detail as { entry?: GrowthAuditEntry } | undefined)?.entry;
    if (!entry || entry.event !== 'recall_weight_suggested') continue;
    let parsed: { suggestion?: unknown } | null = null;
    try {
      parsed = JSON.parse(entry.payload) as { suggestion?: unknown };
    } catch {
      continue;
    }
    const s = parsed?.suggestion as
      | { from?: unknown; to?: unknown; reason?: unknown; metrics?: { recalls?: unknown } }
      | null | undefined;
    // 结构校验：坏权重（缺键/越界/和≠1）整条跳过，不让页面在渲染时崩在 toFixed 上
    if (!s || !validRecallWeights(s.from) || !validRecallWeights(s.to)) continue;
    const at = typeof entry.at === 'number' ? entry.at : a.ts;
    if (best && at <= best.at) continue;
    best = {
      at,
      requestId: a.request_id,
      from: s.from,
      to: s.to,
      reason: typeof s.reason === 'string' ? s.reason : '',
      recalls: typeof s.metrics?.recalls === 'number' ? s.metrics.recalls : 0,
    };
  }
  return best;
}

/**
 * 批次61 GAP-2：最新一条带 `signal_summary` 的 `gc` 审计 → 页面视图（无记录 → null）。
 * 只认 ok=true 且 summary 里有 window_days/recalls 的记录；读失败的 gc（ok=false）不算「有数据」，
 * 避免把「审计读不到」画成「没有反馈」。
 */
export function feedbackSignalFromLedger(audits: AuditRecord[]): FeedbackSignalView | null {
  let best: FeedbackSignalView | null = null;
  for (const a of audits) {
    if (a.action !== 'gc') continue;
    const sig = (a.detail as { signal_summary?: unknown } | undefined)?.signal_summary as
      | { ok?: unknown; summary?: unknown } | undefined;
    if (!sig || sig.ok !== true) continue;
    const s = sig.summary as Partial<{
      window_days: number; recalls: number; evidence_thin: number;
      verdicts: { confirm?: number; reject?: number; disputed?: number };
      reject_ratio: number; rejected_mem_ids: number;
    }> | undefined;
    if (!s || typeof s.recalls !== 'number' || typeof s.window_days !== 'number') continue;
    if (best && a.ts <= best.at) continue;
    best = {
      at: a.ts,
      window_days: s.window_days,
      recalls: s.recalls,
      evidence_thin: typeof s.evidence_thin === 'number' ? s.evidence_thin : 0,
      verdicts: {
        confirm: typeof s.verdicts?.confirm === 'number' ? s.verdicts.confirm : 0,
        reject: typeof s.verdicts?.reject === 'number' ? s.verdicts.reject : 0,
        disputed: typeof s.verdicts?.disputed === 'number' ? s.verdicts.disputed : 0,
      },
      reject_ratio: typeof s.reject_ratio === 'number' ? s.reject_ratio : 0,
      rejected_mem_ids: typeof s.rejected_mem_ids === 'number' ? s.rejected_mem_ids : 0,
    };
  }
  return best;
}

const SCHEDULE_KEY_SET = new Set<string>(SCHEDULE_KEYS);

/**
 * 批次48 A23.2：从真实审计里取每个调度任务**最近一次** schedule_run 记录。
 * 只认内核写的 detail（task/host/status/duration_ms/next_due_at）；字段缺失按 null，
 * 任务未知或动作不对一律忽略 —— 页面因此能区分「宿主真实跑过」与「从未运行」，
 * 不需要也不允许从 cron 反推「应该跑过」。
 */
export function scheduleRunsFromLedger(
  audits: AuditRecord[],
): Partial<Record<ScheduleKey, ScheduleRunInfo>> {
  const out: Partial<Record<ScheduleKey, ScheduleRunInfo>> = {};
  for (const a of audits) {
    if (a.action !== 'schedule_run') continue;
    const d = a.detail as Record<string, unknown> | undefined;
    const task = d?.task;
    if (typeof task !== 'string' || !SCHEDULE_KEY_SET.has(task)) continue;
    const key = task as ScheduleKey;
    const prev = out[key];
    if (prev && prev.ts >= a.ts) continue;
    const statusRaw = d?.status;
    const status: ScheduleRunInfo['status'] =
      statusRaw === 'ok' || statusRaw === 'error' ? statusRaw : 'skipped';
    out[key] = {
      task: key,
      host: typeof d?.host === 'string' ? d.host : 'unknown',
      status,
      trigger: typeof d?.trigger === 'string' ? d.trigger : undefined,
      duration_ms: typeof d?.duration_ms === 'number' && Number.isFinite(d.duration_ms) ? d.duration_ms : null,
      next_due_at: typeof d?.next_due_at === 'number' && Number.isFinite(d.next_due_at) ? d.next_due_at : null,
      error: typeof d?.error === 'string' ? d.error : null,
      result: (d?.result && typeof d.result === 'object' ? d.result : {}) as Record<string, unknown>,
      ts: a.ts,
    };
  }
  return out;
}

export { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS };
export type { DimWeights, LayerThresholds };

/** 一次性加载真实数据（记忆表 + 全量审计）→ 页面所有展示数字的唯一真相源 */
export interface RealGrowth {
  available: boolean;
  memCount: number;
  auditCount: number;
  metrics: GrowthMetrics;
  samples: DedupSample[];
  dedupStats: { short_circuit_hits: number; merged: number; avg_cost_ms: number; avg_cost_samples: number };
  deltaSeries: DeltaPoint[];
  growthAudit: GrowthAuditEntry[];
  /** 每个调度任务最近一次真实运行记录（无记录 = 该任务未运行） */
  scheduleRuns: Partial<Record<ScheduleKey, ScheduleRunInfo>>;
  /** 自生长回归的最近一次结果（四态可区分；无记录 = 未到运行时间） */
  regression: RegressionOutcome;
  /** 每次真实回归的逐条记录（最新在前；无记录 = 空数组） */
  regressionRecords: RegressionRecord[];
  /**
   * 批次61 GAP-3：Agent 侧使用画像（同一批审计实算，7 天窗）。
   * 只读聚合：不写审计、不改记忆；verdict 分布只能到项目级（memory_op 审计无 client 字段）。
   */
  agentUsage: AgentUsageSummary;
  /** 批次61 GAP-1：最新召回权重建议（无建议 → null，页面显「暂无建议」） */
  recallSuggestion: RecallSuggestionView | null;
  /** 批次61 GAP-2：最新净化周期的反馈信号画像（无 gc 记录 → null，页面显「暂无数据」） */
  feedbackSignal: FeedbackSignalView | null;
}

// 真实账本实算标记（供构建产物核验）
export const GROWTH_REAL_DATA_SOURCE = 'real-ledger';

export async function loadRealGrowthData(): Promise<RealGrowth> {
  const storage = getRealStorage();
  const [mems, audits] = await Promise.all([
    storage.listMemories({}),
    storage.queryAudit({}),
  ]);
  const growthAudit = audits
    .filter((a) => a.action === 'growth_op')
    .map((a) => (a.detail as { entry?: GrowthAuditEntry }).entry)
    .filter((e): e is GrowthAuditEntry => Boolean(e));

  return {
    available: mems.length > 0 || audits.length > 0,
    memCount: mems.length,
    auditCount: audits.length,
    metrics: metricsFromLedger(mems, audits),
    samples: samplesFromMemories(mems, 4),
    dedupStats: dedupStatsFromLedger(audits),
    deltaSeries: deltaSeriesFromLedger(audits),
    growthAudit,
    scheduleRuns: scheduleRunsFromLedger(audits),
    regression: regressionOutcomeFromLedger(audits),
    regressionRecords: regressionRecordsFromLedger(audits),
    // 与其它指标读同一份审计快照，保证页面上「Agent 侧」与「反馈指标」不会各说一套
    agentUsage: summarizeAgentUsage(audits, Date.now(), 7),
    recallSuggestion: recallSuggestionFromLedger(audits),
    feedbackSignal: feedbackSignalFromLedger(audits),
  };
}

/** 回归采纳审计 → 测试集 F1 提升（missing 字段 → null，不拿 0 冒充） */
function regressionF1GainOf(a: AuditRecord): number | null {
  if (a.action !== 'weight_tuned') return null;
  const d = a.detail as { kind?: unknown; metrics?: { before?: unknown; after?: unknown } } | undefined;
  if (d?.kind !== 'dedup_regression') return null;
  const before = testMetricsOf(d.metrics?.before);
  const after = testMetricsOf(d.metrics?.after);
  if (!before || !after) return null;
  return Math.round((after.f1 - before.f1) * 1000) / 1000;
}

/** 审计 payload（JSON 字符串）→ delta_before；解析失败按 0（账本不伪造） */
function deltaBeforeOf(a: AuditRecord): number {
  const raw = (a.detail as { entry?: GrowthAuditEntry })?.entry?.payload;
  if (typeof raw !== 'string') return 0;
  try {
    const p = JSON.parse(raw) as { delta_before?: number };
    return p.delta_before ?? 0;
  } catch {
    return 0;
  }
}
