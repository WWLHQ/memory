// 监控仪表盘（REQ-006 / P6）· 真实数据接真层
// 设计约定（与记忆库管理页 / 自我净化与生长页 / 生命周期页一致）：
//   数据真相 = 内核账本（桌面 Electron 下 = 主进程 FileStorage 持久库；浏览器降级 = 内存态，
//   未写入过即空账本 → 诚实空态，绝不伪造数据）。
//
// 指标卡（12.1）诚实口径（阶段4-I / B8 跨模块接真）：
//   · 时间窗口按规格 §12.1 真过滤：命中率 / payload p95 / 延迟 p99 = 1h，死信 = 24h，证据不足率 = 1d；
//     历史审计缺 detail 字段的行**不计入分母**，不拿 0 / false 冒充已采集。
//   · 命中率 = 1h 内「有命中条数(hits>0)」的召回占比（真实 detail.hits），不再是恒 100% 的调用成功率；
//     payload_tokens p95 / 延迟 p99 从真实 detail.payload_tokens / detail.latency_ms 分位数实算；
//     证据不足率 = 1d 内极简模式(mode=minimal)请求中 evidence_thin=true 的占比。
//   · 账本无对应统计口径的指标（Agent 探活 / 队列 / 冷存储 IO / 哈希校验 / pipeline_llm_tokens）
//     → 显示「—」并由 MetricGrid 标注「未采集」，绝不伪造演示数字。
//     pipeline_llm_tokens 内核恒 0（召回管线不调 LLM、网关真实 usage 未接入），不拿 0 算 p95 冒充已接通。
//   · 告警时间线 = 真实账本 monitor_alert 审计（仅读，不再灌种子告警）。
import type { Memory, AuditRecord } from '../../core/memagent/types.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { getKernelStorage } from '../kernel.ts';
import type { AlertItem, MetricCard } from './types.ts';

export type RealStorage = Pick<StorageBackend, 'listMemories' | 'queryAudit'>;

function getRealStorage(): RealStorage {
  // 全站同一份账本（桌面 = 主进程持久库；浏览器 = 进程内单例）。
  return getKernelStorage();
}

/* ---------- 指标卡真实实算（12.1 六组 14 项；按规格时间窗口过滤；无口径 → 「—」未采集） ---------- */

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

/** 从真实账本（记忆表 + 审计）实算 14 张指标卡；now 可注入以便确定性测试 */
export function metricsFromLedger(mems: Memory[], audits: AuditRecord[], now: number = Date.now()): MetricCard[] {
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
  const minimal1d = audits.filter((a) => a.action === 'recall' && within(a, DAY, now)
    && a.detail?.mode === 'minimal' && typeof a.detail?.evidence_thin === 'boolean');
  const thinCount = minimal1d.filter((a) => a.detail.evidence_thin === true).length;
  const evidenceThinRate = minimal1d.length > 0 ? Math.round((thinCount / minimal1d.length) * 100) : null;

  // 死信(24h)：内核账本当前不写 sync_fail（只在 SyncHub 内部审计）；有则实算，无则未采集。
  const syncFail24h = audits.filter((a) => a.action === 'sync_fail' && within(a, DAY, now)).length;

  // 人工审核（真实账本实算；规格是「待裁决数 / 超期未处理」，无时间窗口）
  const conflictAudits = audits.filter((a) => a.action === 'conflict_resolve').length;
  const conflictMems = mems.filter((m) => m.conflict_id && m.decay_class !== 'archived' && m.decay_class !== 'dormant').length;
  const pendingReview = Math.max(conflictAudits, conflictMems);
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
    // Agent 健康：账本无 Agent 探活采样（内核不做连通探测）→ 未采集
    { group: 'Agent 健康', metric: '连通成功率(5min)', value: '—', threshold: '<95% ⚠️', level: 'ok', jump: 'P10', unit: '' },
    { group: 'Agent 健康', metric: '熔断状态', value: '—', threshold: 'OPEN 🔴', level: 'ok', jump: 'P10' },
    { group: 'Agent 健康', metric: '平均延迟', value: '—', unit: 's', threshold: '>5s ⚠️', level: 'ok', jump: 'P10' },
    // 队列 / 冷存储：账本无 RawArchive 队列与冷存储 IO 统计；sync_fail 只在 SyncHub 内部 → 未采集
    { group: '队列', metric: 'RawArchive 堆积', value: '—', threshold: '>1000 ⚠️', level: 'ok', jump: 'P10(5.3)' },
    { group: '队列', metric: '死信消息(24h)', value: syncFail24h > 0 ? syncFail24h : '—', threshold: '>0 ⚠️', level: levelOf(syncFail24h || null, (n) => n > 0, () => false), jump: '5.3' },
    { group: '冷存储', metric: '写入成功率', value: '—', unit: '%', threshold: '<99.5% ⚠️', level: 'ok', jump: '5.4' },
    { group: '冷存储', metric: '哈希校验失败(24h)', value: '—', threshold: '>0 🔴', level: 'ok', jump: '5.4' },
    // 人工审核（真实账本实算）
    { group: '人工审核', metric: '待裁决', value: pendingReview > 0 ? pendingReview : '—', threshold: '>20 ⚠️', level: levelOf(pendingReview || null, (n) => n > 20, (n) => n > 50), jump: 'P7' },
    { group: '人工审核', metric: '超期 7d', value: overdue7d > 0 ? overdue7d : '—', threshold: '>0 ⚠️', level: levelOf(overdue7d || null, (n) => n > 0, () => false), jump: 'P7' },
    // 检索性能：1h / 1d 窗口真实过滤 + 真实 detail 字段分位数；无样本 → 「—」未采集
    { group: '检索性能(1h)', metric: '命中率', value: hitRate ?? '—', unit: hitRate === null ? '' : '%', threshold: '<60% ⚠️', level: levelOf(hitRate, (n) => n < 60, () => false), jump: 'P1' },
    { group: '检索性能(1h)', metric: 'payload_tokens p95', value: payloadP95 ?? '—', threshold: '>2000 ⚠️', level: levelOf(payloadP95, (n) => n > 2000, () => false), jump: '2.4.1' },
    // pipeline_llm_tokens 内核恒 0（召回管线不调 LLM、网关 usage 未接入）→ 不拿 0 算 p95，如实未采集
    { group: '检索性能(1h)', metric: 'pipeline_llm_tokens p95', value: '—', threshold: '>3000', level: 'ok', jump: '—' },
    { group: '检索性能(1h)', metric: '延迟 p99', value: latencyP99 ?? '—', unit: 's', threshold: '>2s ⚠️', level: levelOf(latencyP99, (n) => n > 2, () => false), jump: '—' },
    { group: '检索性能(1h)', metric: '极简证据不足率(1d)', value: evidenceThinRate ?? '—', unit: evidenceThinRate === null ? '' : '%', threshold: '>20% ⚠️', level: levelOf(evidenceThinRate, (n) => n > 20, () => false), jump: '2.4.3' },
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
}

// 真实账本实算标记（供构建产物核验）
export const MONITOR_REAL_DATA_SOURCE = 'real-ledger';

export async function loadRealMonitorData(): Promise<RealMonitor> {
  const storage = getRealStorage();
  const [mems, audits, alerts] = await Promise.all([
    storage.listMemories({}),
    storage.queryAudit({}),
    realLoadAlerts(),
  ]);
  return {
    available: mems.length > 0 || audits.length > 0,
    memCount: mems.length,
    auditCount: audits.length,
    metrics: metricsFromLedger(mems, audits),
    alerts,
  };
}
