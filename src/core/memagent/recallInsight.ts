// 召回洞察（批次11/13）：项目背景筛选 / 省量核算 / 聊天窗口提示行与累计金额的唯一纯函数真源。
// 批次13：追加折叠明细（<details> 四段），提示行仍是唯一摘要行；数字全部同源。
// 约束：数字全部来自真实账本（记忆内容 + recall 审计），未配置单价时金额一律 null，绝不编造。
import type {
  AuditRecord, Category, Hit, Memory, RecallBackground, RecallBackgroundItem, RecallMode, RecallResult, RecallSavings,
} from './types.ts';
import { displayTerms, pickHitSpans } from './hitHighlight.ts';
// A6：模式中文名的唯一真源就是调度层那张表，回显不另立一份文案
import { RECALL_MODE_SPECS } from './recallModes.ts';

/**
 * 本地预算单位 t 的确定性换算：全链路同源 —— 召回硬熔断裁剪（agent.ts）、背景选入、
 * 省量核算、金额换算都读它。**不是 LLM tokenizer 的 token 数**，也未接入网关真实 usage。
 * 已知限制：中文按「2 字 1t」会低估真实 BPE 分词（常见汉字约 1 字 1–2 token），
 * 因此 3000t 是项目内预算刻度，不代表真实上下文长度；真实用量应以网关 usage 为准。
 * 改这个口径会同时改变新写入的 payload_tokens 与历史审计的统计含义，必须整体迁移，
 * 不得只改本函数（见 specs/MANUAL-TEST-FIX-BATCH-42.md §9）。
 */
export const CHARS_PER_BUDGET_UNIT = 2;
export const estTokens = (s: string): number => Math.ceil(s.length / CHARS_PER_BUDGET_UNIT);

/** 项目背景上限：最多 5 条、单条 160 字、合计 300t（且不得挤占 payload 硬熔断余量） */
export const BACKGROUND_MAX_ITEMS = 5;
export const BACKGROUND_ITEM_CHARS = 160;
export const BACKGROUND_MAX_TOKENS = 300;

/** 背景优先级：决策/踩坑/偏好优先，其次事实/洞察/上下文 */
const CATEGORY_PRIORITY: Record<Category, number> = {
  decision: 5, pitfall: 4, preference: 3, fact: 2, insight: 1, context: 0,
};

function updatedAt(m: Memory): number {
  return m.updated_at ?? m.created_at ?? 0;
}

/** 背景排序：置顶 > 类别优先级 > 最近更新 > mem_id（确定性） */
function compareBackground(a: Memory, b: Memory): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const p = CATEGORY_PRIORITY[b.category] - CATEGORY_PRIORITY[a.category];
  if (p !== 0) return p;
  const dt = updatedAt(b) - updatedAt(a);
  if (dt !== 0) return dt;
  return a.mem_id.localeCompare(b.mem_id);
}

/**
 * 选项目背景：与本次命中去重、排除合并影子；minimal 模式不携带（16.5 次模式 ≤200t 语义）。
 * maxTokens 由调用方按硬熔断余量传入，保证 payload + background ≤ 3000t。
 */
export function selectRecallBackground(
  mems: Memory[],
  excludeIds: ReadonlySet<string>,
  opts: { minimal?: boolean; maxTokens?: number } = {},
): RecallBackground {
  if (opts.minimal) return { items: [], tokens: 0, candidates: 0 };
  const maxTokens = Math.max(0, opts.maxTokens ?? BACKGROUND_MAX_TOKENS);
  const pool = mems.filter(
    (m) => !excludeIds.has(m.mem_id) && !m.merged_into && !m.deleted && m.content.trim().length > 0,
  );
  const items: RecallBackgroundItem[] = [];
  let tokens = 0;
  for (const m of [...pool].sort(compareBackground)) {
    if (items.length >= BACKGROUND_MAX_ITEMS) break;
    const truncated = m.content.length > BACKGROUND_ITEM_CHARS;
    const content = truncated ? `${m.content.slice(0, BACKGROUND_ITEM_CHARS)}…` : m.content;
    const t = estTokens(content);
    if (tokens + t > maxTokens) continue;
    items.push({
      mem_id: m.mem_id, category: m.category, content, tokens: t,
      pinned: m.pinned, created_at: m.created_at, truncated,
    });
    tokens += t;
  }
  return { items, tokens, candidates: pool.length };
}

/** 全量注入基线：项目全部可读记忆（排除合并影子/墓碑） */
export function corpusTokens(mems: Memory[]): number {
  return mems
    .filter((m) => !m.merged_into && !m.deleted)
    .reduce((sum, m) => sum + estTokens(m.content), 0);
}

/** 省量核算：preCapTokens = 硬熔断裁剪前的命中 token（topK + 冷回填） */
export function computeRecallSavings(args: {
  memories: Memory[];
  hits: Hit[];
  background: RecallBackground;
  preCapTokens: number;
}): RecallSavings {
  const corpus = corpusTokens(args.memories);
  const payload = args.hits.reduce((sum, h) => sum + estTokens(h.content), 0);
  const background = args.background.tokens;
  const injected = payload + background;
  return {
    corpus_tokens: corpus,
    payload_tokens: payload,
    background_tokens: background,
    injected_tokens: injected,
    budget_trimmed_tokens: Math.max(0, args.preCapTokens - payload),
    saved_tokens: Math.max(0, corpus - injected),
  };
}

/* ---------- 累计用量（recall 审计）与金额换算 ---------- */

export interface RecallRollup {
  today_calls: number;
  today_injected_tokens: number;
  today_saved_tokens: number;
  /** 旧版审计无省量字段：payload 计入用量，但不参与省量/省额（诚实标注） */
  today_legacy_calls: number;
  all_calls: number;
  all_injected_tokens: number;
  all_saved_tokens: number;
  all_legacy_calls: number;
}

export interface RecallMoneyBlock {
  calls: number;
  cost_cny: number;
  saved_cny: number;
  legacy_calls: number;
}

/**
 * 阶段5-F：金额是**估算**，不是账单。
 * 口径 = 本地预算单位 t（estTokens = 字符数 / CHARS_PER_BUDGET_UNIT）× 用户在全局参数页自设的单价；
 * 未接入网关真实 usage，且中文按「2 字 1t」会低估真实 BPE。UI 必须带「估算」字样，不得显示成真实扣费。
 */
export interface RecallMoney {
  unit_price_cny_per_mtok: number;
  this_call: { injected_tokens: number; cost_cny: number; saved_cny: number };
  today: RecallMoneyBlock;
  all: RecallMoneyBlock;
}

/** 批次 RAG：短收摘要与统计汇总的唯一口径（三档模板共用；不写库、不进 display 契约） */
export interface RecallEchoSummary {
  /** 首行：命中数 + top3 编号依据词 + 省量比例 + 本次金额/金额未开 */
  headline: string;
  /** 第二行：注入 / 基线 / 背景 / 今日 / 全部 */
  stats: string;
  /** 只在真有告警时非空；正常轮次不产出常驻噪声 */
  warnings: string[];
  /**
   * A6（回显贯通）：本次模式与分流依据（§3.4「让用户知道系统替你选了 X，因为命中了这些词」）。
   * 会话视图（dispatch=null）为 null —— 没有分流动作就不编一行。
   */
  mode_line: string | null;
}

export interface RecallHint {
  /** 聊天窗口逐字回显的单行提示 */
  line: string;
  /**
   * 批次33-C：折叠档专用短摘要（最多两行 + 告警行，与 line 数字同源）。
   * 为什么另起一行：line 把命中/背景/省量/本次/今日/全部串成一条长句，在不渲染 HTML 的客户端里
   * 折成 4~5 行，用户要求「不点击只显示前 2 行」——明细挪到本机明细页后，聊天侧必须自带收口版本。
   */
  shortLine: string;
  /** 未配置单价 → null（提示行明示，不编造金额） */
  money: RecallMoney | null;
  rollup: RecallRollup;
  /**
   * 批次 RAG：新版短收摘要（buildRecallEchoSummary 生成）。
   * 可选 —— 老调用方手写 hint 时不至于类型失败；缺省时 compact 档退回 shortLine。
   */
  echo?: RecallEchoSummary;
}

/** 本地时区当日零点 */
export function localDayStart(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** 从 recall 审计累计今日/全部用量；缺省字段按旧账处理（用量按 payload 保守计，省量不计） */
export function rollupRecalls(audits: AuditRecord[], now: number): RecallRollup {
  const dayStart = localDayStart(now);
  const out: RecallRollup = {
    today_calls: 0, today_injected_tokens: 0, today_saved_tokens: 0, today_legacy_calls: 0,
    all_calls: 0, all_injected_tokens: 0, all_saved_tokens: 0, all_legacy_calls: 0,
  };
  for (const a of audits) {
    if (a.action !== 'recall' || a.ts > now) continue;
    const payload = num(a.detail.payload_tokens) ?? 0;
    const injected = num(a.detail.injected_tokens) ?? payload;
    const saved = num(a.detail.saved_tokens);
    out.all_calls++;
    out.all_injected_tokens += injected;
    if (saved === null) out.all_legacy_calls++;
    else out.all_saved_tokens += saved;
    if (a.ts >= dayStart) {
      out.today_calls++;
      out.today_injected_tokens += injected;
      if (saved === null) out.today_legacy_calls++;
      else out.today_saved_tokens += saved;
    }
  }
  return out;
}

const fmtInt = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 金额格式：小额多留位数，去掉尾随 0；非法值给 — */
export function formatCny(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '¥0';
  const abs = Math.abs(n);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return `¥${n.toFixed(digits).replace(/\.?0+$/, '')}`;
}

function costOf(tokens: number, price: number): number {
  return (tokens / 1_000_000) * price;
}

/** 单价合法性：有限且 ≥0；null/非法 → 未配置 */
export function normalizeUnitPrice(price: unknown): number | null {
  return typeof price === 'number' && Number.isFinite(price) && price >= 0 ? price : null;
}

/**
 * 组装聊天窗口提示：命中 / 项目背景 / 省量 / 本次+今日+全部金额。
 * 提示行只含真实可核算字段；未配置单价时输出「未设置单价」，金额字段为 null。
 */
export function buildRecallHint(
  result: RecallResult,
  rollup: RecallRollup,
  unitPriceCnyPerMTok: number | null,
): RecallHint {
  const hitPart = result.hits.length > 0
    ? `命中 ${result.hits.length} 条（${fmtInt(result.savings.payload_tokens)}t）`
    : `未命中（扫描 ${fmtInt(result.scanned_memories)} 条，未注入命中内容）`;
  const bg = result.background;
  const bgPart = `📎 背景 ${bg.items.length} 条（${fmtInt(bg.tokens)}t）`;
  const savePart = `⚡ 本次省 ${fmtInt(result.savings.saved_tokens)}t（全量约 ${fmtInt(result.savings.corpus_tokens)}t）`;

  // 批次 RAG：告警抽成唯一函数，提示行与三档模板共用同一份（正常轮次不产出常驻噪声）
  const warnings = recallWarnings(result, rollup, unitPriceCnyPerMTok);

  const price = normalizeUnitPrice(unitPriceCnyPerMTok);
  let money: RecallMoney | null = null;
  let moneyPart: string;
  /** 批次33-C 折叠档第二行：本次花费/省额 + 今日/全部次数（今日/全部的金额明细挪到本机明细页，仍同源） */
  let moneyShort: string;
  if (price === null) {
    moneyPart = '💰 金额未开：未设置单价（全局参数页可设 ¥/百万预算单位 t；金额按本地预算单位估算）';
    moneyShort = `💰 金额未开（参数页可设 ¥/百万预算单位 t） ｜ 今日 ${rollup.today_calls} 次 ｜ 全部 ${rollup.all_calls} 次`;
  } else {
    money = {
      unit_price_cny_per_mtok: price,
      this_call: {
        injected_tokens: result.savings.injected_tokens,
        cost_cny: costOf(result.savings.injected_tokens, price),
        saved_cny: costOf(result.savings.saved_tokens, price),
      },
      today: {
        calls: rollup.today_calls,
        cost_cny: costOf(rollup.today_injected_tokens, price),
        saved_cny: costOf(rollup.today_saved_tokens, price),
        legacy_calls: rollup.today_legacy_calls,
      },
      all: {
        calls: rollup.all_calls,
        cost_cny: costOf(rollup.all_injected_tokens, price),
        saved_cny: costOf(rollup.all_saved_tokens, price),
        legacy_calls: rollup.all_legacy_calls,
      },
    };
    moneyPart = `💰 金额估算（本地预算单位 t × 单价）：本次 ${formatCny(money.this_call.cost_cny)}（省 ${formatCny(money.this_call.saved_cny)}）`
      + ` ｜ 今日 ${rollup.today_calls} 次 ${formatCny(money.today.cost_cny)}（省 ${formatCny(money.today.saved_cny)}）`
      + ` ｜ 全部 ${rollup.all_calls} 次 ${formatCny(money.all.cost_cny)}（省 ${formatCny(money.all.saved_cny)}）`;
    moneyShort = `💰 估算 本次 ${formatCny(money.this_call.cost_cny)}（省 ${formatCny(money.this_call.saved_cny)}）`
      + ` ｜ 今日 ${rollup.today_calls} 次 ｜ 全部 ${rollup.all_calls} 次`;
  }

  const line = [`🧠 Memory ｜ ${hitPart} ｜ ${bgPart} ｜ ${savePart} ｜ ${moneyPart}`, ...warnings].join(' ｜ ');
  // A6：shortLine 是「无 echo 时的兜底摘要」，模式行同样带上（§3.4 透明），dispatch=null 时不加
  const modeLine = buildRecallModeLine(result);
  const shortLine = [
    `🧠 Memory ｜ ${hitPart} ｜ ${bgPart} ｜ ${savePart}`,
    moneyShort,
    ...(modeLine ? [modeLine] : []),
    ...warnings,
  ].join('\n');
  const hint: RecallHint = { line, shortLine, money, rollup };
  hint.echo = buildRecallEchoSummary(result, hint, unitPriceCnyPerMTok);
  return hint;
}

/* ---------- 批次 RAG：短收摘要 / 统计汇总 / 编号依据 —— 三档模板共用的唯一口径 ---------- */

/**
 * 省量比例：本次唯一新增的**展示派生值**（saved_tokens / corpus_tokens）。
 * 不写库、不进审计、不进 display 契约；分母为 0 或非法时输出「—」，绝不编造。
 */
export function recallSavingRatio(result: RecallResult): string {
  const corpus = result.savings.corpus_tokens;
  if (!Number.isFinite(corpus) || corpus <= 0) return '—';
  return `${((Math.max(0, result.savings.saved_tokens) / corpus) * 100).toFixed(1)}%`;
}

/** 本次命中依据词：按 hits 返回顺序去重取前 max 个，与打分同源，不从正文猜 */
export function recallHitTerms(result: RecallResult, max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of result.hits) {
    for (const raw of h.matched_terms ?? []) {
      const t = raw.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** 告警与提示行完全同源（同一函数生成）：正常轮次为空，不做常驻噪声 */
export function recallWarnings(
  result: RecallResult, rollup: RecallRollup, unitPriceCnyPerMTok: number | null,
): string[] {
  const warnings: string[] = [];
  if (result.evidence_thin) warnings.push('⚠ 证据不足：未命中权威来源，建议事实优先重试');
  if (result.budget.status === 'fused') {
    warnings.push(`⚠ 预算熔断：已裁剪 ${fmtInt(result.savings.budget_trimmed_tokens)}t`);
  }
  if (normalizeUnitPrice(unitPriceCnyPerMTok) !== null && rollup.today_legacy_calls > 0) {
    warnings.push(`⚠ 今日含 ${rollup.today_legacy_calls} 次旧记录（无省量字段，金额按载荷下限计）`);
  }
  return warnings;
}

/**
 * A6（回显贯通 §3.4）：本次生效模式 + 分流来源 + 命中特征词；会话视图（dispatch=null）返回 null。
 * 只读 RecallResult.dispatch（与 mode_dispatch 审计同一份对象），不在这里重新判断模式——
 * 回显一旦自己再算一遍，就又变成第三套口径。
 */
export function buildRecallModeLine(result: RecallResult): string | null {
  const d = result.dispatch;
  if (!d) return null;
  const nameOf = (m: Exclude<RecallMode, null>): string =>
    (m === 'auto' ? '自动' : RECALL_MODE_SPECS[m].name);
  const kw = result.hit_keywords;
  let body: string;
  if (d.source === 'manual') {
    body = `${nameOf(d.applied)}（用户指定）`;
  } else if (d.applied === 'auto') {
    // 自动分流建议了极简、本轮按默认口径执行（specs §2.6 A2 观测档）——如实说明，不冒充分流已落地
    body = `自动（分流建议${nameOf(d.suggested)} · 本轮按默认口径执行）`;
  } else {
    const why = kw.length > 0 ? `命中${kw.map((k) => `「${k}」`).join('')}` : '零命中走 scene 默认';
    body = `${nameOf(d.applied)}（自动分流 · ${plainClip(why, 60)}）`;
  }
  const sec = d.secondary ? ` · 次模式：${RECALL_MODE_SPECS[d.secondary].name}` : '';
  return `⚙ 模式：${body}${sec}`;
}

/** 折叠档外层 summary：≤80 字，命中数 + top3 命中词 + 省量比例 + 展开提示 */
export function buildRecallFoldSummary(result: RecallResult): string {
  const terms = recallHitTerms(result, 3);
  const termPart = terms.length > 0 ? ` · 依据${terms.map((t) => `「${plainClip(t, 12)}」`).join('')}` : '';
  return `🧠 命中 ${result.hits.length} 条${termPart} ｜ 省 ${recallSavingRatio(result)} ｜ ▶ 展开本次召回汇总`;
}

/** 两行短收摘要：首行命中依据前置，第二行统计汇总；warnings 独立成行（异常驱动） */
export function buildRecallEchoSummary(
  result: RecallResult, hint: RecallHint, unitPriceCnyPerMTok: number | null,
): RecallEchoSummary {
  // 编号必须严格对应 hits[i]（RAG 契约）：取前 3 条命中的代表词，而不是 top3 命中词。
  // 否则首行的 [3] 可能只是第 1 条命中的第 3 个词，与依据段 [n] 指代的条目错配。
  const cited = result.hits.slice(0, 3)
    .map((h, i) => ({ n: i + 1, term: h.matched_terms?.[0]?.trim() ?? '' }))
    .filter((x) => x.term.length > 0);
  const termPart = cited.length > 0
    ? ' · 依据 ' + cited.map((x) => `[${x.n}]「${plainClip(x.term, 20)}」`).join('')
    : '';
  const moneyTag = hint.money === null ? '金额未开' : `估算 ${formatCny(hint.money.this_call.cost_cny)}`;
  const headline = `🧠 命中 ${result.hits.length} 条${termPart} ｜ 省 ${recallSavingRatio(result)}`
    + `（${fmtInt(result.savings.saved_tokens)}t）｜ ${moneyTag}`;
  const stats = `📊 汇总：注入 ${fmtInt(result.savings.injected_tokens)}t / 基线 ${fmtInt(result.savings.corpus_tokens)}t`
    + ` · 背景 ${result.background.items.length} 条（${fmtInt(result.background.tokens)}t）`
    + ` · 今日 ${hint.rollup.today_calls} 次 · 全部 ${hint.rollup.all_calls} 次`;
  return { headline, stats, warnings: recallWarnings(result, hint.rollup, unitPriceCnyPerMTok), mode_line: buildRecallModeLine(result) };
}

/** 统计汇总四行：字段全部来自 RecallResult / RecallHint，零新增计算（除展示派生比例） */
export function buildRecallStatLines(result: RecallResult, hint: RecallHint): string[] {
  const t = result.savings;
  const bg = result.background;
  const r = hint.rollup;
  const money = hint.money;
  return [
    `命中：${result.hits.length} 条（${fmtInt(t.payload_tokens)}t） · 背景 ${bg.items.length} 条（${fmtInt(bg.tokens)}t） · 扫描 ${fmtInt(result.scanned_memories)} 条`,
    `用量：本次注入 ${fmtInt(t.injected_tokens)}t / 全量基线 ${fmtInt(t.corpus_tokens)}t · 预算 ${result.budget.status}（软 ${fmtInt(result.budget.soft)} / 警 ${fmtInt(result.budget.warn)} / 硬 ${fmtInt(result.budget.hard)}t）`,
    `省量：${fmtInt(t.saved_tokens)}t（${recallSavingRatio(result)}） · ` + (money === null
      ? '金额未开'
      : `估算 ${formatCny(money.this_call.cost_cny)}（省 ${formatCny(money.this_call.saved_cny)}）`),
    money === null
      ? `累计：今日 ${r.today_calls} 次 · 全部 ${r.all_calls} 次`
      : `累计：今日 ${r.today_calls} 次（${formatCny(money.today.cost_cny)}） · 全部 ${r.all_calls} 次（${formatCny(money.all.cost_cny)}）`,
  ];
}

/** 相关度 5 格字符条：零样式做层级，不赌客户端是否放行内联 style */
function scoreBar(score: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(score * 5)));
  return '▮'.repeat(filled) + '▯'.repeat(5 - filled);
}

/**
 * RAG 编号依据：hits[i] → [i+1]，1-based，按返回顺序（与 score 降序一致）。
 * hits=0 时不产出任何 [n]；无 matched_terms 时不写 🎯、不谎称语义命中。
 */
export function buildRecallCitationLines(
  result: RecallResult,
  markup: HitMarkup,
  clip: (s: string, maxChars: number) => string,
  maxChars = 120,
): string[] {
  return result.hits.map((h, i) => {
    const clipped = clip(h.content, maxChars);
    const body = markHitFragments(clipped, h.matched_terms, markup);
    const terms = displayTerms(h.matched_terms, h.content, 3);
    const why = terms.length > 0
      ? ' 🎯 命中' + terms.map((x) => `「${clip(x, 20)}」`).join('')
      : '';
    const note = terms.length > 0 ? '' : ' · 无字面重合，仅按相关度参考';
    return `[${i + 1}] ${body}（${h.layer}·${h.decay_class} · ${h.score.toFixed(2)} ${scoreBar(h.score)}）${why}${note}`;
  });
}

/** 统计汇总 + 编号依据两段的正文（HTML / 纯 Markdown 两档共用，只有高亮载体不同） */
function buildRecallEchoBody(
  result: RecallResult,
  hint: RecallHint,
  markup: HitMarkup,
  clip: (s: string, maxChars: number) => string,
): string {
  const stats = buildRecallStatLines(result, hint).map((l) => `- ${l}`).join('\n');
  const citeBlock = result.hits.length > 0
    ? `**🎯 本次用上的依据**\n\n${buildRecallCitationLines(result, markup, clip).map((l) => `- ${l}`).join('\n')}`
    : '';
  return `**📊 本次召回统计汇总**\n\n${stats}${citeBlock ? `\n\n${citeBlock}` : ''}`;
}

/* ---------- 聊天窗口明细（批次13 HTML 折叠 / 批次29 纯 Markdown）：四段；不支持 HTML 的客户端用纯 Markdown ---------- */

/** 折叠块文本安全化：记忆内容里的尖括号不得破坏 <details> 结构 */
function mdInline(s: string, maxChars: number): string {
  return plainClip(s, maxChars).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 纯 Markdown 版不转义 HTML（客户端如 DSH 只渲染 Markdown，转义串会原样露出 &lt;） */
function plainClip(s: string, maxChars: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > maxChars ? `${one.slice(0, maxChars)}…` : one;
}

function mdSection(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n</details>`;
}

export interface RecallMarkdownOpts {
  /** true（默认）= 批次13 <details> 折叠版，仅实测支持 HTML 的客户端（Qoder）；false = 纯 Markdown 四小节（批次29，DSH 实测只渲染 Markdown） */
  htmlDetails?: boolean;
}

/* ---------- 批次59（方案 C）：回显里的「命中片段」高亮 ---------- */

/**
 * 高亮载体：html = `<mark>`（折叠档 / 明细页）；markdown = `**「」**`（纯 Markdown 档不引入 HTML 标签）；
 * plain = 原样（不做任何装饰，供不需要高亮的调用方）。
 */
export type HitMarkup = 'html' | 'markdown' | 'plain';

export interface RecallHitStyle {
  markup: HitMarkup;
  /**
   * 段标题里的一句话读法说明（`🧠 命中记忆 3 条（120t）｜ 黄色 = …`）。
   * **只在本次命中里真的存在 matched_terms 时追加**——没有命中词就不解释，
   * 也保证旧账本（无 matched_terms）的回显逐字不变。
   */
  readingHint?: string;
}

/**
 * 把命中词在给定文本里标出来（纯文本切片拼接，绝不用 innerHTML）。
 * 未命中 / 无 terms / 词已被截断切掉 → 原样返回，**不硬标**（§0 诚实约束）。
 */
export function markHitFragments(text: string, terms: string[] | undefined, markup: HitMarkup): string {
  if (markup === 'plain' || !terms || terms.length === 0) return text;
  const spans = pickHitSpans(terms, text);
  if (spans.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const sp of spans) {
    out += text.slice(cursor, sp.start);
    const seg = text.slice(sp.start, sp.end);
    out += markup === 'html' ? `<mark>${seg}</mark>` : `**「${seg}」**`;
    cursor = sp.end;
  }
  return out + text.slice(cursor);
}

/** 四段明细的结构：标题 + 逐条正文（不含列表符号，由各自的渲染器补） */
export interface RecallSection {
  title: string;
  lines: string[];
}

/**
 * 四段明细的唯一数据口径（批次33 抽出，聊天 Markdown / 本机明细页共用）：
 * 项目背景 / 命中记忆 / Token 用量 / 省钱与费用。clip 只管「截断 + 是否 HTML 转义」，数字完全同源。
 */
export function buildRecallSections(
  result: RecallResult,
  hint: RecallHint,
  unitPriceCnyPerMTok: number | null,
  clip: (s: string, maxChars: number) => string,
  maxChars = 120,
  hitStyle: RecallHitStyle = { markup: 'plain' },
): RecallSection[] {
  const t = result.savings;
  const bg = result.background;
  const r = hint.rollup;
  const money = hint.money;
  const price = normalizeUnitPrice(unitPriceCnyPerMTok);

  const bgLines = bg.items.length > 0
    ? bg.items.map((it) => `[${it.category}] ${clip(it.content, maxChars)}`)
    : ['无（minimal 模式或账本暂无可用背景）'];

  // 批次59：本次是否真的有「命中依据」——没有就不高亮、不解释、不写 🎯 空标签
  const hasTerms = result.hits.some((h) => (h.matched_terms?.length ?? 0) > 0);
  const hitLines = result.hits.length > 0
    ? result.hits.map((h) => {
        const clipped = clip(h.content, maxChars);
        const body = markHitFragments(clipped, h.matched_terms, hitStyle.markup);
        const terms = displayTerms(h.matched_terms, h.content, 3);
        // 🎯 命中词 = 回答「为什么是它」；没有共有词时整段不出现
        const why = terms.length > 0
          ? ' 🎯 命中' + terms.map((x) => `「${clip(x, 20)}」`).join('')
          : '';
        return `[${h.layer}/${h.decay_class}] ${body}（相关度 ${h.score.toFixed(2)}）${why}`;
      })
    : [`未命中（扫描 ${fmtInt(result.scanned_memories)} 条，未注入命中内容）`];

  const tokenLines = [
    `本次注入：${fmtInt(t.injected_tokens)}t（命中 ${fmtInt(t.payload_tokens)}t + 背景 ${fmtInt(t.background_tokens)}t）`,
    `全量基线：${fmtInt(t.corpus_tokens)}t（项目全部可读记忆）`,
    `预算裁剪：${fmtInt(t.budget_trimmed_tokens)}t（${result.budget.status}；软 ${fmtInt(result.budget.soft)}t / 告警 ${fmtInt(result.budget.warn)}t / 硬 ${fmtInt(result.budget.hard)}t）`,
    `扫描记忆：${fmtInt(result.scanned_memories)} 条`,
  ];

  const saveLines: string[] = [];
  if (price === null || money === null) {
    saveLines.push(`本次省：${fmtInt(t.saved_tokens)}t（金额未开：未设置单价，全局参数页可设 ¥/百万预算单位 t）`);
    saveLines.push(`今日：${r.today_calls} 次，省 ${fmtInt(r.today_saved_tokens)}t`);
    saveLines.push(`全部：${r.all_calls} 次，省 ${fmtInt(r.all_saved_tokens)}t`);
  } else {
    saveLines.push(`本次：估算花费 ${formatCny(money.this_call.cost_cny)}（省 ${formatCny(money.this_call.saved_cny)}；省 ${fmtInt(t.saved_tokens)}t）`);
    saveLines.push(`今日：${r.today_calls} 次，估算花费 ${formatCny(money.today.cost_cny)}（省 ${formatCny(money.today.saved_cny)}）`);
    saveLines.push(`全部：${r.all_calls} 次，估算花费 ${formatCny(money.all.cost_cny)}（省 ${formatCny(money.all.saved_cny)}）`);
    saveLines.push(`单价：${formatCny(price)}/百万预算单位 t（用户在全局参数页设置，非厂商账单）`);
    saveLines.push('金额口径：本地预算单位 t（estTokens = 字符数 / CHARS_PER_BUDGET_UNIT）× 单价，为估算值，不是网关真实 usage 账单。');
  }
  if (r.today_legacy_calls > 0) {
    saveLines.push(`今日含 ${r.today_legacy_calls} 次旧记录（无省量字段，金额按载荷下限计）`);
  }

  const hitTitle = `🧠 命中记忆 ${result.hits.length} 条（${fmtInt(t.payload_tokens)}t）`;
  return [
    { title: `📎 项目背景 ${bg.items.length} 条（${fmtInt(bg.tokens)}t）`, lines: bgLines },
    {
      // 读法说明只在真有命中词时追加：旧的/无语义的命中（matched_terms 为空）标题逐字不变
      title: hasTerms && hitStyle.readingHint ? `${hitTitle}｜ ${hitStyle.readingHint}` : hitTitle,
      lines: hitLines,
    },
    { title: `⚡ Token 用量（本次注入 ${fmtInt(t.injected_tokens)}t）`, lines: tokenLines },
    { title: `💰 省钱与费用（本次省 ${fmtInt(t.saved_tokens)}t）`, lines: saveLines },
  ];
}

/**
 * 批次 RAG 组装聊天窗口明细：外层短收 summary（html 档）或两行短摘要（纯 Markdown 档）
 * → 统计汇总四行 → `[n]` 编号依据（默认可见）→ 四段明细降级为二级折叠（html 档）/ 加粗小节（纯 Markdown 档）
 * → 告警段仅在真有 warning 时生成。四段数字仍由 buildRecallSections 唯一口径提供，逐字不变。
 */
export function buildRecallMarkdown(
  result: RecallResult,
  hint: RecallHint,
  unitPriceCnyPerMTok: number | null,
  opts: RecallMarkdownOpts = {},
): string {
  const htmlDetails = opts.htmlDetails !== false;
  const clip = htmlDetails ? mdInline : plainClip;
  const markup: HitMarkup = htmlDetails ? 'html' : 'markdown';
  // 批次59：同一份四段口径带上各自的高亮载体——HTML 档用 <mark>，纯 Markdown 档用加粗引号
  const sections = buildRecallSections(result, hint, unitPriceCnyPerMTok, clip, 120, htmlDetails
    ? { markup: 'html', readingHint: '黄色 = 与本次提问重合的片段；🎯 = 命中的词' }
    : { markup: 'markdown', readingHint: '加粗「」= 与本次提问重合的片段；🎯 = 命中的词' });
  const echo = hint.echo ?? buildRecallEchoSummary(result, hint, unitPriceCnyPerMTok);
  const echoBody = buildRecallEchoBody(result, hint, markup, clip);
  const warningBlock = echo.warnings.length > 0
    ? (htmlDetails
        ? `<details><summary>⚠ 状态 ${echo.warnings.length} 项</summary>\n\n`
          + `${echo.warnings.map((w) => `- ${mdInline(w, 200)}`).join('\n')}\n</details>`
        : echo.warnings.map((w) => `**${w}**`).join('\n\n'))
    : '';

  if (!htmlDetails) {
    const inner = sections
      .map((s) => `**${s.title}**\n\n${s.lines.map((l) => `- ${l}`).join('\n')}`)
      .join('\n\n');
    // 2026-11-12（T9 同源缺陷）：markdown-full 档原来用单换行拼三行，同样会被客户端合并成一段。
    // 与 compact 档保持同一口径：**空行分段**，段落数 = 2（摘要）+ warning 数。
    // A6：模式行紧跟汇总（§3.4 透明），会话视图无分流时为 null，不产出空行。
    const summary = [echo.headline, echo.stats, ...(echo.mode_line ? [echo.mode_line] : [])]
      .map((l) => `**${l}**`).join('\n\n');
    return summary
      + (warningBlock ? `\n\n${warningBlock}` : '')
      + `\n\n${echoBody}\n\n${inner}`;
  }

  const inner = sections
    .map((s) => mdSection(mdInline(s.title, 240), s.lines.map((l) => `- ${l}`).join('\n')))
    .join('\n\n');
  return `<details>\n<summary>${mdInline(buildRecallFoldSummary(result), 160)}</summary>\n\n`
    + `${echoBody}`
    + (echo.mode_line ? `\n\n**${mdInline(echo.mode_line, 160)}**` : '')
    + `\n\n${inner}`
    + (warningBlock ? `\n\n${warningBlock}` : '')
    + '\n</details>';
}

/**
 * 批次32-C / 33-C：不支持 HTML 折叠的客户端（DSH 实测只渲染 Markdown，`<details>` 原样露出）只给
 * **两行短摘要 + 一个可点链接**，点开是本机明细页（真 `<details>` 折叠，数字同源）。
 * 批次 RAG：首行改为「命中数 + top3 编号依据词 + 省量比例 + 金额」，第二行改为统计汇总，
 * 告警行只在真有 warning 时追加（异常驱动），链接文案加入「统计汇总 / 命中依据」以与实际内容一致。
 * detailUrl 缺失（TCP 8202 等无端口场景）时退回文字指引：明细用同 query + detail=true 再取。
 * hint.echo 缺省（手写 hint 的老调用方）时退回 shortLine，不抛异常。
 */
export function buildRecallCompactMarkdown(hint: RecallHint, detailUrl?: string): string {
  const echo = hint.echo;
  // 2026-11-12（WorkBuddy 实测回填）：三行之间必须留**空行**。原先用单换行，Markdown 视作软换行，
  // WorkBuddy 会把「🧠 摘要 / 📊 汇总 / ⚠ 告警」合并成一整段（截图实证），读者根本分不出层级。
  // 空行 = 段落分隔，是所有客户端都认的硬分隔；末尾不追加空行，保持 rows 数为 2~3。
  const summary = echo
    ? [echo.headline, echo.stats, ...(echo.mode_line ? [echo.mode_line] : []), ...echo.warnings]
      .map((l) => `**${l}**`).join('\n\n')
    : `**${hint.shortLine}**`;
  if (detailUrl) {
    // 2026-11-12（用户回填）：WorkBuddy 桌面端与手机端点本机链接均无反应 —— 手机是 127.0.0.1 不可达，
    // 桌面端是客户端不跳外链。链接保留（浏览器/别的客户端仍可用），但必须给一条不依赖链接的取明细路径，
    // 否则用户永远看不到「统计汇总 / 命中依据」。这句是给用户看的，Agent 原样输出即可。
    return `${summary}\n\n▶ [展开本次召回明细（统计汇总 / 命中依据 / Token / 费用）](${detailUrl})`
      + '\n\n📌 链接点不开时（手机端 / 部分客户端），直接说「看明细」即可，我用同一个 query 取回明细铺开。';
  }
  return `${summary}\n\n`
    + '📌 明细已收起（统计汇总 / 命中依据 / Token 用量 / 省钱与费用）。需要看时用同一个 query 再调用一次 recall_memory 并置 detail=true，'
    + '然后把返回的 display.markdown 原样输出；不需要就保持本行，不要自行编造明细。';
}

/* ---------- 本机召回明细页（批次33-C）：聊天里点链接展开，页面自己支持真折叠 ---------- */

export interface RecallDetailPageMeta {
  project_id: string;
  query: string;
  /** 调用方标识（批次15），页面标注「本次由 X 触发」 */
  client?: string;
  issuedAt: number;
  /** 票据过期时刻（由 RecallDetailTickets 决定，页面文案与真实过期一致） */
  expiresAt: number;
  /** 明细正文截断字数（页面明示，不假装全文） */
  clipChars?: number;
}

/** 记忆内容进 HTML 前必须转义：正文里的尖括号不得破坏折叠结构 */
export function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function localTimeLabel(ms: number): string {
  return `${new Date(ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（UTC+08:00）`;
}

/**
 * 批次 RAG（T4）· 明细页单条命中卡：编号即正文引用 `[n]`，`id="hit-n"` 供 `/recall/<id>#hit-n` 直达。
 * 相关度用字符条（零依赖）而非色块；「复制引用」「有用/没用」都是**本地交互**——
 * 页面不含 MCP 令牌，反馈只生成可粘贴的 `feedback(...)` 指令文本，绝不冒充已生效。
 */
function hitCardHtml(h: Hit, index: number, maxChars: number): string {
  const n = index + 1;
  const body = markHitFragments(htmlEscape(plainClip(h.content, maxChars)), h.matched_terms, 'html');
  const terms = displayTerms(h.matched_terms, h.content, 3);
  const why = terms.length > 0
    ? `<p class="why">🎯 命中${terms.map((x) => `「${htmlEscape(plainClip(x, 20))}」`).join('')}</p>`
    : '<p class="why none">无字面重合，仅按相关度参考</p>';
  // mem_id 只在「纯安全字符」时才写进 onclick，否则隐藏反馈按钮——绝不把未经校验的 id 拼进脚本
  const safeId = /^[A-Za-z0-9_-]{1,64}$/.test(h.mem_id) ? h.mem_id : '';
  const fb = safeId
    ? `<div class="fb"><button type="button" class="mini" onclick="mmFeedback('${safeId}','confirm',this)">这条有用</button>`
      + `<button type="button" class="mini" onclick="mmFeedback('${safeId}','reject',this)">这条没用</button>`
      + '<pre class="fbtxt" hidden></pre></div>'
    : '<p class="why none">该条 id 含非安全字符，已隐藏反馈按钮（不编造 id）。</p>';
  return `<article class="hit" id="hit-${n}">
<p class="hithead"><span class="badge num">[${n}]</span><span class="badge">${htmlEscape(h.layer)}</span><span class="badge">${htmlEscape(h.decay_class)}</span><span class="rel">相关度 ${h.score.toFixed(2)} <span class="bar">${scoreBar(h.score)}</span></span><button type="button" class="mini" onclick="mmCopy('[${n}]', this)">复制引用 [${n}]</button></p>
<p class="hitbody">${body}</p>
${why}
${fb}
</article>`;
}

/**
 * 渲染一次性本机明细页（批次 RAG T4 重构）：
 * 顶部状态条 → 统计汇总卡（四组字段，明细页可用真 `<table>`）→ `[n]` 编号命中卡（`id="hit-n"` 锚点、
 * 相关度条、层/热度徽标、`<mark>` 高亮、🎯 命中词、复制引用、就地反馈）→ 背景/用量/费用三段折叠
 * （折叠状态写 `localStorage`，同源仅本机）→ 页脚口径说明。
 * 纯字符串输出，不依赖模板引擎；所有动态内容走 htmlEscape；不含令牌、外部资源与远端脚本。
 */
export function buildRecallDetailPage(
  result: RecallResult,
  hint: RecallHint,
  unitPriceCnyPerMTok: number | null,
  meta: RecallDetailPageMeta,
): string {
  const clipChars = meta.clipChars ?? 400;
  const sections = buildRecallSections(
    result, hint, unitPriceCnyPerMTok, (s, n) => htmlEscape(plainClip(s, n)), clipChars,
    { markup: 'html', readingHint: '黄色 = 与本次提问重合的片段；🎯 = 命中的词' },
  );
  const hasTerms = result.hits.some((h) => (h.matched_terms?.length ?? 0) > 0);
  const echo = hint.echo ?? buildRecallEchoSummary(result, hint, unitPriceCnyPerMTok);
  const summaryLines = [echo.headline, echo.stats, ...(echo.mode_line ? [echo.mode_line] : [])]
    .map((l) => `<p class="sum">${htmlEscape(l)}</p>`)
    .join('\n');
  const ttlMin = Math.max(1, Math.round((meta.expiresAt - meta.issuedAt) / 60_000));
  // 顶部状态条：命中数 / 省量% / 预算 / 生成时间 / 有效期，一行可扫读（明细页的「我在看什么」）
  const statusBar = `命中 ${result.hits.length} 条 · 省 ${recallSavingRatio(result)}（${fmtInt(result.savings.saved_tokens)}t）`
    + ` · 预算 ${result.budget.status} · 生成 ${localTimeLabel(meta.issuedAt)} · 有效期 ${ttlMin} 分钟`;
  // 统计汇总卡：与聊天侧 buildRecallStatLines 同一口径，按「键：值」拆成两列，不重算任何数字
  const statRows = buildRecallStatLines(result, hint).map((line) => {
    const at = line.indexOf('：');
    return at > 0 ? { k: line.slice(0, at), v: line.slice(at + 1) } : { k: '汇总', v: line };
  });
  const statTable = `<table class="stats"><tbody>${statRows
    .map((r) => `<tr><th scope="row">${htmlEscape(r.k)}</th><td>${htmlEscape(r.v)}</td></tr>`)
    .join('')}</tbody></table>`;
  const warnList = echo.warnings.length > 0
    ? `<ul class="warn">${echo.warnings.map((w) => `<li>${htmlEscape(w)}</li>`).join('')}</ul>`
    : '';
  // 依据段标题沿用 buildRecallSections 的第 2 段（数字与聊天侧同源，含读法说明），正文换成编号卡
  const citesTitle = sections[1]?.title ?? `🧠 命中记忆 ${result.hits.length} 条（${fmtInt(result.savings.payload_tokens)}t）`;
  const citeCards = result.hits.length > 0
    ? result.hits.map((h, i) => hitCardHtml(h, i, clipChars)).join('\n')
    : `<p class="muted">未命中（扫描 ${fmtInt(result.scanned_memories)} 条）：本页不编造条目，也不出现任何 [n] 编号。</p>`;
  const FOLD_KEYS = ['bg', 'token', 'money'];
  const otherFolds = [sections[0], sections[2], sections[3]]
    .filter((s): s is RecallSection => Boolean(s))
    .map((s, i) => `<details data-fold="${FOLD_KEYS[i] ?? 'seg'}">\n<summary>${htmlEscape(s.title)}</summary>\n`
      + `<ul>${s.lines.map((l) => `<li>${l}</li>`).join('')}</ul>\n</details>`)
    .join('\n');
  // 批次59：把「黄色是什么意思」「没标黄是什么意思」一次说清——不解释等于让用户猜
  const legend = hasTerms
    ? `<p class="legend">🟨 黄色片段 = 与本次提问「${htmlEscape(plainClip(meta.query, 60))}」重合的部分（🎯 后是命中的词）。
没标黄的条目 = 与本次提问没有字面重合，只能按相关度参考，不代表「没用上」。</p>\n`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>召回明细 ｜ MultiAgent Memory</title>
<style>
:root { color-scheme: light dark; --fg: #1f2328; --muted: #6a737d; --border: #e3e6ea; --bg: #fff; --card: #f7f8fa; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6e8eb; --muted: #9aa4ae; --border: #333a41; --bg: #16181c; --card: #1d2025; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 40px; background: var(--bg); color: var(--fg);
  font: 14px/1.65 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
main { max-width: 880px; margin: 0 auto; }
h1 { font-size: 17px; margin: 0 0 10px; }
h2 { font-size: 14px; margin: 16px 0 8px; }
.sum { margin: 2px 0; font-weight: 600; }
.meta { color: var(--muted); font-size: 12px; margin: 8px 0 18px; }
.ops { display: flex; gap: 8px; margin-bottom: 12px; }
.ops button { font: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--card); color: var(--fg); cursor: pointer; }
details { border: 1px solid var(--border); border-radius: 8px; background: var(--card); margin: 0 0 10px; padding: 0 12px; }
summary { cursor: pointer; font-weight: 600; padding: 10px 0; list-style: disclosure-closed; }
details[open] summary { list-style: disclosure-open; border-bottom: 1px solid var(--border); }
ul { margin: 8px 0 12px; padding-left: 20px; }
li { margin: 3px 0; word-break: break-word; }
.statusbar { margin: 0 0 10px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--card); font-size: 12px; color: var(--muted); }
table.stats { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 12.5px; }
table.stats th, table.stats td { border-bottom: 1px solid var(--border); padding: 6px 8px; text-align: left; vertical-align: top; }
table.stats th { width: 56px; color: var(--muted); font-weight: 600; white-space: nowrap; }
.hit { border: 1px solid var(--border); border-radius: 8px; background: var(--card); padding: 10px 12px; margin: 0 0 10px; }
.hithead { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 12px; }
.badge { border: 1px solid var(--border); border-radius: 999px; padding: 0 7px; color: var(--muted); font-size: 11.5px; }
.badge.num { color: var(--fg); font-weight: 700; border-color: var(--fg); }
.rel { color: var(--muted); }
.bar { letter-spacing: 1px; color: var(--fg); }
.hitbody { margin: 0; word-break: break-word; }
.why { margin: 6px 0 0; font-size: 12px; }
.why.none, .muted { color: var(--muted); }
.fb { display: flex; gap: 6px; margin: 8px 0 0; }
button.mini { font: inherit; font-size: 11.5px; padding: 2px 8px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--bg); color: var(--fg); cursor: pointer; }
.fbtxt { margin: 6px 0 0; padding: 8px; background: var(--bg); border: 1px dashed var(--border);
  border-radius: 6px; font-size: 11.5px; white-space: pre-wrap; word-break: break-all; }
.warn { margin: 0 0 12px; padding-left: 20px; font-size: 12px; color: #8a6d00; }
footer { color: var(--muted); font-size: 12px; margin-top: 18px; border-top: 1px solid var(--border); padding-top: 12px; }
code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
mark { background: #ffe58f; color: #1f2328; padding: 0 1px; border-radius: 3px; }
.legend { margin: 0 0 14px; padding: 8px 10px; border: 1px solid #f0e0a8; border-radius: 6px;
  background: #fffbe6; color: #6b5b00; font-size: 12px; line-height: 1.6; }
@media (prefers-color-scheme: dark) {
  mark { background: #7a6320; color: #fff8d6; }
  .legend { background: #2b2716; border-color: #4a431f; color: #e8d98a; }
}
</style>
</head>
<body>
<main>
<h1>🧠 本次召回明细</h1>
<p class="statusbar">${htmlEscape(statusBar)}</p>
${summaryLines}
<p class="meta">项目 <code>${htmlEscape(meta.project_id)}</code> ｜ 查询「${htmlEscape(plainClip(meta.query, 80))}」${meta.client ? ` ｜ 调用方 <code>${htmlEscape(meta.client)}</code>` : ''}
<br>本链接 ${ttlMin} 分钟内有效（过期后请在聊天里让助手用 detail=true 再取一次）</p>
<h2>📊 本次召回统计汇总</h2>
${statTable}
${warnList}${legend}<div class="ops">
<button type="button" onclick="mmAll(true)">全部展开</button>
<button type="button" onclick="mmAll(false)">全部收起</button>
</div>
<details data-fold="cites" open>
<summary>${htmlEscape(citesTitle)}</summary>
${citeCards}
</details>
${otherFolds}
<footer>
本页与聊天里的摘要<b>数字同源</b>（同一次 recall 的真实账本计算，未重算、未估算）。
命中与背景正文按 ${clipChars} 字截断，超出部分以「…」标示；金额按全局参数页单价换算，非厂商账单。
编号 <code>[n]</code> 与聊天正文里的引用脚标一一对应，也可用 <code>/recall/&lt;id&gt;#hit-n</code> 直达单条依据。
「这条有用 / 没用」只生成本机可粘贴的 <code>feedback</code> 指令文本，本页不含令牌，<b>不会自动生效</b>。
折叠状态只写本机 <code>localStorage</code>，不上传、不落账本。
链接由一次性随机 id 保护（30 分钟过期、不落盘），MCP 令牌不出现在 URL 与本页任何位置；服务只监听 127.0.0.1。
</footer>
</main>
<script>
(function () {
  var KEY = 'mm.recall.detail.folds.v1';
  var st = {};
  try { st = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { st = {}; }
  var boxes = [].slice.call(document.querySelectorAll('details[data-fold]'));
  boxes.forEach(function (d) {
    var k = d.getAttribute('data-fold');
    if (Object.prototype.hasOwnProperty.call(st, k)) d.open = !!st[k];
    d.addEventListener('toggle', function () {
      st[k] = d.open;
      try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
    });
  });
  window.mmAll = function (v) { boxes.forEach(function (d) { d.open = v; }); };
  window.mmCopy = function (text, btn) {
    var done = function (ok) {
      if (!btn) return;
      var old = btn.getAttribute('data-label') || btn.textContent;
      btn.setAttribute('data-label', old);
      btn.textContent = ok ? '已复制' : '复制失败，请手选';
      setTimeout(function () { btn.textContent = old; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else { done(false); }
  };
  window.mmFeedback = function (id, verdict, btn) {
    var box = btn.parentNode.querySelector('.fbtxt');
    if (!box) return;
    var cmd = '请调用 MCP 工具 feedback：feedback(verdict="' + verdict + '", mem_id="' + id + '")';
    box.hidden = false;
    box.textContent = cmd + '（本页不含 MCP 令牌，不会自动生效；把这一行粘到聊天里让助手执行）';
    window.mmCopy(cmd, btn);
  };
})();
</script>
</body>
</html>
`;
}

/** 明细页失效（未知 id / 已过期 / id 格式非法）的诚实回执：不猜数据，给两条可执行的退路 */
export function buildRecallDetailExpiredPage(): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>明细链接已失效</title>
<style>body{font:15px/1.7 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;margin:0;padding:40px 20px;color:#1f2328;background:#fff}
main{max-width:720px;margin:0 auto}h1{font-size:18px}code{font-family:ui-monospace,Consolas,monospace;background:#f2f3f5;padding:1px 4px;border-radius:4px}
</style></head><body><main>
<h1>🧠 本次召回明细链接已失效</h1>
<p>这个链接是一次性的，只在签发后 30 分钟内有效，且不落盘。有效期内没打开、或超过时间，明细就取不回来了。</p>
<p>要看明细，任选一种：</p>
<ul>
<li>回到聊天窗口，让助手「用同一个问题再检索一次并展开明细」（即 <code>recall_memory</code> 置 <code>detail=true</code>），会重新得到一份纯 Markdown 四段明细；</li>
<li>或在客户端里重新提问一次，摘要行里会带一条新的「▶ 展开本次召回明细」链接。</li>
</ul>
<p>本页面不含令牌，也不显示任何其它项目的记忆；链接本身由随机 id 把守。</p>
</main></body></html>
`;
}
