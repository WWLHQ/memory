// 召回洞察（批次11/13）：项目背景筛选 / 省量核算 / 聊天窗口提示行与累计金额的唯一纯函数真源。
// 批次13：追加折叠明细（<details> 四段），提示行仍是唯一摘要行；数字全部同源。
// 约束：数字全部来自真实账本（记忆内容 + recall 审计），未配置单价时金额一律 null，绝不编造。
import type {
  AuditRecord, Category, Hit, Memory, RecallBackground, RecallBackgroundItem, RecallResult, RecallSavings,
} from './types.ts';

/** 粗略 token 估算（契约级演示：≈ chars/2，与召回预算同一口径） */
export const estTokens = (s: string) => Math.ceil(s.length / 2);

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

export interface RecallMoney {
  unit_price_cny_per_mtok: number;
  this_call: { injected_tokens: number; cost_cny: number; saved_cny: number };
  today: RecallMoneyBlock;
  all: RecallMoneyBlock;
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

  const warnings: string[] = [];
  if (result.evidence_thin) warnings.push('⚠ 证据不足：未命中权威来源，建议事实优先重试');
  if (result.budget.status === 'fused') warnings.push(`⚠ 预算熔断：已裁剪 ${fmtInt(result.savings.budget_trimmed_tokens)}t`);

  const price = normalizeUnitPrice(unitPriceCnyPerMTok);
  let money: RecallMoney | null = null;
  let moneyPart: string;
  /** 批次33-C 折叠档第二行：本次花费/省额 + 今日/全部次数（今日/全部的金额明细挪到本机明细页，仍同源） */
  let moneyShort: string;
  if (price === null) {
    moneyPart = '💰 金额未开：未设置单价（全局参数页可设 ¥/百万 token）';
    moneyShort = `💰 金额未开（参数页可设 ¥/百万 token） ｜ 今日 ${rollup.today_calls} 次 ｜ 全部 ${rollup.all_calls} 次`;
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
    moneyPart = `💰 本次 ${formatCny(money.this_call.cost_cny)}（省 ${formatCny(money.this_call.saved_cny)}）`
      + ` ｜ 今日 ${rollup.today_calls} 次 ${formatCny(money.today.cost_cny)}（省 ${formatCny(money.today.saved_cny)}）`
      + ` ｜ 全部 ${rollup.all_calls} 次 ${formatCny(money.all.cost_cny)}（省 ${formatCny(money.all.saved_cny)}）`;
    moneyShort = `💰 本次 ${formatCny(money.this_call.cost_cny)}（省 ${formatCny(money.this_call.saved_cny)}）`
      + ` ｜ 今日 ${rollup.today_calls} 次 ｜ 全部 ${rollup.all_calls} 次`;
    if (rollup.today_legacy_calls > 0) {
      warnings.push(`⚠ 今日含 ${rollup.today_legacy_calls} 次旧记录（无省量字段，金额按载荷下限计）`);
    }
  }

  const line = [`🧠 Memory ｜ ${hitPart} ｜ ${bgPart} ｜ ${savePart} ｜ ${moneyPart}`, ...warnings].join(' ｜ ');
  const shortLine = [
    `🧠 Memory ｜ ${hitPart} ｜ ${bgPart} ｜ ${savePart}`,
    moneyShort,
    ...warnings,
  ].join('\n');
  return { line, shortLine, money, rollup };
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
): RecallSection[] {
  const t = result.savings;
  const bg = result.background;
  const r = hint.rollup;
  const money = hint.money;
  const price = normalizeUnitPrice(unitPriceCnyPerMTok);

  const bgLines = bg.items.length > 0
    ? bg.items.map((it) => `[${it.category}] ${clip(it.content, maxChars)}`)
    : ['无（minimal 模式或账本暂无可用背景）'];

  const hitLines = result.hits.length > 0
    ? result.hits.map((h) => `[${h.layer}/${h.decay_class}] ${clip(h.content, maxChars)}（相关度 ${h.score.toFixed(2)}）`)
    : [`未命中（扫描 ${fmtInt(result.scanned_memories)} 条，未注入命中内容）`];

  const tokenLines = [
    `本次注入：${fmtInt(t.injected_tokens)}t（命中 ${fmtInt(t.payload_tokens)}t + 背景 ${fmtInt(t.background_tokens)}t）`,
    `全量基线：${fmtInt(t.corpus_tokens)}t（项目全部可读记忆）`,
    `预算裁剪：${fmtInt(t.budget_trimmed_tokens)}t（${result.budget.status}；软 ${fmtInt(result.budget.soft)}t / 告警 ${fmtInt(result.budget.warn)}t / 硬 ${fmtInt(result.budget.hard)}t）`,
    `扫描记忆：${fmtInt(result.scanned_memories)} 条`,
  ];

  const saveLines: string[] = [];
  if (price === null || money === null) {
    saveLines.push(`本次省：${fmtInt(t.saved_tokens)}t（金额未开：未设置单价，全局参数页可设 ¥/百万 token）`);
    saveLines.push(`今日：${r.today_calls} 次，省 ${fmtInt(r.today_saved_tokens)}t`);
    saveLines.push(`全部：${r.all_calls} 次，省 ${fmtInt(r.all_saved_tokens)}t`);
  } else {
    saveLines.push(`本次：花费 ${formatCny(money.this_call.cost_cny)}（省 ${formatCny(money.this_call.saved_cny)}；省 ${fmtInt(t.saved_tokens)}t）`);
    saveLines.push(`今日：${r.today_calls} 次，花费 ${formatCny(money.today.cost_cny)}（省 ${formatCny(money.today.saved_cny)}）`);
    saveLines.push(`全部：${r.all_calls} 次，花费 ${formatCny(money.all.cost_cny)}（省 ${formatCny(money.all.saved_cny)}）`);
    saveLines.push(`单价：${formatCny(price)}/百万 token（用户在全局参数页设置，非厂商账单）`);
  }
  if (r.today_legacy_calls > 0) {
    saveLines.push(`今日含 ${r.today_legacy_calls} 次旧记录（无省量字段，金额按载荷下限计）`);
  }

  return [
    { title: `📎 项目背景 ${bg.items.length} 条（${fmtInt(bg.tokens)}t）`, lines: bgLines },
    { title: `🧠 命中记忆 ${result.hits.length} 条（${fmtInt(t.payload_tokens)}t）`, lines: hitLines },
    { title: `⚡ Token 用量（本次注入 ${fmtInt(t.injected_tokens)}t）`, lines: tokenLines },
    { title: `💰 省钱与费用（本次省 ${fmtInt(t.saved_tokens)}t）`, lines: saveLines },
  ];
}

/**
 * 组装聊天窗口明细：外层 = 提示行，内层四段（项目背景 / 命中记忆 / Token / 省钱与费用）。
 * htmlDetails=false 时同结构输出纯 Markdown（**加粗小节标题** + 列表，零 HTML 标签）。数字全部同源。
 */
export function buildRecallMarkdown(
  result: RecallResult,
  hint: RecallHint,
  unitPriceCnyPerMTok: number | null,
  opts: RecallMarkdownOpts = {},
): string {
  const htmlDetails = opts.htmlDetails !== false;
  const clip = htmlDetails ? mdInline : plainClip;
  const sections = buildRecallSections(result, hint, unitPriceCnyPerMTok, clip);
  const inner = sections
    .map((s) => {
      const body = s.lines.map((l) => `- ${l}`).join('\n');
      return htmlDetails ? mdSection(s.title, body) : `**${s.title}**\n\n${body}`;
    })
    .join('\n\n');

  if (!htmlDetails) return `**${hint.line}**\n\n${inner}`;
  return `<details>\n<summary>${mdInline(hint.line, 500)}</summary>\n\n${inner}\n</details>`;
}

/**
 * 批次32-C / 33-C：不支持 HTML 折叠的客户端（DSH 实测只渲染 Markdown，`<details>` 原样露出）默认只给
 * **两行短摘要 + 一个可点链接**，点开是本机明细页（真 `<details>` 折叠，数字同源）。
 * 为什么不再直接铺四小节：DSH 聊天窗口没有可点击的折叠控件，四段全文每次铺满页面（用户明确要求收起）。
 * detailUrl 缺失（TCP 8202 等无端口场景）时退回文字指引：明细用同 query + detail=true 再取。
 */
export function buildRecallCompactMarkdown(hint: RecallHint, detailUrl?: string): string {
  const summary = `**${hint.shortLine}**`;
  if (detailUrl) {
    return `${summary}\n\n▶ [展开本次召回明细（项目背景 / 命中记忆 / Token / 费用）](${detailUrl})`;
  }
  return `${summary}\n\n`
    + '📌 明细已收起（项目背景 / 命中记忆 / Token 用量 / 省钱与费用）。需要看时用同一个 query 再调用一次 recall_memory 并置 detail=true，'
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
 * 渲染一次性本机明细页：摘要两行 + 四段 `<details>`（默认收起，点标题展开）+「全部展开/收起」。
 * 纯字符串输出，不依赖模板引擎；所有动态内容走 htmlEscape；不含令牌、外部资源与远端脚本。
 */
export function buildRecallDetailPage(
  result: RecallResult,
  hint: RecallHint,
  unitPriceCnyPerMTok: number | null,
  meta: RecallDetailPageMeta,
): string {
  const clipChars = meta.clipChars ?? 400;
  const sections = buildRecallSections(result, hint, unitPriceCnyPerMTok, (s, n) => htmlEscape(plainClip(s, n)), clipChars);
  const detailBlocks = sections
    .map((s) => `<details>\n<summary>${htmlEscape(s.title)}</summary>\n<ul>${s.lines.map((l) => `<li>${l}</li>`).join('')}</ul>\n</details>`)
    .join('\n');
  const summaryLines = hint.shortLine
    .split('\n')
    .map((l) => `<p class="sum">${htmlEscape(l)}</p>`)
    .join('\n');
  const ttlMin = Math.max(1, Math.round((meta.expiresAt - meta.issuedAt) / 60_000));
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
footer { color: var(--muted); font-size: 12px; margin-top: 18px; border-top: 1px solid var(--border); padding-top: 12px; }
code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
</style>
</head>
<body>
<main>
<h1>🧠 本次召回明细</h1>
${summaryLines}
<p class="meta">项目 <code>${htmlEscape(meta.project_id)}</code> ｜ 查询「${htmlEscape(plainClip(meta.query, 80))}」${meta.client ? ` ｜ 调用方 <code>${htmlEscape(meta.client)}</code>` : ''}
<br>生成 ${localTimeLabel(meta.issuedAt)} ｜ 本链接 ${ttlMin} 分钟内有效（过期后请在聊天里让助手用 detail=true 再取一次）</p>
<div class="ops">
<button type="button" onclick="document.querySelectorAll('details').forEach(function(d){d.open=true})">全部展开</button>
<button type="button" onclick="document.querySelectorAll('details').forEach(function(d){d.open=false})">全部收起</button>
</div>
${detailBlocks}
<footer>
本页与聊天里的摘要<b>数字同源</b>（同一次 recall 的真实账本计算，未重算、未估算）。
命中与背景正文按 ${clipChars} 字截断，超出部分以「…」标示；金额按全局参数页单价换算，非厂商账单。
链接由一次性随机 id 保护（30 分钟过期、不落盘），MCP 令牌不出现在 URL 与本页任何位置；服务只监听 127.0.0.1。
</footer>
</main>
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
