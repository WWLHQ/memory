// 写入页（REQ-006 / P2）数据模型
// 字段严格对应规格 §P2（13.6 / 6.1 / 17.6）。

/** 六类知识库（17.6） */
export type MemoryCategory =
  | 'decision'
  | 'pitfall'
  | 'preference'
  | 'fact'
  | 'project'
  | 'feedback';

/** 写入来源（§P2） */
export type SourceKind = 'conversation' | 'api' | 'mcp';

export type LayerName = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

export interface MemoryDraft {
  content: string;
  category: MemoryCategory;
  tags: string[];
  source: SourceKind;
  /** 全局继承，可清空（§P2） */
  session_id: string;
  /** 全局注入，只读必填（R2，禁手填/禁空） */
  project_id: string;
}

export interface DedupDimScores {
  semantic: number;   // 35%
  keyword: number;    // 20%
  entity: number;     // 15%
  structure: number;  // 10%
  llm_judge: number;  // 20%
}

export interface ExistingMemory {
  id: string;
  content: string;
}

export interface DedupResult {
  dims: DedupDimScores;
  composite: number;
  threshold: number;
  is_duplicate: boolean;
  matched?: ExistingMemory;
}

export interface WriteReceipt {
  memory_id: string;
  layers: Record<LayerName, { summary: string; auditOnly?: boolean }>;
  dedup_action: 'create' | 'merge' | 'overwrite' | 'keep';
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}
