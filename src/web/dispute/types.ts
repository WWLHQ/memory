// 冲突裁决页（REQ-006 / P7）数据模型
// 字段严格对应规格 §P7（12.1 / 9.7 / 16.2 / 18.2-E / 18.4 约束5）。

/** 冲突类型（9.7） */
export type ConflictType =
  | 'direct_contradiction'
  | 'partial_overlap'
  | 'context_dependent'
  | 'uncertain';

/** 裁决动作（9.7 三模式 + 保留） */
export type Verdict = 'auto_override' | 'user_confirm' | 'merge' | 'hold';

export interface ConflictRecord {
  id: string;
  old_id: string;
  new_id: string;
  old_content: string;
  new_content: string;
  old_confidence: number;
  new_confidence: number;
  conflict_type: ConflictType;
  /** >0.7 触发（9.7） */
  conflict_score: number;
  /** 队列筛选（12.1 人工审核） */
  dispute_flag: boolean;
  overdue_days: number;
  /** auto_override 后回填（9.7） */
  replaced_by?: string;
  replaced_at?: string;
  created_at: string;
}

/** 成对审计对象（16.2 / 18.4 约束5） */
export interface ConflictAudit {
  action: string;
  old_id: string;
  new_id: string;
  verdict: Verdict;
  request_id: string;
  note?: string;
}
