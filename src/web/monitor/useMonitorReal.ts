// 监控仪表盘（REQ-006 / P6）· 真实数据接真层
// 设计约定（与记忆库管理页 / 自我净化与生长页 / 生命周期页一致）：
//   数据真相 = 内核账本（桌面 Electron 下 = 主进程 FileStorage 持久库；浏览器降级 = 内存态，
//   未写入过即空账本 → 诚实空态，绝不伪造数据）。
//
// 指标卡（12.1）诚实口径（阶段4-I / B8 跨模块接真；2026-11-15 用户批准 14→13 卡）：
//   · 时间窗口按规格 §12.1 真过滤：命中率 / payload p95 / 延迟 p99 = 1h，证据不足率 = 1d；
//     历史审计缺 detail 字段的行**不计入分母**，不拿 0 / false 冒充已采集。
//   · 命中率 = 1h 内「有命中条数(hits>0)」的召回占比（真实 detail.hits），不再是恒 100% 的调用成功率；
//     payload_tokens p95 / 延迟 p99 从真实 detail.payload_tokens / detail.latency_ms 分位数实算；
//     证据不足率 = 1d 内极简模式(mode=minimal)请求中 evidence_thin=true 的占比；分母为 0 时显「无样本」而非假 0%。
//   · 队列组「精炼队列」：成功/失败/等待/跳过四项来自主进程 `refine:state` 只读回执；
//     浏览器模式无主进程 → 整卡诚实「未取数」，绝不拿页面内存对象冒充真队列。
//   · 「死信消息(24h)」卡已删：它是 failed 的 24h 子集，与精炼队列重复计数。
//   · Agent 健康三卡 + 冷存储两卡（写入率 / 校验异常）：来自主进程定时拨测聚合（monitor:stats）。
//     无主进程 / 无样本时值位标「未取数」，绝不伪造演示数字。
//   · 链路开销（pipeline_llm_tokens）：本地检索管线不调大模型，内核恒 0，如实显示 0（标注「本地检索不调大模型」），不再叫未采集。
//   · 待裁决 / 超期：真实值可能为 0，0 是真实健康态，必须显示 0 而非「未取数」（修 0 值误判 bug）。
//   · 告警时间线 = 真实账本 monitor_alert 审计（仅读，不再灌种子告警）。
import type { Memory, AuditRecord } from '../../core/memagent/types.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { getKernelStorage } from '../kernel.ts';
import type { AlertItem, MetricCard } from './types.ts';
import type { RefineQueueSummary } from '../params/refineQueue.ts';
import { agentOptionsFromLedger } from './options.ts';
import { operationEntriesFromAudits, operationStatusFromAudits, type OperationEntry, type OperationStatus } from './operationState.ts';
import { hostCall } from '../../desktop/hostBridge.ts';

export type RealStorage = Pick<StorageBackend, 'listMemories' | 'queryAudit'>;

function getRealStorage(): RealStorage {
  // 全站同一份账本（桌面 = 主进程持久库；浏览器 = 进程内单例）。
  return getKernelStorage();
}

/* ---------- 指标卡真实实算（12.1 五组 13 项；按规格时间窗口过滤；无口径 → 值位「未取数」） ---------- */

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** 最近秩分位数（p∈(0,1]）；空样本返回 null，绝不补 0 */
export function percentile(samples: number[], p: number): number | null {
  const sorted = samples.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** 审计 ts 是否落在窗口内；上界留 1 分钟容差，避免「刚写入、now 稍早」的边界抖动 */
function within(a: AuditRecord, windowMs: number, now: number): boolean {
  return typeof a.ts === 'number' && a.ts >= now - windowMs && a.ts <= now + 60_000;
}

/** 只认数值型 detail 字段；历史审计缺字段返回 null（不计入分母，也不当 0） */
function detailNum(a: AuditRecord, key: string): number | null {
  const v = a.detail?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 主进程 monitor:stats 返回结构（与 src/electron/agentProbe.ts 的 MonitorStats 字段一致，仅渲染层本地定义避免引入主进程模块） */
export interface MonitorStats {
  agent: {
    connectivityRate: number | null;
    circuit: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    avgLatencyMs: number | null;
    probedAt: number | null;
    windowSamples: number;
  };
  writeRate: { rate: number | null; success: number; filtered: number; failed: number; since: number } | null;
  checksumFail: number | null;
}

/**
 * 用主进程拨测聚合覆盖 5 张卡（Agent 健康 3 + 冷存储 2）；stats 为 null（无主进程/未就绪）时原样返回。
 * 仅替换有真实值且口径明确的卡，绝不伪造。
 */
export function applyMonitorStats(metrics: MetricCard[], stats: MonitorStats | null): MetricCard[] {
  if (!stats) return metrics;
  return metrics.map((m) => {
    switch (m.metric) {
      case '连通成功率(5min)': {
        if (stats.agent.connectivityRate === null) return m;
        const v = stats.agent.connectivityRate;
        // 规格 12.1 只有一档：<95% → ⚠️ 警告（不再额外造 <80% 🔴 档，避免偏离规格）
        return { ...m, value: v, level: v < 95 ? 'warn' : 'ok' };
      }
      case '熔断状态':
        // 无样本（windowSamples=0）时 circuit 只是模块初始值 CLOSED，不能据此说「正常」——
        // 保持「未取数」，由渲染层显「暂无数据 / 暂无结论」，绝不拿零样本冒充健康。
        if (stats.agent.windowSamples <= 0) return m;
        return { ...m, value: stats.agent.circuit, level: stats.agent.circuit === 'OPEN' ? 'crit' : stats.agent.circuit === 'HALF_OPEN' ? 'warn' : 'ok' };
      case '平均延迟': {
        if (stats.agent.avgLatencyMs === null) return m;
        const v = Math.round(stats.agent.avgLatencyMs) / 1000;
        return { ...m, value: v, level: v > 5 ? 'warn' : 'ok' };
      }
      case '写入成功率': {
        if (!stats.writeRate || stats.writeRate.rate === null) return m;
        const v = stats.writeRate.rate;
        // 规格 12.1 只有一档：<99.5% → ⚠️ 警告（不再额外造 <95% 🔴 档）
        // 口径已剔除质量门过滤，见 agentProbe.computeWriteRate（方案 1）
        return { ...m, value: v, level: v < 99.5 ? 'warn' : 'ok' };
      }
      case '哈希校验失败(24h)': {
        if (stats.checksumFail === null) return m;
        const v = stats.checksumFail;
        return { ...m, value: v, level: v > 0 ? 'crit' : 'ok' };
      }
      default:
        return m;
    }
  });
}

/** 从真实账本（记忆表 + 审计）+ 主进程补炼队列回执实算 13 张指标卡；now 可注入以便确定性测试 */
export function metricsFromLedger(
  mems: Memory[], audits: AuditRecord[], now: number = Date.now(), refine: RefineQueueSummary | null = null,
): MetricCard[] {
  // 检索性能(1h)：只认窗口内的真 recall 审计。命中率用真实 detail.hits（>0 才算命中），
  // 不再是「recall 调用数 / (recall + recall_breach)」——后两个 action 在内核账本里没有写入点，会恒 100%。
  const recall1h = audits.filter((a) => a.action === 'recall' && within(a, HOUR, now));
  const withHits = recall1h.filter((a) => detailNum(a, 'hits') !== null);
  const hitCount = withHits.filter((a) => (detailNum(a, 'hits') ?? 0) > 0).length;
  const hitRate = withHits.length > 0 ? Math.round((hitCount / withHits.length) * 100) : null;

  const payloadP95 = percentile(
    recall1h.map((a) => detailNum(a, 'payload_tokens')).filter((v): v is number => v !== null), 0.95);
  const latencyP99Ms = percentile(
    recall1h.map((a) => detailNum(a, 'latency_ms')).filter((v): v is number => v !== null), 0.99);
  const latencyP99 = latencyP99Ms === null ? null : Math.round(latencyP99Ms) / 1000; // 卡以秒展示（阈值 >2s）

  // 证据不足率(1d)：规格 §12.1 分母 = 极简模式请求；缺 evidence_thin 的历史行不计入。
  // 分母为 0（近 1 天没有极简检索）→ 显「无极简」而非假 0%，避免误导。
  const minimal1d = audits.filter((a) => a.action === 'recall' && within(a, DAY, now)
    && a.detail?.mode === 'minimal' && typeof a.detail?.evidence_thin === 'boolean');
  const thinCount = minimal1d.filter((a) => a.detail.evidence_thin === true).length;
  const evidenceThinRate: number | '无极简' = minimal1d.length > 0 ? Math.round((thinCount / minimal1d.length) * 100) : '无极简';

  // 「死信(24h)」卡已删：它是补炼队列 failed 的 24h 子集，与「精炼队列」重复计数（用户 2026-11-15 批准）。

  // 人工审核（真实账本实算；规格是「待裁决数 / 超期未处理」，无时间窗口）
  // 批次48 A15：待裁决 = 当前仍挂在 conflict_id 的记忆数（队列现存量）。
  // 0 是真实健康态，必须显示 0 而非「未取数」（修 0 值误判 bug）。
  const conflictMems = mems.filter((m) => m.conflict_id && m.decay_class !== 'archived' && m.decay_class !== 'dormant').length;
  const pendingReview = conflictMems;
  const overdue7d = mems.filter((m) => m.conflict_id && m.decay_class !== 'archived' && m.decay_class !== 'dormant'
    && now - (m.created_at ?? now) > 7 * DAY).length;

  // 级别判定（诚实：有真实值才判；未采集 = null → ok，不伪造告警）
  const levelOf = (v: number | null, warn: (n: number) => boolean, crit: (n: number) => boolean): MetricCard['level'] => {
    if (v === null) return 'ok';
    if (crit(v)) return 'crit';
    if (warn(v)) return 'warn';
    return 'ok';
  };

  return [
    // 检索性能：1h / 1d 窗口真实过滤 + 真实 detail 字段分位数；无样本 → 「—」未采集
    // 2026-11-15 用户要求：检索表现置顶（最常用）。
    { group: '检索性能(1h)', metric: '命中率', value: hitRate ?? '未取数', unit: hitRate === null ? '' : '%', threshold: '<60% ⚠️', level: levelOf(hitRate, (n) => n < 60, () => false), jump: 'P1' },
    { group: '检索性能(1h)', metric: 'payload_tokens p95', value: payloadP95 ?? '未取数', threshold: '>2000 ⚠️', level: levelOf(payloadP95, (n) => n > 2000, () => false), jump: '2.4.1' },
    // 链路开销：本地检索管线不调大模型，内核恒 0，如实显示 0（标注「本地检索不调大模型」，见 recallLabels）。
    { group: '检索性能(1h)', metric: 'pipeline_llm_tokens p95', value: 0, threshold: '>3000', level: 'ok', jump: '' },
    { group: '检索性能(1h)', metric: '延迟 p99', value: latencyP99 ?? '未取数', unit: 's', threshold: '>2s ⚠️', level: levelOf(latencyP99, (n) => n > 2, () => false), jump: '' },
    { group: '检索性能(1h)', metric: '极简证据不足率(1d)', value: evidenceThinRate, unit: evidenceThinRate === '无极简' ? '' : '%', threshold: '>20% ⚠️', level: evidenceThinRate === '无极简' ? 'ok' : levelOf(evidenceThinRate, (n) => n > 20, () => false), jump: '2.4.3' },
    // Agent 健康：值位由主进程 monitor:stats 覆盖；无主进程/无样本 → 未取数。
    // 单位不在此写死（旧写法 unit:'' 会让 MetricGrid 的 `c.unit ?? t.unit` 不回退真源，导致「100」缺 %）；
    // 留空 undefined → 回退 recallLabels 的 '%'；空态走「暂无数据」分支本就不拼单位。
    { group: 'Agent 健康', metric: '连通成功率(5min)', value: '未取数', threshold: '<95% ⚠️', level: 'ok', jump: 'P10' },
    { group: 'Agent 健康', metric: '熔断状态', value: '未取数', threshold: 'OPEN 🔴', level: 'ok', jump: 'P10' },
    { group: 'Agent 健康', metric: '平均延迟', value: '未取数', unit: 's', threshold: '>5s ⚠️', level: 'ok', jump: 'P10' },
    // 冷存储：写入率 / 校验异常由主进程 monitor:stats 覆盖；无主进程/无样本 → 未取数。
    { group: '冷存储', metric: '写入成功率', value: '未取数', unit: '%', threshold: '<99.5% ⚠️', level: 'ok', jump: '5.4' },
    { group: '冷存储', metric: '哈希校验失败(24h)', value: '未取数', threshold: '>0 🔴', level: 'ok', jump: '5.4' },
    // 人工审核（真实账本实算；真实 0 显示 0，不冒充空态）
    { group: '人工审核', metric: '待裁决', value: pendingReview, threshold: '>20 ⚠️', level: levelOf(pendingReview, (n) => n > 20, (n) => n > 50), jump: 'P7' },
    { group: '人工审核', metric: '超期 7d', value: overdue7d, threshold: '>0 ⚠️', level: levelOf(overdue7d, (n) => n > 0, () => false), jump: 'P7' },
    // 精炼队列：四项计数来自主进程 refine:state 真回执；无宿主 / 无回执 → 整卡「未取数」，不猜数字。
    // 2026-11-15 用户要求：精炼队列置底。
    {
      group: '队列', metric: '精炼队列',
      value: refine ? refine.pending : '未取数',
      parts: refine ? { ok: refine.done, failed: refine.failed, waiting: refine.pending, skipped: refine.skipped } : undefined,
      threshold: '>1000 ⚠️',
      level: levelOf(refine?.pending ?? null, (n) => n > 1000, () => false),
      jump: 'P10(5.3)',
    },
  ];
}

/* ---------- 告警时间线：仅读真实账本 monitor_alert（不再灌种子告警） ---------- */

/** 从真实账本读告警时间线（仅读，不写入；无告警 → 空数组，诚实空态） */
export async function realLoadAlerts(): Promise<AlertItem[]> {
  const storage = getRealStorage();
  const audits = await storage.queryAudit({ action: 'monitor_alert' });
  return audits
    .map((a) => (a.detail as { entry?: AlertItem }).entry)
    .filter((e): e is AlertItem => Boolean(e));
}

/* ---------- 一次性加载（页面所有展示数字的唯一真相源） ---------- */

export interface RealMonitor {
  available: boolean;
  memCount: number;
  auditCount: number;
  metrics: MetricCard[];
  alerts: AlertItem[];
  /** 批次48 A25：宿主 Agent 筛选选项（账本 agent 字段 + created_by_agent 派生；空账本 = ['all']） */
  agentOptions?: string[];
  /** REQ-013 / C5：后台操作真实状态（从 audit.jsonl 聚合；空账本 = 空数组诚实态） */
  operations?: OperationStatus[];
  /** REQ-013 / C5（T6-A）：同上但带 action/标签/时间，供页面列明细（同一份派生） */
  operationEntries?: OperationEntry[];
}

// 真实账本实算标记（供构建产物核验）
export const MONITOR_REAL_DATA_SOURCE = 'real-ledger';

/** 读取主进程 monitor:stats（Agent 健康 + 冷存储）；无主进程（浏览器）或不就绪 → null 诚实降级 */
async function loadMonitorStats(): Promise<MonitorStats | null> {
  try {
    const r = await hostCall<MonitorStats>('monitor:stats', []);
    return r ?? null;
  } catch {
    return null;
  }
}

export async function loadRealMonitorData(): Promise<RealMonitor> {
  const storage = getRealStorage();
  // 动态导入：纯函数 metricsFromLedger 的单测不必加载宿主桥；浏览器模式会诚实回 ok:false → 队列卡「暂无数据」。
  const { refineQueueState } = await import('../params/refineQueue.ts');
  const [mems, audits, alerts, refine, mon] = await Promise.all([
    storage.listMemories({}),
    storage.queryAudit({}),
    realLoadAlerts(),
    refineQueueState(),
    loadMonitorStats(),
  ]);
  const refineSummary: RefineQueueSummary | null = refine.ok ? refine.view?.summary ?? null : null;
  return {
    available: mems.length > 0 || audits.length > 0,
    memCount: mems.length,
    auditCount: audits.length,
    metrics: applyMonitorStats(metricsFromLedger(mems, audits, Date.now(), refineSummary), mon),
    alerts,
    // 批次48 A25：选项只来自真实账本，空账本只留「全部」
    agentOptions: agentOptionsFromLedger(alerts, mems.map((m) => m.created_by_agent)),
    // REQ-013 / C5：从真实审计聚合后台操作状态（只读，不改落盘）；无相关审计 = 空数组诚实态
    operations: operationStatusFromAudits(audits),
    operationEntries: operationEntriesFromAudits(audits),
  };
}
