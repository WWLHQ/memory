// 监控告警页（REQ-006 / P6 · 批次49 起 1:1 对齐设计真源 stratum-a-full.html pg-monitor 段）：
// af-head → 筛选行（级别下拉 + 1h/24h/7d chips + 宿主 Agent 下拉）→ af-g3 六格汇总 →
// 全部指标折叠（20 卡 8 组，保 P6-T3 全量功能）→ 后台操作状态（REQ-013 C5）→ 告警时间线（af-tl）。
// 数据真相 = 内核账本 + 主进程拨测/队列/备份：指标实算，无口径显「— 未采集」，不冒充读数；
// 告警 = 真实 monitor_alert 审计只读回放，点击跳到真实审计 / 记忆深链（不是假跳）。
// ⚠ 内核读不到（批次25 P0-7）→ 三态加载：显示内核原因 + 重试，绝不渲染成「账本为空」。
import { useState, type ReactNode } from 'react';
import { ALL_AGENTS_OPTION } from './options.ts';
import { filterAlerts, groupMetrics } from './logic.ts';
import { operationLabel, summarizeOperations } from './operationState.ts';
import { loadRealMonitorData, type RealMonitor } from './useMonitorReal.ts';
import { useMonitorMirror } from './useMonitorMirror.ts';
import { KernelLoadError, useKernelLoad } from '../shared/kernelLoad.tsx';
import { useHostTheme } from '../shared/hostTheme.ts';
import { MetricGrid } from './MetricGrid.tsx';
import { AlertTimeline } from './AlertTimeline.tsx';
import type { AlertItem, MonitorFilter } from './types.ts';

const WINDOW_LABEL = { '1h': '近 1 小时', '24h': '近 24 小时', '7d': '近 7 天' } as const;
const LEVEL_OPTIONS: { value: MonitorFilter['level']; label: string }[] = [
  { value: 'all', label: '级别：全部' },
  { value: 'warn', label: '级别：告警' },
  { value: 'crit', label: '级别：严重' },
];

export function MonitorPage({ load = loadRealMonitorData }: { load?: () => Promise<RealMonitor> } = {}) {
  useHostTheme();
  const [filter, setFilter] = useState<MonitorFilter>({ level: 'all', window: '24h', agent: 'all' });
  useMonitorMirror(filter);
  const ledger = useKernelLoad<RealMonitor>('monitor', load);
  const { phase, data: real, error: loadError, retry } = ledger;

  const alertsAll: AlertItem[] = real?.alerts ?? [];
  const alerts = filterAlerts(alertsAll, filter);
  const cards = real?.metrics ?? [];
  // 卡数/组数写死在文案里会随增卡漂移（13→20 就漂过一次），这里按真实卡片算。
  const groupCount = groupMetrics(cards).length;
  const summary = real?.summary;

  const head = (
    <div className="af-head" data-testid="monitor-head">
      <h1>监控告警</h1>
      <span className="sub">指标只来自真实账本 · 无数据显「— 未采集」 · Agent 下拉由 monitor_alert + created_by_agent 派生</span>
      <div className="right">
        <button type="button" className="af-btn" data-testid="monitor-refresh" onClick={retry}>刷新</button>
      </div>
    </div>
  );

  const shell = (inner: ReactNode) => (
    <div className="mon-page" data-testid="monitor-page">
      <div className="mon-scroll"><div className="mon-main"><div className="af-stack">{inner}</div></div></div>
    </div>
  );

  if (phase === 'loading') {
    return shell(
      <>
        {head}
        <div className="af-panel"><div className="af-pb"><div className="af-note">正在读取本机数据…</div></div></div>
      </>,
    );
  }

  if (phase === 'error') {
    return shell(
      <>
        {head}
        <KernelLoadError what="读取监控账本" error={loadError} onRetry={retry} />
      </>,
    );
  }

  return shell(
    <>
      {head}

      {/* 筛选行（设计稿：级别下拉 + 时间窗 chips + 宿主 Agent 下拉 + 诚实注释；命中数与账本规模为附加诚实信息） */}
      <section className="af-panel">
        <div className="af-pb af-row">
          <select id="f-level" className="af-select" style={{ maxWidth: 110 }} data-testid="f-level" value={filter.level}
            onChange={(e) => setFilter({ ...filter, level: e.target.value as MonitorFilter['level'] })}>
            {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {(['1h', '24h', '7d'] as const).map((w) => (
            <button key={w} type="button" className={`af-chip${filter.window === w ? ' on' : ''}`}
              data-testid={`f-window-${w}`} aria-pressed={filter.window === w}
              onClick={() => setFilter({ ...filter, window: w })}>{w}</button>
          ))}
          <select id="f-agent" className="af-select" style={{ maxWidth: 150 }} data-testid="f-agent" value={filter.agent}
            onChange={(e) => setFilter({ ...filter, agent: e.target.value })}>
            {(real?.agentOptions ?? [ALL_AGENTS_OPTION]).map((a) => (
              <option key={a} value={a}>{a === ALL_AGENTS_OPTION ? '全部' : a}</option>
            ))}
          </select>
          <span className="af-note">空账本时本下拉只保留「全部」，不内置占位名</span>
          <span className="af-note" data-testid="filter-hits">命中 {alerts.length} 条</span>
          {real && (
            <span className="af-note">本机已有 {real.memCount} 条记忆 · {real.auditCount} 条操作记录</span>
          )}
        </div>
      </section>

      {/* 六格汇总（af-g3 af-stat：全部真实派生，无口径显「— 未采集」） */}
      {summary && summary.length > 0 && (
        <div className="af-g3" data-testid="monitor-summary">
          {summary.map((s) => (
            <section key={s.k} className="af-panel af-stat" data-testid={`summary-${s.k}`}>
              <div className="k">{s.k}<span>{s.sub}</span></div>
              <div className="v">
                {s.v}{s.unit ? <em>{s.unit}</em> : null}
              </div>
              <div className={`d${s.mut ? ' mut' : ''}`}>{s.d}</div>
            </section>
          ))}
        </div>
      )}

      {/* 全部指标：20 卡 8 组收进折叠（保 P6-T3 全量功能不丢）；真没卡才显空态 */}
      {cards.length > 0 ? (
        <details className="af-det" data-testid="metrics-det">
          <summary>全部指标（{cards.length} 项 · 分 {groupCount} 组）</summary>
          <div className="det-b"><MetricGrid cards={cards} /></div>
        </details>
      ) : (
        <div className="af-panel" data-testid="metrics-empty">
          <div className="af-ph"><h3>指标卡</h3><span className="af-badge warn">暂无数据</span></div>
          <div className="af-pb">
            <div className="af-note">
              已读到本机数据，但还没有可用于统计的记录：所有数字都从真实账本和本机队列算出来，
              没有记录时不会编造演示数字。请先在「写入页」产生真实记忆，或运行一次检索后刷新。
            </div>
          </div>
        </div>
      )}

      {/* 后台操作状态（REQ-013 C5）：设计稿之外的诚实附加段，保功能不静默删除 */}
      {real?.operations && real.operations.length > 0 ? (
        <section className="af-panel" data-testid="operations-status">
          <div className="af-ph">
            <h3>后台操作状态</h3>
            <span className="af-note">只读本机操作记录（定时任务 / 记忆精炼 / 合并 / 遗忘周期 / 同步 / 接入）；排队中不算失败</span>
            <span className="hint">audit 只读</span>
          </div>
          <div className="af-pb">
            {(() => {
              const s = summarizeOperations(real.operations!);
              return (
                <div className="af-note" data-testid="operations-summary">
                  排队中 {s.queued} · 进行中 {s.running} · 已完成 {s.succeeded} · 失败 {s.failed}
                </div>
              );
            })()}
            {real.operationEntries && real.operationEntries.length > 0 ? (
              <div className="af-note" data-testid="operations-list">
                最近：
                {real.operationEntries
                  .slice(0, 6)
                  .map((op) => `${op.label}·${operationLabel(op.status)}·${new Date(op.ts).toLocaleTimeString('zh-CN', { hour12: false })}`)
                  .join(' ｜ ')}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {alertsAll.length === 0 ? (
        <div className="af-panel" data-testid="alerts-empty">
          <div className="af-ph"><h3>告警时间线</h3><span className="af-badge">0 条</span></div>
          <div className="af-pb">
            <div className="af-note">
              当前本机没有告警记录。这里只显示真实写进账本的告警，不会预先塞入演示告警；
              监控探测触发告警后会自动出现在这里，点一下可跳到对应的审计或记忆。
            </div>
          </div>
        </div>
      ) : (
        <AlertTimeline alerts={alerts} windowLabel={WINDOW_LABEL[filter.window]} />
      )}
    </>,
  );
}
