// 生长页单测夹具（仅测试用；页面数据真相 = 内核账本）。
import type { DedupSample, DeltaPoint, GrowthMetrics } from '../types.ts';

export const SAMPLES: DedupSample[] = [
  {
    id: 's1', label: '「用户偏好深色主题 · 凌晨使用多」', target: 'L2',
    dims: { semantic: 0.91, keyword: 0.62, entity: 0.70, structure: 0.55, llm_judge: 0.88 },
  },
  {
    id: 's2', label: '「API 网关超时重试策略 · 指数退避」', target: 'L4',
    dims: { semantic: 0.44, keyword: 0.85, entity: 0.40, structure: 0.66, llm_judge: 0.35 },
  },
  {
    id: 's3', label: '「部署脚本使用 Docker Compose v2」', target: 'L1',
    dims: { semantic: 0.96, keyword: 0.78, entity: 0.82, structure: 0.71, llm_judge: 0.93 },
  },
  {
    id: 's4', label: '「季度汇报模板 · 数据看板优先」', target: 'L3',
    dims: { semantic: 0.55, keyword: 0.48, entity: 0.62, structure: 0.52, llm_judge: 0.41 },
  },
];

export const SEED_METRICS: GrowthMetrics = {
  hit_rate: 0.28,
  confirmed: 132,
  rejected: 41,
  low_quality_ratio: 0.45,
  level_stats_L6: 0.42,
  latency_ms: 218,
};

export const SEED_DELTA: DeltaPoint[] = [
  { day: '周一', delta: 0.012, is_tuned: false },
  { day: '周二', delta: 0.018, is_tuned: false },
  { day: '周三', delta: 0.015, is_tuned: false },
  { day: '周四', delta: 0.024, is_tuned: false },
  { day: '周五', delta: 0.021, is_tuned: false },
  { day: '周六', delta: 0.026, is_tuned: false },
  { day: '周日', delta: 0.041, is_tuned: true },
];
