// 监控仪表盘（REQ-006 / P6）· 20 卡分 8 组 + 告警时间轴（左轴级别色）+ 三档过滤
// 数据真相 = 内核账本 + 主进程补炼队列/采集器/备份：指标实算（没有真实口径的卡不显示数字、值位说「暂无数据」，不冒充读数）；
// 告警 = 真实 monitor_alert 审计只读回放，点击跳到真实审计 / 记忆深链（不是假跳）。
// ⚠ 内核读不到（批次25 P0-7）→ 三态加载：显示内核原因 + 重试，绝不渲染成「账本为空」。
import { useState } from 'react';
import { ALL_AGENTS_OPTION } from './options.ts';
import { filterAlerts, groupMetrics } from './logic.ts';
import { operationLabel, summarizeOperations } from './operationState.ts';
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
  // 卡数/组数写死在文案里会随增卡漂移（13→20 就漂过一次），这里按真实卡片算。
  const groupCount = groupMetrics(cards).length;

  const head = (
    <div className="p0-hd">
      <h2>监控仪表盘</h2>
      <span className="p0-tag">本机运行状况</span>
      <span className="p0-sub">
        {cards.length > 0 ? `${cards.length} 项监控指标，分 ${groupCount} 组` : '监控指标'}；下方是告警时间线
      </span>
      <span className="p0-right">
        {real ? <span className="p0-tag">本机已有 {real.memCount} 条记忆 · {real.auditCount} 条操作记录</span> : null}
        <span className="p0-tag info">只显示真实数据</span>
      </span>
    </div>
  );

  if (phase === 'loading') {
    return (
      <div className="p0-page" data-testid="monitor-page">
        {head}
        <div className="p0-card"><div className="p0-note">正在读取本机数据…</div></div>
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
          <h3>筛选告警</h3>
          <span className="p0-sub">按级别、时间范围、宿主 Agent 三个条件同时筛选</span>
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
          <div className="p0-hd"><h3>指标卡</h3><span className="p0-tag warn">暂无数据</span></div>
          <div className="p0-note">
            已读到本机数据，但还没有可用于统计的记录：所有数字都从真实账本和本机队列算出来，
            没有记录时不会编造演示数字。请先在「写入页」产生真实记忆，或运行一次检索后刷新。
          </div>
        </div>
      )}

      {real?.operations && real.operations.length > 0 ? (
        <div className="p0-card" data-testid="operations-status">
          <div className="p0-hd">
            <h3>后台操作状态</h3>
            <span className="p0-sub">只读本机操作记录（定时任务 / 记忆精炼 / 合并 / 遗忘周期 / 同步 / 接入）；排队中不算失败</span>
          </div>
          {(() => {
            const s = summarizeOperations(real.operations!);
            return (
              <div className="p0-note" data-testid="operations-summary">
                排队中 {s.queued} · 进行中 {s.running} · 已完成 {s.succeeded} · 失败 {s.failed}
              </div>
            );
          })()}
          {real.operationEntries && real.operationEntries.length > 0 ? (
            <div className="p0-note" data-testid="operations-list">
              最近：
              {real.operationEntries
                .slice(0, 6)
                .map((op) => `${op.label}·${operationLabel(op.status)}·${new Date(op.ts).toLocaleTimeString('zh-CN', { hour12: false })}`)
                .join(' ｜ ')}
            </div>
          ) : null}
        </div>
      ) : null}

      {alertsAll.length === 0 ? (
        <div className="p0-card" data-testid="alerts-empty">
          <div className="p0-hd"><h3>告警时间线</h3><span className="p0-tag">0 条</span></div>
          <div className="p0-note">
            当前本机没有告警记录。这里只显示真实写进账本的告警，不会预先塞入演示告警；
            监控探测触发告警后会自动出现在这里，点一下可跳到对应的审计或记忆。
          </div>
        </div>
      ) : (
        <AlertTimeline alerts={alerts} />
      )}
    </div>
  );
}
