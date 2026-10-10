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
  /** 单价 ¥/千次 */
  price: number;
  /** 声明日额度（次数） */
  quota: number;
  used: number;
}

export type ProxySelectMode = 'auto' | 'manual';

/** 反代理审计条目（R10） */
export interface ProxyAuditEntry {
  event: 'llm_proxy';
  llm_proxy_source: string;
  cost: number;
  mode: ProxySelectMode | 'local';
  at: number;
}
