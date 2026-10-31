// 批次31：渲染层 LLM Provider —— 内核写路径的逐层精炼经 llm:refine IPC 代理主进程网关。
// 为什么经 IPC：apiKey 只存主进程数据根（0600），渲染层绝不接触密钥；浏览器模式无宿主能力
// → createHostLlm 返回 null，内核继续 FakeLlmProvider（只落 L1，诚实不伪造）。
// isStub 是 getter：网关配置快照未就绪/不可用时按 stub 口径（只落 L1），可用即放开 L2–L6，
// 参数页保存配置后刷新快照立即生效（无需重启）。
import type { Category, LlmProvider, ModelInfo } from '../core/memagent/types.ts';
import type { RefineLayer } from '../core/memagent/layerRules.ts';
import { hostCall, hostCapability } from '../desktop/hostBridge.ts';
import { getStoredSessionId } from './Home/crossTabAuth.ts';

export interface LlmEngineSnapshot {
  enabled: boolean;
  baseURL: string;
  model: string;
}

export interface LlmGatewaySnapshot {
  usable: boolean;
  deepseekKeySet: boolean;
  config: { ollama: LlmEngineSnapshot; deepseek: LlmEngineSnapshot };
}

let snapshot: LlmGatewaySnapshot | null = null;
let refreshInFlight: Promise<void> | null = null;

/** 桌面壳内才可能有网关（native=顶层窗口有 preload；bridge=iframe 经宿主桥代理） */
export function hostLlmAvailable(): boolean {
  const cap = hostCapability();
  return cap === 'native' || cap === 'bridge';
}

/** 用最新配置刷新快照（内核装配点/参数页读写后调用）；失败 → 快照置 null（按 stub 口径） */
export async function refreshHostLlmSnapshot(): Promise<void> {
  if (!hostLlmAvailable()) { snapshot = null; return; }
  try {
    const r = await hostCall<LlmGatewaySnapshot & { ok: boolean }>('llm:config', [getStoredSessionId()]);
    snapshot = r.ok && r.config
      ? { usable: !!r.usable, deepseekKeySet: !!r.deepseekKeySet, config: r.config }
      : null;
  } catch {
    snapshot = null;
  }
}

/** 去重并发刷新（内核装配点多处触发时只发一次 IPC） */
export function refreshHostLlmSnapshotOnce(): Promise<void> {
  refreshInFlight ??= refreshHostLlmSnapshot().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

/** 参数页保存配置后由 llmEngine 桥调用（主进程返回值即最新快照） */
export function applyHostLlmSnapshot(v: LlmGatewaySnapshot | null): void {
  snapshot = v;
}

// routeProxy 记账元数据（与主进程 llmGateway 同口径；price/quota 是 19.8 成本路由的记账值，非真实账单）
const OLLAMA_INFO = { tier: 'free', price: 0, quota: 100_000, used: 0 } as const;
const DEEPSEEK_INFO = { tier: 'cheap', price: 0.01, quota: 100_000, used: 0 } as const;

function modelsFromSnapshot(s: LlmGatewaySnapshot): ModelInfo[] {
  const out: ModelInfo[] = [];
  if (s.config.ollama.enabled && s.config.ollama.model) out.push({ model: s.config.ollama.model, ...OLLAMA_INFO });
  if (s.config.deepseek.enabled && s.config.deepseek.model && s.deepseekKeySet) out.push({ model: s.config.deepseek.model, ...DEEPSEEK_INFO });
  return out;
}

/**
 * 内核 LLM 装配点：桌面壳内返回经 IPC 代理的 Provider，否则 null（调用方回退 FakeLlmProvider）。
 * listModels 反映快照；快照为空 → 空表 → routeProxy 回退本地 → 内核按「无合格代理源」诚实记录。
 */
export function createHostLlm(): LlmProvider | null {
  if (!hostLlmAvailable()) return null;
  void refreshHostLlmSnapshotOnce();
  return {
    get isStub() { return !(snapshot?.usable ?? false); },
    listModels(): ModelInfo[] {
      return snapshot?.usable ? modelsFromSnapshot(snapshot) : [];
    },
    async refineLayer(_model: string, layer: RefineLayer, input: string, category: Category, ctx: { request_id: string; usage: string }): Promise<string> {
      const r = await hostCall<{ ok: boolean; text?: string; error?: string }>(
        'llm:refine',
        [{ mode: 'layer', layer, input, category, request_id: ctx.request_id }, getStoredSessionId()],
      );
      if (!r.ok) throw new Error(r.error ?? 'LLM 精炼失败');
      return r.text ?? '';
    },
    async call(_model: string, prompt: string, ctx: { request_id: string; usage: string }): Promise<{ text: string; tokens: number }> {
      const r = await hostCall<{ ok: boolean; text?: string; tokens?: number; error?: string }>(
        'llm:refine',
        [{ mode: 'raw', prompt, request_id: ctx.request_id, usage: ctx.usage }, getStoredSessionId()],
      );
      if (!r.ok) throw new Error(r.error ?? 'LLM 调用失败');
      const text = r.text ?? '';
      return { text, tokens: r.tokens ?? Math.ceil(text.length / 2) };
    },
  };
}
