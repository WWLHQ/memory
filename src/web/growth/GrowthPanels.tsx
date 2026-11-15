// P14-T3 自生长侧组件：指标卡 + 五项优化 + Δ 收益曲线 + 调度时间轴（7.1/7.2/13.3）
import { useEffect, useState } from 'react';
import type {
  DeltaMetric, DeltaPoint, GrowthAuditEntry, GrowthMetrics, GrowthReceipt, OptimizationItem, RegressionOutcome,
  RegressionRecord, ScheduleItem, ScheduleRunInfo, RecallSuggestionView, FeedbackSignalView,
  RecallWeights, FeedbackPolicy, DimKey, Layer,
} from './types.ts';
import { GC_CONCURRENCY_NOTE, type AgentUsageSummary } from '../../core/memagent/agentUsage.ts';
import { RECALL_KEYS } from '../../shared/growthConfig.ts';
import { RECALL_KEY_LABEL, fmtRecallWeights } from './recallLabels.ts';

export function GrowthCards({ m, empty }: { m: GrowthMetrics; empty?: boolean }) {
  const items: Array<[string, string, string, string]> = [
    ['hit_rate', '检索命中率', m.hit_rate ? m.hit_rate.toFixed(2) : '未取数', 'm-hit-rate'],
    ['confirmed', '确认数（+0.1）', String(m.confirmed), 'm-confirmed'],
    ['rejected', '拒绝数（−0.05）', String(m.rejected), 'm-rejected'],
    ['low_quality', '低质占比（cold/dormant/archived）', m.low_quality_ratio.toFixed(2), 'm-lowq'],
    ['level_L6', 'L6 层命中', m.level_stats_L6.toFixed(2), 'm-l6'],
    ['latency', '检索耗时', m.latency_samples > 0 ? `${Math.round(m.latency_ms)}ms` : '未取数', 'm-latency'],
  ];
  return (
    <div className="card" data-testid="growth-cards">
      <b>反馈指标（7.1，只读 · 真实账本实算）</b>
      <div className="note">
        全部数字来自真实记忆账本：命中率 = recall/cold_recall 命中数 ÷ (命中+违约)；低质/L6 占比 = 记忆表真实衰减分层与层分布；
        确认/拒绝 = 真实用户反馈审计条数；检索耗时 = 真实 recall 审计 <code>detail.latency_ms</code> 的平均值（阶段5-F 接真），
        无样本时显示「—」而非 0ms。{empty ? '当前账本为空，无真实数据。' : ''}
      </div>
      <div className="row" style={{ gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        {items.map(([key, label, val, tid]) => (
          <span key={key} className="panel" style={{ padding: '8px 12px', minWidth: 120 }} data-testid={tid}>
            <div className="dim" style={{ fontSize: 11 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{val}</div>
          </span>
        ))}
      </div>
    </div>
  );
}

const STATE_BADGE: Record<OptimizationItem['state'], { text: string; color: string }> = {
  triggered: { text: '已触发', color: 'var(--danger,#ff5d5d)' },
  running: { text: '执行中', color: 'var(--warn,#ffb84d)' },
  idle: { text: '待命', color: 'var(--muted,#a9b6c4)' },
};

export function OptimizationList({ opts }: { opts: OptimizationItem[] }) {
  return (
    <div className="card" data-testid="opt-list">
      <b>五项自动优化（7.2）</b>
      <div className="note">各带触发条件 + 状态徽标；全部写审计（R2/G6），⑤ 权重回归记 weight_tuned。</div>
      <table className="ltable" data-testid="opt-rows">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>项</th>
            <th style={{ textAlign: 'left' }}>触发条件</th>
            <th style={{ textAlign: 'left' }}>动作</th>
            <th>审计</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {opts.map((o) => (
            <tr key={o.key} data-testid={`opt-${o.key}`}>
              <td style={{ textAlign: 'left' }}>{o.title}</td>
              <td style={{ textAlign: 'left' }}>{o.condition}</td>
              <td style={{ textAlign: 'left' }}><code>{o.action}</code></td>
              <td style={{ textAlign: 'center' }}>{o.auditName}</td>
              <td style={{ textAlign: 'center' }}>
                <span
                  data-testid={`opt-state-${o.key}`}
                  style={{ color: STATE_BADGE[o.state].color, fontWeight: 700 }}
                >
                  {STATE_BADGE[o.state].text}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 批次48 A23.3：回归四态文案（四者必须可区分，绝不合并成「无变化」） */
export function regressionStatusText(r: RegressionOutcome): string {
  if (r.kind === 'never_run') return '未到运行时间：每周日 03:00（账本暂无回归记录）';
  if (r.kind === 'insufficient_samples') {
    const c = r.counts;
    return c
      ? `样本不足：累计 ${c.total} 条（负例 ${c.negatives} 条，窗口 ${c.window_days} 天）· 正在积累样本，非故障`
      : '样本不足：继续积累样本，非故障';
  }
  const metricsText = r.before && r.after
    ? `测试集 F1 ${r.before.f1} → ${r.after.f1}，precision ${r.before.precision} → ${r.after.precision}`
    : '指标缺失';
  if (r.kind === 'not_adopted') {
    return `已评估未达门槛（${r.reason ?? '未给出原因'}）· ${metricsText} · 未采纳，配置未改动`;
  }
  return `已采纳：${metricsText} · 权重/阈值已写入 growth:v1 账本`;
}

const REGRESSION_VERDICT: Record<RegressionRecord['kind'], { text: string; cls: string }> = {
  insufficient_samples: { text: '样本不足', cls: '' },
  not_adopted: { text: '未采纳', cls: 'warn' },
  adopted: { text: '已采纳', cls: 'ok' },
};

const REASON_TEXT: Record<string, string> = {
  f1_gain_below_threshold: '测试集 F1 提升未达 ≥0.02',
  precision_drop_over_threshold: '精确率下降 > 0.05',
  test_split_degenerate: '测试集切分退化（全正/全负或样本不足 10）',
  invalid_proposal: '候选权重/阈值不合法，已回滚',
};

function signed(v: number, digits = 3): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
}

/** 回归评估表：每次真实回归一行；字段缺失显示「未记录」，不编造结论 */
export function RegressionTable({ records }: { records: RegressionRecord[] }) {
  return (
    <div className="card" data-testid="regression-table">
      <b>回归评估（7.3 · 真实账本逐条）</b>
      <div className="note">
        每行对应一条真实回归审计（insufficient_samples / weight_regression / weight_tuned）。
        仅「已采纳」会把新权重/阈值写入 growth:v1；其余一律未改动配置。
      </div>
      {records.length === 0 ? (
        <div className="p0-empty dashed" data-testid="regression-empty">
          账本暂无回归记录 —— 未到运行时间（每周日 03:00），可在下方「手动触发」跑一次真实回归。
        </div>
      ) : (
        <table className="ltable" data-testid="regression-rows">
          <thead>
            <tr>
              <th>批次（request_id）</th>
              <th>触发时间</th>
              <th>样本</th>
              <th>基线 F1</th>
              <th>新 F1</th>
              <th>精确率 Δ</th>
              <th>结论</th>
              <th>裁决</th>
              <th>配置生效</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const verdict = REGRESSION_VERDICT[r.kind];
              const gain = r.before && r.after ? r.after.f1 - r.before.f1 : null;
              const precDelta = r.before && r.after ? r.after.precision - r.before.precision : null;
              const conclusion = r.kind === 'insufficient_samples'
                ? `累计 ${r.counts?.total ?? '未记录'} / 40 · 负例 ${r.counts?.negatives ?? '未记录'} / 10`
                : r.kind === 'not_adopted'
                  ? (REASON_TEXT[r.reason ?? ''] ?? (r.reason ?? '未给出原因'))
                  : `测试集 F1 ${signed(gain ?? 0)} · 精确率 Δ ${signed(precDelta ?? 0)}`;
              return (
                <tr key={`${r.requestId}-${r.ts}`} data-testid={`regression-row-${r.requestId}`}>
                  <td className="mono" title={r.requestId}>{r.requestId}</td>
                  <td>{fmtTime(r.ts)}</td>
                  <td>{r.counts ? `${r.counts.total}（正 ${r.counts.positives} / 负 ${r.counts.negatives}）` : '未记录'}</td>
                  <td>{r.before ? r.before.f1.toFixed(3) : '未取数'}</td>
                  <td>{r.after ? r.after.f1.toFixed(3) : '未取数'}</td>
                  <td>{precDelta === null ? '未取数' : signed(precDelta)}</td>
                  <td>{conclusion}</td>
                  <td>
                    <span className={`p0-tag ${verdict.cls}${verdict.cls ? '' : ''}`} data-testid={`regression-verdict-${r.requestId}`}>
                      {verdict.text}
                    </span>
                  </td>
                  <td>{r.applied ? 'growth:v1 已改' : '未修改'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface SuggestionAuditView {
  from: RecallWeights;
  to: RecallWeights;
  reason: string;
  windowDays?: number;
  recalls?: number;
  thin?: number;
  thinRatio?: number;
}

/**
 * 把一条「召回权重建议」审计的 payload 还原成人话；解析不出结构就返回 null，
 * 调用方退回「事件名 + 原始字段」的兜底渲染（绝不因为格式变化而显示空白）。
 */
function suggestionAuditOf(payload: string): SuggestionAuditView | null {
  let raw: unknown;
  try { raw = JSON.parse(payload); } catch { return null; }
  const o = raw as {
    suggestion?: { from?: unknown; to?: unknown; reason?: unknown };
    metrics?: Record<string, unknown>;
  } | null;
  const s = o?.suggestion;
  // 四维必须都是数字，否则 weightChangeRows 的 toFixed 会抛错把整张卡带崩 ——
  // 结构不全就如实退回兜底渲染，不猜、不补默认值。
  const isWeights = (w: unknown): w is RecallWeights =>
    !!w && typeof w === 'object'
    && RECALL_KEYS.every((k) => typeof (w as Record<string, unknown>)[k] === 'number');
  const from = s?.from;
  const to = s?.to;
  if (!isWeights(from) || !isWeights(to)) return null;
  const m = o?.metrics ?? {};
  const num = (v: unknown): number | undefined =>
    (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    from,
    to,
    reason: typeof s?.reason === 'string' ? s.reason : '',
    windowDays: num(m.window_days),
    recalls: num(m.recalls),
    thin: num(m.evidence_thin),
    thinRatio: num(m.evidence_thin_ratio),
  };
}

/** 真的变了的维度 → 人话；没变的单独列，避免用户以为「全都改了」 */
function weightChangeRows(
  from: RecallWeights, to: RecallWeights,
): { changed: string[]; unchanged: string[] } {
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const k of RECALL_KEYS) {
    const d = to[k] - from[k];
    if (Math.abs(d) < 1e-9) { unchanged.push(RECALL_KEY_LABEL[k]); continue; }
    changed.push(`${RECALL_KEY_LABEL[k]} ${from[k].toFixed(2)} → ${to[k].toFixed(2)}（${d > 0 ? '+' : ''}${d.toFixed(2)}）`);
  }
  return { changed, unchanged };
}

/**
 * 把建议审计翻成一句人话（2026-11-14 用户诉求：红框里那坨 JSON 看不懂）。
 * 纪律：只翻译**账本真写过**的字段，缺的写「未记录」，不猜、不补零、不美化。
 */
function suggestionText(v: SuggestionAuditView, event: string): string {
  const head = event.includes('suggest')
    ? '召回权重建议（仅建议，未改动配置）：'
    : '召回权重变更：';
  const scope = v.windowDays !== undefined ? `最近 ${v.windowDays} 天` : '评估窗口未记进审计';
  const recalls = v.recalls !== undefined ? `${v.recalls} 次召回` : '召回次数未记进审计';
  const thin = v.thin !== undefined && v.thinRatio !== undefined
    ? `里有 ${v.thin} 次（${(v.thinRatio * 100).toFixed(1)}%）证据不足`
    : '的证据不足比例未记进审计';
  const { changed, unchanged } = weightChangeRows(v.from, v.to);
  const body = changed.length > 0 ? changed.join('、') : '四个维度权重都没变';
  const keep = unchanged.length > 0 ? `；${unchanged.join('、')}不变` : '';
  return `${head}${scope} ${recalls}${thin} → ${body}${keep}。`;
}

/**
 * 账本事件名 → 人话（2026-11-14 用户硬性要求：整页人话，不出现英文事件名/原始 JSON）。
 * 词表没有的事件如实写「未登记的审计事件」，绝不把原名当正文糊上去。
 */
const GROWTH_EVENT_LABEL: Record<string, string> = {
  recall_weight_suggested: '召回权重建议',
  recall_weight_no_suggestion: '召回权重无需调整',
  recall_weight_applied: '召回权重已采纳',
  feedback_policy_changed: '反馈策略已更新',
  schedule_changed: '调度开关已更新',
  evolution_settings_changed: '进化设置已保存',
  weight_tuned: '权重调优已采纳',
  keyword_refined: '关键词提取已精炼',
  阈值变更: '判重阈值已变更',
  衰减变更: '遗忘衰减已变更',
  索引构建: '预索引已构建',
};

export function DeltaPanel({
  series, delta, deltaMetric, currentHitRate, audit, onManualTrigger, regression, receipt,
}: {
  series: DeltaPoint[];
  delta: number;
  /** Δ 口径来源：决定副标题文案与用户如何解读这个数字；`none` = 没有基线（不存在改善量） */
  deltaMetric?: DeltaMetric;
  /** 无基线时用来说明「这是现状、不是改善量」的真实命中率（原样展示，不美化） */
  currentHitRate?: number;
  audit: GrowthAuditEntry[];
  onManualTrigger: () => void;
  /** 真实回归最近一次结果（四态；无记录 = 未到运行时间） */
  regression: RegressionOutcome;
  /** 手动触发的真实审计回执（request_id / action / 账本累计条数） */
  receipt: GrowthReceipt | null;
}) {
  // M0-3：方向判定（带浮点噪声阈值，避免 -0.0001 误判为「变差」）。
  // 语义：ok/danger 表达「效果好/坏」，不套股市红涨绿跌。
  // 2026-11-14：新增 none = 无基线（从未调过参数）——此时 Δ 不存在，不得把当前值当改善量。
  type DeltaDir = 'good' | 'bad' | 'flat' | 'none';
  const noBaseline = deltaMetric === 'none';
  const dirOf = (v: number): DeltaDir =>
    v > 0.0005 ? 'good' : v < -0.0005 ? 'bad' : 'flat';
  const colorOf = (dir: DeltaDir): string =>
    dir === 'good' ? 'var(--ok,#5dd39e)'
      : dir === 'bad' ? 'var(--danger,#ff5d5d)'
      : 'var(--muted,#a9b6c4)';
  const deltaDir: DeltaDir = noBaseline ? 'none' : dirOf(delta);
  const metricLabel = noBaseline
    ? (typeof currentHitRate === 'number' && Number.isFinite(currentHitRate)
      ? `当前命中率 ${(currentHitRate * 100).toFixed(1)}% 是现状，不是改善量`
      : '还没有可比的基线，不显示改善量')
    : deltaMetric === 'f1_gain'
      ? '测试集 F1 提升（判重回归采纳，同一确定性划分 + 同一 30 天窗）'
      : '调权重前后命中率差（手动 / 历史优化）';
  const verdictLabel = noBaseline
    ? '无对比基线：还没有过一次真实调参（weight_tuned），谈不上改善'
    : deltaDir === 'good' ? '本次自生长改善了效果'
      : deltaDir === 'bad' ? '本次自生长使效果变差'
        : '本次前后效果持平';
  // 无基线 → 不印数字（印任何数字都会被读成"改善量"）
  const deltaText = noBaseline
    ? 'Δ 无基线'
    : `Δ ${delta > 0 ? '+' : delta < 0 ? '-' : ''}${Math.abs(delta).toFixed(3)}`;
  const max = Math.max(0.06, ...series.map((p) => Math.abs(p.delta)));
  const W = 560, H = 120, PAD = 28;
  const step = (W - PAD * 2) / Math.max(1, series.length - 1);
  const pts = series.map((p, i) => `${PAD + i * step},${H - PAD - (p.delta / max) * (H - PAD * 1.6)}`);
  return (
    <div className="card" data-testid="delta-panel">
      <b>自生长收益（7.2 · 联动效果看板 KPI9 · 真实账本）</b>
      <div className="note">
        Δ 取自真实 7 日反馈（7.1）；weight_tuned 触发点 = 每周日 03:00（13.3）。
        曲线数据 = 真实 weight_tuned 审计事件（回归采纳 + 历史 growth_op）按日聚合，无记录则显示空态（不伪造数值）。
      </div>
      <div className="row" style={{ alignItems: 'baseline', gap: 16, marginTop: 8 }}>
        <span
          data-testid="delta-value" data-dir={deltaDir}
          style={{ fontSize: 26, fontWeight: 800, color: colorOf(deltaDir) }}
        >
          {deltaText}
        </span>
        {/* 文字 + 颜色双编码：方向不仅靠颜色，还用明确结论文字，色盲可辨 */}
        <span data-testid="delta-verdict" data-dir={deltaDir} style={{ color: colorOf(deltaDir), fontWeight: 600 }}>
          {verdictLabel}
        </span>
        <span className="dim">{metricLabel}</span>
        <button className="btn" data-testid="manual-trigger" onClick={onManualTrigger}>⚡ 手动触发一次自生长</button>
      </div>
      {series.length === 0 ? (
        <div data-testid="delta-empty" className="note" style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>
          暂无真实自生长调参记录（weight_tuned）。点击「手动触发」会产生第一条真实记录，或等待每周日 03:00 调度。
        </div>
      ) : (
        <svg data-testid="delta-chart" width="100%" viewBox={`0 0 ${W} ${H}`} style={{ marginTop: 8, maxWidth: W }}>
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border,#2a3442)" />
          <polyline points={pts.join(' ')} fill="none" stroke="var(--accent,#4f8cff)" strokeWidth="2" />
          {series.map((p, i) => (
            <g key={`${p.day}-${i}`}>
              <circle
                cx={PAD + i * step} cy={H - PAD - (p.delta / max) * (H - PAD * 1.6)}
                r={p.is_tuned ? 5 : 3}
                fill={colorOf(dirOf(p.delta))}
                data-testid={p.is_tuned ? 'tuned-point' : undefined}
              />
              <text x={PAD + i * step} y={H - 8} fontSize="10" fill="var(--muted,#a9b6c4)" textAnchor="middle">{p.day}</text>
            </g>
          ))}
        </svg>
      )}
      <div className="note">
        大点 = weight_tuned 触发点（周日 03:00）· 颜色：<span style={{ color: 'var(--ok,#5dd39e)' }}>绿=变好</span> /
        <span style={{ color: 'var(--danger,#ff5d5d)' }}>红=变坏</span> /
        <span style={{ color: 'var(--muted,#a9b6c4)' }}>灰=持平</span> · 真实账本审计：{audit.length} 条（R2）
      </div>
      <div className="note" data-testid="regression-status" style={{ marginTop: 4 }}>
        自生长回归状态：{regressionStatusText(regression)}
      </div>
      {receipt && (
        <div className="note" data-testid="manual-receipt" style={{ marginTop: 4 }}>
          审计回执：request_id=<span className="mono">{receipt.requestId}</span> · action=<b>{receipt.action}</b>
          {' '}· 账本累计 {receipt.total} 条 · {fmtTime(receipt.at)}
        </div>
      )}
      {audit.length > 0 && (
        <div className="note" data-testid="growth-audit" style={{ marginTop: 6 }}>
          <div className="dim" style={{ marginBottom: 2 }}>
            账本最近 {Math.min(3, audit.length)} 条（人话版）
          </div>
          {audit.slice(0, 3).map((a, i) => {
            const view = suggestionAuditOf(a.payload);
            const label = GROWTH_EVENT_LABEL[a.event];
            return (
              <div key={`${a.event}-${a.at}-${i}`} data-testid="audit-entry" style={{ marginTop: 4 }}>
                <div data-testid="audit-human">
                  {view
                    ? suggestionText(view, a.event)
                    : `${label ?? '未登记的审计事件'}：这条审计没有可翻译的明细，只记录发生时间。`}
                </div>
                {/* 只留人读得懂的元信息：审计 ID + 时间。原始 payload 与英文事件名一律不上屏 */}
                <div className="dim" data-testid="audit-meta" style={{ fontSize: 11 }}>
                  审计 ID {a.requestId ?? '账本未带'} · {fmtTime(a.at)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * M0-4：自生长效果结论卡 + 参数差异表（用户要能感知「好了还是坏了」）。
 * 结论卡四态（M0 阶段判重回归不会「恶化」——adopted 必然 F1 提升≥0.02）：
 *   改善 / 已评估未达门槛未改动 / 样本积累中 / 未到运行时间。
 * 参数差异表：五维权重 + 六层阈值 前→后对照，未变项也列出并标注原因（llm_judge 固定保留）。
 */
const DIM_LABEL: Record<DimKey, string> = {
  semantic: '语义', keyword: '关键词', entity: '实体', structure: '结构', llm_judge: 'LLM 裁决',
};

export function EvolutionEffectCard({ records }: { records: RegressionRecord[] }) {
  // regressionRecordsFromLedger 已按 ts 倒序；最新一条决定结论卡主态
  const latest = records[0];
  const adopted = records.find((r) => r.kind === 'adopted' && r.weightsBefore && r.weightsAfter);

  // M0 阶段判重回归不会「恶化」（adopted 门槛保证 F1 提升）；恶化判定在 M2/M3 召回权重回滚时启用。
  let verdictDir: 'good' | 'flat' | 'empty';
  let verdictText: string;
  let verdictSub: string;
  if (!latest) {
    verdictDir = 'empty';
    verdictText = '未到运行时间（每周日 03:00）或账本暂无回归记录';
    verdictSub = '可在下方「手动触发」跑一次真实回归；无记录不编造效果。';
  } else if (latest.kind === 'insufficient_samples') {
    const total = latest.counts?.total ?? 0;
    const neg = latest.counts?.negatives ?? 0;
    verdictDir = 'empty';
    verdictText = `样本积累中：累计 ${total}/40 · 负例 ${neg}/10（未达门槛，非故障）`;
    verdictSub = '判重回归需要 ≥40 条样本且负例 ≥10 才能评估，继续积累即可。';
  } else if (latest.kind === 'not_adopted') {
    verdictDir = 'flat';
    verdictText = `已评估但未达采纳门槛（${REASON_TEXT[latest.reason ?? ''] ?? latest.reason ?? '未给出原因'}），未改动任何配置`;
    verdictSub = '本轮评估认为改动不会让判重更准，账本保持原配置。';
  } else if (adopted && adopted.before && adopted.after) {
    const gain = adopted.after.f1 - adopted.before.f1;
    verdictDir = 'good';
    verdictText = `本次自生长改善了判重：测试集 F1 ${signed(gain)}（同一确定性划分 + 同一 30 天窗）`;
    verdictSub = `基线 F1 ${adopted.before.f1.toFixed(3)} → 新 F1 ${adopted.after.f1.toFixed(3)}。`;
  } else {
    verdictDir = 'flat';
    verdictText = '最近一次为已采纳记录，但审计未携带参数前后对照（历史记录）';
    verdictSub = '新版本已落参数前后对照，后续采纳可见详细差异。';
  }

  const vColor = verdictDir === 'good' ? 'var(--ok,#5dd39e)'
    : verdictDir === 'flat' ? 'var(--accent,#4f8cff)'
    : 'var(--muted,#a9b6c4)';

  const bw = adopted?.weightsBefore;
  const aw = adopted?.weightsAfter;
  const tb = adopted?.thresholdsBefore;
  const ta = adopted?.thresholdsAfter;
  const dimRows = bw && aw ? (Object.keys(bw) as DimKey[]).map((k) => {
    const before = bw[k];
    const after = aw[k];
    const delta = after - before;
    return { k, before, after, delta, fixed: k === 'llm_judge', changed: Math.abs(delta) > 1e-9 };
  }) : [];
  const layerRows = tb && ta ? (Object.keys(tb) as Layer[]).map((l) => {
    const before = tb[l];
    const after = ta[l];
    const delta = after - before;
    return { l, before, after, delta, changed: Math.abs(delta) > 1e-9 };
  }) : [];

  return (
    <div className="card" data-testid="evolution-effect-card">
      <b>自生长效果结论（M0 · 真实账本）</b>
      <div
        data-testid="evolution-verdict" data-dir={verdictDir}
        style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, border: `1px solid ${vColor}`, color: vColor, fontWeight: 600 }}
      >
        {verdictText}
        <div className="note" style={{ color: vColor, fontWeight: 400, marginTop: 4 }}>{verdictSub}</div>
      </div>

      {adopted && bw && aw ? (
        <>
          <div className="note" style={{ marginTop: 10 }}>
            参数差异表（{fmtTime(adopted.ts)} 采纳）：未变化项也列出，便于判断「改了什么、值不值」。
          </div>
          <table className="ltable" data-testid="param-diff-table" style={{ marginTop: 6 }}>
            <thead>
              <tr><th>五维判重权重</th><th>进化前</th><th>进化后</th><th>Δ</th><th>状态</th></tr>
            </thead>
            <tbody>
              {dimRows.map((r) => (
                <tr key={r.k} data-testid={`dim-row-${r.k}`}>
                  <td>{DIM_LABEL[r.k]}<span className="mono">（{r.k}）</span></td>
                  <td>{r.before.toFixed(2)}</td>
                  <td>{r.after.toFixed(2)}</td>
                  <td style={{ color: r.changed ? 'var(--accent,#4f8cff)' : 'var(--muted,#a9b6c4)' }}>{signed(r.delta, 2)}</td>
                  <td data-testid={`dim-status-${r.k}`}>
                    {r.fixed ? '固定保留（不参与调优）' : r.changed ? '已调整' : '未变化'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="ltable" data-testid="threshold-diff-table" style={{ marginTop: 8 }}>
            <thead>
              <tr><th>六层判重阈值</th><th>进化前</th><th>进化后</th><th>Δ</th><th>状态</th></tr>
            </thead>
            <tbody>
              {layerRows.map((r) => (
                <tr key={r.l} data-testid={`layer-row-${r.l}`}>
                  <td>{r.l}</td>
                  <td>{r.before.toFixed(2)}</td>
                  <td>{r.after.toFixed(2)}</td>
                  <td style={{ color: r.changed ? 'var(--accent,#4f8cff)' : 'var(--muted,#a9b6c4)' }}>{signed(r.delta, 2)}</td>
                  <td data-testid={`layer-status-${r.l}`}>{r.changed ? '已调整' : '未变化'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note" style={{ marginTop: 6 }}>
            回滚：M0 阶段版本化未上线，恶化时将在回滚功能上线后可一键回滚（不做假按钮）。
          </div>
        </>
      ) : (
        <div className="note" data-testid="param-diff-empty" style={{ marginTop: 8 }}>
          尚无已采纳且携带参数前后对照的记录 —— 未到运行时间或样本不足，参数差异表暂不展示。
        </div>
      )}
    </div>
  );
}

const HOST_LABEL: Record<'native' | 'bridge' | 'none', string> = {
  native: '主进程（Electron）',
  bridge: '主进程（Electron，宿主桥）',
  none: '不可用（Web 端不执行调度）',
};

/** 批次48 A23.4：调度架构说明（Web 端只能说明「调度由桌面端执行」，绝不呈现「已调度」） */
function scheduleArchText(hostKind: 'native' | 'bridge' | 'none'): string {
  if (hostKind === 'none') {
    return '调度由桌面端执行：周期任务由 Electron 主进程单 tick 引擎运行；'
      + '当前是 Web/浏览器环境 —— 本页不执行调度、不设置定时器，只读展示配置与账本运行记录。';
  }
  return '调度由桌面端执行：周期任务由 Electron 主进程单 tick 引擎运行；'
    + '本页只读展示其账本运行记录，不自行调度。';
}

/** 调度宿主：优先取审计里真实的 host 字段，无记录时按当前端能力如实标注 */
function hostText(hostKind: 'native' | 'bridge' | 'none', run?: ScheduleRunInfo | null): string {
  if (run?.host === 'electron-main') return '主进程（Electron）';
  return HOST_LABEL[hostKind];
}

const RUN_STATUS_LABEL: Record<ScheduleRunInfo['status'], string> = {
  ok: '成功', skipped: '跳过', error: '失败',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地时间展示（与调度审计 next_due_at 同一时间基准，不做时区转换） */
function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 跳过/失败原因：错误文本优先，其次 result.reason / result.skipped_reason（都来自真实审计） */
function runReason(run: ScheduleRunInfo): string {
  if (run.error) return run.error;
  const r = run.result;
  if (typeof r?.reason === 'string') return r.reason;
  if (typeof r?.skipped_reason === 'string') return r.skipped_reason;
  return '';
}

export function ScheduleTimeline({
  schedule, onToggle, hostKind,
}: {
  schedule: ScheduleItem[];
  onToggle: (key: ScheduleItem['key']) => void;
  /** 当前端实际可用的调度宿主（native/bridge = 桌面主进程；none = 浏览器降级） */
  hostKind: 'native' | 'bridge' | 'none';
}) {
  return (
    <div className="card" data-testid="schedule-timeline">
      <b>调度时间轴（13.3，只读时刻 + 可启停）</b>
      <div className="note" data-testid="sched-arch">{scheduleArchText(hostKind)}</div>
      <div className="note">
        R5：调度时刻可配但不可全部停用 —— 至少保留每日 02:00 衰减。启停只改配置（growth:v1），
        实际执行只由桌面端主进程完成。运行记录来自内核真实审计 action=schedule_run；无记录即「尚未运行」，不从 cron 反推。
      </div>
      <div className="row" style={{ gap: 18, marginTop: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {schedule.map((s) => (
          <div key={s.key} data-testid={`sched-${s.key}`} style={{ minWidth: 280 }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                data-testid={`sched-check-${s.key}`}
                checked={s.enabled}
                disabled={s.required}
                onChange={() => onToggle(s.key)}
              />
              <span>{s.cron} · {s.label}{s.required ? '（不可停）' : ''}</span>
            </label>
            <div className="note" data-testid={`sched-run-${s.key}`} style={{ marginLeft: 22, marginTop: 2 }}>
              {s.run
                ? `最近运行（schedule_run 审计）${fmtTime(s.run.ts)} · ${RUN_STATUS_LABEL[s.run.status]}`
                  + (s.run.duration_ms != null ? ` · ${s.run.duration_ms}ms` : '')
                  + (runReason(s.run) ? ` · 原因 ${runReason(s.run)}` : '')
                : '最近运行：尚未运行（账本无 schedule_run 记录）'}
            </div>
            <div className="note" data-testid={`sched-next-${s.key}`} style={{ marginLeft: 22 }}>
              {s.run?.next_due_at
                ? `下次到期：${fmtTime(s.run.next_due_at)}`
                : '下次到期：—（尚未运行，无记录）'}
            </div>
            <div className="note" data-testid={`sched-host-${s.key}`} style={{ marginLeft: 22 }}>
              调度宿主：{hostText(hostKind, s.run)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}



/**
 * 批次61 GAP-3：Agent 侧使用卡（审计实算 · 非实时）。
 * 红线：
 *  · 空审计显示「暂无数据」，不显示 0 制造「已采集」假象（AC C4）；
 *  · verdict 分布只能到项目级 —— memory_op 审计没有 client 字段，界面上必须写明不可拆分；
 *  · 缺 client 的调用以「未标识」原样呈现，不猜成某个 Agent（AC C3）。
 */
export function AgentUsageCard({ usage }: { usage: AgentUsageSummary }) {
  const { totals, agents, verdicts } = usage;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="card" data-testid="agent-usage">
      <b>Agent 侧使用（{usage.window_days} 天窗 · 审计实算 · 非实时）</b>
      <div className="note" data-testid="agent-usage-note">{usage.note}</div>
      {agents.length === 0 ? (
        <div className="note" data-testid="agent-usage-empty">
          暂无数据：窗口内没有任何 recall / mcp_call 审计。此处不显示 0，避免被误读成「已采集但都是 0」。
        </div>
      ) : (
        <table className="ltable" data-testid="agent-usage-rows" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Agent（detail.client / mcp_call.agent）</th>
              <th>召回次数</th>
              <th>省下 tokens</th>
              <th>证据不足</th>
              <th>工具调用</th>
              <th>首调合规</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.client} data-testid={`agent-row-${a.client}`}>
                <td style={{ textAlign: 'left' }}>{a.client}</td>
                <td>{a.recalls}</td>
                <td>{a.saved_tokens}</td>
                <td>{a.evidence_thin}</td>
                <td>{a.calls}</td>
                <td>
                  {a.reliable_first_calls > 0
                    ? `${a.first_call_recall}/${a.reliable_first_calls}`
                    : '无可靠会话'}
                </td>
              </tr>
            ))}
            <tr data-testid="agent-row-total" style={{ fontWeight: 700 }}>
              <td style={{ textAlign: 'left' }}>合计</td>
              <td>{totals.recalls}</td>
              <td>{totals.saved_tokens}</td>
              <td>{totals.evidence_thin}</td>
              <td>{totals.calls}</td>
              <td>
                {totals.first_call_compliance === null
                  ? '无可靠会话'
                  : pct(totals.first_call_compliance)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <div className="note" data-testid="agent-usage-verdicts" style={{ marginTop: 8 }}>
        反馈裁决（项目级，<b>不可按 Agent 拆分</b>：memory_op 审计无 client 字段）：
        确认 {verdicts.confirm} · 拒绝 {verdicts.reject} · 待裁决 {verdicts.disputed}
      </div>
      <div className="note" data-testid="agent-usage-concurrency">{GC_CONCURRENCY_NOTE}</div>
    </div>
  );
}

function fmtWeights(w: RecallWeights): string {
  // 2026-11-14：UI 不出 w_f/w_i 这类字段名（用户要求整页人话），统一走唯一一份中文名映射
  return fmtRecallWeights(w);
}

/**
 * 批次61 GAP-1（补齐「用户确认 → 应用」闭环）：召回权重卡。
 * 红线：
 *  · 自生长只**产建议**（applied:false），此处不自动应用；只有用户点「采纳建议」才写 growth:v1.recall_weights；
 *  · 无建议时显「暂无建议」，不显示 0 冒充「已评估」；
 *  · 当前权重已等于建议值时按钮置灰（幂等，不重复写账本）。
 */
export function RecallWeightCard({
  current, suggestion, onApply,
}: {
  current: RecallWeights;
  suggestion: RecallSuggestionView | null;
  onApply: (to: RecallWeights) => void;
}) {
  const applied = suggestion
    ? RECALL_KEYS.every((k) => Math.abs(current[k] - suggestion.to[k]) < 1e-9)
    : false;
  return (
    <div className="card" data-testid="recall-weight-card">
      <b>召回权重（GAP-1 · 读出自 growth:v1）</b>
      <div className="note">
        决定召回排序的四分量权重；缺省与历史常量一致。自生长只产建议，
        必须点「采纳」才写入账本，不自动改权重。
      </div>
      <div className="note" data-testid="recall-weight-current" style={{ marginTop: 6 }}>
        当前：{fmtWeights(current)}
      </div>
      {suggestion ? (
        <div className="note" data-testid="recall-weight-suggestion" style={{ marginTop: 6 }}>
          <div>
            最新建议（{fmtTime(suggestion.at)} · 窗口内 {suggestion.recalls} 次召回）：
            <b> {fmtWeights(suggestion.from)} → {fmtWeights(suggestion.to)}</b>
          </div>
          <div className="dim">理由：{suggestion.reason || '未给出理由'}</div>
          <button
            className="btn" data-testid="recall-weight-apply"
            disabled={applied}
            onClick={() => onApply(suggestion.to)}
          >
            {applied ? '已采纳（当前 = 建议值）' : '采纳建议（写入 growth:v1）'}
          </button>
        </div>
      ) : (
        <div className="note" data-testid="recall-weight-empty" style={{ marginTop: 6 }}>
          暂无建议：窗口内召回样本不足 30 次，或当前权重已无调整空间。此处不显示 0，避免被误读成「已评估」。
        </div>
      )}
    </div>
  );
}

const POLICY_WINDOW_MIN = 1;
const POLICY_WINDOW_MAX = 365;
const POLICY_THRESHOLD_MIN = 1;
const POLICY_THRESHOLD_MAX = 50;

/**
 * 批次61 GAP-2（补齐「策略 → 启用」闭环 + signal_summary 可观测）：反馈闭环卡。
 * 红线：
 *  · 缺省关闭（与改造前逐字一致）；开启后窗口内累计 reject 达阈才降档（hot→warm→cold，不推 dormant）；
 *  · 保存才写 growth:v1.feedback_policy，未改动时按钮置灰；
 *  · 无 signal_summary 审计时显「暂无数据」，不显示 0 冒充「没有反馈」。
 */
export function FeedbackLoopCard({
  policy, signal, onSave,
}: {
  policy: FeedbackPolicy;
  signal: FeedbackSignalView | null;
  onSave: (next: FeedbackPolicy) => void;
}) {
  const [draft, setDraft] = useState<FeedbackPolicy>(policy);
  // 保存后重载 → 外部策略变化，草稿跟随（避免页面状态与账本分叉）
  useEffect(() => { setDraft(policy); }, [policy]);

  const dirty = draft.enabled !== policy.enabled
    || draft.window_days !== policy.window_days
    || draft.reject_downgrade_threshold !== policy.reject_downgrade_threshold;
  const valid = Number.isInteger(draft.window_days)
    && draft.window_days >= POLICY_WINDOW_MIN && draft.window_days <= POLICY_WINDOW_MAX
    && Number.isInteger(draft.reject_downgrade_threshold)
    && draft.reject_downgrade_threshold >= POLICY_THRESHOLD_MIN
    && draft.reject_downgrade_threshold <= POLICY_THRESHOLD_MAX;

  return (
    <div className="card" data-testid="feedback-loop-card">
      <b>反馈闭环（GAP-2 · reject 累计 → 降档）</b>
      <div className="note">
        默认关闭 = 只改 confidence，与改造前逐字一致。开启后窗口内累计 reject 达阈才降档
        （hot→warm→cold，不推 dormant）。策略写入 growth:v1.feedback_policy。
      </div>
      <div className="row" style={{ gap: 16, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 13 }}>
          <input
            type="checkbox" data-testid="feedback-enabled"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          /> 启用 reject 降档
        </label>
        <label style={{ fontSize: 13 }}>
          窗口
          <input
            type="number" min={POLICY_WINDOW_MIN} max={POLICY_WINDOW_MAX} data-testid="feedback-window"
            value={draft.window_days} style={{ width: 64 }}
            onChange={(e) => setDraft({ ...draft, window_days: Number(e.target.value) })}
          /> 天
        </label>
        <label style={{ fontSize: 13 }}>
          阈值
          <input
            type="number" min={POLICY_THRESHOLD_MIN} max={POLICY_THRESHOLD_MAX} data-testid="feedback-threshold"
            value={draft.reject_downgrade_threshold} style={{ width: 64 }}
            onChange={(e) => setDraft({ ...draft, reject_downgrade_threshold: Number(e.target.value) })}
          /> 次
        </label>
        <button
          className="btn" data-testid="feedback-save"
          disabled={!dirty || !valid}
          onClick={() => onSave(draft)}
        >保存策略</button>
        {!valid && (
          <span className="status deprecated" data-testid="feedback-invalid">
            窗口需 1–365 天 · 阈值需 1–50 次
          </span>
        )}
      </div>
      <div className="note" data-testid="feedback-policy-state" style={{ marginTop: 6 }}>
        当前策略：{policy.enabled ? '已启用' : '未启用（默认，行为与改造前一致）'} ·
        窗口 {policy.window_days} 天 · 阈值 {policy.reject_downgrade_threshold} 次
      </div>
      <div className="note" data-testid="feedback-signal" style={{ marginTop: 8 }}>
        {signal ? (
          <>
            <b>最近一次净化周期信号（{fmtTime(signal.at)} · 窗口 {signal.window_days} 天）：</b>{' '}
            召回 {signal.recalls} 次 · 证据不足 {signal.evidence_thin} 次 ·
            裁决 确认 {signal.verdicts.confirm} / 拒绝 {signal.verdicts.reject} / 待裁决 {signal.verdicts.disputed} ·
            拒绝占比 {Math.round(signal.reject_ratio * 100)}% · 被拒记忆 {signal.rejected_mem_ids} 条
          </>
        ) : (
          <span data-testid="feedback-signal-empty">
            暂无数据：账本还没有带 signal_summary 的净化周期审计（runForgettingCycle 尚未跑过）。
          </span>
        )}
      </div>
    </div>
  );
}
