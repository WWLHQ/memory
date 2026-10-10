// 生命周期页（REQ-006 / P4）数据模型
// 字段对应规格 §P4（9.10 / 17.4 / 17.5）。

export type MemoryStatus =
  | 'active'
  | 'hibernating'
  | 'archived'
  | 'deprecated'
  | 'stale'
  | 'dormant';

export type DecayClass = 'hot' | 'warm' | 'cold' | 'archived' | 'dormant';

export interface LifecycleRecord {
  id: string;
  content: string;
  status: MemoryStatus;
  /** 9.7 deprecated 替代（点跳替代记忆详情占位） */
  replaced_by?: string;
  replaced_at?: string;
  ageDays: number;
  half_life_days: number;
  confidence: number; // 0–1，下限 0.05
  importance: number; // 0–1，下限 0.1
  access_count: number; // 与 reinforce 分家（17.4）
  reinforce_count: number;
  pinned: boolean;
  locked: boolean; // 锁定后调参面板全置灰（G4），仅可解锁
  decay_class: DecayClass;
}

export type LifeOp =
  | { kind: 'migrate'; target: MemoryStatus }
  | { kind: 'param'; half_life_days?: number; confidence?: number; importance?: number; pinned?: boolean; locked?: boolean }
  | { kind: 'batch_migrate'; ids: string[]; target: MemoryStatus };

export interface OpResult {
  ok: boolean;
  /** 批量操作返回多条；单条操作返回 1 条 */
  affected: LifecycleRecord[];
  audit: string;
  request_id: string;
  message?: string;
}
