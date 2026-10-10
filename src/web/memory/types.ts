// 记忆管理页（REQ-006 / P8）数据模型
// 字段严格对应规格 §P8（17.3 / 9.5 / 9.10.1 / 17.4 / 15.3）。

/** 六态机（9.10.1） */
export type MemoryStatus =
  | 'active'
  | 'hibernating'
  | 'archived'
  | 'deprecated'
  | 'stale'
  | 'dormant';

/** 温度（15.3 / 17.5）：由 age 与 half_life 推导 */
export type DecayClass = 'hot' | 'warm' | 'cold' | 'archived' | 'dormant';

/** 记忆类别（17.6 六类，这里仅做字符串枚举约束） */
export type MemoryType =
  | 'decision'
  | 'pitfall'
  | 'preference'
  | 'fact'
  | 'project'
  | 'feedback';

export interface MemoryRecord {
  id: string;
  content: string;
  type: MemoryType;
  tags: string[];
  /** 0–1，下限 0.1（17.4） */
  importance: number;
  /** 0–1，下限 0.05（2.4.2 规则4） */
  confidence: number;
  /** 访问次数（与 reinforce 分家，17.4） */
  access_count: number;
  reinforce_count: number;
  pinned: boolean;
  locked: boolean;
  archived: boolean;
  status: MemoryStatus;
  /** 合并谱系（15.2 / 17.9） */
  merged_from?: string[];
  merged_into?: string;
  created_at: string;
  updated_at: string;
  /** 距今天数（用于 decay 推导，17.5） */
  ageDays: number;
  /** 半衰期天数（17.5），下限钳制 >0 */
  halfLifeDays: number;
}

/** 17.3 操作类型 */
export type MemoryOp =
  | 'remember'
  | 'forget'
  | 'pin'
  | 'unpin'
  | 'lock'
  | 'unlock'
  | 'archive'
  | 'restore'
  | 'delete';

export interface OpResult {
  /** 操作后记录；delete 返回 null（已移除） */
  rec: MemoryRecord | null;
  /** G6 审计动作枚举 */
  audit: string;
  /** 是否被 locked 约束拒绝（G4） */
  ok: boolean;
}
