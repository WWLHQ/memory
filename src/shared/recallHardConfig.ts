// 硬前置召回 A/B/C 三层开关的**配置单一真源**（批次62 UI 开关）。
// 渲染层、主进程、单测共用这一份类型/默认值/校验，避免各写一份判定漂移。
// 语义：这里存的是「用户意图」；真实运行态由主进程 state() 读宿主配置 / 端口监听 / 服务端门禁值，
// 绝不拿配置冒充运行态（AGENTS §0「绝不伪造数据」）。
export interface RecallHardConfig {
  /** A：宿主 UserPromptSubmit 钩子是否在宿主 settings.json 里 */
  a_hook: boolean;
  /** B：应用内置 LLM 网关是否监听 */
  b_gateway: boolean;
  /** B：上游 LLM 根地址（启用前必填） */
  b_upstream: string;
  /** B：本地监听端口，默认 8300 */
  b_port: number;
  /** C：MCP 严格首步召回门禁是否开启 */
  c_strict_gate: boolean;
}

export const RECALL_HARD_CONFIG_FILE = 'recall-hard-config.json';

export const DEFAULT_RECALL_HARD_CONFIG: Readonly<RecallHardConfig> = Object.freeze({
  // 与批次62 现状一致：A 已装 workbuddy、C 桌面运行时默认开、B 默认不开（需上游地址）。
  a_hook: true,
  b_gateway: false,
  b_upstream: '',
  b_port: 8300,
  c_strict_gate: true,
});

export const RECALL_HARD_DEFAULT_PORT = 8300;
export const RECALL_HARD_MIN_PORT = 1;
export const RECALL_HARD_MAX_PORT = 65535;

export function validRecallHardPort(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
    && v >= RECALL_HARD_MIN_PORT && v <= RECALL_HARD_MAX_PORT;
}

/** 上游只认 http/https 且必须能解析出 host；不接受 javascript: / 空串 / 相对地址。 */
export function validRecallUpstream(v: unknown): v is string {
  if (typeof v !== 'string' || !v.trim()) return false;
  try {
    const u = new URL(v.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
  } catch { return false; }
}

export function recallHardBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}

/** 坏结构一律回默认，不抛错、不把坏值写盘；未知字段忽略（向前兼容）。 */
export function normalizeRecallHardConfig(raw: unknown): RecallHardConfig {
  const base = { ...DEFAULT_RECALL_HARD_CONFIG };
  const o = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  if (typeof o.a_hook === 'boolean') base.a_hook = o.a_hook;
  if (typeof o.b_gateway === 'boolean') base.b_gateway = o.b_gateway;
  if (typeof o.b_upstream === 'string' && o.b_upstream.trim().length <= 2048) {
    base.b_upstream = o.b_upstream.trim();
  }
  if (validRecallHardPort(o.b_port)) base.b_port = o.b_port;
  if (typeof o.c_strict_gate === 'boolean') base.c_strict_gate = o.c_strict_gate;
  return base;
}

/** 只挑出调用方显式给出的合法字段；非法字段直接拒绝，不静默吞掉。 */
export function parseRecallHardPatch(raw: unknown):
  | { ok: true; patch: Partial<RecallHardConfig> }
  | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '需要一个配置对象' };
  }
  const o = raw as Record<string, unknown>;
  const patch: Partial<RecallHardConfig> = {};
  for (const key of ['a_hook', 'b_gateway', 'c_strict_gate'] as const) {
    if (key in o) {
      if (typeof o[key] !== 'boolean') return { ok: false, error: `${key} 需要布尔值（启用 / 不启用）` };
      patch[key] = o[key] as boolean;
    }
  }
  if ('b_upstream' in o) {
    if (typeof o.b_upstream !== 'string') return { ok: false, error: 'b_upstream 需要字符串' };
    const v = o.b_upstream.trim();
    if (v && !validRecallUpstream(v)) return { ok: false, error: '上游地址必须是 http/https 绝对地址' };
    patch.b_upstream = v;
  }
  if ('b_port' in o) {
    if (!validRecallHardPort(o.b_port)) return { ok: false, error: `端口需要 ${RECALL_HARD_MIN_PORT}–${RECALL_HARD_MAX_PORT} 的整数` };
    patch.b_port = o.b_port;
  }
  return { ok: true, patch };
}
