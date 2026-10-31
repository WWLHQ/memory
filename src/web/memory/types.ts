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
  /** 采集来源（§19.3 双通道）：manual / webhook / mcp；undefined = 手动写入页 */
  source_agent?: string;
  /** 采集会话 ID（§5.4 幂等键的一部分） */
  session_id?: string;
  /** 精炼来源：stub = 未接入 LLM（仅 L1，列表标「未精炼」） */
  refined_by?: 'stub' | 'llm' | 'llm_partial';
  /** 本组层内容（L1–L6）生成时间；undefined = 批次24 之前的历史行，未记录 */
  layers_generated_at?: string;
  /** 该记忆在内存身的层级（内核 layer 字段）。层级页据此判定可编辑层：
   *  编辑只写主内容 + 这一层，其余层是派生视图（改它们会破坏 sha256/向量口径）。 */
  layer?: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';
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

/** 记忆账本位置（诚实标注「存储在哪」，非演示） */
export interface MemoryStoreLocation {
  kind: 'file' | 'memory' | 'unknown';
  path?: string;
  source: string;
}
