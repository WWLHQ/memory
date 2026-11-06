// P13 大模型配置页（REQ-009 13.2 / 19.8）数据模型
export type VectorModelKey = 'st' | 'bge-m3' | 'ds';

export interface VectorModelInfo {
  key: VectorModelKey;
  label: string;
  dims: number;
  deploy: '本地' | '云端';
  /** 云端模型必须配 Key（R2 脱敏展示） */
  needsKey: boolean;
}

/** LLM 四用途（13.2）：write 写入 / judge 冲突裁决 / rerank 重排 / growth 生长 */
export type LlmUsage = 'write' | 'judge' | 'rerank' | 'growth';

export interface UsageConfig {
  /** 本地模型通道 */
  local: boolean;
  /** 网络模型通道（C3：勾选必须配端点） */
  net: boolean;
  endpoint: string;
  /** 明文仅存内存，展示一律走 maskKey（R2） */
  apiKey: string;
  temperature: number;
  timeoutSec: number;
}

export type ProxyTier = 'free' | 'cheap' | 'paid';

/** 反代理来源映射（19.8）：Agent × 模型 × 档位 × 单价 × 额度 × 已用 */
export interface ProxySource {
  agent: string;
  model: string;
  tier: ProxyTier;
  /** 单价 ¥/千次；null = 未设置（批次48 A16：云端无真实计费接口，由参数页配置） */
  price: number | null;
  /** 声明日额度（次数）；null = 未设置；Infinity = 不限量（本地端点） */
  quota: number | null;
  used: number;
}

export type ProxySelectMode = 'auto' | 'manual';

/** R10：真实代理调用审计（账本 llm_proxy / llm_fallback） */
export interface ProxyCallAuditEntry {
  event: 'llm_proxy';
  llm_proxy_source: string;
  /** 真实花费（usage × 单价）；null = usage/单价未记录（不拿 0 冒充已计费，批次48 A24） */
  cost: number | null;
  mode: ProxySelectMode | 'local';
  at: number;
}

/**
 * 保存模型配置（账本 param_save + detail.kind=model_config）。
 * 它不是代理调用，**没有** llm_proxy_source / cost / mode，绝不拿 0 或 agent:local 冒充。
 * 字段全部取自账本 detail；历史记录缺字段时为 null（UI 显示「未记录」）。
 */
export interface ModelConfigAuditEntry {
  event: 'model_config';
  at: number;
  vector: string | null;
  dims: number | null;
  reembedded: number | null;
  persisted: boolean | null;
  api_key_persisted: boolean | null;
}

/** 审计回显条目 = 账面真实事件的可辨识联合（阶段4-G / B6 接真） */
export type ProxyAuditEntry = ProxyCallAuditEntry | ModelConfigAuditEntry;
