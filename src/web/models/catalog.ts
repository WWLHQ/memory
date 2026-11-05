// P13 大模型配置页：规格常量（向量模型 + 四用途默认参数）。
// 反代理源不再硬编码虚构目录（批次42 阶段3-B 已删除）—— 真实模型来自主进程网关快照，
// 经 hostLlm.getHostLlmSnapshot() 单一真源下发；used 由 coreModels 从内核审计账本当日 llm_proxy 明细实算。
import type { LlmUsage, UsageConfig, VectorModelInfo, VectorModelKey } from './types.ts';

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
