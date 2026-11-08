// 监控仪表盘（REQ-006 / P6）· 14 卡分 5 组 + 告警时间轴（左轴级别色）+ 三档过滤
// 数据真相 = 内核账本：指标实算（没有真实口径的卡不显示数字、值位标「未采集」，不冒充读数）；
// 告警 = 真实 monitor_alert 审计只读回放，点击跳到真实审计 / 记忆深链（不是假跳）。
// ⚠ 内核读不到（批次25 P0-7）→ 三态加载：显示内核原因 + 重试，绝不渲染成「账本为空」。
import { useState } from 'react';
import { ALL_AGENTS_OPTION } from './options.ts';
import { filterAlerts } from './logic.ts';
import { loadRealMonitorData, type RealMonitor } from './useMonitorReal.ts';
import { useMonitorMirror } from './useMonitorMirror.ts';
import { KernelLoadError, useKernelLoad } from '../shared/kernelLoad.tsx';
import { MetricGrid } from './MetricGrid.tsx';
import { AlertTimeline } from './AlertTimeline.tsx';
import type { AlertItem, MonitorFilter } from './types.ts';

export function MonitorPage({ load = loadRealMonitorData }: { load?: () => Promise<RealMonitor> } = {}) {
  const [filter, setFilter] = useState<MonitorFilter>({ level: 'all', window: '24h', agent: 'all' });
  useMonitorMirror(filter);
  const ledger = useKernelLoad<RealMonitor>('monitor', load);
  const { phase, data: real, error: loadError, retry } = ledger;

  const alertsAll: AlertItem[] = real?.alerts ?? [];
  const alerts = filterAlerts(alertsAll, filter);
  const cards = real?.metrics ?? [];

  const head = (
    <div className="p0-hd">
      <h2>监控仪表盘</h2>
      <span className="p0-tag">REQ-006 · P6</span>
      <span className="p0-sub">12.1 指标卡（14 项 / 5 组）+ 12.2 告警时间线</span>
      <span className="p0-right">
        {real ? <span className="p0-tag">账本 {real.memCount} 条记忆 / {real.auditCount} 条审计</span> : null}
        <span className="p0-tag info">只读真实账本</span>
      </span>
    </div>
  );

  if (phase === 'loading') {
    return (
      <div className="p0-page" data-testid="monitor-page">
        {head}
        <div className="p0-card"><div className="p0-note">加载真实账本中…</div></div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="p0-page" data-testid="monitor-page">
        {head}
        <KernelLoadError what="读取监控账本" error={loadError} onRetry={retry} />
      </div>
    );
  }

  return (
    <div className="p0-page" data-testid="monitor-page">
      {head}

      <div className="p0-card">
        <div className="p0-hd">
          <h3>筛选（12.2）</h3>
          <span className="p0-sub">级别 / 时间窗 / 宿主 Agent（三维 AND）</span>
          <span className="p0-right p0-tag">命中 {alerts.length} 条</span>
        </div>
        <div className="p0-row-actions" style={{ marginTop: 0 }}>
          <label className="p0-note" htmlFor="f-level">级别</label>
          <select id="f-level" className="p0-in" data-testid="f-level" value={filter.level}
            onChange={(e) => setFilter({ ...filter, level: e.target.value as MonitorFilter['level'] })}>
            <option value="all">全部</option>
            <option value="warn">⚠️ 告警</option>
            <option value="crit">🔴 严重</option>
          </select>
          <label className="p0-note" htmlFor="f-window">时间窗</label>
          <select id="f-window" className="p0-in" data-testid="f-window" value={filter.window}
            onChange={(e) => setFilter({ ...filter, window: e.target.value as MonitorFilter['window'] })}>
            <option value="1h">近 1 小时</option>
            <option value="24h">近 24 小时</option>
            <option value="7d">近 7 天</option>
          </select>
          <label className="p0-note" htmlFor="f-agent">宿主 Agent</label>
          <select id="f-agent" className="p0-in" data-testid="f-agent" value={filter.agent}
            onChange={(e) => setFilter({ ...filter, agent: e.target.value })}>
            {(real?.agentOptions ?? [ALL_AGENTS_OPTION]).map((a) => (
              <option key={a} value={a}>{a === ALL_AGENTS_OPTION ? '全部' : a}</option>
            ))}
          </select>
        </div>
      </div>

      {cards.length > 0 ? (
        <MetricGrid cards={cards} />
      ) : (
        <div className="p0-card" data-testid="metrics-empty">
          <div className="p0-hd"><h3>指标卡</h3><span className="p0-tag warn">未采集</span></div>
          <div className="p0-note">
            已读到内核账本，但没有监控样本：指标数字全部来自真实账本实算（召回审计 / conflict_resolve / sync_fail 等），
            账本为空时不会伪造演示数字。请先在「写入页」产生真实记忆或运行检索后刷新。
          </div>
        </div>
      )}

      {alertsAll.length === 0 ? (
        <div className="p0-card" data-testid="alerts-empty">
          <div className="p0-hd"><h3>告警时间线</h3><span className="p0-tag">0 条</span></div>
          <div className="p0-note">
            当前真实账本无 monitor_alert 告警记录。告警时间线只回放内核真实写入的 monitor_alert 审计（不灌种子告警）；
            监控探测触发真实告警后此处自动展示，并可点击跳到对应审计 / 记忆。
          </div>
        </div>
      ) : (
        <AlertTimeline alerts={alerts} />
      )}
    </div>
  );
}
