import { describe, it, expect } from 'vitest';
import { evalLevel, inWindow, filterAlerts, groupMetrics, percentile, levelBadge } from '../logic.ts';
import { SEED_ALERTS, SEED_METRICS } from '../seed.ts';
import type { MetricCard } from '../types.ts';

const NOW = new Date('2026-10-10T11:00:00Z').getTime();

describe('evalLevel / levelBadge', () => {
  it('级别透传与徽标', () => {
    const c: MetricCard = { group: '队列', metric: 'x', value: 1, threshold: '', level: 'warn', jump: '' };
    expect(evalLevel(c)).toBe('warn');
    expect(levelBadge('crit')).toBe('🔴');
    expect(levelBadge('warn')).toBe('⚠️');
    expect(levelBadge('ok')).toBe('✓');
  });
});

describe('inWindow', () => {
  it('时间窗边界', () => {
    expect(inWindow('2026-10-10T10:30:00Z', '1h', NOW)).toBe(true);
    expect(inWindow('2026-10-10T09:00:00Z', '1h', NOW)).toBe(false);
    expect(inWindow('2026-10-10T09:00:00Z', '24h', NOW)).toBe(true);
  });
});

describe('filterAlerts（12.2 三维 AND）', () => {
  it('级别过滤', () => {
    expect(filterAlerts(SEED_ALERTS, { level: 'crit', window: '7d', agent: 'all' }, NOW).length).toBe(2);
  });
  it('Agent 过滤（all 广播条目保留）', () => {
    // coder-01 命中 2 条 + agent='all' 广播条 1 条
    expect(filterAlerts(SEED_ALERTS, { level: 'all', window: '7d', agent: 'coder-01' }, NOW).length).toBe(3);
  });
  it('组合过滤', () => {
    const r = filterAlerts(SEED_ALERTS, { level: 'crit', window: '1h', agent: 'all' }, NOW);
    expect(r.every((a) => a.level === 'crit')).toBe(true);
  });
});

describe('groupMetrics', () => {
  it('14 卡分 6 组', () => {
    const g = groupMetrics(SEED_METRICS);
    expect(SEED_METRICS.length).toBe(14);
    expect(g.length).toBe(5); // 规格表实际 5 组
    expect(g[0][0]).toBe('Agent 健康');
  });
});

describe('percentile', () => {
  it('p95/p99 nearest-rank', () => {
    expect(percentile([1, 2, 3, 4, 5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([], 99)).toBe(0);
  });
});

describe('种子覆盖（12.1）', () => {
  it('含 crit 与 warn 样本', () => {
    expect(SEED_METRICS.some((m) => m.level === 'crit')).toBe(true);
    expect(SEED_METRICS.some((m) => m.level === 'warn')).toBe(true);
  });
  it('告警时间线含 request_id 与 memory_id', () => {
    expect(SEED_ALERTS.every((a) => a.request_id)).toBe(true);
    expect(SEED_ALERTS.some((a) => a.memory_id)).toBe(true);
  });
});
