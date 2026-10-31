// 批次31：LLM 精炼网关（主进程唯一真源）——「简单的用 Ollama，需要深入的用 DeepSeek」。
// 为什么放主进程：内核在渲染层运行，直连外部 LLM 会撞 CORS 且 apiKey 必须进渲染层；
// 网关收口在主进程后，密钥只存数据根 llm-deepseek-key.txt（0600，同 mcp-token.txt 先例），
// 渲染层经 llm:refine IPC 代理逐层调用，浏览器模式无宿主能力 → 维持 stub（诚实不伪造）。
// 分层路由（不加硬上限）：L2（会话摘要）优先 Ollama（免费本地）；L3–L6 优先 DeepSeek；
// 任一引擎失败/未启用自动回退另一引擎；两层都不可用 → 抛错由内核记 refine_error 诚实回退 L1。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Category, LlmProvider, ModelInfo } from '../core/memagent/types.ts';
import { layerSpecOf, type RefineLayer } from '../core/memagent/layerRules.ts';

// ── 配置与密钥落盘（数据根，随迁移白名单走）────────────────────────────────────

export const LLM_CONFIG_FILE = 'llm-config.json';
/** DeepSeek API Key 单独落盘（绝不进 llm-config.json / 日志 / 审计 / 返回值） */
export const LLM_KEY_FILE = 'llm-deepseek-key.txt';
const HTTP_TIMEOUT_MS = 60_000;

export interface LlmEngineConfig {
  enabled: boolean;
  /** OpenAI 兼容 base（不含路径） */
  baseURL: string;
  model: string;
}

export interface LlmGatewayConfig {
  ollama: LlmEngineConfig;
  deepseek: LlmEngineConfig;
}

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export function defaultLlmConfig(): LlmGatewayConfig {
  return {
    ollama: { enabled: false, baseURL: 'http://127.0.0.1:11434', model: '' },
    deepseek: { enabled: false, baseURL: DEEPSEEK_BASE_URL, model: 'deepseek-chat' },
  };
}

function clampConfig(raw: unknown): LlmGatewayConfig {
  const def = defaultLlmConfig();
  const r = (raw ?? {}) as Partial<LlmGatewayConfig>;
  const eng = (e: Partial<LlmEngineConfig> | undefined, d: LlmEngineConfig): LlmEngineConfig => ({
    enabled: e?.enabled === true,
    baseURL: typeof e?.baseURL === 'string' && e.baseURL.trim() ? e.baseURL.trim().replace(/\/+$/, '') : d.baseURL,
    model: typeof e?.model === 'string' ? e.model.trim() : d.model,
  });
  return { ollama: eng(r.ollama, def.ollama), deepseek: eng(r.deepseek, def.deepseek) };
}

export function loadLlmConfig(dir: string): LlmGatewayConfig {
  try {
    return clampConfig(JSON.parse(readFileSync(join(dir, LLM_CONFIG_FILE), 'utf8')));
  } catch {
    return defaultLlmConfig();
  }
}

export function saveLlmConfig(dir: string, cfg: LlmGatewayConfig): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, LLM_CONFIG_FILE), JSON.stringify(clampConfig(cfg), null, 2) + '\n', 'utf8');
}

export function loadDeepseekKey(dir: string): string {
  try {
    return readFileSync(join(dir, LLM_KEY_FILE), 'utf8').trim();
  } catch {
    return '';
  }
}

/** 0600 落盘（mcp-token.txt 先例）；空串 = 清除密钥 */
export function saveDeepseekKey(dir: string, key: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, LLM_KEY_FILE), key.trim() + '\n', { encoding: 'utf8', mode: 0o600 });
}

// ── 提示词（层规格单一真源 layerRules）────────────────────────────────────────

/** 逐层提示词：输入只能是上一层产物（§2.2 不变量 1 由调用方保证）；规格直接取 LAYER_SPECS */
export function buildLayerPrompt(layer: RefineLayer, input: string, category: Category): string {
  const s = layerSpecOf(layer);
  const len = s.maxChars !== null || s.minChars !== null
    ? `长度：${s.minChars ?? 0}–${s.maxChars ?? '不限'} 字。`
    : '';
  const preserve = s.preserve?.length ? `保留：源文中出现的这些关键词不得丢弃（也不得凭空补造）——${s.preserve.join('、')}。` : '';
  const must = s.mustInclude?.length ? `必含要素：${s.mustInclude.join('、')}。` : '';
  const l6 = layer === 'L6'
    ? '输出格式：仅一个 JSON 对象 {"keywords":["…"],"projections":["…"]}，keywords 为检索关键词数组（≤30 个），projections 为适用投影场景数组。'
    : '只输出该层内容本身，不要任何解释、前缀或标题。';
  return [
    `你是多 Agent 记忆系统的层级精炼引擎。基于记忆分类「${category}」，把上游内容提炼为 ${s.id}（${s.name}）。`,
    len, preserve, must, l6,
    '',
    '上游内容：',
    '"""',
    input,
    '"""',
  ].filter(Boolean).join('\n');
}

// ── OpenAI 兼容调用 ───────────────────────────────────────────────────────────

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function endpoint(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/v1/chat/completions`;
}

/** 错误消息清洗：绝不让响应体/头部里的密钥形态进入异常文本（异常会进审计 refine_error） */
function safeErrorText(engine: string, status: number, bodyText: string): string {
  const brief = bodyText.replace(/\s+/g, ' ').slice(0, 200);
  return `${engine} HTTP ${status}：${brief || '(无响应体)'}`;
}

async function chat(
  name: 'ollama' | 'deepseek',
  engine: LlmEngineConfig,
  apiKey: string,
  prompt: string,
  fetchImpl: FetchLike,
): Promise<string> {
  if (!engine.model) throw new Error(`${name} 未配置模型名`);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (name === 'deepseek') headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetchImpl(endpoint(engine.baseURL), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: engine.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2048, // 上限给足余量；字数规格由内核 checkLayerSpec 硬校验，超限判违规
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(safeErrorText(name, res.status, await res.text().catch(() => '')));
  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error(`${name} 返回空内容`);
  return text.trim();
}

// ── 分层路由 Provider（注入内核的 LlmProvider 实现）───────────────────────────

/** 路由元数据（routeProxy 用）：Ollama=免费档优先选中；DeepSeek=低价档（≤ 内核 price_cap 0.01）。
 *  注意：price/quota 是内核 19.8 成本路由的记账元数据，不是 DeepSeek 真实账单。 */
const OLLAMA_MODEL_INFO: Omit<ModelInfo, 'model'> = { tier: 'free', price: 0, quota: 100_000, used: 0 };
const DEEPSEEK_MODEL_INFO: Omit<ModelInfo, 'model'> = { tier: 'cheap', price: 0.01, quota: 100_000, used: 0 };

export class TieredLlmProvider implements LlmProvider {
  /** 非 stub：内核 makeLayerGenerator 据此放开 L2–L6 生成 */
  readonly isStub = false;

  constructor(
    private cfg: LlmGatewayConfig,
    private deepseekKey: string,
    private fetchImpl: FetchLike = fetch,
  ) {}

  usable(): boolean {
    return (this.cfg.ollama.enabled && !!this.cfg.ollama.model) || (this.cfg.deepseek.enabled && !!this.cfg.deepseek.model && !!this.deepseekKey);
  }

  listModels(): ModelInfo[] {
    const out: ModelInfo[] = [];
    if (this.cfg.ollama.enabled && this.cfg.ollama.model) out.push({ model: this.cfg.ollama.model, ...OLLAMA_MODEL_INFO });
    if (this.cfg.deepseek.enabled && this.cfg.deepseek.model && this.deepseekKey) out.push({ model: this.cfg.deepseek.model, ...DEEPSEEK_MODEL_INFO });
    return out;
  }

  /**
   * 逐层精炼（§2.2）：L2 优先 Ollama（简单层），L3–L6 优先 DeepSeek（深层）；
   * 首选引擎未启用或调用失败 → 回退另一引擎；两者都失败 → 抛错（内核记 refine_error 回退已生成层）。
   */
  async refineLayer(model: string, layer: RefineLayer, input: string, category: Category, ctx: { request_id: string; usage: string }): Promise<string> {
    void model; // 路由按层内部决定；内核传入的 model 仅用于 routeProxy 记账
    const prompt = buildLayerPrompt(layer, input, category);
    const order: ('ollama' | 'deepseek')[] = layer === 'L2' ? ['ollama', 'deepseek'] : ['deepseek', 'ollama'];
    const failures: string[] = [];
    for (const name of order) {
      const engine = this.cfg[name];
      if (!engine.enabled) continue;
      if (name === 'deepseek' && !this.deepseekKey) { failures.push('deepseek 未配置密钥'); continue; }
      try {
        return await chat(name, engine, this.deepseekKey, prompt, this.fetchImpl);
      } catch (e) {
        failures.push(String((e as Error)?.message ?? e));
      }
    }
    throw new Error(`LLM 精炼失败（${layer}，request_id=${ctx.request_id}）：${failures.join('；') || '无可用引擎（两引擎均未启用）'}`);
  }

  /** 通用调用（judge/rerank 等用途）：简单调用优先本地 Ollama，失败回退 DeepSeek */
  async call(model: string, prompt: string, _ctx: { request_id: string; usage: string }): Promise<{ text: string; tokens: number }> {
    void model;
    const order: ('ollama' | 'deepseek')[] = ['ollama', 'deepseek'];
    const failures: string[] = [];
    for (const name of order) {
      const engine = this.cfg[name];
      if (!engine.enabled) continue;
      if (name === 'deepseek' && !this.deepseekKey) { failures.push('deepseek 未配置密钥'); continue; }
      try {
        const text = await chat(name, engine, this.deepseekKey, prompt, this.fetchImpl);
        return { text, tokens: Math.ceil(text.length / 2) };
      } catch (e) {
        failures.push(String((e as Error)?.message ?? e));
      }
    }
    throw new Error(`LLM 调用失败：${failures.join('；') || '无可用引擎'}`);
  }
}

// ── 连通性真拨测（管理员「测试连通」按钮；真实 HTTP，不伪造成功）───────────────

export interface EngineTestResult {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  error?: string;
}

export async function testOllama(cfg: LlmGatewayConfig, fetchImpl: FetchLike = fetch): Promise<EngineTestResult> {
  const engine = cfg.ollama;
  if (!engine.enabled) return { ok: false, error: 'Ollama 未启用' };
  if (!engine.model) return { ok: false, error: '未填写模型名' };
  const t0 = Date.now();
  try {
    await chat('ollama', engine, '', '只回复两个字符：OK', fetchImpl);
    return { ok: true, model: engine.model, latencyMs: Date.now() - t0, error: undefined };
  } catch (e) {
    return { ok: false, model: engine.model, latencyMs: Date.now() - t0, error: String((e as Error)?.message ?? e) };
  }
}

export async function testDeepseek(cfg: LlmGatewayConfig, key: string, fetchImpl: FetchLike = fetch): Promise<EngineTestResult> {
  const engine = cfg.deepseek;
  if (!engine.enabled) return { ok: false, error: 'DeepSeek 未启用' };
  if (!engine.model) return { ok: false, error: '未填写模型名' };
  if (!key) return { ok: false, model: engine.model, error: '未配置 API Key' };
  const t0 = Date.now();
  try {
    await chat('deepseek', engine, key, '只回复两个字符：OK', fetchImpl);
    return { ok: true, model: engine.model, latencyMs: Date.now() - t0, error: undefined };
  } catch (e) {
    return { ok: false, model: engine.model, latencyMs: Date.now() - t0, error: String((e as Error)?.message ?? e) };
  }
}

/** 启动装配：读配置 + 密钥，可用则建网关；不可用返回 null（内核继续用 FakeLlmProvider 口径） */
export function loadLlmGateway(dir: string): TieredLlmProvider | null {
  const cfg = loadLlmConfig(dir);
  const key = loadDeepseekKey(dir);
  const p = new TieredLlmProvider(cfg, key);
  return p.usable() ? p : null;
}

/** existsSync 仅用于 IPC 返回「密钥是否已设置」（绝不回显内容） */
export function deepseekKeyExists(dir: string): boolean {
  try {
    return existsSync(join(dir, LLM_KEY_FILE)) && loadDeepseekKey(dir).length > 0;
  } catch {
    return false;
  }
}
