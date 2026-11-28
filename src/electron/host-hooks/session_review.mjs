#!/usr/bin/env node
// Stop 钩子：每轮回答收尾前的「复盘 + 沉淀结论」双闸门。
// ① 复盘标题存在（容忍常见变体）→ 否则拦住补写；② 若声明"已写 mem_xxx"→ 用 get_memory 查库验真。
// 第2问风险管控：正则放宽 + 补写指令明示"改写而非追加" + 多标题按已复盘放行并 stderr 记 warn。
// fail-open：任何读取/解析/RPC 异常都放行，绝不阻断正常对话。令牌只发 loopback。
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// 数据根解析（2026-11-18 修）：优先读引导指针 data-root.json（档1 后数据根在 D 盘、档2 已按子目录归类）。
// 原实现把 %APPDATA%\MultiAgent Memory 的平铺路径写死，迁移后令牌与钩子状态全读废弃目录，
// 且 fail-open 让失效完全静默 —— 这类「写到别的目录还自认成功」的坑比报错危险。
function legacyBase() {
  const appdata = process.env.APPDATA || process.env.LOCALAPPDATA;
  return appdata ? join(appdata, 'MultiAgent Memory') : join(homedir(), '.config', 'multiagent-memory');
}
function dataRoot() {
  try {
    const p = JSON.parse(readFileSync(join(legacyBase(), 'data-root.json'), 'utf8'));
    if (p && typeof p.root === 'string' && p.root.trim()) return p.root;
  } catch { /* 指针缺失/损坏 → 回落老位置 */ }
  return legacyBase();
}
/** 归类后路径优先：<root>/<sub>/<file> 存在就用它，否则回落 <root>/<file>（老布局兼容） */
function pick(sub, file) {
  const classified = join(dataRoot(), sub, file);
  try { readFileSync(classified); return classified; } catch { return join(dataRoot(), file); }
}

/** 执行探针：每次调用追加一行（时间/判定/原因），用于确认 Stop 钩子是否真被调用。无敏感正文。 */
function audit(line) {
  try {
    const file = join(dirname(hookStatusPath()), 'session-review-audit.jsonl');
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line + '\n', 'utf8');
  } catch { /* 探针失败不影响钩子 */ }
}
function hookStatusPath() {
  return pick('logs', 'recall-hook-status.json');
}

const PASS = { continue: true };
const MCP_URL = process.env.MEMAGENT_MCP_URL || 'http://127.0.0.1:8204/mcp';
const HOOK_TIMEOUT_MS = 2500;
// 标题变体一次收齐，降低"自然语言写法不同→误拦→补写两段"的概率
const REVIEW_TITLE = /^#{2,4}\s*(本次会话复盘|本次问题复盘|本次复盘|会话复盘|问题复盘)\s*$/m;
const SEDIMENT_LINE = /沉淀[:：]\s*(.+)$/m;
const MEM_ID_RE = /mem_[0-9A-Z]{20,}/;

const BLOCK_NO_REVIEW = '本轮回答尚未输出「本次会话复盘」。请在结束前补上一段，标题用 "### 本次会话复盘"，内容依次写：① 本次的现象与真正根因（区分表层症状 vs 根因）；② 排查中走过的弯路/浪费的动作；③ 修复点与防复发机制（哪条判据或测试钉住）；④ 遗留未解项与下一步。若你已写过复盘，只需把已有段落的标题改成标准格式，不要再新增第二段。';
const BLOCK_NO_SEDIMENT = '复盘段里缺少「沉淀结论」行。请在复盘末尾加一行，格式三选一：沉淀：已写 mem_xxx（本轮有新耐久知识并已 write_memory）/ 沉淀：本轮无新耐久知识，跳过 / 沉淀：L0 未解锁，已挂起待重放。不要新增第二段复盘，只在这一段里补这一行。';
const BLOCK_FAKE_MEM = '复盘里声明的 mem_id 经查库确认不存在，请核对 write_memory 的真实回执后改写这一行（不要把错误 mem_id 留在复盘里）；只改这一行，不要新增第二段复盘。';

function log(msg) { process.stderr.write(`[session_review] ${msg}\n`); }
function pass(tag = 'pass') {
  audit(JSON.stringify({ at: new Date().toISOString(), decision: tag }));
  process.stdout.write(JSON.stringify(PASS));
}
function block(reason, tag = 'block') {
  audit(JSON.stringify({ at: new Date().toISOString(), decision: tag }));
  process.stdout.write(JSON.stringify({ continue: false, reason, suppressOutput: true }));
}

/**
 * 【2026-11-26 根治复盘重复】取文口径与 fold_card_check.mjs 完全对齐。
 * 老实现取「全文最后一条 assistant 正文」，会被「出卡后补的那句确认话」覆盖 →
 *   卡前已写复盘却误判缺复盘 → 逼补第二段 → 与 fold_card_check「删卡后文字」互搏 → 循环。
 * 新实现：有 show_widget 卡时，取「卡前最后一条实质 assistant 正文」；无卡才取最后一条。
 * 两张卡/多次正文也只认最近一张卡之前那条，与 fold_card_check#extractBodyBeforeCard 同口径。
 */
function assistantText(obj) {
  if (obj?.type !== 'message' || obj.role !== 'assistant' || !Array.isArray(obj.content)) return '';
  return obj.content
    .filter((c) => c?.type === 'output_text' || c?.type === 'text')
    .map((c) => c.text || '')
    .join('\n');
}
function lastCardLine(lines, from) {
  for (let i = lines.length - 1; i >= from; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if ((obj.type === 'function_call' || obj.type === 'tool_use') && obj.name === 'show_widget') return i;
  }
  return -1;
}
function readLastAssistantText(tp) {
  const lines = readFileSync(tp, 'utf8').split('\n');
  const from = Math.max(0, lines.length - 300);
  const cardLine = lastCardLine(lines, from);
  const start = cardLine >= from ? cardLine - 1 : lines.length - 1;
  for (let i = start; i >= from; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const t = assistantText(obj);
    if (t.trim()) return t;
  }
  return '';
}

/**
 * 【2026-11-24 根治 30 次死循环】识别 Stop hook 回灌轮：最后一条 user 消息是钩子反馈注入。
 * 与 fold_card_check 同判据。两个 Stop 钩子对同一条违规末条同时触发时：
 *   fold_card_check 说「删卡后文字」↔ 本钩子说「补复盘」→ 指令矛盾 → 补复盘又成卡后正文 → 循环。
 * 回灌轮的 assistant 输出只是为了响应某一钩子的反馈，不该被另一钩子再判一次「缺复盘」。
 * 放行后只对真实提问轮把关，打破互搏。
 */
function isFeedbackTurn(tp) {
  const lines = readFileSync(tp, 'utf8').split('\n');
  const from = Math.max(0, lines.length - 200);
  for (let i = lines.length - 1; i >= from; i -= 1) {
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

function tokenFile() {
  if (process.env.MEMAGENT_MCP_TOKEN_FILE) return process.env.MEMAGENT_MCP_TOKEN_FILE;
  return pick('keys', 'mcp-token.txt');
}
function isLoopback(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]');
  } catch { return false; }
}
function parseRpcBody(raw) {
  let text = raw.trim();
  if (text.startsWith('data:') || text.startsWith('event:') || text.startsWith('id:')) {
    const data = text.split(/\r?\n/).find((l) => l.startsWith('data:'));
    text = data ? data.slice(5).trim() : '';
  }
  try { return JSON.parse(text); } catch { return null; }
}
async function rpc(body, token, sid) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${token}`,
    'x-memagent-client': 'session-review-hook',
  };
  if (sid) headers['Mcp-Session-Id'] = sid;
  const res = await fetch(MCP_URL, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return { sid: res.headers.get('Mcp-Session-Id') || '', raw: await res.text() };
}

/** 查库验真：true=存在 / false=明确不存在 / null=无法判断（fail-open 放行） */
async function memExists(memId) {
  try {
    if (!isLoopback(MCP_URL)) { log('verify-skip: non-loopback mcp url'); return null; }
    let tokenText;
    try { tokenText = await readFile(tokenFile(), 'utf8'); } catch { log('verify-skip: token missing'); return null; }
    if (!tokenText.trim()) { log('verify-skip: token empty'); return null; }
    const init = await rpc({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'session-review-hook', version: '1.0' } },
    }, tokenText.trim());
    // C 严格门禁：独立会话必须先 recall_memory，否则所有非 recall 工具硬拦（实测）。
    // 用一个固定轻量 query 满足门禁；验真只关心 get_memory 的 ok 字段，不消费召回内容。
    await rpc({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'recall_memory', arguments: { query: 'mem_id 验真', top_k: 1, scene: 'task_start' } },
    }, tokenText.trim(), init.sid);
    const get = await rpc({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'get_memory', arguments: { mem_id: memId } },
    }, tokenText.trim(), init.sid);
    const parsed = parseRpcBody(get.raw);
    const result = parsed?.result ?? parsed;
    const sc = result?.structuredContent ?? result;
    if (sc && typeof sc === 'object' && 'ok' in sc) return sc.ok === true;
    const blocks = result?.content;
    if (Array.isArray(blocks)) {
      const text = blocks.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('');
      const m = text.match(/"ok"\s*:\s*(true|false)/);
      if (m) return m[1] === 'true';
    }
    log('verify-unknown: cannot determine ok, fail-open');
    return null;
  } catch (e) {
    log(`verify-error: ${String((e)?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

async function main() {
  audit(JSON.stringify({ at: new Date().toISOString(), decision: 'invoked' }));
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { pass('pass:no-stdin'); return; }
  let evt;
  try { evt = JSON.parse(raw); } catch { pass('pass:bad-event'); return; }
  if (evt.stop_hook_active === true) { pass('pass:active'); return; }
  const tp = evt.transcript_path;
  if (typeof tp !== 'string' || !tp) { pass('pass:no-transcript'); return; }
  // 根治 30 次互搏：Stop 回灌轮放行，不再要求补复盘（fold_card_check 正在要求删卡后文字）
  try { if (isFeedbackTurn(tp)) { pass('pass:feedback-turn'); return; } } catch { /* fail-open */ }
  let tail;
  try { tail = readLastAssistantText(tp); } catch { pass('pass:read-error'); return; }
  if (!tail) { pass('pass:empty-tail'); return; }

  // 管控3：多个复盘标题 → 视为已复盘放行，但记 warn（防补写出两段时误拦）
  const titles = tail.match(new RegExp(REVIEW_TITLE.source, 'gm')) || [];
  if (titles.length > 1) { log(`warn: ${titles.length} review titles in one response (possible duplicate)`); pass('pass:multi-title'); return; }
  if (titles.length === 0) { block(BLOCK_NO_REVIEW, 'block:no-review'); return; }

  // 沉淀结论行检查
  const sm = tail.match(SEDIMENT_LINE);
  if (!sm) { block(BLOCK_NO_SEDIMENT, 'block:no-sediment'); return; }
  const verdict = sm[1].trim();
  if (verdict.includes('跳过') || verdict.includes('挂起')) { pass('pass:skip-or-hold'); return; } // 诚实表态，无需验真
  const idm = verdict.match(MEM_ID_RE);
  if (!idm) { block(BLOCK_NO_SEDIMENT, 'block:no-memid'); return; } // "已写"却没给合法 mem_id
  const exists = await memExists(idm[0]);
  if (exists === true) { pass('pass:memid-verified'); return; }
  if (exists === false) { block(BLOCK_FAKE_MEM, 'block:fake-memid'); return; }
  pass('pass:verify-unknown'); // null=无法判断 → fail-open
}
main().catch(() => pass('pass:crash'));
