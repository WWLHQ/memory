// 大模型配置页（REQ-009 / P13）接真内核：auto 择优走内核 routeProxy（19.8 统一路由），
// 每次模拟/保存写内核审计账本（llm_proxy/llm_fallback），回显从内核流加载。
// manual 模式的 R7/C11 选择约束属端壳 UX（内核 routeProxy 无 manual 语义），仍在页面逻辑层。
import type { ModelInfo } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import { FakeLlmProvider, routeProxy } from '../../core/memagent/llm.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';
import { ulid } from '../../core/memagent/ulid.ts';
import { SEED_SOURCES } from './seed.ts';
import type { ProxyAuditEntry, ProxySource } from './types.ts';

interface Ctx {
  models: ModelInfo[];   // 内核路由输入（used 随模拟真实累加）
  usedToday: number;     // 19.8 cost_cap 口径
  storage: InMemoryStorage;
}

let ctxP: Promise<Ctx> | null = null;

function getCtx(): Promise<Ctx> {
  if (!ctxP) {
    ctxP = (async () => {
      // 种子反代理映射（19.8）→ 内核 ModelInfo：agent 维度由 model 名唯一映射回查
      const models: ModelInfo[] = SEED_SOURCES.map((s) => ({
        model: s.model, tier: s.tier, price: s.price, quota: s.quota, used: s.used,
      }));
      const storage = new InMemoryStorage();
      createMemAgent({
        form: 'web', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(models.map((m) => ({ ...m }))),
        vector: new JsVectorBackend(), storage,
      });
      return { models, usedToday: 0, storage };
    })();
  }
  return ctxP;
}

async function writeAudit(
  ctx: Ctx,
  llm_proxy_source: string,
  cost: number,
  mode: ProxyAuditEntry['mode'],
  extra: Record<string, unknown>,
): Promise<ProxyAuditEntry> {
  const at = Date.now();
  const fallback = llm_proxy_source === 'agent:local' && extra.kind !== 'model_config';
  await ctx.storage.appendAudit({
    request_id: `req_${ulid()}`,
    action: fallback ? 'llm_fallback' : 'llm_proxy',
    form: 'web',
    ts: at,
    detail: { llm_proxy_source, cost, mode, ...extra },
  });
  return { event: 'llm_proxy', llm_proxy_source, cost, mode, at };
}

export interface SimulateOutcome {
  source: ProxySource | null;  // 命中源（null = 回退本地）
  reason: string;
  cost: number;
  audit: ProxyAuditEntry;
}

/** auto 模拟调用：内核统一路由（先免费 → 低价 ≤ price_cap → cost_cap → 回退本地） */
export async function coreSimulateAuto(priceCap: number, costCap: number): Promise<SimulateOutcome> {
  const ctx = await getCtx();
  const r = routeProxy(ctx.models, priceCap, costCap, ctx.usedToday);
  if (r.model) {
    const src = SEED_SOURCES.find((s) => s.model === r.model);
    if (!src) {
      return { source: null, reason: `内核命中未知模型 ${r.model} → 回退本地`, cost: 0, audit: await writeAudit(ctx, 'agent:local', 0, 'local', { reason: r.reason }) };
    }
    ctx.usedToday += r.cost;
    const mi = ctx.models.find((m) => m.model === r.model);
    if (mi) mi.used += 1; // 余量真实扣减，下一次模拟可见
    const audit = await writeAudit(ctx, `agent:${src.agent}`, r.cost, 'auto', { model: r.model, reason: r.reason });
    return { source: { ...src }, reason: r.reason, cost: r.cost, audit };
  }
  const audit = await writeAudit(ctx, 'agent:local', 0, 'local', { reason: r.reason, code: 'E_LLM_FALLBACK' });
  return { source: null, reason: r.reason, cost: 0, audit };
}

/** manual 模拟调用：择优在页面（R7/C11），审计写内核 */
export async function coreAuditProxy(src: ProxySource | null, cost: number, mode: 'manual' | 'local'): Promise<ProxyAuditEntry> {
  const ctx = await getCtx();
  return writeAudit(ctx, src ? `agent:${src.agent}` : 'agent:local', cost, mode, { manual: true, reason: src ? '手动指定' : '回退本地' });
}

/** 保存 model_config：写内核审计（llm_proxy_source=agent:local，展示层标注 model_config） */
export async function coreSaveConfig(vectorLabel: string, dims: number): Promise<ProxyAuditEntry> {
  const ctx = await getCtx();
  return writeAudit(ctx, 'agent:local', 0, 'local', { kind: 'model_config', vector: vectorLabel, dims });
}

/** 审计回显 = 内核审计流（llm_proxy + llm_fallback，最新在前，最多 20 条） */
export async function coreAuditTail(): Promise<ProxyAuditEntry[]> {
  const ctx = await getCtx();
  const records = await ctx.storage.queryAudit({});
  return records
    .filter((a) => a.action === 'llm_proxy' || a.action === 'llm_fallback')
    .map((a) => {
      const d = a.detail as { llm_proxy_source?: string; cost?: number; mode?: ProxyAuditEntry['mode'] };
      return {
        event: 'llm_proxy' as const,
        llm_proxy_source: d.llm_proxy_source ?? 'agent:local',
        cost: d.cost ?? 0,
        mode: d.mode ?? 'local',
        at: a.ts,
      };
    })
    .slice(-20)
    .reverse();
}
