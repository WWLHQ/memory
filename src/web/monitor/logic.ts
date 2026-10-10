// 监控仪表盘（REQ-006 / P6）纯逻辑层
import type { AlertItem, MetricCard, MonitorFilter } from './types.ts';

/** 阈值判定（12.1）：warn 阈值表，返回 ok/warn/crit */
export function evalLevel(card: MetricCard): 'ok' | 'warn' | 'crit' {
  return card.level;
}

/** 时间窗过滤（12.2） */
export function inWindow(ts: string, window: MonitorFilter['window'], now = Date.now()): boolean {
  const ms = { '1h': 3600e3, '24h': 86400e3, '7d': 604800e3 }[window];
  return now - new Date(ts).getTime() <= ms;
}

/** 告警筛选：级别 + 时间窗 + 宿主 Agent（三维 AND） */
export function filterAlerts(list: AlertItem[], f: MonitorFilter, now = Date.now()): AlertItem[] {
  return list.filter((a) => {
    if (f.level !== 'all' && a.level !== f.level) return false;
    if (!inWindow(a.ts, f.window, now)) return false;
    if (f.agent !== 'all' && a.agent !== f.agent && a.agent !== 'all') return false;
    return true;
  });
}

/** 指标卡按组聚合（渲染顺序稳定） */
export function groupMetrics(cards: MetricCard[]): [string, MetricCard[]][] {
  const map = new Map<string, MetricCard[]>();
  for (const c of cards) {
    if (!map.has(c.group)) map.set(c.group, []);
    map.get(c.group)!.push(c);
  }
  return [...map.entries()];
}

/** p 分位数（检索性能卡，nearest-rank 简化） */
export function percentile(nums: number[], p: number): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

/** 级别徽标文案 */
export function levelBadge(l: 'ok' | 'warn' | 'crit'): string {
  return l === 'crit' ? '🔴' : l === 'warn' ? '⚠️' : '✓';
}
