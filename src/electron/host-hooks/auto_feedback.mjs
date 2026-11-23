#!/usr/bin/env node
// Stop 钩子：自动反馈采集——每轮回答结束后，检测正文 [n] 引用，提交 implicit=true 正向弱信号。
// 信号来源：agent 回答中就地标注的 [n]（对应最近一次 recall_memory 的 hits[n-1]）。
// 设计决策（2026-11-22 用户拍板）：
//   - 只自动采集正向引用（confirm），不采集否定信号
//   - 信号强度保持 trust_delta=0，仅 reinforce_count+1，进评估样本池
//   - 用户本轮已显式表态的条目（feedback 工具调用 / 「N 有用/N 没用」短句）排除，不重复计分
//   - fail-open：任何异常静默放行，绝不阻断对话
// 审计：写 auto-feedback-audit.jsonl（dataRoot/logs/），记录每轮检测与提交结果
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// ── 数据根解析（与 session_review.mjs 同套逻辑） ──────────────────────────
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
function pick(sub, file) {
  const classified = join(dataRoot(), sub, file);
  try { readFileSync(classified); return classified; } catch { return join(dataRoot(), file); }
}

// ── 常量 ─────────────────────────────────────────────────────────────────
const PASS = { continue: true };
const MCP_URL = process.env.MEMAGENT_MCP_URL || 'http://127.0.0.1:8204/mcp';
const HOOK_TIMEOUT_MS = 3000;
const LOG_PREFIX = '[auto_feedback] ';
const MAX_RECENT_LINES = 300;   // 只扫最近 N 行（性能护栏）
const MAX_FB_PER_ROUND = 5;      // 每轮最多提交 5 条 implicit（防刷）

// ── 审计探针 ─────────────────────────────────────────────────────────────
function audit(line) {
  try {
    const file = join(dataRoot(), 'logs', 'auto-feedback-audit.jsonl');
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line + '\n', 'utf8');
  } catch { /* 探针失败不影响钩子 */ }
}
function log(msg) { process.stderr.write(LOG_PREFIX + msg + '\n'); }
function pass(tag = 'pass') {
  audit(JSON.stringify({ at: new Date().toISOString(), decision: tag }));
  process.stdout.write(JSON.stringify(PASS));
}

// ── 转录解析 ─────────────────────────────────────────────────────────────
/**
 * 从转录 JSONL 中（取最近 N 行）：
 * 1. 找最后一条 assistant 文本
 * 2. 找最近一次 recall_memory 的 DeferExecuteTool 结果（取 request_id + hits）
 * 3. 检测正文 [n] 引用
 * 4. 排除用户已显式表态的条目
 */

/** 解析 DeferExecuteTool 的 recall_memory 结果 → { request_id, hits: [{mem_id}] }
 *  转录里的 recall_memory 输出 = 摘要行 + JSON 块 + 后续指令文本，
 *  须用深度计数找到第一个完整的 JSON 对象（JSON.parse 不能直接吃带尾随文本的串）。
 */
function parseRecallResult(obj) {
  if (obj?.type !== 'function_call_result' || obj?.name !== 'DeferExecuteTool') return null;
  const outText = obj?.output?.text || '';
  if (!outText.includes('"request_id"') || !outText.includes('"hits"')) return null;
  const jsonStart = outText.indexOf('{');
  if (jsonStart < 0) return null;
  // 深度计数：找第一个与起始 { 配对的 }（考虑字符串内的引号）
  let depth = 0, inStr = false, esc = false;
  let jsonEnd = -1;
  for (let i = jsonStart; i < outText.length; i++) {
    const ch = outText[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
  }
  if (jsonEnd < 0) return null;
  try {
    const j = JSON.parse(outText.substring(jsonStart, jsonEnd));
    if (!j.request_id || !Array.isArray(j.hits)) return null;
    const hits = j.hits.map(h => ({ mem_id: h.mem_id }));
    return { request_id: j.request_id, hits };
  } catch {
    return null;
  }
}

/** 提取最后一条 assistant 消息文本（只取 output_text，跳过 reasoning） */
function extractLastAssistantText(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'message' && obj.role === 'assistant' && Array.isArray(obj.content)) {
      const texts = obj.content
        .filter(c => c?.type === 'output_text')
        .map(c => c.text || '')
        .join('\n');
      if (texts) return texts;
    }
  }
  return '';
}

/**
 * 检测正文 [n] 引用（排除卡片回显区）。
 * 规则：只取 recall_memory 结果行之前的 assistant 消息正文里的 [n]，
 * 但实际场景中 [n] 标注在正文，卡片在末尾。简化方案：
 * 取最后一条 assistant 消息，跳过末尾召回卡片行（以 ▶ 或「⚙ 模式」开头的行），
 * 对剩余正文做 [n] 提取。
 */
function extractNRefs(assistantText) {
  // 跳过末尾卡片区域：从最后一个「▶」或「⚙ 模式」行开始截断
  const lines = assistantText.split('\n');
  let cutoff = lines.length;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('▶') || trimmed.startsWith('⚙') || trimmed.startsWith('**▶') || trimmed.startsWith('**⚙')) {
      cutoff = i;
      break;
    }
  }
  const bodyLines = lines.slice(0, cutoff);
  const body = bodyLines.join('\n');
  const refs = new Set();
  const re = /\[(\d{1,2})\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 20) refs.add(n); // 合理范围护栏
  }
  return [...refs];
}

/**
 * 检测用户本轮已显式表态的条目：
 * - 用户消息是「N 有用 / N 没用」→ 对应 hits[N-1] 已显式
 * - 转录中出现 feedback 工具调用（function_call name=DeferExecuteTool 且 args 含 feedback + 目标 mem_id）
 * 简化方案：扫最近 N 行里 feedback 相关调用，收集 mem_id
 */
function collectExplicitMemIds(lines) {
  const explicit = new Set();
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    // feedback 工具调用（DeferExecuteTool 里 name 或 params 含 'feedback' + mem_id）
    if (obj.type === 'function_call' && obj.name === 'DeferExecuteTool') {
      const argsStr = JSON.stringify(obj.arguments || {});
      if (argsStr.includes('"feedback"') || argsStr.includes('"verdict"')) {
        // 提取 mem_id
        const memMatch = argsStr.match(/"mem_id"\s*:\s*"(mem_[^"]+)"/);
        if (memMatch) explicit.add(memMatch[1]);
      }
    }
    // 用户消息「N 有用 / N 没用」→ 对应 index N
    if (obj.type === 'message' && obj.role === 'user') {
      for (const c of (obj.content || [])) {
        if (c?.type !== 'input_text') continue;
        const text = (c.text || '').trim();
        // 整条只有「N 有用」或「N 没用」（可带 ↗ 或标点）
        const m = text.match(/^(?:\d{1,2}\s*(?:有用|没用)\s*↗?[\s.。]*)+$/);
        if (m) {
          // 所有 N 都算显式
          const nums = text.match(/\d{1,2}/g) || [];
          for (const n of nums) {
            // 对应 hits[n-1] 的 mem_id 由调用方按顺序映射
            explicit.add('idx:' + n);
          }
        }
      }
    }
  }
  return explicit;
}

// ── MCP 调用 ─────────────────────────────────────────────────────────────
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
async function rpc(body, token, sid) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${token}`,
    'x-memagent-client': 'auto-feedback-hook',
  };
  if (sid) headers['Mcp-Session-Id'] = sid;
  const res = await fetch(MCP_URL, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return { sid: res.headers.get('Mcp-Session-Id') || res.headers.get('mcp-session-id') || '', raw: await res.text() };
}

async function createFeedbackSession(token) {
  // 一次 initialize + 一次 recall_memory(top_k=1) 解锁门禁，复用同一 session 提交所有 feedback
  const init = await rpc({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'auto-feedback-hook', version: '1.0' } },
  }, token);
  await rpc({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'recall_memory', arguments: { query: 'auto-feedback 门禁', top_k: 1, scene: 'task_start' } },
  }, token, init.sid);
  return init.sid;
}

async function submitOneFeedback(token, sid, memId, requestId, rpcId) {
  const fb = await rpc({
    jsonrpc: '2.0', id: rpcId, method: 'tools/call',
    params: {
      name: 'feedback',
      arguments: { mem_id: memId, verdict: 'confirm', implicit: true, recall_id: requestId },
    },
  }, token, sid);
  return fb.raw;
}

// ── 主流程 ──────────────────────────────────────────────────────────────
async function main() {
  audit(JSON.stringify({ at: new Date().toISOString(), decision: 'invoked' }));
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { pass('pass:no-stdin'); return; }
  let evt;
  try { evt = JSON.parse(raw); } catch { pass('pass:bad-event'); return; }
  if (evt.stop_hook_active === true) { pass('pass:active'); return; }
  const tp = evt.transcript_path;
  if (typeof tp !== 'string' || !tp) { pass('pass:no-transcript'); return; }

  // 读转录
  let allLines;
  try { allLines = readFileSync(tp, 'utf8').split('\n'); } catch { pass('pass:read-error'); return; }
  // 只取最近 N 行
  const lines = allLines.slice(-MAX_RECENT_LINES).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) { pass('pass:empty'); return; }

  // ① 找最近一次 recall_memory 结果
  let recallData = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    recallData = parseRecallResult(obj);
    if (recallData) break;
  }
  if (!recallData || recallData.hits.length === 0) { pass('pass:no-recall'); return; }

  // ② 取最后一条 assistant 正文
  const assistantText = extractLastAssistantText(lines);
  if (!assistantText) { pass('pass:no-assistant'); return; }

  // ③ 提取 [n] 引用
  const nRefs = extractNRefs(assistantText);
  if (nRefs.length === 0) { pass('pass:no-refs'); return; }

  // ④ 排除显式表态条目
  const explicitSet = collectExplicitMemIds(lines);
  // 将 [n] 映射到 mem_id
  const candidates = [];
  for (const n of nRefs) {
    const hit = recallData.hits[n - 1];
    if (!hit) continue; // [n] 超出命中数 → 跳过
    // 显式判定：mem_id 在 explicit set 里，或 idx:n 在 explicit set 里
    if (explicitSet.has(hit.mem_id) || explicitSet.has('idx:' + n)) continue;
    candidates.push({ mem_id: hit.mem_id, n });
  }
  if (candidates.length === 0) { pass('pass:all-explicit'); return; }
  // 防刷护栏
  const toSubmit = candidates.slice(0, MAX_FB_PER_ROUND);
  if (candidates.length > MAX_FB_PER_ROUND) {
    log(`warn: ${candidates.length} candidates truncated to ${MAX_FB_PER_ROUND}`);
  }

  // ⑤ 批量提交 implicit feedback（fail-open，单条失败不影响后续）
  // 前置检查：token 与 loopback（只检查一次）
  let tokenText = '';
  try {
    tokenText = readFileSync(tokenFile(), 'utf8').trim();
  } catch { /* token 缺失 → 全部 fail-open */ }
  if (!tokenText || !isLoopback(MCP_URL)) {
    const tag = !tokenText ? 'skip:token-missing' : 'skip:non-loopback';
    audit(JSON.stringify({ at: new Date().toISOString(), decision: tag, candidates: candidates.length }));
    pass(tag);
    return;
  }

  // 共享一个 MCP 会话（initialize + recall 解锁门禁只做一次）
  let sid = '';
  try {
    sid = await createFeedbackSession(tokenText);
  } catch (e) {
    log(`session-error: ${String(e?.message || e).slice(0, 80)}`);
    audit(JSON.stringify({ at: new Date().toISOString(), decision: 'session-error' }));
    pass('session-error');
    return;
  }

  const results = [];
  let submitted = 0;
  let dupCount = 0;
  let errCount = 0;
  let rpcId = 3; // 从 3 开始（1=initialize, 2=recall）
  for (const cand of toSubmit) {
    try {
      const rawResp = await submitOneFeedback(tokenText, sid, cand.mem_id, recallData.request_id, rpcId++);
      const respText = rawResp || '';
      if (respText.includes('"duplicate"') && respText.includes('true')) {
        dupCount++;
        results.push({ mem_id: cand.mem_id, n: cand.n, status: 'duplicate' });
      } else {
        submitted++;
        results.push({ mem_id: cand.mem_id, n: cand.n, status: 'submitted' });
      }
    } catch (e) {
      errCount++;
      log(`submit-error [${cand.mem_id}]: ${String(e?.message || e).slice(0, 80)}`);
      results.push({ mem_id: cand.mem_id, n: cand.n, status: 'error' });
    }
  }

  const tag = submitted > 0 ? `submitted:${submitted}` : (dupCount > 0 ? `duplicate:${dupCount}` : 'all-failed');
  audit(JSON.stringify({
    at: new Date().toISOString(),
    decision: tag,
    submitted, dupCount, errCount,
    totalCandidates: candidates.length,
    submittedMemIds: toSubmit.map(c => c.mem_id),
  }));
  pass(tag);
}

main().catch(() => {
  audit(JSON.stringify({ at: new Date().toISOString(), decision: 'crash' }));
  process.stdout.write(JSON.stringify(PASS));
});
