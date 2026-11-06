// P13 纯逻辑（T2）：向量模型信息 / Key 脱敏 / 用途校验 / 反代理择优与审计
import type { LlmUsage, ProxyCallAuditEntry, ProxySelectMode, ProxySource, UsageConfig, VectorModelInfo, VectorModelKey } from './types.ts';
import { VECTOR_MODELS } from './catalog.ts';
import { remainingText } from '../../shared/proxyAccounting.ts';

/** R3：fallback_local 恒开，无关闭入口 */
export const FALLBACK_ALWAYS_ON = true;

export function vectorInfo(key: VectorModelKey): VectorModelInfo {
  return VECTOR_MODELS.find((m) => m.key === key) ?? VECTOR_MODELS[0];
}

/** R2：Key 脱敏展示 —— 只露前 2 位，其余打码 */
export function maskKey(k: string): string {
  if (!k) return '';
  return `[API_KEY:${k.slice(0, 2)}****]`;
}

/** 换维度触发重建的估时（分钟）：按维度比例 × 每 500 条 1 分钟基准 */
export function rebuildEta(fromDims: number, toDims: number, count: number): number {
  return Math.max(1, Math.ceil((count / 500) * (toDims / fromDims)));
}

/**
 * 用途校验（13.2）：
 * R1 每用途至少一可用模型（local/net 至少勾一项）
 * C3 勾网络通道必须配端点
 * R4 judge 温度恒 0（输入非 0 会被归零并提示）
 */
export function validateUsage(usage: LlmUsage, cfg: UsageConfig): { errors: string[]; normalized: UsageConfig } {
  const errors: string[] = [];
  let normalized: UsageConfig = { ...cfg };
  if (!cfg.local && !cfg.net) errors.push('R1 每个用途至少要有一个可用模型（本地/网络至少勾一项）');
  if (cfg.net && !cfg.endpoint.trim()) errors.push('C3 勾选网络模型必须填写端点 URL');
  if (usage === 'judge' && cfg.temperature !== 0) normalized = { ...normalized, temperature: 0 };
  return { errors, normalized };
}

/** R8：反代理预算 = 声明额度 × 0.9；配额未设置 → null（无法算预算，不编造） */
export function proxyBudgetOf(src: ProxySource): number | null {
  return src.quota === null ? null : Math.floor(src.quota * 0.9);
}

/** 当日余量（可为负 = 超限）；配额未设置 → null */
export function remainingOf(src: ProxySource): number | null {
  const budget = proxyBudgetOf(src);
  return budget === null ? null : budget - src.used;
}

/** R7/R12：档位资格 —— 免费恒可；低价需 price ≤ price_cap；paid 永不入代理。
 *  批次48 A16：云端单价未设置 → 无法判定资格，按不合格处理（不拿占位数字蒙）。 */
export function proxyEligible(src: ProxySource, priceCap: number): boolean {
  if (src.tier === 'paid') return false;
  if (src.tier === 'free') return true;
  return src.price !== null && src.price <= priceCap;
}

/** C13：price_cap ≥ 0；=0 时仅免费源可用 */
export function validatePriceCap(v: number): { ok: boolean; freeOnly: boolean; msg: string } {
  if (!Number.isFinite(v) || v < 0) return { ok: false, freeOnly: false, msg: 'price_cap 必须 ≥ 0' };
  if (v === 0) return { ok: true, freeOnly: true, msg: 'price_cap=0：仅免费源可代理，付费源一律回退本地' };
  return { ok: true, freeOnly: false, msg: '' };
}

export type ProxyPick = { source: ProxySource | null; reason: string };

/**
 * auto 择优（C7/C8/C13）：免费（余量多者优先，耗尽者剔除）→ 低价 ≤ price_cap（价低者优先）→ 无合格回退本地。
 * 余量 ≤ 0（超限，如 x-agent 演示源）一律剔除。
 */
export function autoPick(srcs: ProxySource[], priceCap: number, _now: number): ProxyPick {
  const remain = (s: ProxySource) => remainingOf(s);
  const eligible = srcs.filter((s) => {
    const r = remain(s);
    return proxyEligible(s, priceCap) && r !== null && r > 0;
  });
  const free = eligible.filter((s) => s.tier === 'free').sort((a, b) => (remain(b) ?? 0) - (remain(a) ?? 0));
  if (free.length > 0) {
    return { source: free[0], reason: `免费优先：${free[0].agent}/${free[0].model}（余量 ${remainingText(remain(free[0])!)}）` };
  }
  const cheap = eligible.filter((s) => s.tier === 'cheap').sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  if (cheap.length > 0) {
    return { source: cheap[0], reason: `无可用免费源，走低价：${cheap[0].agent}/${cheap[0].model}（¥${cheap[0].price}/千次 ≤ cap ¥${priceCap}）` };
  }
  return { source: null, reason: '无合格代理源（免费耗尽 / 低价超 cap / 单价或配额未设置）→ 回退本地 fallback_local（R12）' };
}

/**
 * manual 择优（C9/C11/R7）：只在勾选源内取第一个可用者；
 * 勾选中含不具备资格的（paid 或 cheap 超 cap）→ 直接拒绝并报错（不静默转其他源）；
 * 勾选源全部耗尽 → 回退本地，不转未勾选源。
 */
export function manualPick(selected: ProxySource[], priceCap: number, _now: number): ProxyPick {
  const ineligible = selected.filter((s) => !proxyEligible(s, priceCap));
  if (ineligible.length > 0) {
    const s = ineligible[0];
    const why = s.tier === 'paid'
      ? 'paid 档不可入代理'
      : s.price === null ? '单价未设置（参数页配置）' : `¥${s.price}/千次 超 price_cap ¥${priceCap}`;
    return { source: null, reason: `R7 拒绝：勾选源 ${s.agent}/${s.model}（${why}）` };
  }
  const first = selected.find((s) => {
    const r = remainingOf(s);
    return r !== null && r > 0;
  });
  if (first) return { source: first, reason: `手动指定：${first.agent}/${first.model}（余量 ${remainingText(remainingOf(first)!)}）` };
  return { source: null, reason: '勾选源当日余量已耗尽或配额未设置 → 回退本地 fallback_local，不转未勾选源（C11）' };
}

/** R10：反代理调用审计 —— llm_proxy_source=agent:<name> + 花费 + 模式 */
export function auditProxy(src: ProxySource | null, cost: number, mode: ProxySelectMode | 'local'): ProxyCallAuditEntry {
  return {
    event: 'llm_proxy',
    llm_proxy_source: src ? `agent:${src.agent}` : 'agent:local',
    cost,
    mode: src ? mode : 'local',
    at: Date.now(),
  };
}
