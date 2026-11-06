// 监控仪表盘（REQ-006 / P6）· 完整编排（T5）· 真实数据接真版
// 告警时间线 = 真实账本 monitor_alert 审计（只读回放，不灌种子）；
// 指标卡 = 真实账本实算（useMonitorReal.metricsFromLedger；无数据口径 → 「—」未采集，不伪造演示数字）。
// 与记忆库管理页一致：数据真相 = 内核账本（桌面 = 主进程 FileStorage 持久库）。
// ⚠ 内核读不到（批次25 P0-7）→ 三态加载：显示内核原因 + 重试，绝不渲染成「账本为空」。
import { useState } from 'react';
import { ALL_AGENTS_OPTION } from './options.ts';
import { filterAlerts } from './logic.ts';
import { loadRealMonitorData, type RealMonitor } from './useMonitorReal.ts';
import { useMonitorMirror } from './useMonitorMirror.ts';
import { KernelLoadError, useKernelLoad } from '../shared/kernelLoad.tsx';
import { MetricGrid } from './MetricGrid.tsx';
import { AlertTimeline } from './AlertTimeline.tsx';
import { useToast } from './useToast.tsx';
import type { AlertItem, MonitorFilter } from './types.ts';

export function MonitorPage({ load = loadRealMonitorData }: { load?: () => Promise<RealMonitor> } = {}) {
  const [filter, setFilter] = useState<MonitorFilter>({ level: 'all', window: '24h', agent: 'all' });
  const { node: toast, show } = useToast();
  useMonitorMirror(filter);
  // 挂载：从真实账本读全量监控数据（指标实算 + 告警回放；无种子兜底、无静默空态）
  const ledger = useKernelLoad<RealMonitor>('monitor', load);
  const { phase, data: real, error: loadError, retry } = ledger;

  const alertsAll: AlertItem[] = real?.alerts ?? [];
  const alerts = filterAlerts(alertsAll, filter);
  const cards = real?.metrics ?? [];

  if (phase === 'loading') {
    return (
      <div className="wrap" data-testid="monitor-page">
        <h1>📡 监控仪表盘 <span className="badge p2">REQ-006 · P6</span></h1>
        <div className="note">加载真实账本中…</div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="wrap" data-testid="monitor-page">
        <h1>📡 监控仪表盘 <span className="badge p2">REQ-006 · P6</span></h1>
        <KernelLoadError what="读取监控账本" error={loadError} onRetry={retry} />
        {toast}
      </div>
    );
  }

  return (
    <div className="wrap" data-testid="monitor-page">
      <h1>📡 监控仪表盘 <span className="badge p2">REQ-006 · P6</span></h1>
      <div className="sub">
        12.1 指标卡（真实账本实算·无数据口径显「—」未采集）+ 12.2 告警时间线（真实 monitor_alert 审计）
        {real ? ` · 账本 ${real.memCount} 条记忆 / ${real.auditCount} 条审计` : ''}
      </div>

      <div className="card">
        <div className="row-head"><b>筛选（12.2）</b></div>
        <div className="row">
          <label style={{ fontSize: 12 }}>级别</label>
          <select data-testid="f-level" value={filter.level} onChange={(e) => setFilter({ ...filter, level: e.target.value as MonitorFilter['level'] })}>
            <option value="all">全部</option>
            <option value="warn">⚠️ 告警</option>
            <option value="crit">🔴 严重</option>
          </select>
          <label style={{ fontSize: 12 }}>时间窗</label>
          <select data-testid="f-window" value={filter.window} onChange={(e) => setFilter({ ...filter, window: e.target.value as MonitorFilter['window'] })}>
            <option value="1h">近 1 小时</option>
            <option value="24h">近 24 小时</option>
            <option value="7d">近 7 天</option>
          </select>
          <label style={{ fontSize: 12 }}>宿主 Agent</label>
          <select data-testid="f-agent" value={filter.agent} onChange={(e) => setFilter({ ...filter, agent: e.target.value })}>
            {(real?.agentOptions ?? [ALL_AGENTS_OPTION]).map((a) => (
              <option key={a} value={a}>{a === ALL_AGENTS_OPTION ? '全部' : a}</option>
            ))}
          </select>
          <span className="dim">命中 {alerts.length} 条</span>
        </div>
      </div>

      {cards.length > 0 ? (
        <MetricGrid cards={cards} />
      ) : (
        <div className="card" data-testid="metrics-empty">
          <b>已读到内核账本，但无监控样本，指标未采集。</b>
          <div className="note">
            指标卡数字均由真实账本实算（召回审计 / conflict_resolve / sync_fail 等）；
            账本为空时全部显示「—」未采集，不伪造演示数字。请先在「写入页」产生真实记忆后刷新。
          </div>
        </div>
      )}

      {alertsAll.length === 0 ? (
        <div className="card" data-testid="alerts-empty">
          <b>当前真实账本无 monitor_alert 告警记录。</b>
          <div className="note">
            告警时间线只回放真实账本中内核真实写入的 monitor_alert 审计（不灌种子告警）。
            当监控探测触发真实告警后，此处将自动展示。
          </div>
        </div>
      ) : (
        <AlertTimeline
          alerts={alerts}
          onJump={(kind, id) => show(`跳转审计：${kind === 'request' ? id : `记忆 ${id}`}`)}
        />
      )}
      {toast}
    </div>
  );
}
