// 全局参数页 · LLM 精炼引擎桥（批次31）：渲染层经宿主桥走 llm:* IPC 调主进程网关。
// 浏览器/宿主桥不可达时诚实降级（available()=false），绝不伪造配置或拨测成功。
import { hostCall } from '../../desktop/hostBridge.ts';
import { hostLlmAvailable, applyHostLlmSnapshot } from '../hostLlm.ts';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';

export interface LlmConfigView {
  usable: boolean;
  deepseekKeySet: boolean;
  config: {
    ollama: { enabled: boolean; baseURL: string; model: string };
    deepseek: { enabled: boolean; baseURL: string; model: string };
  };
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

export async function llmGetConfig(): Promise<LlmConfigView | null> {
  try {
    const r = await hostCall<LlmConfigView & { ok: boolean }>('llm:config', [getStoredSessionId()]);
    if (!r.ok || !r.config) return null;
    const view: LlmConfigView = { usable: !!r.usable, deepseekKeySet: !!r.deepseekKeySet, config: r.config };
    applyHostLlmSnapshot(view);
    return view;
  } catch {
    return null;
  }
}

/** 保存配置（管理员）：deepseekKey 只在本请求参数中出现一次（写 0600 文件，任何返回值不含密钥）；空串 = 清除 */
export async function llmSaveConfig(
  patch: { config?: Partial<LlmConfigView['config']>; deepseekKey?: string },
): Promise<{ ok: boolean; view?: LlmConfigView; error?: string }> {
  try {
    const r = await hostCall<LlmConfigView & { ok: boolean; error?: string }>('llm:configSet', [patch, getStoredSessionId()]);
    if (!r.ok) return { ok: false, error: r.error ?? '保存失败（需要管理员权限）' };
    const view: LlmConfigView = { usable: !!r.usable, deepseekKeySet: !!r.deepseekKeySet, config: r.config };
    applyHostLlmSnapshot(view);
    return { ok: true, view };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 连通真拨测（管理员）：真实 HTTP 调用，结果如实返回（含失败原因；错误文本不含密钥） */
export async function llmTestEngine(target: 'ollama' | 'deepseek'): Promise<LlmTestResult> {
  try {
    return await hostCall<LlmTestResult>('llm:test', [target, getStoredSessionId()]);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}
