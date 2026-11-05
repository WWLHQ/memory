// LlmProvider（§5.1）+ 内核统一反代理路由（19.8：先免费 → 后低价 ≤ price_cap → cost_cap → 回退本地）
import { MemAgentError } from './errors.ts';
import type { LlmProvider, ModelInfo } from './types.ts';

/**
 * 诚实 stub Provider：零模型纯 stub（对照 createHostLlm 经 llm:config 快照下发真实模型）。
 * 不再内置任何假模型表与假用量字段（批次42 阶段3-A 已删除）；
 * listModels 默认返回空 → routeProxy 无合格代理源 → 内核诚实回退本地、只落 L1，绝不伪造 L2–L6。
 * 真实端（Desktop/Remote/System）的模型来自主进程 llmGateway 快照，经 llm:refine IPC 代理，不在此硬编码。
 */
export class FakeLlmProvider implements LlmProvider {
  /** 显式 stub：写入管线据此只落 L1，不伪造 L2–L6 */
  readonly isStub = true;

  constructor(private models: ModelInfo[] = []) {}

  listModels(): ModelInfo[] {
    return this.models.map((m) => ({ ...m }));
  }

  async call(_model: string, _prompt: string, _ctx: { request_id: string; usage: string }): Promise<{ text: string; tokens: number }> {
    throw new MemAgentError('E_QUOTA', 'stub LLM 无可用模型（网关未配置，请接入宿主 LLM 网关）');
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
