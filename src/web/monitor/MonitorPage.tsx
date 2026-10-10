// 监控仪表盘（REQ-006 / P6）T4 编排
// 告警时间线走内核账本（monitor_alert 真写 + 挂载回放）+ mirror 上抛；指标卡为演示快照。
import { useEffect, useState } from 'react';
import { AGENT_OPTIONS, SEED_METRICS } from './seed.ts';
import { filterAlerts } from './logic.ts';
import { coreLoadAlerts } from './coreMonitor.ts';
import { useMonitorMirror } from './useMonitorMirror.ts';
import { MetricGrid } from './MetricGrid.tsx';
import { AlertTimeline } from './AlertTimeline.tsx';
import { useToast } from './useToast.tsx';
import type { AlertItem, MonitorFilter } from './types.ts';

export function MonitorPage() {
  const [filter, setFilter] = useState<MonitorFilter>({ level: 'all', window: '24h', agent: 'all' });
  const [alertsAll, setAlertsAll] = useState<AlertItem[]>([]);
  const { node: toast, show } = useToast();
  useMonitorMirror(filter);

  // 挂载回放：内核账本中的告警（种子保真 + 运行时新增）
  useEffect(() => {
    let alive = true;
    coreLoadAlerts()
      .then((items) => {
        if (alive) setAlertsAll(items);
      })
      .catch(() => {}); // 内核不可达 → 空时间线（safe-noop 语义）
    return () => {
      alive = false;
    };
  }, []);

  const alerts = filterAlerts(alertsAll, filter);

  return (
    <div className="wrap" data-testid="monitor-page">
      <h1>📡 监控仪表盘 <span className="badge p2">REQ-006 · P6</span></h1>
      <div className="sub">12.1 指标卡（6 组 14 项，演示快照）+ 12.2 告警时间线（内核账本）</div>

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
            {AGENT_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <span className="dim">命中 {alerts.length} 条</span>
        </div>
      </div>

      <MetricGrid cards={SEED_METRICS} />
      <AlertTimeline
        alerts={alerts}
        onJump={(kind, id) => show(`跳转审计：${kind === 'request' ? id : `记忆 ${id}`}`)}
      />
      {toast}
    </div>
  );
}
