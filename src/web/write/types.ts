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

export interface ExistingMemory {
  id: string;
  content: string;
}

/**
 * 查重预览（批次25 P0-3）：页面只实算词面重合度，只报这一个数；
 * 旧的 semantic/keyword/entity/structure/llm_judge 全是同一 Jaccard 的仿射变换。真正判重由内核提交时执行。
 */
export interface DedupResult {
  /** 本地词面相似度（Jaccard，0–1） */
  score: number;
  /** 对照层（未接入大模型时内核只对 L1 查重） */
  layer: LayerName;
  /** 该层阈值，取内核单一真源 layerRules.DEDUP_THRESHOLDS */
  threshold: number;
  is_duplicate: boolean;
  matched?: ExistingMemory;
}

export interface ReceiptLayer {
  summary: string;
  auditOnly?: boolean;
  /** 本次写入真实产出的层（false = 未生成，界面标「未精炼」） */
  produced: boolean;
  /** 真实层内容（L1 不展示，仅审计展开） */
  text?: string;
}

export interface WriteReceipt {
  /** 内核本次真实签发的请求号（拒绝时也可能由内核带在错误详情里） */
  request_id: string;
  memory_id: string;
  /** 内核回执时间（页面记录的真实落定时刻） */
  created_at: string;
  layers: Record<LayerName, ReceiptLayer>;
  /** 内核四态映射：create / graft（分支嫁接）/ keep（duplicated）/ filtered（L0→L1 质量门拦截，未入库） */
  /** 阶段5-E / B10：只保留内核写路径真实产出的四种结果（见 coreWrite.ts） */
  dedup_action: 'create' | 'graft' | 'keep' | 'filtered';
  /** 精炼来源：stub = 未接入 LLM（只落 L1） */
  refined_by: 'stub' | 'llm' | 'llm_partial';
}

/** 被内核拒绝的写入：不生成成功回执，只如实展示原因与 request_id（可能未签发） */
export interface WriteRefusal {
  reason: string;
  request_id: string | null;
  created_at: string;
  /** L0 写密钥锁定 = 可原地解锁后重放，不是内容问题 */
  l0_locked: boolean;
}

/** 最近回执行（来源：账本审计 action=write，无演示数据） */
export interface WriteReceiptHistoryRow {
  request_id: string;
  ts: number;
  action: string;
  result: string;
  dedup: string;
  sim: number | null;
  memory_id: string | null;
  layers: string;
  source: string;
  /** filtered 行的拦截码与质量门版本（批次58 最近写入通栏如实展示；非 filtered 为 null） */
  filter_code: string | null;
  gate_version: number | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}
