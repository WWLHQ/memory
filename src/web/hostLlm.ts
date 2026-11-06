// 批次31 建 / 批次32 多引擎化：渲染层 LLM Provider —— 内核写路径的逐层精炼经 llm:refine IPC 代理主进程网关。
// 为什么经 IPC：apiKey 只存主进程数据根（0600），渲染层绝不接触密钥；浏览器模式无宿主能力
// → createHostLlm 返回 null，内核继续 FakeLlmProvider（只落 L1，诚实不伪造）。
// isStub 是 getter：网关配置快照未就绪/不可用时按 stub 口径（只落 L1），可用即放开 L2–L6，
// 参数页保存配置后刷新快照立即生效（无需重启）。
import type { Category, LlmProvider, ModelInfo } from '../core/memagent/types.ts';
import type { RefineLayer } from '../core/memagent/layerRules.ts';
import { hostCall, hostCapability } from '../desktop/hostBridge.ts';
import { getStoredSessionId } from './Home/crossTabAuth.ts';
import { UNSET_PROXY_ACCOUNTING, proxyModelMeta, type ProxyAccounting } from '../shared/proxyAccounting.ts';

/** 引擎视图（与主进程 llmGateway.LlmEngineView 同形；keySet 只表「有没有」，绝不含密钥本体） */
export interface LlmEngineView {
  id: string;
  name: string;
  enabled: boolean;
  baseURL: string;
  model: string;
  needsKey: boolean;
  keySet: boolean;
  lastLatencyMs: number | null;
  lastProbeAt: number | null;
  lastProbeOk: boolean | null;
}

export interface LlmPresetView {
  preset: string;
  name: string;
  baseURL: string;
  model: string;
  needsKey: boolean;
}

export interface LlmGatewaySnapshot {
  usable: boolean;
  engines: LlmEngineView[];
  presets: LlmPresetView[];
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
    snapshot = r.ok && Array.isArray(r.engines) ? { usable: !!r.usable, engines: r.engines, presets: r.presets ?? [] } : null;
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

/** 读取当前网关快照（反代理源单一真源；无网关/未配置 → null，按诚实空态处理） */
export function getHostLlmSnapshot(): LlmGatewaySnapshot | null {
  return snapshot;
}

// routeProxy 记账元数据（与主进程 llmGateway 同口径；批次48 A16 起单价/配额由参数快照下发，
// 未设置 → 云端源不进入路由，不再用 0.01 / 100000 占位数字）
let proxyAccounting: ProxyAccounting = { ...UNSET_PROXY_ACCOUNTING };

/** 参数页加载/保存后把反代理记账值交给内核 provider（同一份参数快照真源） */
export function setHostProxyAccounting(acc: ProxyAccounting): void {
  proxyAccounting = acc;
}

export function getHostProxyAccounting(): ProxyAccounting {
  return proxyAccounting;
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;

/** 只看主机名：本机引擎常带路径（…/v1），与主进程 isLocalBase 同口径；参数页据此标注本地/云端 */
export function isLocalBase(baseURL: string): boolean {
  try {
    return LOCAL_HOST.test(new URL(baseURL).hostname);
  } catch {
    return false;
  }
}

function modelsFromSnapshot(s: LlmGatewaySnapshot): ModelInfo[] {
  const out: ModelInfo[] = [];
  for (const e of s.engines) {
    if (!e.enabled || !e.model || (e.needsKey && !e.keySet)) continue;
    // 云端缺单价/配额 → proxyModelMeta 返回 null：不可路由（页面显示「未设置」，绝不编造）
    const meta = proxyModelMeta(isLocalBase(e.baseURL), proxyAccounting, 0);
    if (meta) out.push({ model: e.model, ...meta });
  }
  return out;
}

/**
 * 内核 LLM 装配点：桌面壳内返回经 IPC 代理的 Provider，否则 null（调用方回退 FakeLlmProvider）。
 * listModels 反映快照；快照为空 → 空表 → routeProxy 回退本地 → 内核按「无合格代理源」诚实记录。
 */
export function createHostLlm(): LlmProvider | null {
  if (!hostLlmAvailable()) return null;
  void refreshHostLlmSnapshotOnce();
  // 批次48 A24：精炼调用的真实 usage 累计（`unknown` = 主进程回 tokens=null，即上游未带 usage）
  let usage = { calls: 0, tokens: 0, unknown: false };
  return {
    get isStub() { return !(snapshot?.usable ?? false); },
    takeUsage(): { tokens: number | null } | null {
      if (usage.calls === 0) return null;
      const out = { tokens: usage.unknown ? null : usage.tokens };
      usage = { calls: 0, tokens: 0, unknown: false };
      return out;
    },
    listModels(): ModelInfo[] {
      return snapshot?.usable ? modelsFromSnapshot(snapshot) : [];
    },
    async refineLayer(_model: string, layer: RefineLayer, input: string, category: Category, ctx: { request_id: string; usage: string }): Promise<string> {
      const r = await hostCall<{ ok: boolean; text?: string; tokens?: number | null; error?: string }>(
        'llm:refine',
        [{ mode: 'layer', layer, input, category, request_id: ctx.request_id }, getStoredSessionId()],
      );
      if (!r.ok) throw new Error(r.error ?? 'LLM 精炼失败');
      usage.calls += 1;
      if (typeof r.tokens === 'number') usage.tokens += r.tokens;
      else usage.unknown = true;
      return r.text ?? '';
    },
    async call(_model: string, prompt: string, ctx: { request_id: string; usage: string }): Promise<{ text: string; tokens: number }> {
      const r = await hostCall<{ ok: boolean; text?: string; tokens?: number; error?: string }>(
        'llm:refine',
        [{ mode: 'raw', prompt, request_id: ctx.request_id, usage: ctx.usage }, getStoredSessionId()],
      );
      if (!r.ok) throw new Error(r.error ?? 'LLM 调用失败');
      const text = r.text ?? '';
      // 批次48 A24：不再按字符数估算；上游未返回 usage → tokens=0
      return { text, tokens: typeof r.tokens === 'number' ? r.tokens : 0 };
    },
  };
}
