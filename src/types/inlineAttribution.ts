// REQ-004 Agent 界面内联记忆标识：领域类型（T1 契约基线）
// 来源：需求规格书_Agent界面内联记忆标识.md（19.7）§1/§2/§4、设计/ui/Agent界面内联标识_原型.html
// 范围：仅定义类型。实际 write_memory / 召回 / token 统计属 REQ-007；反馈经 FeedbackPort 端口收口（见 T7）。

/** 衰减层温度点（§2.1，15.3） */
export type DecayClass = 'hot' | 'warm' | 'cold' | 'dormant';

/** ① 记忆注入标记（答案段落内联 🧠） */
export interface MemoryInjectionMark {
  memory_id: string;
  /** L2 占位符摘要（≤200t，cold 条不给 L1 原文，15.3） */
  summaryL2: string;
  decay_class: DecayClass;
  /** 老化提示（9.6：45 天前→"代码可能已改动，请校验"），空串表示未老化 */
  aging_hint: string;
  /** 审计页 request_id（4.3 可溯源） */
  request_id: string;
  /** 证据不足标记（2.4.3 evidence_thin），恒显示不可关 */
  evidence_thin?: boolean;
}

/** ② Token 节省标记（回答底部 ⚡ 一行 + 分解） */
export interface TokenSaving {
  /** 本次召回注入的记忆 token */
  actual_payload: number;
  /** 若不裁剪的全量 token（对比基线） */
  full_baseline: number;
  /** 节省额 = full_baseline − actual_payload */
  saved: number;
  /** 归因分解（极简 / L2 占位符 / 超支裁剪） */
  breakdown: Array<{ reason: string; tokens: number }>;
}

/** ③ 背景免重复标记（会话头部 📎）条目 */
export interface BackgroundItem {
  id: string;
  kind: 'stack' | 'constraint' | 'decision' | 'pitfall';
  text: string;
}

/** ③ 背景免重复标记（新会话自动带入的项目上下文） */
export interface BackgroundMark {
  count: number;
  items: BackgroundItem[];
}

/** ④ 老化 / 证据警示（对应答案内联 ⚠️） */
export interface AgingWarnMark {
  kind: 'aging' | 'evidence_thin';
  text: string;
  request_id: string;
}

/** 💾 写入沉淀标记（每回答贡献摘要里的 write_memory 提示，仅展示，实际写入属 REQ-007） */
export interface WriteBackMark {
  memory_id: string;
  request_id: string;
  summary: string;
}

/** 标识详略级别（§4 可开关与降级） */
export type AttributionLevel = 'full' | 'token_only' | 'off';

/** 内联标识配置（Agent 端可配置，默认开） */
export interface AttributionConfig {
  show_memory_attribution: boolean;
  attribution_level: AttributionLevel;
}

/** 用户干预动作（13.7 反馈） */
export type FeedbackAction = 'confirm' | 'reject' | 'disputed';

/**
 * 信任增量（13.7 → 7.2 自生长；9.10 stale）。
 * confirm +0.1（提升优先级）/ reject −0.05（降权不删除）/ disputed → 冲突裁决队列 P7。
 */
export interface TrustDelta {
  action: FeedbackAction;
  delta: number;
  /** disputed 时进入冲突裁决队列 */
  toConflictQueue?: boolean;
}

/** 反馈端口（T7）：组件只依赖此接口，不直连后端；真实内核端口留待 REQ-007 */
export interface FeedbackPort {
  writeAudit(req: string, delta: TrustDelta): void;
}
