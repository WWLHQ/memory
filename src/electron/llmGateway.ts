// 批次32：LLM 精炼网关（主进程唯一真源）——通用 OpenAI 兼容**多引擎**，路由口径「哪个能用、哪个快用哪个」。
// 为什么放主进程：内核在渲染层运行，直连外部 LLM 会撞 CORS 且 apiKey 必须进渲染层；
// 网关收口在主进程后，密钥只存数据根 llm-keys.json（0600，同 mcp-token.txt 先例），
// 渲染层经 llm:refine IPC 代理逐层调用，浏览器模式无宿主能力 → 维持 stub（诚实不伪造）。
// 路由（批次32 改口径，取消 L2/L3–L6 分层绑定）：按各引擎**最近一次真实拨测延时**升序排队，
// 未拨测的按列表顺序排后；逐个试，首个成功即用，失败回退下一个；全部不可用 → 抛错由内核记 refine_error 诚实回退。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Category, LlmProvider, ModelInfo } from '../core/memagent/types.ts';
import { layerBand, layerSpecOf, type RefineLayer } from '../core/memagent/layerRules.ts';
// 单条引擎预算的单一真源在批次39 的队列模块（core → electron 依赖方向不变），避免两处各写一个 3
import { REFINE_MAX_ENGINES_PER_CALL } from '../core/memagent/refineQueue.ts';
import { UNSET_PROXY_ACCOUNTING, proxyModelMeta, type ProxyAccounting } from '../shared/proxyAccounting.ts';

// ── 配置与密钥落盘（数据根，随迁移白名单走）────────────────────────────────────

export const LLM_CONFIG_FILE = 'llm-config.json';
/** 各引擎 API Key 集中落盘（0600；绝不进 llm-config.json / 日志 / 审计 / IPC 返回值） */
export const LLM_KEYS_FILE = 'llm-keys.json';
/** 批次31 的旧密钥文件：仅在 llm-keys.json 缺 deepseek 条目时只读兜底（不自动改写用户文件） */
export const LEGACY_DEEPSEEK_KEY_FILE = 'llm-deepseek-key.txt';
const HTTP_TIMEOUT_MS = 60_000;

export interface LlmEngineConfig {
  /** 稳定标识（预设 id 或 custom_<ts>）；密钥表与拨测结果都按它关联 */
  id: string;
  name: string;
  enabled: boolean;
  /** OpenAI 兼容 base（不含 /chat/completions） */
  baseURL: string;
  model: string;
  /** 是否需要 API Key（本地 Ollama = false） */
  needsKey: boolean;
  /** 最近一次真实拨测（「测试连通」）延时毫秒；null = 从未拨测 */
  lastLatencyMs: number | null;
  /** 拨测时刻（epoch 毫秒，UI 侧按 UTC+08:00 展示） */
  lastProbeAt: number | null;
  lastProbeOk: boolean | null;
}

export interface LlmGatewayConfig {
  engines: LlmEngineConfig[];
}

export interface LlmPreset {
  preset: string;
  name: string;
  baseURL: string;
  model: string;
  needsKey: boolean;
}

/** 预设快选：全部为 OpenAI 兼容 /chat/completions 端点（用户实测过的 DeepSeek/Ollama 保持不变） */
export const LLM_PRESETS: readonly LlmPreset[] = [
  { preset: 'ollama', name: 'Ollama（本地）', baseURL: 'http://127.0.0.1:11434', model: '', needsKey: false },
  { preset: 'vllm', name: 'vLLM（本地）', baseURL: 'http://127.0.0.1:8000/v1', model: '', needsKey: false },
  { preset: 'lmstudio', name: 'LM Studio（本地）', baseURL: 'http://127.0.0.1:1234/v1', model: '', needsKey: false },
  { preset: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', needsKey: true },
  { preset: 'kimi', name: 'Kimi（月之暗面）', baseURL: 'https://api.moonshot.cn', model: 'moonshot-v1-8k', needsKey: true },
  { preset: 'zhipu', name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus', needsKey: true },
  { preset: 'qwen', name: '通义千问（DashScope 兼容模式）', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode', model: 'qwen-plus', needsKey: true },
  { preset: 'siliconflow', name: '硅基流动 SiliconFlow', baseURL: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', needsKey: true },
  { preset: 'minimax', name: 'MiniMax（abab）', baseURL: 'https://api.minimaxi.com/v1', model: 'MiniMax-Text-01', needsKey: true },
  { preset: 'stepfun', name: '阶跃星辰 StepFun', baseURL: 'https://api.stepfun.com/v1', model: 'step-2-16k-exp', needsKey: true },
  { preset: 'spark', name: '讯飞星火 Spark', baseURL: 'https://spark-api-open.xf-yun.com/v1', model: 'generalv3.5', needsKey: true },
  { preset: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', needsKey: true },
  { preset: 'openrouter', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: '', needsKey: true },
];

function presetOf(id: string): LlmPreset | null {
  return LLM_PRESETS.find((p) => p.preset === id) ?? null;
}

function engine(preset: LlmPreset, over: Partial<LlmEngineConfig> = {}): LlmEngineConfig {
  return {
    id: preset.preset,
    name: preset.name,
    enabled: false,
    baseURL: preset.baseURL,
    model: preset.model,
    needsKey: preset.needsKey,
    lastLatencyMs: null,
    lastProbeAt: null,
    lastProbeOk: null,
    ...over,
  };
}

/** 默认配置 = 批次31 的两个槽位（Ollama + DeepSeek），均未启用；用户可自行增删引擎 */
export function defaultLlmConfig(): LlmGatewayConfig {
  return { engines: [engine(presetOf('ollama')!), engine(presetOf('deepseek')!)] };
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v.trim() : d);
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

function clampEngine(raw: unknown, fallback: LlmEngineConfig): LlmEngineConfig {
  const r = (raw ?? {}) as Partial<LlmEngineConfig>;
  const base = str(r.baseURL) || fallback.baseURL;
  // 命中预设的引擎以预设 needsKey 为准（防用户改坏标记把密钥发给本地端点）；自定义引擎按落盘值
  const isPreset = !!presetOf(str(r.id) || fallback.id);
  return {
    id: str(r.id) || fallback.id,
    name: str(r.name) || fallback.name,
    enabled: r.enabled === true,
    baseURL: base.replace(/\/+$/, ''),
    model: str(r.model),
    needsKey: isPreset ? fallback.needsKey : r.needsKey !== false,
    lastLatencyMs: numOrNull(r.lastLatencyMs),
    lastProbeAt: numOrNull(r.lastProbeAt),
    lastProbeOk: typeof r.lastProbeOk === 'boolean' ? r.lastProbeOk : null,
  };
}

function clampConfig(raw: unknown): LlmGatewayConfig {
  const r = (raw ?? {}) as { engines?: unknown[] } & Partial<LlmGatewayConfig>;
  // 批次31 旧形状 {ollama:{...},deepseek:{...}} → 引擎列表（用户已保存的配置不丢）
  const legacy = raw as { ollama?: unknown; deepseek?: unknown } | null;
  const list: unknown[] = Array.isArray(r.engines)
    ? r.engines
    : legacy && (legacy.ollama || legacy.deepseek)
      ? [
          { id: 'ollama', ...(typeof legacy.ollama === 'object' && legacy.ollama ? legacy.ollama : {}) },
          { id: 'deepseek', ...(typeof legacy.deepseek === 'object' && legacy.deepseek ? legacy.deepseek : {}) },
        ]
      : [];
  if (list.length === 0) return defaultLlmConfig();
  const seen = new Set<string>();
  const engines: LlmEngineConfig[] = [];
  for (const item of list) {
    const id = str((item as Partial<LlmEngineConfig>)?.id);
    if (!id || seen.has(id)) continue; // id 缺失/重复 = 无法关联密钥与拨测结果，丢弃
    seen.add(id);
    const preset = presetOf(id);
    const fallback = preset ? engine(preset) : { ...engine(presetOf('ollama')!), id, name: id, needsKey: true };
    engines.push(clampEngine(item, fallback));
  }
  return engines.length ? { engines } : defaultLlmConfig();
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

/** 密钥表：{引擎 id: key}；deepseek 缺条目时只读兜底批次31 旧文件 */
export function loadLlmKeys(dir: string): Record<string, string> {
  let map: Record<string, string> = {};
  try {
    const raw = JSON.parse(readFileSync(join(dir, LLM_KEYS_FILE), 'utf8')) as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw ?? {})) if (typeof v === 'string' && v.trim()) map[k] = v.trim();
  } catch {
    map = {};
  }
  if (!map.deepseek) {
    try {
      const legacy = readFileSync(join(dir, LEGACY_DEEPSEEK_KEY_FILE), 'utf8').trim();
      if (legacy) map.deepseek = legacy;
    } catch {
      /* 无旧文件：正常 */
    }
  }
  return map;
}

/** 0600 落盘；空串 = 清除该引擎密钥 */
export function saveLlmKey(dir: string, id: string, key: string): Record<string, string> {
  const map = loadLlmKeys(dir);
  const v = key.trim();
  if (v) map[id] = v;
  else delete map[id];
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, LLM_KEYS_FILE), JSON.stringify(map, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return map;
}

export function keyExists(dir: string, id: string): boolean {
  return !!loadLlmKeys(dir)[id];
}

// ── 提示词（层规格单一真源 layerRules）────────────────────────────────────────

/**
 * 逐层提示词：输入只能是上一层产物（§2.2 不变量 1 由调用方保证）。
 * 批次40-D：长度要求与 `checkLayerSpecDetailed` **同源**（都走 `layerBand`），
 * 不再给模型一个它达不到的绝对字数（批次39 实测 4/4 失败样例全是「18 字源 → 要求 ≥50 字」）；
 * 格式契约（开头词）也在这里明说，判废才说得通。
 */
export function buildLayerPrompt(layer: RefineLayer, input: string, category: Category): string {
  const s = layerSpecOf(layer);
  const band = layerBand(s, input);
  const srcLen = input.trim().length;
  const len = band.min === null && band.max === null
    ? ''
    : `长度：${band.min ?? 0}–${band.max ?? '不限'} 字（由上游 ${srcLen} 字按本层压缩比算出；写不够就是没内容，写超了就是没压缩，都算废）。`;
  const preserve = s.preserve?.length ? `保留：源文中出现的这些关键词不得丢弃（也不得凭空补造）——${s.preserve.join('、')}。` : '';
  const contract = s.mustStartWith
    ? `格式契约：第一个词必须是「${s.mustStartWith}」，紧跟内容，不许换成别的说法。`
    : '';
  const l6 = layer === 'L6'
    ? '输出格式：仅一个 JSON 对象 {"keywords":["…"],"projections":["…"]}，keywords 为检索关键词数组（≤30 个），projections 为适用投影场景数组。'
    : `只输出该层内容本身${s.mustStartWith ? '（开头的必需词除外）' : ''}，不要解释、不要标题、不要在结尾补说明。`;
  return [
    `你是多 Agent 记忆系统的层级精炼引擎。基于记忆分类「${category}」，把上游内容提炼为 ${s.id}（${s.name}）。`,
    len, preserve, contract, l6,
    '',
    '上游内容：',
    '"""',
    input,
    '"""',
  ].filter(Boolean).join('\n');
}

// ── OpenAI 兼容调用 ───────────────────────────────────────────────────────────

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** base 已带版本段（…/v1、…/api/paas/v4）→ 直接接 /chat/completions；否则补 /v1/chat/completions */
export function chatEndpoint(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '');
  return /\/v\d+$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/** 错误消息清洗：绝不让响应体/头部里的密钥形态进入异常文本（异常会进审计 refine_error） */
function safeErrorText(engine: string, status: number, bodyText: string): string {
  const brief = bodyText.replace(/\s+/g, ' ').slice(0, 200);
  return `${engine} HTTP ${status}：${brief || '(无响应体)'}`;
}

async function chat(
  eng: LlmEngineConfig,
  apiKey: string,
  prompt: string,
  fetchImpl: FetchLike,
): Promise<string> {
  if (!eng.model) throw new Error(`${eng.name} 未配置模型名`);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (eng.needsKey) headers.Authorization = `Bearer ${apiKey}`; // 本地端点（needsKey=false）绝不带密钥
  const res = await fetchImpl(chatEndpoint(eng.baseURL), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: eng.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2048, // 上限给足余量；字数规格由内核 checkLayerSpec 硬校验，超限判违规
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(safeErrorText(eng.name, res.status, await res.text().catch(() => '')));
  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error(`${eng.name} 返回空内容`);
  return text.trim();
}

// ── 路由 Provider（注入内核的 LlmProvider 实现）───────────────────────────────

/** 本地回环端点记 free 档；其余记 cheap 档。
 *  批次48 A16：price/quota 不再用占位数字 —— 云端单价/日配额由参数页写入参数快照，
 *  主进程经 applyProxyAccounting 下发；未设置 → 该云端引擎不进入路由（诚实「未设置」）。 */
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;

let proxyAccounting: ProxyAccounting = { ...UNSET_PROXY_ACCOUNTING };

/** 参数快照变化后由 main.ts 下发（与渲染层 hostLlm 同一份口径） */
export function applyProxyAccounting(acc: ProxyAccounting): void {
  proxyAccounting = acc;
}

/** 只看主机名判定是否本机回环：本机引擎常带路径（…/v1、…/api/show），不能整串匹配 */
function isLocalBase(baseURL: string): boolean {
  try {
    return LOCAL_HOST.test(new URL(baseURL).hostname);
  } catch {
    return false; // 解析不了的地址按远端对待：不擅自免密钥
  }
}

/** 云端未配置单价/配额 → null（不可路由）；本地 → free / 0 元 / 不限量 */
function modelInfoOf(eng: LlmEngineConfig): Omit<ModelInfo, 'model'> | null {
  return proxyModelMeta(isLocalBase(eng.baseURL), proxyAccounting, 0);
}

/** 引擎是否具备被调用的最低条件：启用 + 有模型名 +（不需要密钥 或 已配密钥） */
function runnable(eng: LlmEngineConfig, key: string): boolean {
  return eng.enabled && !!eng.model && (!eng.needsKey || !!key);
}

export class LlmGatewayProvider implements LlmProvider {
  /** 非 stub：内核 makeLayerGenerator 据此放开 L2–L6 生成 */
  readonly isStub = false;

  /**
   * 一次调用最多试几个引擎（批次39 用户拍板 D：单条 ≤3）。
   * 成本闸门的意义：排在后面的引擎再慢再贵，也不该被一条记忆无限追问下去；
   * 试满即抛错，由调用方（写入 / 补炼队列）如实记 refine_error，绝不降级成 stub 产物。
   */
  private readonly maxEnginesPerCall: number;

  constructor(
    private cfg: LlmGatewayConfig,
    private keys: Record<string, string> = {},
    private fetchImpl: FetchLike = fetch,
    maxEnginesPerCall = REFINE_MAX_ENGINES_PER_CALL,
  ) {
    this.maxEnginesPerCall = maxEnginesPerCall > 0 ? Math.floor(maxEnginesPerCall) : Number.POSITIVE_INFINITY;
  }

  usable(): boolean {
    return this.cfg.engines.some((e) => runnable(e, this.keys[e.id] ?? ''));
  }

  listModels(): ModelInfo[] {
    const out: ModelInfo[] = [];
    for (const e of this.cfg.engines) {
      if (!runnable(e, this.keys[e.id] ?? '')) continue;
      const meta = modelInfoOf(e);
      if (meta) out.push({ model: e.model, ...meta });
    }
    return out;
  }

  /** 调用顺序 = 最近拨测延时升序（未拨测排后，保持列表顺序）；同一次调用内固定 */
  private callOrder(): LlmEngineConfig[] {
    const ready = this.cfg.engines.filter((e) => runnable(e, this.keys[e.id] ?? ''));
    return ready
      .map((e, i) => ({ e, i }))
      .sort((a, b) => (a.e.lastLatencyMs ?? Number.MAX_SAFE_INTEGER) - (b.e.lastLatencyMs ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
      .map(({ e }) => e);
  }

  private async race(prompt: string): Promise<{ text: string; engine: string }> {
    const all = this.callOrder();
    const order = all.slice(0, this.maxEnginesPerCall);
    const failures: string[] = [];
    for (const eng of order) {
      try {
        return { text: await chat(eng, this.keys[eng.id] ?? '', prompt, this.fetchImpl), engine: eng.name };
      } catch (e) {
        failures.push(String((e as Error)?.message ?? e));
      }
    }
    // 被预算挡在门外的引擎要说清楚：用户看到「试了 3 个」不会误以为全机只有 3 个可用
    const capped = all.length - order.length;
    const tail = capped > 0 ? `（本条引擎预算 ${order.length} 个已用完，还有 ${capped} 个未试）` : '';
    throw new Error(`${failures.join('；') || '无可用引擎（未启用 / 未填模型 / 未配密钥）'}${tail}`);
  }

  /** 逐层精炼（§2.2）：不分层绑定厂商，按延时顺序逐个试；全失败 → 抛错（内核记 refine_error 回退已生成层） */
  async refineLayer(model: string, layer: RefineLayer, input: string, category: Category, ctx: { request_id: string; usage: string }): Promise<string> {
    void model; // 厂商由内部排队决定；内核传入的 model 仅用于 routeProxy 记账
    const prompt = buildLayerPrompt(layer, input, category);
    try {
      return (await this.race(prompt)).text;
    } catch (e) {
      throw new Error(`LLM 精炼失败（${layer}，request_id=${ctx.request_id}）：${String((e as Error)?.message ?? e)}`);
    }
  }

  /** 通用调用（judge/rerank 等用途）：同一套延时优先 + 逐个回退 */
  async call(model: string, prompt: string, _ctx: { request_id: string; usage: string }): Promise<{ text: string; tokens: number }> {
    void model;
    const { text } = await this.race(prompt);
    return { text, tokens: Math.ceil(text.length / 2) };
  }
}

// ── 连通性真拨测（管理员「测试连通」按钮；真实 HTTP，不伪造成功）───────────────

export interface EngineTestResult {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  error?: string;
  /** 该引擎当前是否勾选了「启用」——拨测成功但未启用时，渲染层要提示「勾选后才会参与精炼排队」（批次34） */
  enabled?: boolean;
}

/**
 * 真实拨测单个引擎（不落盘；调用方用 applyProbeResult 把结果写回配置）。
 * 批次34：**不再要求 enabled**——「测试连通」正是决定要不要启用它的手段，旧实现在未启用时 9ms 内直接返回
 * 「X 未启用」、一条 HTTP 都不发，用户看到 ❌ 只能理解成「连不通」。启用与否只影响精炼排队（callOrder）。
 * 仍然前提齐备才发请求：引擎存在、模型名非空、需要密钥的引擎必须已有密钥。
 */
export async function testEngine(
  cfg: LlmGatewayConfig,
  keys: Record<string, string>,
  id: string,
  fetchImpl: FetchLike = fetch,
): Promise<EngineTestResult> {
  const eng = cfg.engines.find((e) => e.id === id);
  if (!eng) return { ok: false, error: `未找到引擎 ${id}` };
  if (!eng.model) return { ok: false, error: '未填写模型名' };
  const key = keys[id] ?? '';
  if (eng.needsKey && !key) return { ok: false, model: eng.model, enabled: eng.enabled, error: '未配置 API Key' };
  const t0 = Date.now();
  try {
    await chat(eng, key, '只回复两个字符：OK', fetchImpl);
    return { ok: true, model: eng.model, latencyMs: Date.now() - t0, enabled: eng.enabled };
  } catch (e) {
    return { ok: false, model: eng.model, latencyMs: Date.now() - t0, enabled: eng.enabled, error: String((e as Error)?.message ?? e) };
  }
}

/** 把拨测结果写回配置（成功/失败都记时刻与延时——失败延时有用于 UI 排障；只有成功参与排序） */
export function applyProbeResult(cfg: LlmGatewayConfig, id: string, r: EngineTestResult): LlmGatewayConfig {
  return {
    engines: cfg.engines.map((e) =>
      e.id === id
        ? { ...e, lastProbeOk: r.ok, lastProbeAt: Date.now(), lastLatencyMs: r.ok ? (r.latencyMs ?? null) : null }
        : e,
    ),
  };
}

/** 启动装配：读配置 + 密钥，可用则建网关；不可用返回 null（内核继续用 FakeLlmProvider 口径） */
export function loadLlmGateway(dir: string): LlmGatewayProvider | null {
  const p = new LlmGatewayProvider(loadLlmConfig(dir), loadLlmKeys(dir));
  return p.usable() ? p : null;
}

// ── IPC 视图（新增/删除引擎、只回「密钥是否已设置」，绝不回显内容）──────────────

export type LlmEngineView = LlmEngineConfig & { keySet: boolean };

export interface LlmGatewayView {
  usable: boolean;
  engines: LlmEngineView[];
  presets: LlmPreset[];
}

export function llmEngineViews(cfg: LlmGatewayConfig, keys: Record<string, string>): LlmGatewayView {
  return {
    usable: cfg.engines.some((e) => runnable(e, keys[e.id] ?? '')),
    engines: cfg.engines.map((e) => ({ ...e, keySet: !!keys[e.id] })),
    presets: [...LLM_PRESETS],
  };
}

/** 渲染层可改的字段（其余由服务端维护：needsKey 来自预设、密钥单独落盘、拨测结果由 test 写入） */
export interface LlmEnginePatch {
  id: string;
  name?: string;
  enabled?: boolean;
  baseURL?: string;
  model?: string;
}

export interface LlmAddEngine {
  preset?: string;
  name?: string;
  baseURL?: string;
  model?: string;
}

export interface LlmConfigPatch {
  engines?: LlmEnginePatch[];
  add?: LlmAddEngine;
  remove?: string;
  /** 密钥写入/清除：{id, value}；value 省略或空串 = 清除 */
  key?: { id: string; value?: string };
}

let customSeq = 0;

/** 应用一次配置补丁（纯函数：返回新配置 + 可选的密钥动作，由调用方落盘） */
export function mergeLlmConfig(cfg: LlmGatewayConfig, patch: LlmConfigPatch): { cfg: LlmGatewayConfig; keyOp?: { id: string; value: string } } {
  let engines = cfg.engines.map((e) => ({ ...e }));
  for (const p of patch.engines ?? []) {
    const i = engines.findIndex((e) => e.id === p.id);
    if (i < 0) continue;
    const cur = engines[i];
    engines[i] = clampEngine(
      { ...cur, name: p.name ?? cur.name, enabled: p.enabled ?? cur.enabled, baseURL: p.baseURL ?? cur.baseURL, model: p.model ?? cur.model },
      cur,
    );
  }
  if (patch.remove) engines = engines.filter((e) => e.id !== patch.remove);
  const add = patch.add;
  if (add) {
    const preset = add.preset ? presetOf(add.preset) : null;
    if (preset) {
      if (!engines.some((e) => e.id === preset.preset)) engines.push(engine(preset));
    } else if (str(add.name) && str(add.baseURL)) {
      const id = `custom_${Date.now().toString(36)}${(customSeq++).toString(36)}`;
      const name = str(add.name);
      const baseURL = str(add.baseURL);
      engines.push(
        clampEngine(
          { id, name, baseURL, model: add.model, needsKey: !isLocalBase(baseURL) },
          { id, name, enabled: false, baseURL, model: str(add.model), needsKey: true, lastLatencyMs: null, lastProbeAt: null, lastProbeOk: null },
        ),
      );
    }
  }
  const keyOp = patch.key ? { id: patch.key.id, value: patch.key.value ?? '' } : undefined;
  return { cfg: clampConfig({ engines }), keyOp };
}
