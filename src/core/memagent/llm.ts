// LlmProvider（§5.1）+ 内核统一反代理路由（19.8：先免费 → 后低价 ≤ price_cap → cost_cap → 回退本地）
import { MemAgentError } from './errors.ts';
import type { LlmProvider, ModelInfo } from './types.ts';

/** 演示 Provider：fake 模型表（真实端各自实现 Desktop/Remote/System） */
export class FakeLlmProvider implements LlmProvider {
  constructor(private models: ModelInfo[] = [
    { model: 'claude-free', tier: 'free', price: 0, quota: 1000, used: 100 },
    { model: 'gpt4o-mini', tier: 'cheap', price: 0.01, quota: 2000, used: 200 },
    { model: 'local-small', tier: 'paid', price: 0, quota: 0, used: 0 }, // 本地兜底
  ]) {}

  listModels(): ModelInfo[] {
    return this.models.map((m) => ({ ...m }));
  }

  async call(model: string, prompt: string, _ctx: { request_id: string; usage: string }): Promise<{ text: string; tokens: number }> {
    const m = this.models.find((x) => x.model === model);
    if (!m) throw new MemAgentError('E_QUOTA', `模型不可用：${model}`);
    return { text: `[${model}] ${prompt.slice(0, 40)}`, tokens: Math.ceil(prompt.length / 2) };
  }
}

export interface ProxyPick {
  /** 选中的模型；null = 回退本地 */
  model: string | null;
  source: string;                 // 审计 llm_proxy_source
  cost: number;                   // 单次花费（¥）
  fallback: boolean;              // true → 记 llm_fallback（E_LLM_FALLBACK）
  reason: string;
}

/**
 * 19.8 内核统一路由（全端一致，端壳不实现）：
 * 先免费（余量 > 0）→ 后低价（单价 ≤ price_cap）→ 成本封顶 cost_cap → 超限回退本地。
 * 付费档不入代理；余量 = 0.9 × 额度 − 已用（R8）。
 */
export function routeProxy(
  models: ModelInfo[],
  priceCap: number,
  costCap: number,
  usedToday: number,
): ProxyPick {
  const budget = (m: ModelInfo) => Math.floor(m.quota * 0.9) - m.used;
  const eligible = models.filter((m) => m.tier !== 'paid' && budget(m) > 0);

  const free = eligible.filter((m) => m.tier === 'free');
  if (free.length > 0) {
    const pick = free[0];
    const cost = pick.price / 1000;
    if (usedToday + cost > costCap) {
      return { model: null, source: 'agent:local', cost: 0, fallback: true, reason: `成本封顶（${usedToday.toFixed(2)}+¥${cost.toFixed(4)} > ¥${costCap}）→ 回退本地` };
    }
    return { model: pick.model, source: `agent:${pick.model}`, cost, fallback: false, reason: `免费优先（余量 ${budget(pick)}）` };
  }

  const cheap = eligible.filter((m) => m.tier === 'cheap' && m.price <= priceCap).sort((a, b) => a.price - b.price);
  if (cheap.length > 0) {
    const pick = cheap[0];
    const cost = pick.price / 1000;
    if (usedToday + cost > costCap) {
      return { model: null, source: 'agent:local', cost: 0, fallback: true, reason: `成本封顶 → 回退本地` };
    }
    return { model: pick.model, source: `agent:${pick.model}`, cost, fallback: false, reason: `低价 ¥${pick.price}/千次 ≤ cap ¥${priceCap}` };
  }

  return { model: null, source: 'agent:local', cost: 0, fallback: true, reason: '无合格代理源（免费耗尽/低价超 cap）→ 回退本地' };
}
