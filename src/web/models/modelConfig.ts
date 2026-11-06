// 模型配置真落盘（Phase C3）：向量模型/维度是内核构造参数，保存后必须参与 getKernel 装配。
// localStorage 持久化（跨页面/重载生效）；API Key 明文一律不落盘（仅内存，R2）。
import { DEFAULT_VECTOR_DIM } from '../../core/memagent/vector.ts';
import { DEFAULT_USAGES, USAGE_KEYS, VECTOR_MODELS } from './catalog.ts';
import type { LlmUsage, UsageConfig, VectorModelKey } from './types.ts';

// 批次48 A28：模型配置按租户/用户隔离。旧 key 保留为「空租户缺省」并在首次读取时一次性迁移到租户 key。
const LEGACY_KEY = 'mam.modelConfig.v1';
const TENANT_STORAGE_KEY = 'mam.tenant.v1';

interface TenantStamp {
  user_id?: string;
  team_id?: string;
  enterprise_id?: string;
}

/** 读已持久化的租户三元组（与 kernel.getTenant 同一存储源；此处只读，避免 kernel ↔ modelConfig 循环依赖） */
function storedTenant(): TenantStamp {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(TENANT_STORAGE_KEY);
    if (!raw) return {};
    const t = JSON.parse(raw) as TenantStamp;
    return {
      user_id: typeof t.user_id === 'string' ? t.user_id : undefined,
      team_id: typeof t.team_id === 'string' ? t.team_id : undefined,
      enterprise_id: typeof t.enterprise_id === 'string' ? t.enterprise_id : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * 当前租户的配置 key。
 * 三元组全空 = 空租户 → 回退缺省 key（旧 key），不因缺身份而拒绝读写。
 * 否则形如 `mam.modelConfig.v1:e=<ent>:t=<team>:u=<user>`（encodeURIComponent，避免分隔符冲突）。
 */
export function tenantStorageKey(): string {
  const t = storedTenant();
  if (!t.user_id && !t.team_id && !t.enterprise_id) return LEGACY_KEY;
  const enc = (v?: string): string => encodeURIComponent(v ?? '-');
  return `${LEGACY_KEY}:e=${enc(t.enterprise_id)}:t=${enc(t.team_id)}:u=${enc(t.user_id)}`;
}

/**
 * 旧 key 一次性迁移：租户 key 尚无数据、旧 key 有数据时复制过去并删除旧 key。
 * 只迁移一次（删旧），同一浏览器后续切换租户不会重复拿到别人的配置。
 */
function migrateLegacyIfNeeded(key: string): string | null {
  if (key === LEGACY_KEY) return null;
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
  if (!legacy) return null;
  try {
    localStorage.setItem(key, legacy);
    localStorage.removeItem(LEGACY_KEY);
    return legacy;
  } catch {
    return null;
  }
}

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
    const key = tenantStorageKey();
    const raw = localStorage.getItem(key) ?? migrateLegacyIfNeeded(key);
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
    localStorage.setItem(tenantStorageKey(), JSON.stringify(cfg));
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

/** 测试辅助：清除已保存的模型配置（当前租户 key + 旧 key；生产代码不得调用） */
export function clearModelConfig(): void {
  if (typeof localStorage === 'undefined') return;
  // 清掉旧 key 与所有租户维度的 key（测试隔离；正常运行时只会有一份当前租户配置）
  for (const k of Object.keys(localStorage)) {
    if (k === LEGACY_KEY || k.startsWith(`${LEGACY_KEY}:`)) localStorage.removeItem(k);
  }
  localStorage.removeItem(TENANT_STORAGE_KEY);
}
