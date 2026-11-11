// 批次59：召回回显的「命中片段」计算（方案 C —— 后端定相关性、渲染层定偏移）。
//
// 为什么复用 vector.ts 的 tokenize：召回打分本身就是 hash bag-of-words（中文 2-gram / 英文按词），
// 这里用**同一套分词**求 query∩content，标出来的词就是打分真正用到的词，不是事后另编一套「看起来相关」。
//
// 诚实约束（与 recallInsight 同口径）：
// - 没有共有 token → 返回空数组，渲染层**不高亮**（绝不拿最长句/第一句冒充）；
// - 命中词在截断后的正文里找不到 → 该片不标（截断切掉了就如实不标）；
// - 不做同义/近义扩展（那需要检索侧语义，前端猜不准，会把「疑似」标成「确证」）。

import { tokenize } from './vector.ts';

/** 正文里一段命中区间（半开区间，offset 指向当次渲染用的那段文本） */
export interface HitSpan {
  start: number;
  end: number;
}

/** 两片命中之间出现这些字符就不再合并，避免把两句话标成一整片 */
const BREAK_CHARS = /[。；！？;!?\n\r]/;

/**
 * 高频虚词：单字或短英文词命中几乎不携带信息，命中数看着多但用户看不出「为什么是它」，反而噪声。
 * 中文这里只挡极少数字，主要靠「长度 < 2 丢弃」——2-gram 已经把单字挡在外面了。
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those',
  'how', 'what', 'why', 'when', 'which', 'who', 'do', 'does', 'did', 'can', 'could',
  'should', 'would', 'will', 'not', 'no', 'yes', 'if', 'then', 'than', 'so', 'but',
  'we', 'you', 'they', 'i', 'my', 'our', 'your', 'me', 'us', 'them',
  '的', '了', '是', '在', '和', '与', '及', '或', '就', '也', '都', '还', '把', '被',
  '对', '为', '以', '之', '其', '这', '那', '有', '我', '你', '他', '它', '们',
]);

/** token 是否值得作为「命中依据」展示：至少含一个字母/数字，且不是虚词 */
function usableToken(tok: string): boolean {
  if (!tok) return false;
  // 2-gram 会切出「，。」这类纯标点片段，直接丢
  if (!/[\p{L}\p{N}]/u.test(tok)) return false;
  if (tok.length < 2) return false;
  if (STOPWORDS.has(tok)) return false;
  return true;
}

/**
 * query 与正文的共有 token（命中依据）。
 * 排序：长的在前——同样命中，`timeout` 比 `ti` 有说服力，`接口超时` 的 2-gram 长片段优先展示。
 * limit 默认 12：命中行里列太多反而看不出重点，展示层还会再筛。
 */
export function matchedTerms(query: string, text: string, limit = 12): string[] {
  if (!query || !text) return [];
  const inQuery = new Set(tokenize(query).filter(usableToken));
  if (inQuery.size === 0) return [];
  const inText = new Set(tokenize(text).filter(usableToken));
  const shared: string[] = [];
  for (const tok of inQuery) if (inText.has(tok)) shared.push(tok);
  shared.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return shared.slice(0, Math.max(1, limit));
}

/** 把命中词在正文里定位成区间：逐个 needle 全量扫描 → 排序 → 合并重叠/相邻 → 取最长的 N 片 */
export function pickHitSpans(
  terms: string[],
  text: string,
  opts: { minLen?: number; maxSpans?: number } = {},
): HitSpan[] {
  const minLen = opts.minLen ?? 2;
  const maxSpans = opts.maxSpans ?? 3;
  if (!terms.length || !text) return [];

  // 大小写不敏感定位：toLowerCase 对 ASCII/中文不改变长度，offset 可直接用于原文切片。
  // （若未来接入会变长的 Unicode 折叠，需改成逐段映射，届时此注释即失效提醒。）
  const haystack = text.toLowerCase();
  const raw: HitSpan[] = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    let at = haystack.indexOf(needle);
    while (at >= 0) {
      raw.push({ start: at, end: at + needle.length });
      // 防御：正文里同一个词出现极多次时不无限扫描（回显只标前几片）
      if (raw.length >= 256) break;
      at = haystack.indexOf(needle, at + 1);
    }
    if (raw.length >= 256) break;
  }
  if (!raw.length) return [];

  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: HitSpan[] = [];
  for (const sp of raw) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...sp });
      continue;
    }
    const overlaps = sp.start <= last.end;
    const adjacent = sp.start <= last.end + 1 && !BREAK_CHARS.test(text.slice(last.end, sp.start));
    if (overlaps || adjacent) last.end = Math.max(last.end, sp.end);
    else merged.push({ ...sp });
  }

  return merged
    .filter((sp) => sp.end - sp.start >= minLen)
    // 先按「片长」取最长的几片（信息量最大），再按出现顺序返回，渲染出来是自然阅读顺序
    .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)
    .slice(0, Math.max(1, maxSpans))
    .sort((a, b) => a.start - b.start);
}

/** 命中词给用户看的展示顺序：先出现，去重，最多 n 个 */
export function displayTerms(terms: string[] | undefined, text: string, n = 3): string[] {
  if (!terms || terms.length === 0) return [];
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  const picked: { term: string; at: number }[] = [];
  for (const t of terms) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ term: t, at: lower.indexOf(key) });
  }
  picked.sort((a, b) => (a.at < 0 ? Number.MAX_SAFE_INTEGER : a.at) - (b.at < 0 ? Number.MAX_SAFE_INTEGER : b.at));
  return picked.slice(0, Math.max(1, n)).map((p) => p.term);
}
