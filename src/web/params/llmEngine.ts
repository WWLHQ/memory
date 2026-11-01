// 全局参数页 · LLM 精炼引擎桥（批次31 建 / 批次32 多引擎化）：渲染层经宿主桥走 llm:* IPC 调主进程网关。
// 浏览器/宿主桥不可达时诚实降级（available()=false），绝不伪造配置或拨测成功。
// 密钥只在 patch.key.value 里出现一次（主进程写 0600 文件），任何返回值只带 keySet 布尔，不带密钥本体。
import { hostCall } from '../../desktop/hostBridge.ts';
import { hostLlmAvailable, applyHostLlmSnapshot, type LlmGatewaySnapshot } from '../hostLlm.ts';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';

/** 与主进程 llmGateway.LlmConfigPatch 同形 */
export interface LlmEnginePatch {
  id: string;
  name?: string;
  enabled?: boolean;
  baseURL?: string;
  model?: string;
}

export interface LlmConfigPatch {
  engines?: LlmEnginePatch[];
  /** 从预设添加（preset = 预设 id）或自定义一家 OpenAI 兼容服务（name + baseURL） */
  add?: { preset?: string; name?: string; baseURL?: string; model?: string };
  remove?: string;
  /** 写入/清除某引擎密钥：value 省略或空串 = 清除 */
  key?: { id: string; value?: string };
}

export interface LlmTestResult {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  error?: string;
}

export function llmEngineAvailable(): boolean {
  return hostLlmAvailable();
}

function toView(r: LlmGatewaySnapshot & { ok: boolean }): LlmGatewaySnapshot | null {
  if (!r.ok || !Array.isArray(r.engines)) return null;
  const view: LlmGatewaySnapshot = { usable: !!r.usable, engines: r.engines, presets: r.presets ?? [] };
  applyHostLlmSnapshot(view);
  return view;
}

export async function llmGetConfig(): Promise<LlmGatewaySnapshot | null> {
  try {
    return toView(await hostCall<LlmGatewaySnapshot & { ok: boolean }>('llm:config', [getStoredSessionId()]));
  } catch {
    return null;
  }
}

/** 保存配置（增删引擎 / 改字段 / 写密钥，仅管理员） */
export async function llmSaveConfig(
  patch: LlmConfigPatch,
): Promise<{ ok: boolean; view?: LlmGatewaySnapshot; error?: string }> {
  try {
    const r = await hostCall<LlmGatewaySnapshot & { ok: boolean; error?: string }>('llm:configSet', [patch, getStoredSessionId()]);
    if (!r.ok) return { ok: false, error: r.error ?? '保存失败（需要管理员权限）' };
    return { ok: true, view: toView(r) ?? undefined };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 连通真拨测（管理员）：按引擎 id，真实 HTTP；成功延时由主进程写回配置参与排序 */
export async function llmTestEngine(engineId: string): Promise<LlmTestResult> {
  try {
    return await hostCall<LlmTestResult>('llm:test', [engineId, getStoredSessionId()]);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}
