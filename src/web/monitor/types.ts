// 监控仪表盘（REQ-006 / P6）数据模型
// 规格：12.1 指标卡（阈值/级别/跳转）+ 12.2 告警时间线。

export type AlertLevel = 'ok' | 'warn' | 'crit';

/** 指标卡（12.1 全量 13 项，分 5 组；2026-11-15 用户批准删「死信」卡） */
export interface MetricCard {
  group: 'Agent 健康' | '队列' | '冷存储' | '人工审核' | '检索性能(1h)';
  metric: string;
  /** 当前值（数值或状态串，如 OPEN） */
  value: number | string;
  unit?: string;
  /** 精炼队列卡专用：三项真实计数（来自主进程补炼队列，无真源时整个字段缺失） */
  parts?: { ok: number; failed: number; waiting: number; skipped: number };
  /** 阈值描述文案 */
  threshold: string;
  level: AlertLevel;
  /** 跳转目标（P10/P7/P1/5.3/5.4 占位） */
  jump: string;
}

/** 告警时间线条目 */
export interface AlertItem {
  ts: string;
  level: Exclude<AlertLevel, 'ok'>;
  message: string;
  request_id?: string;
  memory_id?: string;
  agent?: string;
}

/** 筛选（12.2）：级别/时间窗/宿主 Agent */
export interface MonitorFilter {
  level: 'all' | 'warn' | 'crit';
  window: '1h' | '24h' | '7d';
  agent: string;
}
