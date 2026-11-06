// 批次48 A31-b：厂商余额查询适配器（主进程唯一真源）。
// 口径（用户 2026-11-06 拍板，逐字段 provenance，不整块打标）：
//  · 余额 balance：只有真实厂商端点可用才 `vendor_live`；无接口/无凭据/凭据权限不足 → 手工兜底；
//  · 日配额 quota、单价 price：厂商 API 不提供，一律手工配置（模型页按引擎填写，随 llm-config.json 持久化）；
//  · 单次 cost：本地 `usage × 单价` 推算，只标「推算」，绝不暗示为厂商账单；
//  · 刷新：默认 TTL 10 分钟 + 页面手动刷新；余额查询**不计入 cost_cap、不写 llm_proxy 审计**；
//  · 凭据：只存主进程（llm-keys.json 旁的独立 billing 槽 0600），渲染层只拿 keySet 布尔，绝不回传明文。
//
// 适配器矩阵（A31-a 实测结论，见 specs/A31-BILLING-MATRIX.md）：
//  · 可 vendor_live：deepseek / kimi / siliconflow / openrouter（openrouter 需区分 management key 与普通 key）；
//  · 无余额接口：zhipu / qwen / minimax / stepfun / spark / groq → 直接返 no_endpoint，不发 HTTP；
//  · 本机：ollama / vllm / lmstudio → 0 元不限量（local_free），不查厂商。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmEngineConfig, LlmGatewayConfig } from './llmGateway.ts';
import type { BillingEngineView, BillingFetchStatus, BillingProvenance, ManualBilling } from '../shared/billing.ts';

/** 独立 billing 凭据槽：与 llm-keys.json 同级、同样 0600；只存主进程，渲染层拿不到明文 */
export const BILLING_CREDS_FILE = 'llm-billing-keys.json';
/** 余额默认刷新 TTL（用户拍板 10 分钟；页面可手动强制刷新） */
export const BILLING_TTL_MS = 10 * 60 * 1000;
const HTTP_TIMEOUT_MS = 15_000;

export interface BillingBalance {
  amount: number;
  /** CNY / USD 等，来自厂商响应；无法识别时不猜，置空串并按账户币种展示 */
  currency: string;
  /** account = 账户余额；key_limit = 该 key 的限额（openrouter 普通 key，非账户余额） */
  scope: 'account' | 'key_limit';
}

export interface BillingFetchOutcome {
  status: BillingFetchStatus;
  balance?: BillingBalance;
  httpStatus?: number;
  /** 已清洗的短错误文本（状态码 + 截断，不含凭据/响应体细节） */
  error?: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** 厂商适配器：verifiable=false 的厂商明确没有余额接口，直接返 no_endpoint（不发请求） */
export interface BillingAdapter {
  id: string;
  verifiable: boolean;
  fetch: (credential: string, fetchImpl: FetchLike) => Promise<BillingFetchOutcome>;
}

/** 无余额接口的厂商（A31-a 实测：zhipu 带真实 key 仍 404；qwen/minimax/stepfun 网关 401/404 具区分） */
export const NO_ENDPOINT_VENDORS = ['zhipu', 'qwen', 'minimax', 'stepfun', 'spark', 'groq'] as const;
/** 本机引擎：0 元不限量，不查厂商 */
export const LOCAL_BILLING_VENDORS = ['ollama', 'vllm', 'lmstudio'] as const;

const num = (v: unknown): number | null => {
  // 厂商响应里的金额是字符串；空串不能当 0（Number('') === 0），一律按「没给」处理
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

interface HttpOk { ok: true; status: number; json: unknown }
interface HttpFail { ok: false; status: number | null; kind: 'auth' | 'notfound' | 'transient' | 'error'; error: string }

/** 统一 GET：超时/5xx → transient（保留上次值）；401/403 → auth；404 → no_endpoint */
export async function billingGetJson(url: string, credential: string, fetchImpl: FetchLike): Promise<HttpOk | HttpFail> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const status = res.status;
    let text = '';
    try { text = await res.text(); } catch { text = ''; }
    if (status === 401 || status === 403) return { ok: false, status, kind: 'auth', error: `HTTP ${status}（凭据权限不足）` };
    if (status === 404) return { ok: false, status, kind: 'notfound', error: `HTTP 404（该厂商无此余额接口）` };
    if (status >= 500 || status === 429) return { ok: false, status, kind: 'transient', error: `HTTP ${status}（厂商暂时不可达）` };
    if (status < 200 || status >= 300) return { ok: false, status, kind: 'error', error: `HTTP ${status}` };
    try {
      return { ok: true, status, json: JSON.parse(text) };
    } catch {
      // 200 但不是 JSON：按不可解析处理，不拿半截文本当余额
      return { ok: false, status, kind: 'error', error: 'HTTP 200 但响应不是 JSON' };
    }
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return {
      ok: false, status: null, kind: 'transient',
      error: aborted ? `查询超时（${HTTP_TIMEOUT_MS / 1000}s）` : '网络不可达',
    };
  } finally {
    clearTimeout(timer);
  }
}

function toOutcome(f: HttpFail): BillingFetchOutcome {
  const status: BillingFetchStatus =
    f.kind === 'auth' ? 'auth_deficient'
      : f.kind === 'notfound' ? 'no_endpoint'
        : f.kind === 'transient' ? 'transient' : 'error';
  return { status, httpStatus: f.status ?? undefined, error: f.error };
}

/** deepseek：GET /user/balance → balance_infos[0].total_balance（字符串金额） */
export const deepseekBilling: BillingAdapter = {
  id: 'deepseek',
  verifiable: true,
  async fetch(cred, f) {
    const r = await billingGetJson('https://api.deepseek.com/user/balance', cred, f);
    if (!r.ok) return toOutcome(r);
    const j = (r.json ?? {}) as { balance_infos?: unknown };
    const list = Array.isArray(j.balance_infos) ? j.balance_infos : [];
    const first = (list[0] ?? {}) as { currency?: unknown; total_balance?: unknown };
    const amount = num(first.total_balance);
    if (amount === null) return { status: 'error', error: '响应缺少 balance_infos[].total_balance' };
    return { status: 'ok', balance: { amount, currency: typeof first.currency === 'string' ? first.currency : 'CNY', scope: 'account' } };
  },
};

/** kimi/moonshot：GET /v1/users/me/balance → data.available_balance */
export const kimiBilling: BillingAdapter = {
  id: 'kimi',
  verifiable: true,
  async fetch(cred, f) {
    const r = await billingGetJson('https://api.moonshot.cn/v1/users/me/balance', cred, f);
    if (!r.ok) return toOutcome(r);
    const j = (r.json ?? {}) as { data?: { available_balance?: unknown } };
    const amount = num(j.data?.available_balance);
    if (amount === null) return { status: 'error', error: '响应缺少 data.available_balance' };
    return { status: 'ok', balance: { amount, currency: 'CNY', scope: 'account' } };
  },
};

/** 硅基流动：GET /v1/user/info → data.totalBalance（字符串金额；缺省回落 data.balance） */
export const siliconflowBilling: BillingAdapter = {
  id: 'siliconflow',
  verifiable: true,
  async fetch(cred, f) {
    const r = await billingGetJson('https://api.siliconflow.cn/v1/user/info', cred, f);
    if (!r.ok) return toOutcome(r);
    const j = (r.json ?? {}) as { data?: { totalBalance?: unknown; balance?: unknown } };
    const amount = num(j.data?.totalBalance) ?? num(j.data?.balance);
    if (amount === null) return { status: 'error', error: '响应缺少 data.totalBalance' };
    return { status: 'ok', balance: { amount, currency: 'CNY', scope: 'account' } };
  },
};

/**
 * openrouter：两条凭据路径，凭据级别不同必须分开处理（A31-a 实测暴露的陷阱）。
 *  · management key：GET /api/v1/credits → total_credits - total_usage = 账户余额；
 *  · 普通 key：只能 GET /api/v1/key → 本 key 限额（limit_remaining），scope=key_limit，界面必须标「key 限额，非账户余额」；
 *  · **`total_credits: 0` 且 `is_management_key: false` 时绝不能当余额 0 展示**——那条 credits 数据对本 key 无意义，
 *    尚未核验到管理凭据前一律走 key 限额路径（本模块不读 credits 字段做普通 key 的余额）。
 */
export const openrouterBilling: BillingAdapter = {
  id: 'openrouter',
  verifiable: true,
  async fetch(cred, f) {
    const keyRes = await billingGetJson('https://openrouter.ai/api/v1/key', cred, f);
    if (!keyRes.ok) return toOutcome(keyRes);
    const kd = ((keyRes.json ?? {}) as { data?: Record<string, unknown> }).data ?? {};
    if (kd.is_management_key !== true) {
      const remaining = num(kd.limit_remaining);
      if (remaining === null) {
        return { status: 'error', error: '该 key 未设置限额（limit_remaining 缺失），无可用余额口径' };
      }
      return { status: 'ok', balance: { amount: remaining, currency: 'USD', scope: 'key_limit' } };
    }
    const creditsRes = await billingGetJson('https://openrouter.ai/api/v1/credits', cred, f);
    if (!creditsRes.ok) return toOutcome(creditsRes);
    const cd = ((creditsRes.json ?? {}) as { data?: Record<string, unknown> }).data ?? {};
    const total = num(cd.total_credits);
    const used = num(cd.total_usage) ?? 0;
    if (total === null) return { status: 'error', error: '响应缺少 data.total_credits' };
    return { status: 'ok', balance: { amount: total - used, currency: 'USD', scope: 'account' } };
  },
};

/** 无余额接口的厂商：不改口径、不伪造，直接 no_endpoint（不发 HTTP） */
function noEndpointAdapter(id: string): BillingAdapter {
  return {
    id,
    verifiable: false,
    async fetch() {
      return { status: 'no_endpoint', error: '该厂商无余额接口' };
    },
  };
}

export const BILLING_ADAPTERS: Record<string, BillingAdapter> = {
  deepseek: deepseekBilling,
  kimi: kimiBilling,
  siliconflow: siliconflowBilling,
  openrouter: openrouterBilling,
  ...Object.fromEntries(NO_ENDPOINT_VENDORS.map((id) => [id, noEndpointAdapter(id)])),
};

/** 单个引擎的余额视图：线上形状定义在 shared/billing.ts（主进程与页面同源），此处只作别名 */
export type EngineBillingView = BillingEngineView;

interface CacheEntry {
  /** 上次成功拿到的厂商值；失败时**不覆盖**（五级阶梯：永不覆盖已有值） */
  lastGood: BillingBalance | null;
  lastGoodAt: number | null;
  /** 本次展示用的结论 */
  view: Omit<EngineBillingView, 'id' | 'name' | 'kind' | 'manual'>;
}

export interface BillingServiceDeps {
  dataDir: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  ttlMs?: number;
}

/** billing 凭据表：{引擎 id: 凭据}；空串 = 清除 */
export function loadBillingCredentials(dataDir: string): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, BILLING_CREDS_FILE), 'utf8')) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw ?? {})) if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    return out;
  } catch {
    return {};
  }
}

export function saveBillingCredential(dataDir: string, id: string, value: string): Record<string, string> {
  const map = loadBillingCredentials(dataDir);
  const v = value.trim();
  if (v) map[id] = v;
  else delete map[id];
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, BILLING_CREDS_FILE), JSON.stringify(map, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return map;
}

/**
 * 余额查询服务：每引擎一份缓存 + 五级降级阶梯。
 * 阶梯（严格按用户定义，失败时永不覆盖已有值）：
 *  1) 成功 → vendor_live（本次值 + 本次时刻）；
 *  2) 401/403 → 凭据权限不足：降级手工并明示原因（不拿旧值假装实时）；
 *  3) 超时/5xx → 保留上次成功值，标 vendor_stale + 上次成功 as_of；
 *  4) 无适配器/无凭据 → manual（有手工值）否则 unset；
 *  5) 手工也没填 → unset。
 * 本机三家固定 local_free（0 元不限量）。
 */
export class LlmBillingService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(private readonly deps: BillingServiceDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => Date.now());
    this.ttlMs = deps.ttlMs ?? BILLING_TTL_MS;
  }

  /** 读写独立 billing 槽（仅主进程；返回值不含任何其他引擎的凭据） */
  loadCredentials(): Record<string, string> {
    return loadBillingCredentials(this.deps.dataDir);
  }

  saveCredential(id: string, value: string): void {
    saveBillingCredential(this.deps.dataDir, id, value);
  }

  /** 有效凭据 = 独立槽优先、回落推理 key（openrouter 的管理凭据必须放独立槽，推理 key 不会覆盖它） */
  private credentialOf(id: string, inferenceKeys: Record<string, string>): { key: string; source: EngineBillingView['credentialSource'] } {
    const slot = this.loadCredentials()[id];
    if (slot) return { key: slot, source: 'billing' };
    const inference = inferenceKeys[id];
    if (inference) return { key: inference, source: 'inference' };
    return { key: '', source: 'none' };
  }

  private manualFallback(manual: ManualBilling, status: BillingFetchStatus, error: string | null) {
    if (manual.balance !== null) {
      return {
        balance: manual.balance, currency: manual.currency, scope: 'account' as const,
        provenance: 'manual' as BillingProvenance, asOf: manual.updatedAt, status, lastError: error,
      };
    }
    return {
      balance: null, currency: null, scope: null,
      provenance: 'unset' as BillingProvenance, asOf: null, status, lastError: error,
    };
  }

  private cacheEntry(id: string): CacheEntry {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const entry: CacheEntry = {
      lastGood: null, lastGoodAt: null,
      view: { balance: null, currency: null, scope: null, provenance: 'unset', asOf: null, status: 'no_endpoint', lastError: null, keySet: false, credentialSource: 'none' },
    };
    this.cache.set(id, entry);
    return entry;
  }

  /** 单引擎查询（force=false 且缓存未过期 → 直接复用，不重复打厂商） */
  async refreshEngine(
    engine: LlmEngineConfig,
    inferenceKeys: Record<string, string>,
    manual: ManualBilling,
    force: boolean,
  ): Promise<EngineBillingView> {
    const id = engine.id;
    const entry = this.cacheEntry(id);
    const base = { id, name: engine.name, manual };
    if ((LOCAL_BILLING_VENDORS as readonly string[]).includes(id)) {
      entry.view = { balance: 0, currency: 'CNY', scope: 'local', provenance: 'local_free', asOf: null, status: 'zero_cost', lastError: null, keySet: false, credentialSource: 'none' };
      return { ...base, kind: 'local', ...entry.view };
    }
    const adapter = BILLING_ADAPTERS[id];
    const cred = this.credentialOf(id, inferenceKeys);
    const keySet = cred.key !== '';
    if (!adapter || !adapter.verifiable) {
      // 无适配器（自定义引擎）与明确无接口的厂商：不伪造实时，降级手工
      entry.view = {
        ...this.manualFallback(manual, 'no_endpoint', '该厂商无余额接口，手工兜底'),
        keySet, credentialSource: cred.source,
      };
      return { ...base, kind: 'none', ...entry.view };
    }
    if (!keySet) {
      entry.view = {
        ...this.manualFallback(manual, 'no_endpoint', '未配置凭据，手工兜底'),
        keySet: false, credentialSource: 'none',
      };
      return { ...base, kind: 'vendor', ...entry.view };
    }
    // TTL 命中：仅当上次是 vendor_live 且未超时才复用（stale 值不因时间流逝变成 live）
    const fresh = entry.view.provenance === 'vendor_live'
      && entry.view.asOf !== null && this.now() - entry.view.asOf < this.ttlMs;
    if (!force && fresh) {
      return { ...base, kind: 'vendor', ...entry.view, keySet, credentialSource: cred.source };
    }

    const out = await adapter.fetch(cred.key, this.fetchImpl);
    if (out.status === 'ok' && out.balance) {
      const at = this.now();
      entry.lastGood = out.balance;
      entry.lastGoodAt = at;
      entry.view = {
        balance: out.balance.amount, currency: out.balance.currency, scope: out.balance.scope,
        provenance: 'vendor_live', asOf: at, status: 'ok', lastError: null,
        keySet, credentialSource: cred.source,
      };
      return { ...base, kind: 'vendor', ...entry.view };
    }
    if (out.status === 'auth_deficient') {
      // 凭据权限不足：降级手工并明示原因；旧厂商值保持不动（不冒充实时）
      entry.view = {
        ...this.manualFallback(manual, 'auth_deficient', out.error ?? '凭据权限不足（HTTP 401/403）'),
        keySet, credentialSource: cred.source,
      };
      return { ...base, kind: 'vendor', ...entry.view };
    }
    if (out.status === 'transient') {
      if (entry.lastGood && entry.lastGoodAt !== null) {
        entry.view = {
          balance: entry.lastGood.amount, currency: entry.lastGood.currency, scope: entry.lastGood.scope,
          provenance: 'vendor_stale', asOf: entry.lastGoodAt,
          status: 'transient', lastError: out.error ?? '厂商暂时不可达',
          keySet, credentialSource: cred.source,
        };
      } else {
        entry.view = {
          ...this.manualFallback(manual, 'transient', out.error ?? '厂商暂时不可达'),
          keySet, credentialSource: cred.source,
        };
      }
      return { ...base, kind: 'vendor', ...entry.view };
    }
    // no_endpoint / error：同样降级手工（有旧值也不拿它冒充实时，因为这不是「暂时不可达」）
    entry.view = {
      ...this.manualFallback(manual, out.status, out.error ?? '余额查询失败'),
      keySet, credentialSource: cred.source,
    };
    return { ...base, kind: 'vendor', ...entry.view };
  }

  /** 全量刷新（force 由页面手动刷新触发；余额查询不写 llm_proxy 审计、不计 cost_cap） */
  async refreshAll(
    cfg: LlmGatewayConfig,
    inferenceKeys: Record<string, string>,
    manualOf: (id: string) => ManualBilling,
    force: boolean,
  ): Promise<EngineBillingView[]> {
    const out: EngineBillingView[] = [];
    for (const e of cfg.engines) {
      out.push(await this.refreshEngine(e, inferenceKeys, manualOf(e.id), force));
    }
    return out;
  }
}
