// 模型配置真落盘（Phase C3）：向量模型/维度是内核构造参数，保存后必须参与 getKernel 装配。
// localStorage 持久化（跨页面/重载生效）；API Key 明文一律不落盘（仅内存，R2）。
import { DEFAULT_VECTOR_DIM } from '../../core/memagent/vector.ts';
import { DEFAULT_USAGES, USAGE_KEYS, VECTOR_MODELS } from './catalog.ts';
import type { LlmUsage, UsageConfig, VectorModelKey } from './types.ts';

const KEY = 'mam.modelConfig.v1';

/** 可落盘的用途配置（去掉 apiKey 明文） */
export type PersistedUsage = Omit<UsageConfig, 'apiKey'>;

export interface ModelConfig {
  vectorKey: VectorModelKey;
  dims: number;
  usages?: Partial<Record<LlmUsage, PersistedUsage>>;
  updatedAt: number;
}

function isVectorKey(v: unknown): v is VectorModelKey {
  return VECTOR_MODELS.some((m) => m.key === v);
}

export function readModelConfig(): ModelConfig | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ModelConfig>;
    if (!isVectorKey(p.vectorKey)) return null;
    if (typeof p.dims !== 'number' || !Number.isInteger(p.dims) || p.dims <= 0) return null;
    return {
      vectorKey: p.vectorKey,
      dims: p.dims,
      usages: p.usages,
      updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function writeModelConfig(cfg: ModelConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* 隐私模式/配额满：仅本次运行生效，UI 不谎报已落盘 */
  }
}

/** 内核构造 / 重建索引用的向量维度（未保存过 → JS 起步实现默认 64 维） */
export function configuredVectorDim(): number {
  return readModelConfig()?.dims ?? DEFAULT_VECTOR_DIM;
}

/** 用途配置落盘前去除 API Key 明文（R2） */
export function sanitizeUsages(usages: Record<LlmUsage, UsageConfig>): Record<LlmUsage, PersistedUsage> {
  const out = {} as Record<LlmUsage, PersistedUsage>;
  for (const [k, v] of Object.entries(usages) as Array<[LlmUsage, UsageConfig]>) {
    const { apiKey: _drop, ...rest } = v;
    void _drop;
    out[k] = rest;
  }
  return out;
}

/** 页面挂载：落盘配置 → 完整用途表单（缺失项回填默认值；apiKey 明文永不回填） */
export function hydrateUsages(persisted?: Partial<Record<LlmUsage, PersistedUsage>>): Record<LlmUsage, UsageConfig> {
  const out = {} as Record<LlmUsage, UsageConfig>;
  for (const u of USAGE_KEYS) {
    out[u] = { ...DEFAULT_USAGES[u], ...persisted?.[u] };
  }
  return out;
}

/** 测试辅助：清除已保存的模型配置（生产代码不得调用） */
export function clearModelConfig(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}
