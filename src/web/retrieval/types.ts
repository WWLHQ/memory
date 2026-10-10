// 检索页（REQ-012）数据模型
// 规格：§0 状态机 / §1 查询栏 / §2 横幅 / §3 结果行 / §4 上下文 / §5 预算 / §6 异常态。

export type Scene = 'default' | 'task_start' | 'history_query' | 'critical';
export type Mode = 'top_insight' | 'fact_first' | 'event_replay' | 'pattern_reasoning' | 'minimal';
/** null = 自动（走 2.4.4 分流） */
export type ModeSel = Mode | null;

export type PageState = 'IDLE' | 'LOADING' | 'RESULT' | 'EMPTY' | 'ERROR';

/** 温度徽标（15.3） */
export type DecayClass = 'hot' | 'warm' | 'cold' | 'archived' | 'dormant';

/** 预算档位（R9：1500 裁剪 / 2000 告警 / 3000 硬熔断） */
export type BudgetLevel = 'ok' | 'trim' | 'warn' | 'breach';

export interface RetrievalHit {
  memory_id: string;
  content: string;
  /** cold/dormant 时仅 L2 占位符（R2） */
  l2_only: boolean;
  decay_class: DecayClass;
  pinned: boolean;
  locked: boolean;
  freshness: number;
  importance: number;
  confidence: number;
  score: number;
  tags: string[];
  merged_from?: string[];
  /** 冲突仲裁说明（2.4.2 规则6） */
  conflict_note?: string;
  age_days: number;
  half_life_days: number;
}

export interface SceneBudget {
  budget: number;
  defaultMode: Mode;
  backfillDepth: string;
  rerank: boolean | 'auto';
  modes: Mode[];
}

/** 横幅数据（§2） */
export interface ModeBannerData {
  scene: Scene;
  mode: Mode;
  fallback: boolean;
  hit_keywords: string[];
  secondary_mode_hint?: { mode: Mode; note: string } | null;
  request_id: string;
  evidence_thin?: 'none' | 'backfill_hit' | 'backfill_miss';
  cold_recall?: boolean;
}

/** 预算面板数据（§5） */
export interface BudgetData {
  payload_tokens: number;
  pipeline_llm_tokens: number;
  stage1_count: number;
  stage2_count: number;
  rerank_applied: boolean;
  rerank_fallback?: boolean;
  budget_breach: boolean;
  breach_detail?: string[];
}
