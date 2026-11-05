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
  ScheduleItem, GrowthAuditEntry,
} from './types.ts';
import { DEFAULT_SCHEDULE, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from './spec.ts';

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
  const recallHits = audits.filter((a) => a.action === 'recall' || a.action === 'cold_recall').length;
  const recallBreach = audits.filter((a) => a.action === 'recall_breach').length;
  const denom = recallHits + recallBreach;

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
    hit_rate: denom > 0 ? recallHits / denom : 0,
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

/** 24h 短路嫁接统计：真实 merge / filtered 审计实算 */
export function dedupStatsFromLedger(audits: AuditRecord[]): {
  short_circuit_hits: number; merged: number; avg_cost_ms: number;
} {
  const cutoff = Date.now() - DAY;
  const merged = audits.filter((a) => a.action === 'merge' && a.ts >= cutoff).length;
  // 短路命中 = 写时被查重拦截（detail.action 含 filtered / dedup）
  const shortCircuit = audits.filter(
    (a) => a.action === 'write' && a.ts >= cutoff &&
      /filter|dedup|dup/i.test(JSON.stringify(a.detail ?? {})),
  ).length;
  // 平均耗时：账本未采样真实 IO 延迟 → 0（UI 显示「—」）
  return { short_circuit_hits: shortCircuit, merged, avg_cost_ms: 0 };
}

/** Δ 曲线：真实 weight_tuned / growth_op 审计事件（按日聚合）；无记录则空数组（UI 空态） */
export function deltaSeriesFromLedger(audits: AuditRecord[]): DeltaPoint[] {
  const tuned = audits.filter((a) => a.action === 'growth_op' &&
    (a.detail as { entry?: GrowthAuditEntry })?.entry?.event === 'weight_tuned')
    .sort((a, b) => a.ts - b.ts);
  if (tuned.length === 0) return [];
  const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return tuned.slice(-14).map((a) => {
    const d = new Date(a.ts);
    return { day: DAY_NAMES[d.getDay()], delta: deltaBeforeOf(a), is_tuned: true };
  });
}

/** 调度：真实配置（衰减不可停 R5）；非演示数据 —— 内核调度口径如实呈现 */
export function scheduleReal(): ScheduleItem[] {
  return DEFAULT_SCHEDULE.map((s) => ({ ...s }));
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
  dedupStats: { short_circuit_hits: number; merged: number; avg_cost_ms: number };
  deltaSeries: DeltaPoint[];
  growthAudit: GrowthAuditEntry[];
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
  };
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
