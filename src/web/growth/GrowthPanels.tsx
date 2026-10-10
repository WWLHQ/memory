// P14-T3 自生长侧组件：指标卡 + 五项优化 + Δ 收益曲线 + 调度时间轴（7.1/7.2/13.3）
import type { DeltaPoint, GrowthAuditEntry, GrowthMetrics, OptimizationItem, ScheduleItem } from './types.ts';

export function GrowthCards({ m }: { m: GrowthMetrics }) {
  const items: Array<[string, string, string, string]> = [
    ['hit_rate', '检索命中率', m.hit_rate.toFixed(2), 'm-hit-rate'],
    ['confirmed', '确认数（+0.1）', String(m.confirmed), 'm-confirmed'],
    ['rejected', '拒绝数（−0.05）', String(m.rejected), 'm-rejected'],
    ['low_quality', '低质占比', m.low_quality_ratio.toFixed(2), 'm-lowq'],
    ['level_L6', 'L6 层命中', m.level_stats_L6.toFixed(2), 'm-l6'],
    ['latency', '检索耗时', `${m.latency_ms}ms`, 'm-latency'],
  ];
  return (
    <div className="card" data-testid="growth-cards">
      <b>反馈指标（7.1，只读）</b>
      <div className="note">每次检索自动记录，本页不可手改 —— 自生长收益 Δ 与五项优化的数据源。</div>
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

export function DeltaPanel({
  series, delta, audit, onManualTrigger,
}: {
  series: DeltaPoint[];
  delta: number;
  audit: GrowthAuditEntry[];
  onManualTrigger: () => void;
}) {
  const max = Math.max(0.06, ...series.map((p) => Math.abs(p.delta)));
  const W = 560, H = 120, PAD = 28;
  const step = (W - PAD * 2) / Math.max(1, series.length - 1);
  const pts = series.map((p, i) => `${PAD + i * step},${H - PAD - (p.delta / max) * (H - PAD * 1.6)}`);
  return (
    <div className="card" data-testid="delta-panel">
      <b>自生长收益（7.2 · 联动效果看板 KPI9）</b>
      <div className="note">R3：Δ 取自真实 7 日反馈（7.1），不可手工填写；weight_tuned 触发点 = 每周日 03:00（13.3）。</div>
      <div className="row" style={{ alignItems: 'baseline', gap: 16, marginTop: 8 }}>
        <span data-testid="delta-value" style={{ fontSize: 26, fontWeight: 800, color: 'var(--ok,#5dd39e)' }}>
          Δ +{delta.toFixed(3)}
        </span>
        <span className="dim">调权重后命中率 − 调权重前命中率</span>
        <button className="btn" data-testid="manual-trigger" onClick={onManualTrigger}>⚡ 手动触发一次自生长</button>
      </div>
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
      <div className="note">🔴 = weight_tuned 触发点 · 本会话审计：{audit.length} 条（R2）</div>
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

export function ScheduleTimeline({
  schedule, onToggle,
}: {
  schedule: ScheduleItem[];
  onToggle: (key: ScheduleItem['key']) => void;
}) {
  return (
    <div className="card" data-testid="schedule-timeline">
      <b>调度时间轴（13.3，只读时刻 + 可启停）</b>
      <div className="note">R5：调度时刻可配但不可全部停用 —— 至少保留每日 02:00 衰减。</div>
      <div className="row" style={{ gap: 18, marginTop: 8, flexWrap: 'wrap' }}>
        {schedule.map((s) => (
          <label key={s.key} data-testid={`sched-${s.key}`} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              data-testid={`sched-check-${s.key}`}
              checked={s.enabled}
              disabled={s.required}
              onChange={() => onToggle(s.key)}
            />
            <span>{s.cron} · {s.label}{s.required ? '（不可停）' : ''}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
