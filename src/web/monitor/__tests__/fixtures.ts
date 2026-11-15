// 监控页单测夹具（仅测试用；页面指标/告警数据真相 = 内核账本）。
import type { AlertItem, MetricCard } from '../types.ts';

export const SEED_METRICS: MetricCard[] = [
  // 检索性能(1h) —— 2026-11-15 用户要求置顶
  { group: '检索性能(1h)', metric: '命中率', value: 54, unit: '%', threshold: '<60% ⚠️', level: 'warn', jump: 'P1' },
  { group: '检索性能(1h)', metric: 'payload_tokens p95', value: 2300, threshold: '>2000 ⚠️', level: 'warn', jump: '2.4.1' },
  { group: '检索性能(1h)', metric: 'pipeline_llm_tokens p95', value: 2600, threshold: '>3000', level: 'ok', jump: '—' },
  { group: '检索性能(1h)', metric: '延迟 p99', value: 2.6, unit: 's', threshold: '>2s ⚠️', level: 'warn', jump: '—' },
  { group: '检索性能(1h)', metric: '极简证据不足率(1d)', value: 12, unit: '%', threshold: '>20% ⚠️', level: 'ok', jump: '2.4.3' },
  // Agent 使用（批次64 新增：mcp_call 账本聚合）
  { group: 'Agent 使用(7d)', metric: '首调先查记忆率(7d)', value: 88, unit: '%', threshold: '<80% ⚠️', level: 'ok', jump: 'P10' },
  { group: 'Agent 使用(7d)', metric: 'MCP 调用(24h)', value: 69, unit: '次', threshold: '只看趋势', level: 'ok', jump: 'P10' },
  // Agent 健康
  { group: 'Agent 健康', metric: '连通成功率(5min)', value: 97.2, unit: '%', threshold: '<95% ⚠️', level: 'ok', jump: 'P10' },
  { group: 'Agent 健康', metric: '熔断状态', value: 'OPEN', threshold: 'OPEN 🔴', level: 'crit', jump: 'P10' },
  { group: 'Agent 健康', metric: '平均延迟', value: 6.3, unit: 's', threshold: '>5s ⚠️', level: 'warn', jump: 'P10' },
  // 采集与备份（批次64 新增：主进程 collector:status / backup:list）
  { group: '采集与备份', metric: '采集器', value: '在跑', threshold: '停止/连续失败 ⚠️', level: 'ok', jump: 'P9' },
  { group: '采集与备份', metric: '最近备份', value: 2, unit: '天', threshold: '>7 天 ⚠️', level: 'ok', jump: 'S3' },
  // 冷存储
  { group: '冷存储', metric: '写入成功率', value: 99.8, unit: '%', threshold: '<99.5% ⚠️', level: 'ok', jump: '5.4' },
  { group: '冷存储', metric: '哈希校验失败(24h)', value: 1, threshold: '>0 🔴', level: 'crit', jump: '5.4' },
  { group: '冷存储', metric: '质量门拦截(24h)', value: 27, unit: '条', threshold: '正常过滤', level: 'ok', jump: '5.4' },
  // 安全（批次64 新增：l0_auth_fail / l0_auth_deny）
  { group: '安全', metric: '解锁失败(24h)', value: 0, unit: '次', threshold: '>3 次 ⚠️', level: 'ok', jump: 'S2' },
  // 人工审核
  { group: '人工审核', metric: '待裁决', value: 25, threshold: '>20 ⚠️', level: 'warn', jump: 'P7' },
  { group: '人工审核', metric: '超期 7d', value: 2, threshold: '>0 ⚠️', level: 'warn', jump: 'P7' },
  // 后台任务（精炼队列 + 定时任务失败；2026-11-15 用户要求置底）
  { group: '队列', metric: '精炼队列', value: 1240, parts: { ok: 2247, failed: 1273, waiting: 1240, skipped: 265 }, threshold: '>1000 ⚠️', level: 'warn', jump: 'P10(5.3)' },
  { group: '队列', metric: '定时任务失败(24h)', value: 0, unit: '次', threshold: '>0 ⚠️', level: 'ok', jump: 'P9' },
];

// 告警时间戳相对当前时间（避免硬编码日期随时间推移超出筛选时间窗）
const AGO = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export const SEED_ALERTS: AlertItem[] = [
  { ts: AGO(100), level: 'crit', message: 'Agent 熔断 OPEN：连续 5 次超时', request_id: 'req_m1', memory_id: 'mem_001', agent: 'coder-01' },
  { ts: AGO(108), level: 'warn', message: '精炼队列等待 1240 条（阈值 1000）', request_id: 'req_m2', agent: 'writer-02' },
  { ts: AGO(122), level: 'warn', message: '检索命中率 54%（阈值 60%）', request_id: 'req_m3', agent: 'coder-01' },
  { ts: AGO(140), level: 'crit', message: '冷存储哈希校验失败 1 条', request_id: 'req_m4', memory_id: 'mem_030', agent: 'sync-00' },
  { ts: AGO(159), level: 'warn', message: '待裁决冲突 25 条（阈值 20）', request_id: 'req_m5', agent: 'all' },
];
