// 监控仪表盘（REQ-006 / P6）· 真实数据接真层
// 设计约定（与记忆库管理页 / 自我净化与生长页 / 生命周期页一致）：
//   数据真相 = 内核账本（桌面 Electron 下 = 主进程 FileStorage 持久库；浏览器降级 = 内存态，
//   未写入过即空账本 → 诚实空态，绝不伪造数据）。
//
// 指标卡（12.1）诚实口径：
//   · 有真实账本数据可算的指标 = 实算（召回命中率 / 证据不足率 / 冷存储失败 / 人工审核待裁决 等）；
//   · 账本无对应统计口径的指标（连通成功率 / 延迟 / 熔断状态 / 队列堆积 / 死信 / 哈希校验等）
//     → 显示「—」并标注「未采集」，绝不伪造演示数字（与生长页 latency_ms 同口径）。
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

/* ---------- 指标卡真实实算（12.1 六组 14 项；无数据口径 → 显示「—」未采集） ---------- */

/** 从真实账本（记忆表 + 全量审计）实算 14 张指标卡 */
export function metricsFromLedger(mems: Memory[], audits: AuditRecord[]): MetricCard[] {
  const DAY = 24 * 3600 * 1000;
  const now = Date.now();

  // 检索性能（真实召回审计实算）：recall + cold_recall = 命中；recall_breach = 失败
  const recallHits = audits.filter((a) => a.action === 'recall' || a.action === 'cold_recall').length;
  const recallBreach = audits.filter((a) => a.action === 'recall_breach').length;
  const recallDenom = recallHits + recallBreach;
  const hitRate = recallDenom > 0 ? Math.round((recallHits / recallDenom) * 100) : 0;

  // 证据不足率（真实 evidence_thin 审计 / 召回总数）
  const evidenceThin = audits.filter((a) => a.action === 'evidence_thin').length;
  const evidenceThinRate = recallDenom > 0 ? Math.round((evidenceThin / recallDenom) * 100) : 0;

  // 冷存储写入失败（真实 sync_fail / write 失败审计；账本无对应口径则 0 → 未采集）
  const syncFail = audits.filter((a) => a.action === 'sync_fail').length;

  // 人工审核待裁决（真实 conflict_resolve 审计 + 账本 conflict_id 标记记忆）
  const conflictAudits = audits.filter((a) => a.action === 'conflict_resolve').length;
  const conflictMems = mems.filter((m) => m.conflict_id && m.decay_class !== 'archived' && m.decay_class !== 'dormant').length;
  const pendingReview = Math.max(conflictAudits, conflictMems); // 真实待裁决（取较大口径，诚实）

  // 超期 7d（真实账本中 conflict_id 记忆且 created_at 超 7 天）
  const overdue7d = mems.filter((m) => m.conflict_id && m.decay_class !== 'archived' && m.decay_class !== 'dormant'
    && now - (m.created_at ?? now) > 7 * DAY).length;

  // 冷存储写入成功率：账本无真实冷存储 IO 统计 → 未采集（显示「—」）
  // 哈希校验失败：账本无对应口径 → 未采集
  // Agent 健康（连通成功率 / 熔断 / 延迟）：账本无真实 Agent 探活采样 → 未采集
  // 队列堆积 / 死信：账本无 RawArchive 真实队列 → 未采集

  // 级别判定（诚实：有真实值才判；未采集 = ok，不伪造告警）
  const levelOf = (v: number | null, warn: (n: number) => boolean, crit: (n: number) => boolean): MetricCard['level'] => {
    if (v === null) return 'ok'; // 未采集 → ok（不伪造告警级别）
    if (crit(v)) return 'crit';
    if (warn(v)) return 'warn';
    return 'ok';
  };

  return [
    // Agent 健康（账本无真实 Agent 探活采样 → 全部「—」未采集）
    { group: 'Agent 健康', metric: '连通成功率(5min)', value: '—', threshold: '<95% ⚠️', level: 'ok', jump: 'P10', unit: '' },
    { group: 'Agent 健康', metric: '熔断状态', value: '—', threshold: 'OPEN 🔴', level: 'ok', jump: 'P10' },
    { group: 'Agent 健康', metric: '平均延迟', value: '—', unit: 's', threshold: '>5s ⚠️', level: 'ok', jump: 'P10' },
    // 队列（账本无 RawArchive 真实队列 → 「—」未采集）
    { group: '队列', metric: 'RawArchive 堆积', value: '—', threshold: '>1000 ⚠️', level: 'ok', jump: 'P10(5.3)' },
    { group: '队列', metric: '死信消息(24h)', value: syncFail > 0 ? syncFail : '—', threshold: '>0 ⚠️', level: levelOf(syncFail || null, (n) => n > 0, () => false), jump: '5.3' },
    // 冷存储（账本无真实 IO 统计 → 「—」未采集）
    { group: '冷存储', metric: '写入成功率', value: '—', unit: '%', threshold: '<99.5% ⚠️', level: 'ok', jump: '5.4' },
    { group: '冷存储', metric: '哈希校验失败(24h)', value: '—', threshold: '>0 🔴', level: 'ok', jump: '5.4' },
    // 人工审核（真实账本实算）
    { group: '人工审核', metric: '待裁决', value: pendingReview > 0 ? pendingReview : '—', threshold: '>20 ⚠️', level: levelOf(pendingReview || null, (n) => n > 20, (n) => n > 50), jump: 'P7' },
    { group: '人工审核', metric: '超期 7d', value: overdue7d > 0 ? overdue7d : '—', threshold: '>0 ⚠️', level: levelOf(overdue7d || null, (n) => n > 0, () => false), jump: 'P7' },
    // 检索性能(1h)（真实召回审计实算；无召回记录 → 「—」未采集）
    { group: '检索性能(1h)', metric: '命中率', value: recallDenom > 0 ? hitRate : '—', unit: recallDenom > 0 ? '%' : '', threshold: '<60% ⚠️', level: levelOf(recallDenom > 0 ? hitRate : null, (n) => n < 60, () => false), jump: 'P1' },
    { group: '检索性能(1h)', metric: 'payload_tokens p95', value: '—', threshold: '>2000 ⚠️', level: 'ok', jump: '2.4.1' },
    { group: '检索性能(1h)', metric: 'pipeline_llm_tokens p95', value: '—', threshold: '>3000', level: 'ok', jump: '—' },
    { group: '检索性能(1h)', metric: '延迟 p99', value: '—', unit: 's', threshold: '>2s ⚠️', level: 'ok', jump: '—' },
    { group: '检索性能(1h)', metric: '极简证据不足率(1d)', value: recallDenom > 0 ? evidenceThinRate : '—', unit: recallDenom > 0 ? '%' : '', threshold: '>20% ⚠️', level: levelOf(recallDenom > 0 ? evidenceThinRate : null, (n) => n > 20, () => false), jump: '2.4.3' },
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
