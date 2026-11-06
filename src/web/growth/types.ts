// P14 自我净化与生长页（REQ-009 6.1/6.2/7.1/7.2/13.3）数据模型
// 权重/阈值/层号类型单一真源在 shared/growthConfig.ts（内核与页面共用，避免两套定义漂移）
import type { DimKey, DimWeights, Layer, LayerThresholds } from '../../shared/growthConfig.ts';
export type { DimKey, DimWeights, Layer, LayerThresholds };

/** 判重样本：五维得分 + 目标写入层。null = 内核/账本无该维的可信测量，绝不拿中性值冒充 */
export interface DedupSample {
  id: string;
  label: string;
  dims: Record<DimKey, number | null>;
  target: Layer;
}

/** 短路嫁接流程步骤（6.2） */
export interface ShortCircuitStep {
  /** '新建' 表示全层未命中的终态 */
  layer: Layer | '新建';
  /** 该层查重是否命中 */
  hit: boolean;
  /** 命中后的动作（合并/停止） */
  action?: string;
}

/** 自生长反馈指标（7.1，只读） */
export interface GrowthMetrics {
  hit_rate: number;
  confirmed: number;
  rejected: number;
  low_quality_ratio: number;
  level_stats_L6: number;
  /** 阶段5-F：真实 recall 审计 detail.latency_ms 的平均值；无样本为 0（配 latency_samples 判空） */
  latency_ms: number;
  /** 阶段5-F：真实延迟样本条数；0 = 未采集 / 历史缺字段，UI 显示「—」而非 0ms */
  latency_samples: number;
}

export type OptState = 'triggered' | 'running' | 'idle';

/** 五项自动优化（7.2） */
export interface OptimizationItem {
  key: 'lower_threshold' | 'refine_keyword' | 'accelerate_decay' | 'pre_index' | 'regress_weights';
  title: string;
  condition: string;
  action: string;
  auditName: string;
  state: OptState;
  triggeredBy: string;
}

/** 调度项（13.3） */
export interface ScheduleItem {
  key: 'decay' | 'verdict_reminder' | 'self_growth' | 'archive';
  label: string;
  cron: string;
  /** 是否允许停用（衰减不可停，R5） */
  required: boolean;
  enabled: boolean;
  /**
   * 批次48 A23.2：账本里真实存在的最近一次 schedule_run 记录（无记录 = null = 未运行）。
   * 全部字段只来自审计，不从 cron 推算「应该运行过」。
   */
  run?: ScheduleRunInfo | null;
}

/** 一次真实调度执行记录（action='schedule_run' 的 detail 投影） */
export interface ScheduleRunInfo {
  task: 'decay' | 'verdict_reminder' | 'self_growth' | 'archive';
  /** 执行宿主（如 electron-main）；未知记录不冒充 */
  host: string;
  status: 'ok' | 'skipped' | 'error';
  trigger?: string;
  duration_ms: number | null;
  next_due_at: number | null;
  error: string | null;
  result: Record<string, unknown>;
  ts: number;
}

/** 自生长收益曲线点（7.2 / 13.3） */
export interface DeltaPoint {
  day: string;
  delta: number;
  /** 是否 weight_tuned 触发点（每周日 03:00） */
  is_tuned: boolean;
}

/** 审计条目（R2 / G6 / 4.3） */
export interface GrowthAuditEntry {
  event: string;
  action: string;
  payload: string;
  at: number;
}
