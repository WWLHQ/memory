// P13 大模型配置页：规格常量 + 反代理源目录（19.8）。
// 这里只放「配置事实」：模型清单、档位、单价、声明额度、默认用途参数。
// 已用次数（used）不在这里 —— 由 coreModels 从内核审计账本当日 llm_proxy 明细实算。
import type { LlmUsage, ProxyTier, UsageConfig, VectorModelInfo, VectorModelKey } from './types.ts';

export const VECTOR_MODELS: VectorModelInfo[] = [
  { key: 'st', label: 'sentence-transformers（本地）', dims: 384, deploy: '本地', needsKey: false },
  { key: 'bge-m3', label: 'bge-m3（本地）', dims: 1024, deploy: '本地', needsKey: false },
  { key: 'ds', label: 'deepseek-embed（云端）', dims: 768, deploy: '云端', needsKey: true },
];

export const DEFAULT_VECTOR_KEY: VectorModelKey = 'st';

export const USAGE_KEYS: LlmUsage[] = ['write', 'judge', 'rerank', 'growth'];

export const USAGE_LABELS: Record<LlmUsage, string> = {
  write: '写入抽取（write）',
  judge: '冲突裁决（judge）',
  rerank: '检索重排（rerank）',
  growth: '记忆生长（growth）',
};

export function defaultUsage(): UsageConfig {
  return { local: true, net: false, endpoint: '', apiKey: '', temperature: 0.3, timeoutSec: 30 };
}

/** 四用途默认参数（judge 温度恒 0，R4） */
export const DEFAULT_USAGES: Record<LlmUsage, UsageConfig> = {
  write: defaultUsage(),
  judge: { local: true, net: false, endpoint: '', apiKey: '', temperature: 0.0, timeoutSec: 30 },
  rerank: defaultUsage(),
  growth: defaultUsage(),
};

export interface ProxyCatalogEntry {
  agent: string;
  model: string;
  tier: ProxyTier;
  /** 单价 ¥/千次 */
  price: number;
  /** 声明日额度（次数） */
  quota: number;
}

/**
 * 反代理源目录（19.8）：免费 → 低价阶梯。额度为真实声明值，
 * 当日已用量由账本审计实算（coreModels.loadSources）。
 */
export const PROXY_CATALOG: ProxyCatalogEntry[] = [
  { agent: 'claude-code', model: 'claude-free', tier: 'free', price: 0, quota: 5000 },
  { agent: 'cursor-trial', model: 'glm-free', tier: 'free', price: 0, quota: 5000 },
  { agent: 'codex', model: 'gpt4o-mini', tier: 'cheap', price: 0.01, quota: 2000 },
  { agent: 'x-agent', model: 'deepseek-v3', tier: 'cheap', price: 0.03, quota: 2000 },
];
