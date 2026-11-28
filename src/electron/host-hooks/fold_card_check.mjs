#!/usr/bin/env node
// Stop 钩子：召回回显合规性检查（2026-11-23 重写 P0）
//
// 【判据·2026-11-23 最终版】召回折叠卡必须由模型侧调 show_widget 渲染——
// 截图铁证：卡片下方紧跟「查看所有产物(3)>」= WorkBuddy 对 widget 产物的标准展示条，
// 不是宿主自动冒出来的。21:45 曾误判为"宿主原生渲染、禁手画"导致停卡数轮，已作废。
//
// 本钩子检查：
//   1. 【凭证行】本轮有 recall_memory 调用 → 正文须含 🔎 本轮召回：req_xxx（或 ⚠ 零命中）
//   2. 【必须出卡】有召回且命中>0 → 必须有 show_widget 输出召回卡（widget 含 命中N条/⚡省/display.card 等特征）
//   3. 【无三角】正文文本不得含手画黑三角 ▶/▸/▾（▼ 应在 widget 卡片内用 SVG 画）
//   4. 【位置】凭证行后不应有卡片说明文字（卡片本身由 widget 渲染，不写文字说明）
//   5. 【卡片后零正文·2026-11-23 新增 / 2026-11-24 升级硬阻断】最后一个 show_widget 之后不得再有含实质文本的 assistant message
//      （真因实例：出卡后又重发一版完整结论 → 卡片被夹在两版正文中间 = "卡片在中间 + 结论重复"）
//      连续 12 条审计 echo-issue 证明「只提醒」拦不住：additionalContext 是下一轮才注入，用户已经看到卡后文字。
//      2026-11-24 起本项单独升级 exit 2 阻断（宿主把 stderr 回灌模型要求重做末条）；其余项仍只提醒。
//      stop_hook_active=true 时直接 pass，阻断重试不会循环。
//
// fail-open：任何异常静默放行；非阻断违规仅通过 additionalContext 注入提醒。
// 事件读取：与 session_review.mjs / auto_feedback.mjs 一致，从 stdin(fd 0) 读宿主注入的 JSON。
// 审计：写 fold-card-check-audit.jsonl（dataRoot/logs/）
import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const PASS = { continue: true };
const LOG_PREFIX = '[fold_card_check] ';
const MAX_RECENT_LINES = 300;

// ── 正则模式 ───────────────────────────────────────────────────────────────
const RECALL_CREDENTIAL = /🔎\s*本轮召回[：:]\s*req_[0-9A-Z]+/;          // 召回凭证行
const RECALL_ZERO_CRED = /⚠\s*本轮召回零命中/;                            // 零命中凭证
const HAND_DRAWN_TRIANGLE = /[▶▸▾◄]/;                                     // 正文手画三角（宿主气泡 ▼ 不在正文）
const WIDGET_RECALL_CARD = /💠\s*Memory|命中\s*\d+\s*条|⚡\s*省|titleLine[12]|display\.card/;
const CARD_AFTER_PREFIX = '卡片后仍有 assistant 正文';                      // 唯一硬阻断项（2026-11-24）

/** 纯函数：从校验问题里挑出必须硬阻断的项（目前仅「卡片后正文」）。 */
export function pickBlockingIssues(issues) {
  return issues.filter((i) => typeof i === 'string' && i.startsWith(CARD_AFTER_PREFIX));
}

// ── 数据根解析 ─────────────────────────────────────────────────────────────
function legacyBase() {
  const appdata = process.env.APPDATA || process.env.LOCALAPPDATA;
  return appdata ? join(appdata, 'MultiAgent Memory') : join(homedir(), '.config', 'multiagent-memory');
}
function dataRoot() {
  try {
    const p = JSON.parse(readFileSync(join(legacyBase(), 'data-root.json'), 'utf8'));
    if (p && typeof p.root === 'string' && p.root.trim()) return p.root;
  } catch { /* 回落老位置 */ }
  return legacyBase();
}

// ── 审计探针 ───────────────────────────────────────────────────────────────
function audit(line) {
  try {
    const file = join(dataRoot(), 'logs', 'fold-card-check-audit.jsonl');
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line + '\n', 'utf8');
  } catch { /* 探针失败不影响钩子 */ }
}
function log(msg) { process.stderr.write(LOG_PREFIX + msg + '\n'); }
function pass(tag = 'pass') {
  audit(JSON.stringify({ at: new Date().toISOString(), decision: tag }));
  process.stdout.write(JSON.stringify(PASS));
}
function patch(reason, tag = 'patch') {
  audit(JSON.stringify({ at: new Date().toISOString(), decision: tag, reason }));
  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: reason,
    },
  }));
}
/** 硬阻断：exit 2 + stderr 回灌宿主，强制重做末条回复；stop_hook_active 防循环在 main 里守。 */
function block(reason, tag = 'block') {
  audit(JSON.stringify({ at: new Date().toISOString(), decision: tag, reason }));
  process.stderr.write(reason + '\n');
  process.stdout.write(JSON.stringify({
    continue: false,
    stopReason: reason,
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: reason },
  }));
  process.exitCode = 2;
}

// ── 阻断去重（2026-11-28：阻断本身会制造「重复卡片 + 重复复盘」） ──────────────
// 真因：宿主没传 stop_hook_active（实测 exit 2 后会连续回灌），模型每次重做都把整条
// 回答重写一遍 → 第二张卡、第二份复盘。同一份转录 10 分钟内只阻断一次，之后只提醒放行，
// 把「无限重写」收成「最多一次纠正」。
const BLOCK_STATE_FILE = 'fold-card-block-state.json';
const BLOCK_WINDOW_MS = 10 * 60 * 1000;

export function blockedRecently(prev, tp, now) {
  if (!prev || typeof prev !== 'object') return false;
  if (prev.tp !== tp) return false;
  const at = typeof prev.at === 'number' ? prev.at : 0;
  return now - at >= 0 && now - at < BLOCK_WINDOW_MS;
}

function readBlockState() {
  try { return JSON.parse(readFileSync(join(dataRoot(), 'logs', BLOCK_STATE_FILE), 'utf8')); }
  catch { return null; }
}
function writeBlockState(tp, now) {
  try {
    const file = join(dataRoot(), 'logs', BLOCK_STATE_FILE);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ tp, at: now }), 'utf8');
  } catch { /* 状态写不进去就退化成老行为（会重复阻断），不阻断主流程 */ }
}

// ── 转录解析：复用 auto_feedback.mjs 的成熟格式 ─────────────────────────────
/**
 * 【2026-11-24 根治 30 次死循环】只取「本轮」行：最后一个 user 角色消息（真实提问 / Stop feedback 注入）之后。
 * 根因：原实现扫最近 300 行，跨多个 assistant 回合。Stop hook 把回灌当成新 user 消息再触发一轮，
 *   上一轮已出的 show_widget 卡仍在窗口内 → 本轮重写的复盘文字被 findTextAfterCard 误判为「卡后正文」
 *   → 再 block → 再回灌 → 无限循环（用户实测 >30 次）。限定本轮后，跨回合的卡不再参与判定。
 * 识别 user 边界：obj.role === 'user'（真实提问、Stop feedback 注入都是 user）；兼容 type='user'。
 */
export function sliceCurrentTurn(lines) {
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.role === 'user' || obj.type === 'user') { start = i + 1; break; }
  }
  return lines.slice(start);
}

/**
 * 【2026-11-24 根治互搏】识别「Stop hook 回灌轮」：最后一条 user 消息是钩子反馈注入。
 * 两个 Stop 钩子（fold_card_check + session_review）会对同一条违规末条同时触发，
 * 反馈作为 user 消息注入 → 模型为响应反馈输出的修正文本本轮，不该再被判定一次。
 * 否则：fold_card_check 说"删卡后文字"、session_review 说"补复盘"，两条指令互相矛盾
 * → 补了复盘又是卡后正文 → 再 block → 实测 >30 次死循环。回灌轮一律放行，只对真实提问轮把关。
 */
export function isFeedbackTurn(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.role === 'user' || obj.type === 'user') {
      const c = obj.content;
      const txt = (Array.isArray(c) ? c.map((x) => (typeof x?.text === 'string' ? x.text : '')).join('')
        : typeof c === 'string' ? c : '').toLowerCase();
      return txt.includes('stop hook feedback');
    }
  }
  return false;
}

/** 取最后一条 user 消息的纯文本（真实提问或钩子回灌） */
export function lastUserText(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.role === 'user' || obj.type === 'user') {
      const c = obj.content;
      return (Array.isArray(c) ? c.map((x) => (typeof x?.text === 'string' ? x.text : '')).join('')
        : typeof c === 'string' ? c : '');
    }
  }
  return '';
}

/** 本轮是否有 recall_memory 工具调用（function_call_result，DeferExecuteTool + request_id） */
function hasRecallThisTurn(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'function_call_result' && obj.name === 'DeferExecuteTool') {
      const out = obj?.output?.text || '';
      if (out.includes('"request_id"') && out.includes('"hits"')) return true;
    }
  }
  return false;
}

/** 提取最后一条 assistant 正文文本（output_text，跳过 reasoning） */
function extractLastAssistantText(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'message' && obj.role === 'assistant' && Array.isArray(obj.content)) {
      const texts = obj.content
        .filter((c) => c?.type === 'output_text' || c?.type === 'text')
        .map((c) => c.text || '')
        .join('\n');
      if (texts) return texts;
    }
  }
  return '';
}

/**
 * 【2026-11-24 修复死循环】取「卡片之前最后一条实质 assistant 正文」用于凭证/出卡校验。
 * 真因：extractLastAssistantText 取全文最后一条文本，会被「出卡后补的那句确认话」
 *   （如"卡片已作为最后一条内容输出"）覆盖 → 那句话里没有 🔎/复盘 → 误报
 *   "缺凭证/缺复盘" → 重做方向被带偏 → 又补一句确认话 → 无限循环。
 * 修法：只要有卡，凭证校验就看卡前主体正文；卡后文本单独交给 findTextAfterCard 判违规。
 */
function extractBodyBeforeCard(lines, cardLine) {
  for (let i = cardLine - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'message' && obj.role === 'assistant' && Array.isArray(obj.content)) {
      const texts = obj.content
        .filter((c) => c?.type === 'output_text' || c?.type === 'text')
        .map((c) => c.text || '')
        .join('\n');
      if (texts.trim()) return texts;
    }
  }
  return '';
}

/**
 * 【2026-11-23 新增】检测「卡片后有正文」违规。
 * 返回最后一个 show_widget(function_call) 与最后一条实质 assistant 文本的行号；
 * 若文本行号 > 卡片行号 → 出卡后又生成了正文（卡片被夹在中间/结论重复）。
 * 注意：function_call_result:show_widget 本身不算正文；只认 message[assistant].content 里的 output_text/text。
 */
export function findTextAfterCard(lines) {
  let lastCardLine = -1;
  let lastTextLine = -1;
  let lastText = '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if ((obj.type === 'function_call' || obj.type === 'tool_use') && (obj.name === 'show_widget')) {
      lastCardLine = i;
    }
    if (obj.type === 'message' && obj.role === 'assistant' && Array.isArray(obj.content)) {
      const t = obj.content
        .filter((c) => c?.type === 'output_text' || c?.type === 'text')
        .map((c) => c.text || '')
        .join('');
      if (t.trim()) { lastTextLine = i; lastText = t; }
    }
  }
  return { lastCardLine, lastTextLine, textAfterCard: lastCardLine >= 0 && lastTextLine > lastCardLine, lastText };
}

/** 检测本轮是否用 show_widget 手画了"召回卡"（widget_code 含召回卡特征） */
function hasHandDrawnRecallCard(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'function_call' || obj.type === 'tool_use') {
      const name = obj.name || '';
      if (name !== 'show_widget' && name !== 'DeferExecuteTool') continue;
      const argsStr = JSON.stringify(obj.arguments || obj.input || {});
      if (!argsStr.includes('show_widget') && name !== 'show_widget') continue;
      if (WIDGET_RECALL_CARD.test(argsStr)) return true;
    }
  }
  return false;
}

// ── 验证逻辑（纯函数，便于测试） ────────────────────────────────────────────
/**
 * @param {object} input
 * @param {boolean} input.hadRecall        本轮是否有 recall_memory 调用
 * @param {string}  input.assistantText    最后一条 assistant 正文
 * @param {boolean} input.hasOutputCard    是否用 show_widget 输出了召回卡
 */
export function validateEcho({ hadRecall, assistantText, hasOutputCard }) {
  const issues = [];

  // 1. 本轮有召回 → 须有召回凭证行（🔎 或 ⚠ 零命中）
  if (hadRecall && !RECALL_CREDENTIAL.test(assistantText) && !RECALL_ZERO_CRED.test(assistantText)) {
    issues.push('本轮已召回但正文缺 🔎 本轮召回：req_xxx 凭证行');
  }

  // 2. 本轮有召回（命中>0）→ 必须用 show_widget 出卡（2026-11-23 更正：卡是 show_widget 产物，不是宿主自动）
  //    零命中（⚠）时 display.card 为 null，不强制出卡
  const isZeroHit = RECALL_ZERO_CRED.test(assistantText);
  if (hadRecall && !isZeroHit && !hasOutputCard) {
    issues.push('本轮召回命中但缺 show_widget 折叠卡——召回卡必须由模型侧调 show_widget 渲染（宿主不自动生成）');
  }

  // 3. 正文不得含手画黑三角（卡片内 ▼ 由组件 SVG 画，不应出现在正文文本里）
  if (HAND_DRAWN_TRIANGLE.test(assistantText)) {
    issues.push('正文含手画三角符号（▶/▸/▾），展开标记应在 show_widget 卡片内');
  }

  // 4. 位置：若有凭证行，其后不应再有卡片说明文字（复盘/沉淀须在凭证行之前）
  const credMatch = RECALL_CREDENTIAL.exec(assistantText);
  if (credMatch) {
    const after = assistantText.slice(credMatch.index + credMatch[0].length).trim();
    if (after.length > 0 && after.length < 120 && /卡片|已输出|已作为|会话最后/.test(after)) {
      issues.push('凭证行后仍有卡片说明文字（卡片由宿主渲染，不应手写说明）');
    }
  }

  return issues;
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { pass('pass:no-stdin'); return; }
  let evt;
  try { evt = JSON.parse(raw); } catch { pass('pass:bad-event'); return; }
  if (evt.stop_hook_active === true) { pass('pass:active'); return; }
  const tp = evt.transcript_path;
  if (typeof tp !== 'string' || !tp) { pass('pass:no-transcript'); return; }

  let lines;
  try { lines = readFileSync(tp, 'utf8').split('\n').slice(-MAX_RECENT_LINES); }
  catch { pass('pass:read-error'); return; }

  // 根治 30 次死循环①：Stop 回灌轮默认放行——两个 Stop 钩子对同一末条的矛盾指令不再互相触发
  // 例外（2026-11-28）：折叠卡回灌轮（要求「删掉卡后文字」）必须零输出。旧实现一律放行，
  //   模型于是把整条回答重写一遍 → 用户看到第二张卡 + 第二份复盘。这类轮次只允许结束、不许再写。
  if (isFeedbackTurn(lines)) {
    const fb = lastUserText(lines);
    if (!/折叠卡|卡后|删掉/.test(fb)) { pass('pass:feedback-turn'); return; }
    const turn = sliceCurrentTurn(lines);
    const tailText = extractLastAssistantText(turn);
    if (!tailText.trim()) { pass('pass:feedback-silent'); return; }
    const reason = '【折叠卡违规·回灌轮】这一轮只允许直接结束、一个字都不要写：不要再输出正文、不要再调 show_widget 出第二张卡、不要写复盘或确认话。'
      + '上一轮的卡片与卡前正文已经是对的，保持不变即可。';
    const now = Date.now();
    if (blockedRecently(readBlockState(), tp, now)) { patch(reason, 'block-once-skip'); return; }
    writeBlockState(tp, now);
    block(reason, 'block:feedback-not-silent');
    return;
  }
  // 根治 30 次死循环②：所有判定只看本轮（最后一个 user 消息之后），上一轮的卡不参与
  lines = sliceCurrentTurn(lines);

  const hadRecall = hasRecallThisTurn(lines);
  const hasOutputCard = hasHandDrawnRecallCard(lines);
  const cardPos = findTextAfterCard(lines);
  // 凭证/出卡校验用「卡片前的主体正文」，不被卡后确认话覆盖（防误报死循环）
  const assistantText = cardPos.lastCardLine >= 0
    ? (extractBodyBeforeCard(lines, cardPos.lastCardLine) || extractLastAssistantText(lines))
    : extractLastAssistantText(lines);

  if (!assistantText) { pass('pass:empty-tail'); return; }

  const issues = validateEcho({ hadRecall, assistantText, hasOutputCard });

  // 5. 卡片后零正文（2026-11-23 新增）：最后一张 show_widget 之后不得再有实质 assistant 文本
  if (cardPos.textAfterCard) {
    const tail = cardPos.lastText.replace(/\s+/g, ' ').slice(0, 60);
    issues.push(`卡片后仍有 assistant 正文（卡片被夹在中间/结论重复）——出卡后应立即停止生成，不得再输出任何文本（尾部："${tail}…"）`);
  }
  if (issues.length === 0) {
    pass('ok');
  } else {
    const isCardAfter = issues.some((i) => i.startsWith(CARD_AFTER_PREFIX));
    const reason = isCardAfter
      ? '【折叠卡违规·只做一件事】把「最后一张召回卡之后」的 assistant 文字整段删掉即可——不要重新输出正文、不要重新调 show_widget、不要写「卡片已输出/卡后零文字」这类确认话（这类话本身就是违规的卡后正文）。卡片和它之前的正文都是对的，保持不动；删完直接结束，一个字都不要再写。'
      : '【召回回显纠偏·重做末条】顺序=正文→复盘→沉淀→🔎凭证行→最后调 show_widget 出卡（灰底圆角两行标题、右侧 ▼、默认收起，数据逐字取 display.card），出卡后立刻停止。' + issues.join('；');
    if (pickBlockingIssues(issues).length > 0) {
      const now = Date.now();
      if (blockedRecently(readBlockState(), tp, now)) { patch(reason, 'block-once-skip'); return; }
      writeBlockState(tp, now);
      block(reason, 'block:card-after-text');
    } else {
      patch(reason, 'echo-issue');
    }
  }
}

try { main(); } catch (e) { log(`钩子执行失败: ${e.message}`); pass('fail-open'); }
