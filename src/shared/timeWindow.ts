// REQ-013 / C1：本地时区相对时间解析与「时间窗命中」判定（纯函数，零依赖）。
//
// 借鉴 dsh-hindsight-local 的 timeparse.js：自己解析相对时间表达式、用「本地时区戳」、
// 时间窗前后各放宽一天，修 Hindsight 按 UTC 天界解析导致「早上 7 点落到前一天」的偏差。
//
// 设计边界（见 specs/tasks/RECALL-SHAPING.md T1）：
//  - 本模块只做「解析」与「判定」，不含任何召回/打分逻辑；打分接入在 agent.ts（T2）。
//  - 不引入第 6 个召回模式，不动 recallModes.ts 单一真源。
//  - 所有时间戳均为「本地时区」毫秒数（用 new Date(y, m, d, h) 构造，非 UTC）。

export type TimeIntent =
  | { kind: 'none' }
  | { kind: 'absolute'; ts: number; hasTimeOfDay: boolean };

export const DAY_MS = 86_400_000;

/** REQ-013 / C1：时间窗加成的「前后放宽」毫秒（与 hitTimeWindow 默认一致）。 */
export const TIME_WINDOW_MARGIN_MS = DAY_MS;
/** REQ-013 / C1：时间窗命中时的温和乘性加成系数（只作打分修正项，不破坏排序单调性）。 */
export const TIME_WINDOW_BONUS = 1.3;

/** 时段词 → 默认本地小时（无显式数字时套用） */
const PERIOD_HOURS: Readonly<Record<string, number>> = {
  凌晨: 3,
  早上: 7,
  上午: 10,
  中午: 12,
  下午: 15,
  傍晚: 18,
  晚上: 20,
};

/** 绝对日期词 → 相对今天的偏移天数 */
const DAY_WORD_OFFSET: Readonly<Record<string, number>> = {
  今天: 0,
  今日: 0,
  昨天: -1,
  昨日: -1,
  前天: -2,
  大前天: -3,
  明天: 1,
  明日: 1,
  后天: 2,
  大后天: 3,
};

/** 用本地时区构造时间戳（绝不走 UTC） */
function atLocal(y: number, mo: number, d: number, h = 0, min = 0, s = 0): Date {
  return new Date(y, mo, d, h, min, s, 0);
}

/**
 * 在 base 当天套用「时段词 / 显式小时」。
 * 优先级：显式小时（含 am/pm、中文上午/下午前缀）> 时段词 > 无时间（00:00）。
 */
function matchPeriod(e: string, base: Date): { ts: number; hasTimeOfDay: boolean; matched: boolean } {
  // 显式小时：早上7点 / 7am / 下午3点 / 15点 / 7:30
  const hourMatch = e.match(/(?:早上|上午|中午|下午|晚上|凌晨|傍晚)?\s*(\d{1,2})\s*(点|时|:\d{2}|am|pm)/i);
  if (hourMatch) {
    let h = parseInt(hourMatch[1], 10);
    const raw = hourMatch[0].toLowerCase();
    if (/pm/.test(raw) && h < 12) h += 12;
    if (/am/.test(raw) && h === 12) h = 0;
    // 中文下午/晚上/傍晚/深夜 + 12 小时制 → 转 24 小时制
    if (/(下午|晚上|傍晚|深夜)/.test(e) && h < 12) h += 12;
    const ts = atLocal(base.getFullYear(), base.getMonth(), base.getDate(), h, 0, 0);
    return { ts: ts.getTime(), hasTimeOfDay: true, matched: true };
  }
  // 时段词（无显式数字）
  for (const [word, hour] of Object.entries(PERIOD_HOURS)) {
    if (e.includes(word)) {
      const ts = atLocal(base.getFullYear(), base.getMonth(), base.getDate(), hour, 0, 0);
      return { ts: ts.getTime(), hasTimeOfDay: true, matched: true };
    }
  }
  return { ts: base.getTime(), hasTimeOfDay: false, matched: false };
}

/**
 * 把相对时间表达式解析为本地时区时间戳。
 * 支持：今天/昨天/前天/大前天/明天/后天/大后天、N(个)天/周/月/年前(后)、
 *       时段词（凌晨/早上/上午/中午/下午/傍晚/晚上）、显式小时（早上7点/7am/下午3点/15点）。
 * 无法解析返回 { kind: 'none' }。
 */
export function parseRelativeTime(expr: string, ref: Date = new Date()): TimeIntent {
  const e = expr.trim();
  if (!e) return { kind: 'none' };

  const y = ref.getFullYear();
  const mo = ref.getMonth();
  const d = ref.getDate();

  // 1. 绝对日期词（优先）
  // 注：子串命中即视为时间意图（如「今天天气」也命中「今天」）。是否对天气/新闻类非召回查询
  // 排除时间窗，属于调用方（T2/agent）的产品级判断，本纯函数不做 NLP 消歧。
  for (const [word, off] of Object.entries(DAY_WORD_OFFSET)) {
    if (e.includes(word)) {
      const base = atLocal(y, mo, d + off);
      const p = matchPeriod(e, base);
      return { kind: 'absolute', ts: p.ts, hasTimeOfDay: p.hasTimeOfDay };
    }
  }

  // 2. N(个)天/周/月/年前(后)
  const amount = e.match(/(\d+)\s*个?\s*(天|日|周|星期|月|年)(前|后)/);
  if (amount) {
    const n = parseInt(amount[1], 10);
    const unit = amount[2];
    const dir = amount[3] === '前' ? -1 : 1;
    let base: Date;
    if (unit === '天' || unit === '日') base = atLocal(y, mo, d + dir * n);
    else if (unit === '周' || unit === '星期') base = atLocal(y, mo, d + dir * n * 7);
    else if (unit.includes('月')) base = atLocal(y, mo + dir * n, d);
    else base = atLocal(y + dir * n, mo, d);
    const p = matchPeriod(e, base);
    return { kind: 'absolute', ts: p.ts, hasTimeOfDay: p.hasTimeOfDay };
  }

  // 3. 纯时段词（无日期词，默认 ref 当天）
  const p = matchPeriod(e, atLocal(y, mo, d));
  if (p.matched) return { kind: 'absolute', ts: p.ts, hasTimeOfDay: p.hasTimeOfDay };

  return { kind: 'none' };
}

/**
 * 从整句 query 提取 query_timestamp：命中时间意图用解析值，否则用 ref（本地「现在」）。
 * —— 对应 Hindsight 的 query_timestamp，保证「零命中仍注入本地时间」。
 */
export function extractQueryTimestamp(query: string, ref: Date = new Date()): { ts: number; detected: boolean } {
  const intent = parseRelativeTime(query, ref);
  if (intent.kind === 'absolute') return { ts: intent.ts, detected: true };
  return { ts: ref.getTime(), detected: false };
}

/**
 * 时间窗命中判定：|queryTs - memoryTs| <= marginMs（默认前后各放宽 1 天）。
 * marginMs 默认 1 天，修 Hindsight 按 UTC 天界解析导致的 ±1 天偏差。
 */
export function hitTimeWindow(queryTs: number, memoryTs: number, marginMs: number = DAY_MS): boolean {
  return Math.abs(queryTs - memoryTs) <= marginMs;
}
