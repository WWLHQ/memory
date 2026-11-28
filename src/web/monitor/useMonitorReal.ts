// 监控仪表盘（REQ-006 / P6）· 真实数据接真层
// 设计约定（与记忆库管理页 / 自我净化与生长页 / 生命周期页一致）：
//   数据真相 = 内核账本（桌面 Electron 下 = 主进程 FileStorage 持久库；浏览器降级 = 内存态，
//   未写入过即空账本 → 诚实空态，绝不伪造数据）。
//
// 指标卡（12.1）诚实口径（阶段4-I / B8 跨模块接真；2026-11-15 用户批准 14→13；批次64 再补 7 卡 → 20）：
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
import { summarizeAgentUsage } from '../../core/memagent/agentUsage.ts';
import { monitorValueText } from '../growth/recallLabels.ts';
import { hostCall } from '../../desktop/hostBridge.ts';

export type RealStorage = Pick<StorageBackend, 'listMemories' | 'queryAudit'>;

function getRealStorage(): RealStorage {
  // 全站同一份账本（桌面 = 主进程持久库；浏览器 = 进程内单例）。
  return getKernelStorage();
}

/* ---------- 指标卡真实实算（12.1 八组 20 项；按规格时间窗口过滤；无口径 → 值位「未取数」） ---------- */

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

/** 主进程运维态（采集器 + 最近备份）：取不到就是 null，界面显「暂无数据」，绝不猜 */
export interface MonitorOps {
  collector: { running: boolean; consecutiveFails: number; autoRetryStopped: boolean; lastAt: number | null } | null;
  /** 是否真的读到了备份目录（false = 读不到，不能当成「没有备份」） */
  backupOk: boolean;
  /** 最近一次备份的毫秒时间戳；仅 backupOk=true 时有意义，null = 目录里一条备份都没有 */
  lastBackupAt: number | null;
}

/**
 * 用主进程运维态覆盖 2 张卡（采集器 / 最近备份）。ops 为 null（浏览器、主进程未就绪）时原样返回。
 * 采集器口径：在跑且无连续失败 = 正常；已停止 / 自动重试已放弃 / 有连续失败 = 告警。
 */
export function applyMonitorOps(metrics: MetricCard[], ops: MonitorOps | null, now: number = Date.now()): MetricCard[] {
  if (!ops) return metrics;
  return metrics.map((m) => {
    if (m.metric === '采集器') {
      const c = ops.collector;
      if (!c) return m;
      if (!c.running) return { ...m, value: '已停止', level: 'warn' };
      if (c.autoRetryStopped) return { ...m, value: '已停重试', level: 'warn' };
      if (c.consecutiveFails > 0) return { ...m, value: `连续失败 ${c.consecutiveFails} 轮`, level: 'warn' };
      return { ...m, value: '在跑', level: 'ok' };
    }
    if (m.metric === '最近备份') {
      // 读不到备份目录 ≠ 没有备份：读不到保持「暂无数据」，只有真读到空目录才说「从未备份」。
      if (!ops.backupOk) return m;
      if (ops.lastBackupAt === null) return { ...m, value: '从未备份', level: 'warn' };
      const days = Math.max(0, Math.floor((now - ops.lastBackupAt) / DAY));
      return { ...m, value: days, level: days > 7 ? 'warn' : 'ok' };
    }
    return m;
  });
}

/** 读主进程运维态；任一通道失败只让对应那项为 null（不因为备份读不到就把采集器也说成没数据） */
async function loadMonitorOps(): Promise<MonitorOps> {
  // 每个通道各自 try/catch：hostCall 在无宿主环境会同步抛，放进 Promise.allSettled 也接不住。
  const safeCollector = async () => {
    try {
      return await hostCall<{ ok?: boolean; running?: boolean; consecutiveFails?: number; autoRetryStopped?: boolean; last?: { ts?: number } | null }>('collector:status', []);
    } catch { return null; }
  };
  const safeBackup = async () => {
    try { return await hostCall<{ items?: { time?: string }[] }>('backup:list', []); } catch { return null; }
  };
  const [col, bak] = await Promise.all([safeCollector(), safeBackup()]);
  let collector: MonitorOps['collector'] = null;
  if (col && typeof col.running === 'boolean') {
    collector = {
      running: col.running,
      consecutiveFails: typeof col.consecutiveFails === 'number' ? col.consecutiveFails : 0,
      autoRetryStopped: col.autoRetryStopped === true,
      lastAt: typeof col.last?.ts === 'number' ? col.last.ts : null,
    };
  }
  let lastBackupAt: number | null = null;
  if (bak && Array.isArray(bak.items)) {
    for (const it of bak.items) {
      const t = typeof it?.time === 'string' ? Date.parse(it.time) : NaN;
      if (Number.isFinite(t) && (lastBackupAt === null || t > lastBackupAt)) lastBackupAt = t;
    }
  }
  return { collector, backupOk: bak !== null, lastBackupAt };
}

/** 从真实账本（记忆表 + 审计）+ 主进程补炼队列回执实算 20 张指标卡；now 可注入以便确定性测试 */
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

  /* ---------- 批次64：账本里已有、但页面上没人看的 5 个真实信号 ---------- */

  // ① 首调先查记忆率(7d)：复用内核 agentUsage 的同一份口径（分母只算带 Mcp-Session-Id 的可靠首调），
  //    不再在渲染层抄第二套算法；没可靠会话 → null（显「暂无数据」，绝不拿 0% 冒充「全都不合规」）。
  const usage = summarizeAgentUsage(audits, now, 7);
  const firstRecallCompliance = usage.totals.first_call_compliance === null
    ? null
    : Math.round(usage.totals.first_call_compliance * 100);
  // ② MCP 调用(24h)：Agent 侧真实调用量（读+写），0 是真实值（今天没人用 ≠ 没采集）。
  const mcpCalls24h = audits.filter((a) => a.action === 'mcp_call' && within(a, DAY, now)).length;
  // ③ 质量门拦截(24h)：write 审计里 action='filtered_l0_to_l1' 的行——正常过滤，不是失败（与写入率分母已剥离）。
  const qualityFiltered24h = audits.filter((a) => a.action === 'write' && within(a, DAY, now)
    && (a.detail as { action?: unknown } | undefined)?.action === 'filtered_l0_to_l1').length;
  // ④ 定时任务失败(24h)：cron 真执行记录里 status='failed'（skipped 是「条件不满足主动跳过」，不算失败）。
  const scheduleFailed24h = audits.filter((a) => a.action === 'schedule_run' && within(a, DAY, now)
    && (a.detail as { status?: unknown } | undefined)?.status === 'failed').length;
  // ⑤ 解锁失败(24h)：l0_auth_fail（密码错）+ l0_auth_deny（越权拒绝），安全侧真实计数。
  const unlockFailed24h = audits.filter((a) => (a.action === 'l0_auth_fail' || a.action === 'l0_auth_deny') && within(a, DAY, now)).length;

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
    // Agent 使用：账本里 mcp_call 审计的真实聚合（读+写都算），看「Agent 到底有没有在用、有没有按规矩先查」。
    { group: 'Agent 使用(7d)', metric: '首调先查记忆率(7d)', value: firstRecallCompliance ?? '未取数', unit: firstRecallCompliance === null ? '' : '%', threshold: '<80% ⚠️', level: levelOf(firstRecallCompliance, (n) => n < 80, () => false), jump: 'P10' },
    { group: 'Agent 使用(7d)', metric: 'MCP 调用(24h)', value: mcpCalls24h, unit: '次', threshold: '只看趋势', level: 'ok', jump: 'P10' },
    // Agent 健康：值位由主进程 monitor:stats 覆盖；无主进程/无样本 → 未取数。
    // 单位不在此写死（旧写法 unit:'' 会让 MetricGrid 的 `c.unit ?? t.unit` 不回退真源，导致「100」缺 %）；
    // 留空 undefined → 回退 recallLabels 的 '%'；空态走「暂无数据」分支本就不拼单位。
    { group: 'Agent 健康', metric: '连通成功率(5min)', value: '未取数', threshold: '<95% ⚠️', level: 'ok', jump: 'P10' },
    { group: 'Agent 健康', metric: '熔断状态', value: '未取数', threshold: 'OPEN 🔴', level: 'ok', jump: 'P10' },
    { group: 'Agent 健康', metric: '平均延迟', value: '未取数', unit: 's', threshold: '>5s ⚠️', level: 'ok', jump: 'P10' },
    // 采集与备份：值位由主进程 collector:status / backup:list 覆盖；无主进程 → 未取数。
    { group: '采集与备份', metric: '采集器', value: '未取数', threshold: '停止/连续失败 ⚠️', level: 'ok', jump: 'P9' },
    { group: '采集与备份', metric: '最近备份', value: '未取数', unit: '天', threshold: '>7 天 ⚠️', level: 'ok', jump: 'S3' },
    // 冷存储：写入率 / 校验异常由主进程 monitor:stats 覆盖；无主进程/无样本 → 未取数。
    { group: '冷存储', metric: '写入成功率', value: '未取数', unit: '%', threshold: '<99.5% ⚠️', level: 'ok', jump: '5.4' },
    { group: '冷存储', metric: '哈希校验失败(24h)', value: '未取数', threshold: '>0 🔴', level: 'ok', jump: '5.4' },
    // 质量门拦截是设计正确的主动过滤（不是写入失败），只做趋势；不要把数量当告警。
    { group: '冷存储', metric: '质量门拦截(24h)', value: qualityFiltered24h, unit: '条', threshold: '正常过滤', level: 'ok', jump: '5.4' },
    // 安全：密码错/越权拒绝的真实计数（安全页有明细，这里只看苗头）
    { group: '安全', metric: '解锁失败(24h)', value: unlockFailed24h, unit: '次', threshold: '>3 次 ⚠️', level: levelOf(unlockFailed24h, (n) => n > 3, () => false), jump: 'S2' },
    // 人工审核（真实账本实算；真实 0 显示 0，不冒充空态）
    { group: '人工审核', metric: '待裁决', value: pendingReview, threshold: '>20 ⚠️', level: levelOf(pendingReview, (n) => n > 20, (n) => n > 50), jump: 'P7' },
    { group: '人工审核', metric: '超期 7d', value: overdue7d, threshold: '>0 ⚠️', level: levelOf(overdue7d, (n) => n > 0, () => false), jump: 'P7' },
    // 精炼队列：2026-11-24 用户要求拆成「成功 / 失败 / 等待」三张独立卡。
    // 四项计数来自主进程 refine:state 真回执；无宿主 / 无回执 → 三张卡各「未取数」，不猜数字。
    // skipped 是「条件不满足主动跳过」，不算失败，单列在成功卡说明里，不混进三张读数。
    {
      group: '队列', metric: '精炼成功',
      value: refine ? refine.done : '未取数', unit: '条',
      parts: refine ? { ok: refine.done, failed: refine.failed, waiting: refine.pending, skipped: refine.skipped } : undefined,
      threshold: '累计完成，不设告警',
      level: 'ok',
      jump: 'P10(5.3)',
    },
    {
      group: '队列', metric: '精炼失败',
      value: refine ? refine.failed : '未取数', unit: '条',
      threshold: '>0 ⚠️',
      level: levelOf(refine?.failed ?? null, (n) => n > 0, () => false),
      jump: 'P10(5.3)',
    },
    {
      group: '队列', metric: '精炼等待',
      value: refine ? refine.pending : '未取数', unit: '条',
      threshold: '>1000 ⚠️',
      level: levelOf(refine?.pending ?? null, (n) => n > 1000, () => false),
      jump: 'P10(5.3)',
    },
    // 定时任务失败：skipped 是「条件不满足主动跳过」（如样本不足、同步未接），不算失败，只有 failed 计入。
    { group: '队列', metric: '定时任务失败(24h)', value: scheduleFailed24h, unit: '次', threshold: '>0 ⚠️', level: levelOf(scheduleFailed24h, (n) => n > 0, () => false), jump: 'P9' },
  ];
}

/* ---------- 批次49：六格汇总（af-g3 af-stat）真实派生；无口径值位「— 未采集」整串（含文字，不是裸「—」） ---------- */

/** 六格汇总单格：k 主名 + sub 副名；v 主值（unit 走 em 小字）；d 说明行（mut=true 走 muted 色）。
 * 批次51：tone 字段删除——数值一律墨色统一呈现，级别信号由说明行与「全部指标」小卡边框色承载 */
export interface SummaryStat {
  k: string;
  sub: string;
  v: string;
  unit?: string;
  d: string;
  mut: boolean;
}

/** 未采集空态值：整串「— 未采集」（check-no-demo 禁裸「—」当值，故必须带文字） */
const NO_SAMPLE = '— 未采集';

function pctText(card: MetricCard | undefined): string {
  if (!card || card.value === '未取数') return NO_SAMPLE;
  return typeof card.value === 'number' ? `${card.value}%` : String(card.value);
}

/**
 * 从最终 20 卡 + 记忆表 + 审计派生六格汇总（全部真实值，0 是真实健康态照显）：
 * ① Agent 健康=连通成功率卡（拨测）② 补炼队列=精炼队列卡 pending ③ 冷存储=mems decay_class 计数
 * ④ 人工审核=待裁决卡 ⑤ 检索 P95=24h 窗 recall latency_ms p95 ⑥ 今日召回=今日 recall 审计数。
 */
export function summaryFromLedger(
  cards: MetricCard[], mems: Memory[], audits: AuditRecord[], now: number = Date.now(),
): SummaryStat[] {
  const of = (metric: string) => cards.find((c) => c.metric === metric);
  const conn = of('连通成功率(5min)');
  const circuit = of('熔断状态');
  // 2026-11-24：原「精炼队列」拆三卡，汇总卡取「精炼等待」作为 pending 主值，
  // 说明行改从「精炼成功」卡的 parts 读成功/失败，读不到就留空，不冒充 0。
  const refine = of('精炼等待');
  const refineOk = of('精炼成功');
  const review = of('待裁决');
  const overdue = of('超期 7d');

  // ① Agent 健康（拨测）：连通率 + 熔断态说明；无拨测样本 → 未采集
  const healthDetail = circuit && circuit.value !== '未取数'
    ? `熔断 ${monitorValueText(circuit.value)}`
    : '无拨测样本';
  const health: SummaryStat = {
    k: 'Agent 健康', sub: '拨测',
    v: pctText(conn),
    d: conn && conn.value !== '未取数' ? healthDetail : '无拨测样本',
    mut: !conn || conn.value === '未取数',
  };

  // ② 补炼队列（pending）：0 是真实空队列
  const pending = refine && refine.value !== '未取数' && typeof refine.value === 'number';
  const refineStat: SummaryStat = pending && refine
    ? {
        k: '补炼队列', sub: 'pending',
        v: String(refine.value),
        d: refineOk?.parts ? `成功 ${refineOk.parts.ok} · 失败 ${refineOk.parts.failed}` : '',
        mut: false,
      }
    : { k: '补炼队列', sub: 'pending', v: NO_SAMPLE, d: '无主进程队列回执', mut: true };

  // ③ 冷存储：cold+dormant 现存量行数；archived 归档另计（真实计数，0 也照显）
  const coldDormant = mems.filter((m) => m.decay_class === 'cold' || m.decay_class === 'dormant').length;
  const archived = mems.filter((m) => m.decay_class === 'archived').length;
  const cold: SummaryStat = {
    k: '冷存储', sub: 'cold+dormant',
    v: String(coldDormant), unit: '行',
    d: `归档 ${archived} 行另计`,
    mut: false,
  };

  // ④ 人工审核（待办）：待裁决现存量；>0 琥珀强调；说明行带超期计数
  const pendingReview = review && typeof review.value === 'number' ? review.value : null;
  const overdueN = overdue && typeof overdue.value === 'number' ? overdue.value : null;
  const reviewStat: SummaryStat = pendingReview === null
    ? { k: '人工审核', sub: '待办', v: NO_SAMPLE, d: '无冲突裁决队列', mut: true }
    : {
        k: '人工审核', sub: '待办',
        v: String(pendingReview),
        d: `超期 7 天 ${overdueN ?? 0} 条`,
        mut: false,
      };

  // ⑤ 检索 P95（24h）：recall latency_ms 分位数（独立于 1h 窗口卡，窗口按副名如实标 24h）
  const recall24h = audits.filter((a) => a.action === 'recall' && within(a, DAY, now));
  const latSamples = recall24h.map((a) => detailNum(a, 'latency_ms')).filter((v): v is number => v !== null);
  const p95 = percentile(latSamples, 0.95);
  const p95Stat: SummaryStat = p95 === null
    ? { k: '检索 P95', sub: '24h', v: NO_SAMPLE, d: '24 小时内无召回记录', mut: true }
    : { k: '检索 P95', sub: '24h', v: String(Math.round(p95)), unit: 'ms', d: `${latSamples.length} 次召回样本`, mut: false };

  // ⑥ 今日召回：本地零点起的 recall 审计数（0 是真实「今天还没用过」）
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const todayRecalls = audits.filter((a) => a.action === 'recall' && typeof a.ts === 'number' && a.ts >= dayStart.getTime());
  const withHits = todayRecalls.filter((a) => (detailNum(a, 'hits') ?? 0) > 0).length;
  const today: SummaryStat = {
    k: '今日召回', sub: 'recall 审计',
    v: String(todayRecalls.length), unit: '次',
    d: `${withHits} 次有命中`,
    mut: false,
  };

  return [health, refineStat, cold, reviewStat, p95Stat, today];
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
  /** 批次49：六格汇总（af-g3 af-stat），全部真实派生；空账本也有真实 0 / 未采集口径 */
  summary?: SummaryStat[];
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
  const [mems, audits, alerts, refine, mon, ops] = await Promise.all([
    storage.listMemories({}),
    storage.queryAudit({}),
    realLoadAlerts(),
    refineQueueState(),
    loadMonitorStats(),
    loadMonitorOps(),
  ]);
  const refineSummary: RefineQueueSummary | null = refine.ok ? refine.view?.summary ?? null : null;
  const now = Date.now();
  const metrics = applyMonitorOps(applyMonitorStats(metricsFromLedger(mems, audits, now, refineSummary), mon), ops, now);
  return {
    available: mems.length > 0 || audits.length > 0,
    memCount: mems.length,
    auditCount: audits.length,
    metrics,
    alerts,
    // 批次49：六格汇总（从最终卡 + 记忆表 + 审计派生）
    summary: summaryFromLedger(metrics, mems, audits, now),
    // 批次48 A25：选项只来自真实账本，空账本只留「全部」
    agentOptions: agentOptionsFromLedger(alerts, mems.map((m) => m.created_by_agent)),
    // REQ-013 / C5：从真实审计聚合后台操作状态（只读，不改落盘）；无相关审计 = 空数组诚实态
    operations: operationStatusFromAudits(audits),
    operationEntries: operationEntriesFromAudits(audits),
  };
}
