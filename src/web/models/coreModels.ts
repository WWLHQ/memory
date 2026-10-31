// 大模型配置页（REQ-009 / P13）接真内核：
//  · auto 择优走内核 routeProxy（19.8 统一路由）；「模拟」是 dry-run —— 不写账本、不扣额度（Phase C3）。
//  · 保存 model_config 真落盘（localStorage）：向量维度参与内核构造，已入库记忆按新维度重嵌入。
//  · 反代理源的「已用次数 / 当日花费」由账本 llm_proxy 明细实算，不使用任何演示数字。
//  · manual 模式的 R7/C11 选择约束属端壳 UX（内核 routeProxy 无 manual 语义），仍在页面逻辑层。
import type { ModelInfo } from '../../core/memagent/types.ts';
import { routeProxy } from '../../core/memagent/llm.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { embedSync, JsVectorBackend } from '../../core/memagent/vector.ts';
import { getKernelStorage, newRequestId, KERNEL_FORM, rebuildKernelFromModelConfig } from '../kernel.ts';
import { PROXY_CATALOG } from './catalog.ts';
import { readModelConfig, sanitizeUsages, writeModelConfig } from './modelConfig.ts';
import { vectorInfo } from './logic.ts';
import type { LlmUsage, ProxyAuditEntry, ProxySource, UsageConfig, VectorModelKey } from './types.ts';

const DAY = 24 * 3600 * 1000;

interface Ctx {
  models: ModelInfo[];   // 内核路由输入（used 由账本当日 llm_proxy 明细实算）
  usedToday: number;     // 19.8 cost_cap 口径（账本当日 llm_proxy 花费求和）
  storage: StorageBackend;
}

/** 当日账本中每个 model 的调用次数（llm_proxy 审计 detail.model） */
function usedByModel(audits: { ts: number; action: string; detail: Record<string, unknown> }[]): Record<string, number> {
  const since = Date.now() - DAY;
  const out: Record<string, number> = {};
  for (const a of audits) {
    if (a.action !== 'llm_proxy' || a.ts < since) continue;
    const model = typeof a.detail.model === 'string' ? a.detail.model : '';
    if (!model) continue;
    out[model] = (out[model] ?? 0) + 1;
  }
  return out;
}

/** 当日真实代理花费（llm_proxy 审计 detail.cost 求和） */
function costToday(audits: { ts: number; action: string; detail: Record<string, unknown> }[]): number {
  const since = Date.now() - DAY;
  return audits.reduce((sum, a) => {
    if (a.action !== 'llm_proxy' || a.ts < since) return sum;
    return sum + (typeof a.detail.cost === 'number' ? a.detail.cost : 0);
  }, 0);
}

async function getCtx(): Promise<Ctx> {
  const storage = getKernelStorage();
  const audits = await storage.queryAudit({});
  const used = usedByModel(audits);
  const models: ModelInfo[] = PROXY_CATALOG.map((s) => ({
    model: s.model, tier: s.tier, price: s.price, quota: s.quota, used: used[s.model] ?? 0,
  }));
  return { models, usedToday: costToday(audits), storage };
}

/** 反代理源列表（真实账本已用量回填） */
export async function coreLoadSources(): Promise<ProxySource[]> {
  const ctx = await getCtx();
  const entryOf = (model: string) => PROXY_CATALOG.find((c) => c.model === model)!;
  return ctx.models.map((m) => ({
    agent: entryOf(m.model).agent,
    model: m.model,
    tier: m.tier,
    price: m.price,
    quota: m.quota,
    used: m.used,
  }));
}

/** 已入库向量条数（账本中带 embedding 的记忆数，真实统计） */
export async function coreVectorCount(): Promise<number> {
  const storage = getKernelStorage();
  const mems = await storage.listMemories({});
  return mems.filter((m) => Array.isArray(m.embedding) && m.embedding.length > 0).length;
}

export interface SimulateOutcome {
  source: ProxySource | null;  // 命中源（null = 回退本地）
  reason: string;
  cost: number;
  /** 恒为 true：模拟不写审计、不扣额度，仅预览路由结果（Phase C3 dry-run） */
  dryRun: true;
}

/** auto 模拟调用（dry-run）：内核统一路由先免费 → 低价 ≤ price_cap → cost_cap → 回退本地 */
export async function coreSimulateAuto(priceCap: number, costCap: number): Promise<SimulateOutcome> {
  const ctx = await getCtx();
  const r = routeProxy(ctx.models, priceCap, costCap, ctx.usedToday);
  const catalog = r.model ? PROXY_CATALOG.find((c) => c.model === r.model) : undefined;
  const used = r.model ? (ctx.models.find((m) => m.model === r.model)?.used ?? 0) : 0;
  const source: ProxySource | null = catalog ? { ...catalog, used } : null;
  return { source, reason: r.reason, cost: r.cost, dryRun: true };
}

export interface SaveConfigOutcome {
  entry: ProxyAuditEntry;
  /** 本次按新维度重嵌入的记忆条数（维度未变 → 0） */
  reembedded: number;
  /** 配置是否已持久化落盘（localStorage 不可用/配额满 → false，UI 不得谎报已保存） */
  persisted: boolean;
}

/**
 * 保存 model_config（Phase C3 真落盘）：
 * 写入 localStorage → 维度变化时重嵌入全部已入库记忆 → 重建全局内核 → 记一条 param_save 审计。
 */
export async function coreSaveConfig(
  vectorKey: VectorModelKey,
  vectorLabel: string,
  dims: number,
  usages: Record<LlmUsage, UsageConfig>,
): Promise<SaveConfigOutcome> {
  const ctx = await getCtx();
  const prev = readModelConfig();
  writeModelConfig({
    vectorKey,
    dims,
    usages: sanitizeUsages(usages), // R2：API Key 明文不落盘
    updatedAt: Date.now(),
  });
  const persistedCfg = readModelConfig();
  const persisted = persistedCfg?.vectorKey === vectorKey && persistedCfg?.dims === dims;

  let reembedded = 0;
  if (!prev || prev.dims !== dims) {
    const mems = await ctx.storage.listMemories({});
    for (const m of mems) {
      await ctx.storage.putMemory({ ...m, embedding: embedSync(m.content, dims) });
      reembedded += 1;
    }
  }
  rebuildKernelFromModelConfig();

  const at = Date.now();
  await ctx.storage.appendAudit({
    request_id: newRequestId('req'),
    action: 'param_save',
    form: KERNEL_FORM,
    ts: at,
    detail: {
      kind: 'model_config',
      vector: vectorLabel,
      vector_key: vectorKey,
      dims,
      reembedded,
      persisted,
      api_key_persisted: false,
    },
  });
  return {
    entry: { event: 'llm_proxy', llm_proxy_source: 'agent:local', cost: 0, mode: 'local', at, kind: 'model_config' },
    reembedded,
    persisted,
  };
}

export interface VectorProbeResult {
  ok: boolean;
  message: string;
}

/**
 * 向量连通测试（Phase C3 诚实版）：
 *  · 本地档：真实跑一次嵌入，校验维度与输出非全零；
 *  · 云端档：内核尚未接入云端嵌入通道 → 如实「未验证」，绝不谎报通过。
 */
export async function coreVectorProbe(vectorKey: VectorModelKey, apiKey: string): Promise<VectorProbeResult> {
  const info = vectorInfo(vectorKey);
  if (info.needsKey) {
    return {
      ok: false,
      message: apiKey.trim()
        ? `未验证：${info.label} 云端嵌入通道尚未接入内核（Key 仅内存，R2）；当前嵌入仍由本地 hash 起步实现执行`
        : `未验证：${info.label} 为云端模型且未填 API Key；当前嵌入仍由本地 hash 起步实现执行`,
    };
  }
  try {
    const backend = new JsVectorBackend(info.dims);
    const [vec] = await backend.embed(['向量连通测试 vector probe']);
    if (vec.length !== info.dims) {
      return { ok: false, message: `维度不符：期望 ${info.dims}，实际 ${vec.length}` };
    }
    if (!vec.some((v) => v !== 0)) {
      return { ok: false, message: '嵌入输出全零，向量后端不可用' };
    }
    return {
      ok: true,
      message: `本地嵌入通道可用（内核 JsVectorBackend · hash 起步实现 · ${info.dims} 维；${info.label} 权重尚未加载）`,
    };
  } catch (e) {
    return { ok: false, message: `向量后端报错：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 审计回显 = 内核审计流（llm_proxy / llm_fallback / model_config，最新在前，最多 20 条） */
export async function coreAuditTail(): Promise<ProxyAuditEntry[]> {
  const storage = getKernelStorage();
  const records = await storage.queryAudit({});
  return records
    .filter((a) =>
      a.action === 'llm_proxy'
      || a.action === 'llm_fallback'
      || (a.action === 'param_save' && a.detail.kind === 'model_config'))
    .map((a) => {
      const d = a.detail as {
        llm_proxy_source?: string; source?: string; cost?: number; mode?: ProxyAuditEntry['mode']; model?: string;
      };
      if (a.action === 'param_save') {
        return {
          event: 'llm_proxy' as const,
          llm_proxy_source: 'agent:local',
          cost: 0,
          mode: 'local' as const,
          at: a.ts,
          kind: 'model_config' as const,
        };
      }
      return {
        event: 'llm_proxy' as const,
        llm_proxy_source: d.llm_proxy_source ?? d.source ?? 'agent:local',
        cost: d.cost ?? 0,
        mode: d.mode ?? 'local',
        at: a.ts,
      };
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 20);
}
