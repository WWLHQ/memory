// M4：进化时间线 + 参数漂移仪表（展示层，只渲染真实审计投影）。
// 红线：① 每条都能回查到 request_id（不聚合、不补零）；② 空账本显「暂无进化记录」而不是 0；
//      ③ 漂移数值 = 当前配置 − 基准配置的真实差（不归一化掩盖）。
import type { EvolutionTimelineEntry, RollbackState, TimelineDecision } from './evolutionTimeline.ts';
import { recallDrift, rollbackStateOf } from './evolutionTimeline.ts';
import { RECALL_KEY_LABEL } from './recallLabels.ts';
import { DEFAULT_RECALL_WEIGHTS, type RecallWeights } from '../../shared/growthConfig.ts';

const DECISION_VIEW: Record<TimelineDecision, { text: string; cls: string }> = {
  adopted: { text: '已采纳', cls: 'ok' },
  suggested: { text: '建议待采纳', cls: 'info' },
  rejected: { text: '未采纳', cls: '' },
  insufficient: { text: '样本不足', cls: 'info' },
  guarded: { text: '护栏拦截', cls: 'warn' },
  rolled_back: { text: '已回滚', cls: 'err' },
  // M5-1：回诊通过、保留当前配置（不是「已采纳」，也不是「未采纳」）
  kept: { text: '回诊通过·保留', cls: 'ok' },
};

const FAMILY_VIEW: Record<string, string> = {
  recall_weights: '召回权重',
  feedback_policy: '反馈策略',
  dedup_weights: '判重权重',
  dedup_thresholds: '判重阈值',
};

const PHASE_VIEW: Record<string, string> = {
  evolution: '进化轮',
  rollback: '回诊',
};

/** M5-3：回诊点三态文案（不用破折号冒充读数） */
function rollbackText(state: RollbackState, dueAt?: number, daysLeft?: number): string {
  switch (state) {
    case 'none': return '无回诊计划';
    case 'pending': return `${fmtTime(dueAt!)}（未到期，还有 ${daysLeft ?? 0} 天）`;
    case 'overdue': return `${fmtTime(dueAt!)}（已到期未回诊）`;
    case 'done': return `${fmtTime(dueAt!)}（已回诊）`;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地时间（与调度的 next_due_at 同一基准，不做时区转换） */
function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function signed(v: number, digits = 3): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
}

/** 权重前→后：只列真变了的维度（中文名，不出 w_f 这类字段名）；全没变显「未变」；审计没带前后就写明缺什么（不用「—」冒充读数） */
function weightDiff(e: EvolutionTimelineEntry): string {
  if (!e.from || !e.to) return '审计未带参数前后';
  const keys = ['w_f', 'w_i', 'w_c', 'w_a'] as const;
  const changed = keys
    .filter((k) => Math.abs(e.to![k] - e.from![k]) > 1e-9)
    .map((k) => `${RECALL_KEY_LABEL[k]} ${e.from![k].toFixed(2)}→${e.to![k].toFixed(2)}`);
  return changed.length > 0 ? changed.join(' · ') : '未变';
}

/** 离线指标：只列审计里真有的字段（排序质量 / 显著性 / 样本数），不出现裸字段名 */
function metricText(e: EvolutionTimelineEntry): string {
  const parts: string[] = [];
  if (e.gain !== undefined) parts.push(`排序质量提升 ${signed(e.gain)}（NDCG）`);
  if (e.p !== undefined) parts.push(`显著性 p=${e.p.toFixed(3)}`);
  if (e.samples !== undefined) parts.push(`基于 ${e.samples} 次召回`);
  if (e.drop !== undefined) parts.push(`效果跌幅 ${signed(e.drop)}`);
  return parts.length > 0 ? parts.join(' · ') : '本条审计未带离线指标';
}

export function EvolutionTimelineCard({
  entries, current, baseline = DEFAULT_RECALL_WEIGHTS, now,
  onRun, running, lastRun,
}: {
  /** growth_op 审计 → 时间线（最新在前）；空数组 = 账本暂无进化记录 */
  entries: EvolutionTimelineEntry[];
  /** 当前生效的召回权重（读 growth:v1，缺失时页面传默认值） */
  current: RecallWeights;
  /** 基准（默认 = DEFAULT_RECALL_WEIGHTS，出厂口径） */
  baseline?: RecallWeights;
  /** 回诊三态的判定时刻（缺省取当前时间；测试可注入固定值） */
  now?: number;
  /** M5-2：手动跑一轮进化（与 cron 同一函数）；不传 = 不渲染按钮 */
  onRun?: () => void;
  running?: boolean;
  /** 上一轮手动触发的真实回执文案（无触发 → undefined） */
  lastRun?: string;
}) {
  const drift = recallDrift(current, baseline);
  const maxAbs = Math.max(0.01, ...drift.map((r) => Math.abs(r.drift)));
  const t = now ?? Date.now();

  return (
    <div className="card" data-testid="evolution-timeline-card">
      <b>进化时间线（M4 · 真实 growth_op 审计逐条）</b>
      <div className="note">
        每行对应一条真实 growth_op 审计，可用「审计 ID」在审计页回查原文；
        审计里没写的字段会直接写明缺什么，不补零、不推算。
      </div>

      {onRun && (
        <div className="row" style={{ alignItems: 'center', gap: 10, marginTop: 8 }}>
          <button
            type="button" className="btn" data-testid="evo-run-now"
            disabled={running} onClick={onRun}
          >{running ? '正在跑…' : '手动跑一轮进化'}</button>
          <span className="note" data-testid="evo-run-hint" style={{ margin: 0 }}>
            与每周日 03:00 的 cron 走同一套函数（进化轮 + 回诊）；只写真实审计，不改演示数据。
          </span>
        </div>
      )}
      {lastRun && (
        <div className="note" data-testid="evo-run-receipt" style={{ marginTop: 6 }}>{lastRun}</div>
      )}

      {entries.length === 0 ? (
        <div className="p0-empty dashed" data-testid="evolution-timeline-empty">
          暂无进化记录 —— 进化轮需在「调度 → 进化设置」里开启（建议=suggest 出建议、自动=auto 才写配置），
          且样本需达最小召回数才会产出一条记录。
        </div>
      ) : (
        <table className="ltable" data-testid="evolution-timeline-table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>时间</th>
              <th>参数族</th>
              <th>决策</th>
              <th>参数变化</th>
              <th>离线指标</th>
              <th>原因</th>
              <th>回诊点</th>
              <th>审计 ID</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const v = DECISION_VIEW[e.decision];
              const rb = rollbackStateOf(e, entries, t);
              return (
                <tr key={`${e.requestId}-${e.ts}`} data-testid={`evo-row-${e.requestId}`}>
                  <td>{fmtTime(e.ts)}</td>
                  <td>
                    {FAMILY_VIEW[e.family] ?? e.family}
                    {e.phase && (
                      <span
                        className="p0-tag" data-testid={`evo-phase-${e.requestId}`}
                        style={{ marginLeft: 6 }}
                      >{PHASE_VIEW[e.phase]}</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`p0-tag${v.cls ? ` ${v.cls}` : ''}`}
                      data-testid={`evo-decision-${e.requestId}`}
                      data-decision={e.decision}
                    >{v.text}</span>
                  </td>
                  <td className="mono" data-testid={`evo-diff-${e.requestId}`}>{weightDiff(e)}</td>
                  <td className="mono" data-testid={`evo-metric-${e.requestId}`}>{metricText(e)}</td>
                  <td data-testid={`evo-reason-${e.requestId}`}>{e.reason || '本条审计未写原因'}</td>
                  <td data-testid={`evo-rollback-${e.requestId}`} data-rb={rb.state}>
                    {rollbackText(rb.state, rb.dueAt, rb.daysLeft)}
                  </td>
                  <td className="mono" title={e.requestId}>{e.requestId}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="note" style={{ marginTop: 12 }}>
        参数漂移仪表：当前生效值（growth:v1）− 出厂基准，正值=上调、负值=下调；数字为真实差，不做归一化。
      </div>
      <table className="ltable" data-testid="drift-gauge" style={{ marginTop: 4 }}>
        <thead>
          <tr><th>召回权重</th><th>当前</th><th>基准</th><th>漂移</th><th>幅度</th></tr>
        </thead>
        <tbody>
          {drift.map((r) => (
            <tr key={r.key} data-testid={`drift-${r.key}`}>
              <td>{r.label}</td>
              <td data-testid={`drift-cur-${r.key}`}>{r.current.toFixed(3)}</td>
              <td>{r.baseline.toFixed(3)}</td>
              <td
                data-testid={`drift-delta-${r.key}`} data-drift={r.drift}
                style={{ color: Math.abs(r.drift) > 1e-9 ? 'var(--accent,#4f8cff)' : 'var(--muted,#a9b6c4)' }}
              >{signed(r.drift)}</td>
              <td>
                <span
                  data-testid={`drift-bar-${r.key}`}
                  style={{
                    display: 'inline-block', height: 6, borderRadius: 3,
                    width: `${Math.min(100, (Math.abs(r.drift) / maxAbs) * 100)}%`,
                    minWidth: Math.abs(r.drift) > 1e-9 ? 3 : 0,
                    background: Math.abs(r.drift) > 1e-9 ? 'var(--accent,#4f8cff)' : 'var(--line,#2a3444)',
                    verticalAlign: 'middle',
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
