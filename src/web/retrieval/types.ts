// 检索页（REQ-012）数据模型
// 规格：§0 状态机 / §1 查询栏 / §2 横幅 / §3 结果行 / §4 上下文 / §5 预算 / §6 异常态。
import type { RecallDispatchInfo } from '../../core/memagent/types.ts';

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
  /** 来源项目（默认「全部项目」召回时逐条标明，不静默丢弃） */
  project_id?: string;
  /** 该记忆当前主层（L1–L6），用于结果行标注 */
  layer?: string;
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
  /** 实际生效模式（自动档 = 内核分流结论；applied 未套用建议时取建议值，见 dispatch） */
  mode: Mode;
  fallback: boolean;
  /** 自动分流命中的特征词（来自内核 resolveMode.hitKeywords，不是 Web 自己的词表） */
  hit_keywords: string[];
  /** A5 次模式降级注入提示（内核真值；无次模式时 null，不再本地编一条「极简 200t」） */
  secondary_mode_hint?: { mode: Mode; note: string; content?: string } | null;
  /** A6：内核分流事实（来源/建议/实际/依据），与 MCP 回显、mode_dispatch 审计同一份 */
  dispatch?: RecallDispatchInfo | null;
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
  /** 本次查询条设定的预算（tokens）；页面按可见高度/场景给默认值 */
  budget_tokens?: number;
  /** 按预算实际注入（命中仍全部展示，注入条数单独计数） */
  injected_tokens?: number;
  injected_count?: number;
  /** 因预算被裁掉的结果条数（真实计算，不是演示值） */
  dropped_count?: number;
  /** 注入深度（L1 / L1–L3 / L1–L6；注入纪律仍只 L1） */
  depth?: string;
}

/** 检索历史（来源：账本审计 action=recall，无演示数据） */
export interface RecallHistoryRow {
  request_id: string;
  ts: number;
  query: string;
  scene: string;
  mode: string;
  hits: number;
  payload_tokens: number;
  latency_ms: number | null;
  evidence_thin: boolean;
}
