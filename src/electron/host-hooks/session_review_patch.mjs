#!/usr/bin/env node
// UserPromptSubmit 补漏钩子：检查上一条 assistant 回答是否含「复盘 + 沉淀结论」，
// 并对声明的 mem_id 用 get_memory 查库验真。只通过 additionalContext 注入提醒，不阻断对话。
// fail-open：任何读取/解析/RPC 异常都放行；令牌只发 loopback。
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const PASS = { continue: true };
const MCP_URL = process.env.MEMAGENT_MCP_URL || 'http://127.0.0.1:8204/mcp';
const HOOK_TIMEOUT_MS = 2500;
const REVIEW_TITLE = /^#{2,4}\s*(本次会话复盘|本次问题复盘|本次复盘|会话复盘|问题复盘)\s*$/m;
const SEDIMENT_LINE = /沉淀[:：]\s*(.+)$/m;
const MEM_ID_RE = /mem_[0-9A-Z]{20,}/;

const PATCH_NO_REVIEW = '【复盘补漏】上一轮回答缺少「### 本次会话复盘」。请在回答本条新消息前，先按既有复盘段落补上：① 现象与真正根因；② 走过的弯路；③ 修复点与防复发；④ 遗留项与下一步；末尾加一行沉淀结论。若上轮已写过，只把标题改成标准格式，不要新增第二段。';
const PATCH_NO_SEDIMENT = '【复盘补漏】上一轮复盘缺「沉淀：」结论行。请只在原复盘段末尾补一行：沉淀：已写 mem_xxx / 沉淀：本轮无新耐久知识，跳过 / 沉淀：L0 未解锁，已挂起待重放。不要新增第二段复盘。';
const PATCH_NO_MEMID = '【复盘补漏】上一轮沉淀行写了「已写 mem」但没有合法 mem_id，无法验真。请核对真实 write_memory 回执后改写这一行；没有真实回执就写「跳过」或「挂起」。';
const PATCH_FAKE_MEM = '【复盘补漏】上一轮声明的 mem_id 经 get_memory 查库确认不存在。请改掉那一行为真实 mem_id，或如实写「跳过/挂起」；只改这一行，不要新增第二段复盘。';

// 数据根解析（2026-11-18 修）：优先读引导指针 data-root.json（档1 后数据根在 D 盘、档2 已按子目录归类）。
// 原实现写死 %APPDATA%\MultiAgent Memory 平铺路径 —— 迁移后令牌读的是废弃副本、审计写到废弃目录，
// 而且 fail-open 让失效完全静默。
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
function audit(line) {
  try {
    const file = join(dataRoot(), 'logs', 'session-review-patch-audit.jsonl');
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line + '\n', 'utf8');
  } catch { /* 探针失败不影响钩子 */ }
}
function log(msg) { process.stderr.write(`[session_review_patch] ${msg}\n`); }
function pass(tag = 'pass') {
  audit(JSON.stringify({ at: new Date().toISOString(), decision: tag }));
  process.stdout.write(JSON.stringify(PASS));
}
function patch(reason, tag) {
  audit(JSON.stringify({ at: new Date().toISOString(), decision: tag }));
  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: reason,
    },
  }));
}
function readLastAssistantText(tp) {
  const lines = readFileSync(tp, 'utf8').split('\n');
  const from = Math.max(0, lines.length - 200);
  for (let i = lines.length - 1; i >= from; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'message' && obj.role === 'assistant' && Array.isArray(obj.content)) {
      return obj.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n');
    }
  }
  return '';
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
    'x-memagent-client': 'session-review-patch',
  };
  if (sid) headers['Mcp-Session-Id'] = sid;
  const res = await fetch(MCP_URL, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return { sid: res.headers.get('Mcp-Session-Id') || res.headers.get('mcp-session-id') || '', raw: await res.text() };
}
/** true=库里存在 / false=明确不存在 / null=无法判断（fail-open） */
async function memExists(memId) {
  try {
    if (!isLoopback(MCP_URL)) { log('verify-skip: non-loopback mcp url'); return null; }
    let tokenText;
    try { tokenText = readFileSync(tokenFile(), 'utf8'); } catch { log('verify-skip: token missing'); return null; }
    if (!tokenText.trim()) { log('verify-skip: token empty'); return null; }
    const init = await rpc({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'session-review-patch', version: '1.0' } },
    }, tokenText.trim());
    // C 严格门禁：独立 session 必须先 recall_memory，否则 get_memory 会被拦。
    await rpc({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'recall_memory', arguments: { query: 'mem_id 补漏验真', top_k: 1, scene: 'task_start' } },
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
  const tp = evt?.transcript_path;
  if (typeof tp !== 'string' || !tp) { pass('pass:no-transcript'); return; }
  let tail;
  try { tail = readLastAssistantText(tp); } catch { pass('pass:read-error'); return; }
  if (!tail) { pass('pass:empty-tail'); return; }

  const titles = tail.match(new RegExp(REVIEW_TITLE.source, 'gm')) || [];
  if (titles.length > 1) log(`warn: ${titles.length} review titles in one response`);
  if (titles.length === 0) { patch(PATCH_NO_REVIEW, 'patch:no-review'); return; }

  const sm = tail.match(SEDIMENT_LINE);
  if (!sm) { patch(PATCH_NO_SEDIMENT, 'patch:no-sediment'); return; }
  const verdict = sm[1].trim();
  if (verdict.includes('跳过') || verdict.includes('挂起')) { pass('pass:skip-or-hold'); return; }
  const idm = verdict.match(MEM_ID_RE);
  if (!idm) { patch(PATCH_NO_MEMID, 'patch:no-memid'); return; }
  const exists = await memExists(idm[0]);
  if (exists === true) { pass('pass:memid-verified'); return; }
  if (exists === false) { patch(PATCH_FAKE_MEM, 'patch:fake-memid'); return; }
  pass('pass:verify-unknown');
}
main().catch(() => pass('pass:crash'));
