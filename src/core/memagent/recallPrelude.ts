// 硬前置召回的「拼装规则」单一真源（A 宿主钩子 / B LLM Gateway / C 内核门禁 共用）。
// 纯函数、零 IO、零 Node 依赖：vitest 直接测，Node 22 原生 TS 剥离可直接 import，
// 避免钩子（additionalContext）与网关（system 最前面）各写一份拼接规则而漂移。
// 边界：只注入 hits[].content 正文，**绝不注入 display.markdown / 回显话术 / 令牌**。

export const RECALL_PRELUDE_MARKER = '【自建记忆库 · 本轮强制召回】';
export const RECALL_PRELUDE_OPEN = '[RECALL_PRELUDE_V1]';
export const RECALL_PRELUDE_CLOSE = '[/RECALL_PRELUDE_V1]';
/** REQ-013 / C4：注入块携带的可识别标记行——若未来开启「自动把记忆注入 agent 会话」(plugin 回灌)，
 *  被注入内容会进入 agent 会话日志被本采集器重新采集 → 回灌循环。该标记供采集侧剥离识别。
 *  当前未开启自动回灌，属买保险；落点在 system prelude，绝不进 display.markdown（守回显铁律）。 */
export const PLUGIN_INJECTION_MARKER = 'source.kind=plugin:memagent';

/** 单条命中正文上限（防一条超长记忆吃光上下文）与本轮注入总上限 */
export const MAX_HIT_CHARS = 1200;
export const MAX_PRELUDE_CHARS = 6000;
/**
 * REQ-014 / T3（C6-B）：随命中附带的原文摘录上限（与写入侧 `SOURCE_EXCERPT_MAX_CHARS` 同口径）。
 * 摘录进 prelude 是为了「摘要 + 原文片段」双保真，因此**只读命中字段、绝不自行截取 L0 密文**
 * ——L0 密文不在 hits 里，也不可能在这里被拼进来。
 */
export const MAX_EXCERPT_CHARS = 200;
/** 召回 query 取用户最后一条消息，超长截断 */
export const MAX_QUERY_CHARS = 600;

export interface RecallHit {
  content?: unknown;
  mem_id?: unknown;
  layer?: unknown;
  score?: unknown;
  [key: string]: unknown;
}

export interface ChatMessage {
  role?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null;
}

/** MCP streamable-http 可能回纯 JSON，也可能回 SSE（data: ...）；两种都吃到同一个对象。 */
export function parseMcpRpcBody(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  if (text.startsWith('data:') || text.startsWith('event:') || text.startsWith('id:')) {
    const lines = text.split(/\r?\n/);
    const data = lines.find((l) => l.startsWith('data:'));
    if (!data) return null;
    text = data.slice(5).trim();
  }
  if (!text || text === '[DONE]') return null;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 只认 structuredContent.hits，取不到就诚实返回空数组（不猜、不拿 content 文本块兜底）。 */
export function extractRecallHits(rpc: unknown): RecallHit[] {
  const root = asRecord(rpc);
  const result = asRecord(root?.result) ?? root;
  const sc = asRecord(result?.structuredContent);
  const hits = sc?.hits;
  if (!Array.isArray(hits)) return [];
  return hits.map((h) => asRecord(h) as RecallHit | null).filter((h): h is RecallHit => h !== null);
}

/**
 * 零命中时下发的「强制重试指令」块（第 2 层防复发，2026-11-17 用户明确）。
 *
 * 血泪教训：原来零命中返回 null —— 钩子明明每轮都调过 /recall，但模型上下文里
 * **一个字都没注入**，于是「查过了但没命中」与「压根没查」在模型侧完全无法区分，
 * 用户只能靠反复质问才发现。这就是「不查记忆库」反复复发的机制根源。
 *
 * 现在零命中也要下发一段**指令**（不是记忆内容）：换 query 再查一次、仍为空才可回退，
 * 且回退必须显式声明。等于把「要不要再查」的执行权从模型的自觉手里拿走。
 */
export const RECALL_EMPTY_HINT = [
  RECALL_PRELUDE_OPEN,
  `${RECALL_PRELUDE_MARKER} 已执行，本轮零命中（hits=0）。`,
  '零命中不等于「可以不查」：你必须自己再用**不同的 query**（换同义词/换角度，不要原样重复）调用一次 recall_memory；',
  '仍为零命中才允许回退通用知识，且必须在回答里显式写一行「⚠ 本轮召回零命中，已回退现查」。',
  '禁止用「库里没有」掩盖「我没查」。',
  RECALL_PRELUDE_CLOSE,
].join('\n');

/** 把命中正文拼成一段可注入的文本；**零命中返回强制重试指令块**（不再返回 null）。 */
export function buildRecallPrelude(hits: RecallHit[]): string | null {
  const lines: string[] = [];
  for (const hit of hits) {
    if (typeof hit.content !== 'string') continue;
    const body = hit.content.trim().slice(0, MAX_HIT_CHARS);
    if (!body) continue;
    // REQ-014 / T3（C6-B）：命中内容是摘要时附上脱敏原文摘录，实现「摘要 + 原文片段」双保真。
    // 摘录缺失、或与正文逐字相同 → 不追加（否则只是把同一段话印两遍）。
    const excerpt = typeof hit.source_excerpt === 'string'
      ? hit.source_excerpt.trim().slice(0, MAX_EXCERPT_CHARS)
      : '';
    const n = lines.length + 1;
    lines.push(excerpt && excerpt !== body
      ? `[${n}] ${body}\n    原文摘录：${excerpt}`
      : `[${n}] ${body}`);
  }
  if (lines.length === 0) return RECALL_EMPTY_HINT;
  const block = [
    RECALL_PRELUDE_OPEN,
    `${RECALL_PRELUDE_MARKER} 优先采信；与记忆冲突时以记忆为准，记忆库没有的再用通用知识。`,
    PLUGIN_INJECTION_MARKER,
    ...lines,
    RECALL_PRELUDE_CLOSE,
  ].join('\n');
  return block.slice(0, MAX_PRELUDE_CHARS);
}

/** 取最后一条 user 消息的文本（string / OpenAI 多模态 parts 都吃），供召回 query。 */
export function lastUserQuery(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = asRecord(messages[i]);
    if (msg?.role !== 'user') continue;
    const c = msg.content;
    let text = '';
    if (typeof c === 'string') {
      text = c;
    } else if (Array.isArray(c)) {
      text = c.map((part) => {
        const p = asRecord(part);
        return p && typeof p.text === 'string' ? p.text : '';
      }).filter(Boolean).join(' ');
    }
    return text.trim().slice(0, MAX_QUERY_CHARS);
  }
  return '';
}

/** 移除上一轮注入的 prelude 块（幂等：同一会话多轮转发不会越叠越厚）。 */
export function stripRecallPrelude(content: string): string {
  const start = content.indexOf(RECALL_PRELUDE_OPEN);
  if (start < 0) return content;
  const closeAt = content.indexOf(RECALL_PRELUDE_CLOSE, start);
  if (closeAt < 0) return content;
  const after = content.slice(closeAt + RECALL_PRELUDE_CLOSE.length).replace(/^\s*\n?/, '');
  const before = content.slice(0, start);
  return `${before}${after}`.trimStart();
}

/**
 * 把 prelude 拼到 system 消息**最前面**；无 system 则新建一条置顶。
 * 这是 B 方案相对 A 的唯一实质差异：A 只能塞 additionalContext，B 真正改写 messages[0] 的 system。
 */
export function injectSystemPrelude(messages: ChatMessage[], prelude: string | null): ChatMessage[] {
  if (!Array.isArray(messages)) return messages;
  if (!prelude) return messages.map((m) => ({ ...m }));

  const cleaned = messages.map((m) => {
    const copy: ChatMessage = { ...m };
    if (copy.role === 'system' && typeof copy.content === 'string') {
      copy.content = stripRecallPrelude(copy.content);
    } else if (copy.role === 'system' && Array.isArray(copy.content)) {
      copy.content = copy.content.filter((part) => {
        const p = asRecord(part);
        return !(p && typeof p.text === 'string' && p.text.includes(RECALL_PRELUDE_OPEN));
      });
    }
    return copy;
  });

  const idx = cleaned.findIndex((m) => m.role === 'system');
  if (idx < 0) {
    return [{ role: 'system', content: prelude }, ...cleaned];
  }
  const target = cleaned[idx];
  const c = target.content;
  if (Array.isArray(c)) {
    cleaned[idx] = { ...target, content: [{ type: 'text', text: prelude }, ...c] };
  } else if (typeof c === 'string') {
    cleaned[idx] = { ...target, content: c ? `${prelude}\n\n${c}` : prelude };
  } else {
    cleaned[idx] = { ...target, content: prelude };
  }
  return cleaned;
}

/** A 方案：UserPromptSubmit 钩子的 stdout 契约。无命中只有 continue:true，不塞空上下文。 */
export function buildHookOutput(prelude: string | null): Record<string, unknown> {
  if (!prelude) return { continue: true };
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: prelude,
    },
  };
}

// ── 钩子执行状态（防复发「失败锁」：钩子成功/失败必须可检测，绝不静默）──────────
// 状态文件是钩子进程与桌面端 UI 之间唯一的真相载体：钩子每次执行写一次，UI 读最新一次。
// 只记层名/结果/时间/原因分类，**绝不记 prompt 正文、令牌、命中内容**（与 stderr 同一红线）。

export type HookRunStatus = 'ok' | 'empty' | 'failed';
/** 失败原因分类：枚举而非自由文本，避免把异常 message（可能含 URL/令牌片段）写进状态文件。 */
export type HookFailReason =
  | 'empty_input'
  | 'bad_event'
  | 'loopback_guard'
  | 'token_missing'
  | 'rpc_error'
  | 'bad_response'
  | 'unknown';

export interface HookRunState {
  status: HookRunStatus;
  reason?: HookFailReason;
  /** UTC ISO 字符串；无命中/失败也记时间，便于 UI 显示「上次执行于…」 */
  at: string;
  /** 本轮注入的命中条数；失败为 0 */
  hits: number;
  schema: 1;
}

/** 构造一条状态记录；时间与条数由调用方注入，保持纯函数便于单测。 */
export function buildHookRunState(
  status: HookRunStatus,
  at: string,
  hits = 0,
  reason?: HookFailReason,
): HookRunState {
  const state: HookRunState = { status, at, hits, schema: 1 };
  if (reason) state.reason = reason;
  return state;
}

/** 解析状态文件文本；坏 JSON / 结构不符 → null（UI 据此显示「尚无记录」，不猜）。 */
export function parseHookRunState(raw: string | null | undefined): HookRunState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v?.schema !== 1) return null;
    if (v.status !== 'ok' && v.status !== 'empty' && v.status !== 'failed') return null;
    if (typeof v.at !== 'string') return null;
    const hits = typeof v.hits === 'number' && Number.isFinite(v.hits) ? v.hits : 0;
    const state: HookRunState = { status: v.status, at: v.at, hits, schema: 1 };
    if (typeof v.reason === 'string') state.reason = v.reason as HookFailReason;
    return state;
  } catch {
    return null;
  }
}

/** 把状态记录序列化为落盘文本（稳定字段顺序，便于 diff / 排查）。 */
export function serializeHookRunState(state: HookRunState): string {
  const out: Record<string, unknown> = {
    schema: 1,
    status: state.status,
    at: state.at,
    hits: state.hits,
  };
  if (state.reason) out.reason = state.reason;
  return `${JSON.stringify(out)}\n`;
}
