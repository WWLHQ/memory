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
//   5. 【卡片后零正文·2026-11-23 新增】最后一个 show_widget 之后不得再有含实质文本的 assistant message
//      （真因实例：出卡后又重发一版完整结论 → 卡片被夹在两版正文中间 = "卡片在中间 + 结论重复"）
//
// fail-open：任何异常静默放行；违规仅通过 additionalContext 注入提醒，不阻断对话。
// 事件读取：与 session_review.mjs / auto_feedback.mjs 一致，从 stdin(fd 0) 读宿主注入的 JSON。
// 审计：写 fold-card-check-audit.jsonl（dataRoot/logs/）
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
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

// ── 转录解析：复用 auto_feedback.mjs 的成熟格式 ─────────────────────────────
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

  const hadRecall = hasRecallThisTurn(lines);
  const assistantText = extractLastAssistantText(lines);
  const hasOutputCard = hasHandDrawnRecallCard(lines);
  const cardPos = findTextAfterCard(lines);

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
    const reason = '【召回回显纠偏】' + issues.join('；') + '。正确做法：顺序=正文→复盘→沉淀→🔎凭证行→最后调 show_widget 出卡（灰底圆角两行标题、右侧 ▼、默认收起，数据逐字取 display.card），卡片必须是回答绝对最后一条。';
    patch(reason, 'echo-issue');
  }
}

try { main(); } catch (e) { log(`钩子执行失败: ${e.message}`); pass('fail-open'); }
