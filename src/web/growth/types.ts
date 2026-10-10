// P14 自我净化与生长页（REQ-009 6.1/6.2/7.1/7.2/13.3）数据模型
/** 五维查重维度（6.1） */
export type DimKey = 'semantic' | 'keyword' | 'entity' | 'structure' | 'llm_judge';

export type DimWeights = Record<DimKey, number>;

/** 层级 L1–L6（9.10） */
export type Layer = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';
export type LayerThresholds = Record<Layer, number>;

/** 判重样本：五维得分 + 目标写入层 */
export interface DedupSample {
  id: string;
  label: string;
  dims: Record<DimKey, number>;
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
  latency_ms: number;
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
