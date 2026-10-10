// P13 种子数据：3 向量模型 + 4 用途默认 + 反代理映射演示集
import type { LlmUsage, ProxySource, UsageConfig, VectorModelInfo, VectorModelKey } from './types.ts';

export const VECTOR_MODELS: VectorModelInfo[] = [
  { key: 'st', label: 'sentence-transformers（本地）', dims: 384, deploy: '本地', needsKey: false },
  { key: 'bge-m3', label: 'bge-m3（本地）', dims: 1024, deploy: '本地', needsKey: false },
  { key: 'ds', label: 'deepseek-embed（云端）', dims: 768, deploy: '云端', needsKey: true },
];

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

export const SEED_USAGES: Record<LlmUsage, UsageConfig> = {
  write: defaultUsage(),
  judge: { local: true, net: false, endpoint: '', apiKey: '', temperature: 0.0, timeoutSec: 30 },
  rerank: defaultUsage(),
  growth: defaultUsage(),
};

/** 反代理映射（19.8 全量演示）：免费×2（一个近耗尽演示 C8 降权）、低价 ¥0.01、超限 ¥0.03 */
export const SEED_SOURCES: ProxySource[] = [
  { agent: 'claude-code', model: 'claude-free', tier: 'free', price: 0, quota: 1000, used: 120 },
  { agent: 'cursor-trial', model: 'glm-free', tier: 'free', price: 0, quota: 500, used: 480 },
  { agent: 'codex', model: 'gpt4o-mini', tier: 'cheap', price: 0.01, quota: 2000, used: 300 },
  { agent: 'x-agent', model: 'deepseek-v3', tier: 'cheap', price: 0.03, quota: 100, used: 100 },
];

export const SEED_VECTOR_KEY: VectorModelKey = 'st';
export const SEED_VECTOR_COUNT = 1200; // 已入库向量条数（估时用）
