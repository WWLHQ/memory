// P14-T3 自生长侧组件：指标卡 + 五项优化 + Δ 收益曲线 + 调度时间轴（7.1/7.2/13.3）
import type {
  DeltaPoint, GrowthAuditEntry, GrowthMetrics, OptimizationItem, RegressionOutcome,
  ScheduleItem, ScheduleRunInfo,
} from './types.ts';

export function GrowthCards({ m, empty }: { m: GrowthMetrics; empty?: boolean }) {
  const items: Array<[string, string, string, string]> = [
    ['hit_rate', '检索命中率', m.hit_rate ? m.hit_rate.toFixed(2) : '—', 'm-hit-rate'],
    ['confirmed', '确认数（+0.1）', String(m.confirmed), 'm-confirmed'],
    ['rejected', '拒绝数（−0.05）', String(m.rejected), 'm-rejected'],
    ['low_quality', '低质占比（cold/dormant/archived）', m.low_quality_ratio.toFixed(2), 'm-lowq'],
    ['level_L6', 'L6 层命中', m.level_stats_L6.toFixed(2), 'm-l6'],
    ['latency', '检索耗时', m.latency_samples > 0 ? `${Math.round(m.latency_ms)}ms` : '—', 'm-latency'],
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

export function DeltaPanel({
  series, delta, audit, onManualTrigger, regression,
}: {
  series: DeltaPoint[];
  delta: number;
  audit: GrowthAuditEntry[];
  onManualTrigger: () => void;
  /** 真实回归最近一次结果（四态；无记录 = 未到运行时间） */
  regression: RegressionOutcome;
}) {
  const max = Math.max(0.06, ...series.map((p) => Math.abs(p.delta)));
  const W = 560, H = 120, PAD = 28;
  const step = (W - PAD * 2) / Math.max(1, series.length - 1);
  const pts = series.map((p, i) => `${PAD + i * step},${H - PAD - (p.delta / max) * (H - PAD * 1.6)}`);
  return (
    <div className="card" data-testid="delta-panel">
      <b>自生长收益（7.2 · 联动效果看板 KPI9 · 真实账本）</b>
      <div className="note">
        Δ 取自真实 7 日反馈（7.1）；weight_tuned 触发点 = 每周日 03:00（13.3）。
        曲线数据 = 真实 weight_tuned / growth_op 审计事件按日聚合，无记录则显示空态（不伪造数值）。
      </div>
      <div className="row" style={{ alignItems: 'baseline', gap: 16, marginTop: 8 }}>
        <span data-testid="delta-value" style={{ fontSize: 26, fontWeight: 800, color: 'var(--ok,#5dd39e)' }}>
          Δ +{delta.toFixed(3)}
        </span>
        <span className="dim">调权重后命中率 − 调权重前命中率（真实反馈差值）</span>
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
                fill={p.is_tuned ? 'var(--danger,#ff5d5d)' : 'var(--accent,#4f8cff)'}
                data-testid={p.is_tuned ? 'tuned-point' : undefined}
              />
              <text x={PAD + i * step} y={H - 8} fontSize="10" fill="var(--muted,#a9b6c4)" textAnchor="middle">{p.day}</text>
            </g>
          ))}
        </svg>
      )}
      <div className="note">🔴 = weight_tuned 触发点 · 真实账本审计：{audit.length} 条（R2）</div>
      <div className="note" data-testid="regression-status" style={{ marginTop: 4 }}>
        自生长回归状态：{regressionStatusText(regression)}
      </div>
      {audit.length > 0 && (
        <div className="note" data-testid="growth-audit" style={{ marginTop: 6 }}>
          {audit.slice(0, 3).map((a, i) => (
            <div key={i}>· <b>{a.event}</b> {a.action} {a.payload}</div>
          ))}
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


