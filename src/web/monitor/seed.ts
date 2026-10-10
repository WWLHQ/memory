// 监控仪表盘（REQ-006 / P6）种子数据
// 覆盖 14 指标卡（含触发 warn/crit 的样本）+ 告警时间线样本。
import type { AlertItem, MetricCard } from './types.ts';

export const SEED_METRICS: MetricCard[] = [
  // Agent 健康
  { group: 'Agent 健康', metric: '连通成功率(5min)', value: 97.2, unit: '%', threshold: '<95% ⚠️', level: 'ok', jump: 'P10' },
  { group: 'Agent 健康', metric: '熔断状态', value: 'OPEN', threshold: 'OPEN 🔴', level: 'crit', jump: 'P10' },
  { group: 'Agent 健康', metric: '平均延迟', value: 6.3, unit: 's', threshold: '>5s ⚠️', level: 'warn', jump: 'P10' },
  // 队列
  { group: '队列', metric: 'RawArchive 堆积', value: 1240, threshold: '>1000 ⚠️', level: 'warn', jump: 'P10(5.3)' },
  { group: '队列', metric: '死信消息(24h)', value: 3, threshold: '>0 ⚠️', level: 'warn', jump: '5.3' },
  // 冷存储
  { group: '冷存储', metric: '写入成功率', value: 99.8, unit: '%', threshold: '<99.5% ⚠️', level: 'ok', jump: '5.4' },
  { group: '冷存储', metric: '哈希校验失败(24h)', value: 1, threshold: '>0 🔴', level: 'crit', jump: '5.4' },
  // 人工审核
  { group: '人工审核', metric: '待裁决', value: 25, threshold: '>20 ⚠️', level: 'warn', jump: 'P7' },
  { group: '人工审核', metric: '超期 7d', value: 2, threshold: '>0 ⚠️', level: 'warn', jump: 'P7' },
  // 检索性能(1h)
  { group: '检索性能(1h)', metric: '命中率', value: 54, unit: '%', threshold: '<60% ⚠️', level: 'warn', jump: 'P1' },
  { group: '检索性能(1h)', metric: 'payload_tokens p95', value: 2300, threshold: '>2000 ⚠️', level: 'warn', jump: '2.4.1' },
  { group: '检索性能(1h)', metric: 'pipeline_llm_tokens p95', value: 2600, threshold: '>3000', level: 'ok', jump: '—' },
  { group: '检索性能(1h)', metric: '延迟 p99', value: 2.6, unit: 's', threshold: '>2s ⚠️', level: 'warn', jump: '—' },
  { group: '检索性能(1h)', metric: '极简证据不足率(1d)', value: 12, unit: '%', threshold: '>20% ⚠️', level: 'ok', jump: '2.4.3' },
];

export const SEED_ALERTS: AlertItem[] = [
  { ts: '2026-10-10T10:20:00Z', level: 'crit', message: 'Agent 熔断 OPEN：连续 5 次超时', request_id: 'req_m1', memory_id: 'mem_001', agent: 'coder-01' },
  { ts: '2026-10-10T10:12:00Z', level: 'warn', message: 'RawArchive 堆积 1240（阈值 1000）', request_id: 'req_m2', agent: 'writer-02' },
  { ts: '2026-10-10T09:58:00Z', level: 'warn', message: '检索命中率 54%（阈值 60%）', request_id: 'req_m3', agent: 'coder-01' },
  { ts: '2026-10-10T09:40:00Z', level: 'crit', message: '冷存储哈希校验失败 1 条', request_id: 'req_m4', memory_id: 'mem_030', agent: 'sync-00' },
  { ts: '2026-10-10T09:21:00Z', level: 'warn', message: '待裁决冲突 25 条（阈值 20）', request_id: 'req_m5', agent: 'all' },
];

export const AGENT_OPTIONS = ['all', 'coder-01', 'writer-02', 'sync-00'];
