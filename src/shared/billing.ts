// 批次48 A31：余额/配额/单价的公共口径（electron 主进程与 web 模型页共用，纯函数、无 IO）。
// 逐字段 provenance 的四种展示文案与 as_of 格式化集中在这里，避免页面各写一套措辞（口径漂移）。
// 口径：余额只有真实厂商端点才算 vendor_live；配额/单价厂商不提供，恒为手工值；单次 cost 只能是推算。

export type BillingProvenance = 'vendor_live' | 'vendor_stale' | 'manual' | 'unset' | 'local_free';

/** 查询结论（主进程产出、页面据此决定文案与降级动作；线上契约同形） */
export type BillingFetchStatus =
  | 'ok'
  | 'auth_deficient'
  | 'no_endpoint'
  | 'transient'
  | 'error'
  | 'zero_cost';

/** 单个引擎的余额视图（IPC 线上形状；只含 keySet 布尔，绝无凭据明文） */
export interface BillingEngineView {
  id: string;
  name: string;
  /** local = 本机 0 元；vendor = 有适配器的厂商；none = 无余额接口的厂商/自定义引擎 */
  kind: 'local' | 'vendor' | 'none';
  balance: number | null;
  currency: string | null;
  scope: 'account' | 'key_limit' | 'local' | null;
  provenance: BillingProvenance;
  /** 余额的 as_of：vendor_live = 本次成功时刻；vendor_stale = 上次成功时刻；manual = 手工值写入时刻；其余 null */
  asOf: number | null;
  status: BillingFetchStatus;
  /** 已清洗的失败/降级原因（成功时 null） */
  lastError: string | null;
  keySet: boolean;
  credentialSource: 'billing' | 'inference' | 'none';
  manual: ManualBilling;
}

/** 手工兜底配置（模型页按引擎填写，随 llm-config.json 持久化） */
export interface ManualBilling {
  /** 手工填写的余额；null = 未填 */
  balance: number | null;
  currency: string;
  /** 声明日配额（厂商 API 不提供） */
  dailyQuota: number | null;
  /** 单价（¥/百万词元，厂商 API 不提供）；单次 cost 用它推算 */
  priceCnyPerMTok: number | null;
  /** 手工值写入时刻（展示 as_of）；null = 未填 */
  updatedAt: number | null;
}

export const UNSET_MANUAL_BILLING: ManualBilling = {
  balance: null, currency: 'CNY', dailyQuota: null, priceCnyPerMTok: null, updatedAt: null,
};

const toNum = (v: unknown): number | null => {
  // 空串/纯空白视为未填：Number('') === 0，若直接转会把「没填」悄悄变成 0（A31 明确禁止）
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** 归一化：非有限值/越界一律按「未填」处理，绝不把空串或 NaN 悄悄当 0 */
export function normalizeManualBilling(raw: unknown): ManualBilling {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const balance = toNum(r.balance);
  const quota = toNum(r.dailyQuota);
  const price = toNum(r.priceCnyPerMTok);
  const currency = typeof r.currency === 'string' && r.currency.trim() ? r.currency.trim().toUpperCase() : 'CNY';
  return {
    balance: balance !== null && balance >= 0 ? balance : null,
    currency,
    dailyQuota: quota !== null && quota > 0 ? quota : null,
    priceCnyPerMTok: price !== null && price >= 0 ? price : null,
    updatedAt: toNum(r.updatedAt),
  };
}

/** 是否真的填过手工值（三项任一非空） */
export function manualBillingSet(m: ManualBilling): boolean {
  return m.balance !== null || m.dailyQuota !== null || m.priceCnyPerMTok !== null;
}

/** HH:mm（UTC+08:00，与全站时间展示同口径） */
export function billingHHmm(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ts));
}

/** 距今天数（向下取整、不为负） */
export function billingMinutesAgo(ts: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - ts) / 60_000));
}

export interface ProvenanceInput {
  provenance: BillingProvenance;
  asOf: number | null;
  /** vendor 余额口径：account = 账户余额；key_limit = 该 key 限额（非账户余额） */
  scope?: 'account' | 'key_limit' | 'local' | null;
}

/**
 * 逐字段 provenance 文案（用户拍板四种措辞）：
 *  「厂商实时 · HH:mm」/「厂商上次成功 · N 分钟前（当前不可达）」/「手工兜底（非厂商实时）」/「未设置」；
 *  openrouter 普通 key 额外标「（key 限额，非账户余额）」，防止把 key 限额当账户余额。
 *  本机三家单列「本机 · 0 元不限量」。
 */
export function billingProvenanceText(p: ProvenanceInput, now: number = Date.now()): string {
  const scopeTag = p.scope === 'key_limit' ? '（key 限额，非账户余额）' : '';
  switch (p.provenance) {
    case 'vendor_live':
      return `厂商实时 · ${p.asOf === null ? '–' : billingHHmm(p.asOf)}${scopeTag}`;
    case 'vendor_stale':
      return p.asOf === null
        ? `厂商上次成功 · 时间未记录（当前不可达）${scopeTag}`
        : `厂商上次成功 · ${billingMinutesAgo(p.asOf, now)} 分钟前（当前不可达）${scopeTag}`;
    case 'manual':
      return '手工兜底（非厂商实时）';
    case 'local_free':
      return '本机 · 0 元不限量';
    case 'unset':
    default:
      return '未设置';
  }
}

/** 余额金额展示：currency + 两位小数；null → 未设置（不拿 0 冒充） */
export function billingAmountText(amount: number | null, currency: string | null): string {
  if (amount === null) return '未设置';
  const cur = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : `${currency ?? ''} `;
  return `${cur}${amount.toFixed(2)}`;
}

/**
 * 单次 cost 推算（仅在调用方拿到真实 usage tokens 时可用）：
 * `cost = tokens / 1e6 × priceCnyPerMTok`；返回 null = 缺 tokens 或单价未设置 —— 不估算、不填 0。
 * 文案必须标「推算」，不得呈现为厂商账单。
 */
export function estimateCallCostCny(tokens: number | null, priceCnyPerMTok: number | null): number | null {
  if (tokens === null || priceCnyPerMTok === null) return null;
  if (!Number.isFinite(tokens) || tokens < 0) return null;
  if (!Number.isFinite(priceCnyPerMTok) || priceCnyPerMTok < 0) return null;
  return (tokens / 1_000_000) * priceCnyPerMTok;
}
