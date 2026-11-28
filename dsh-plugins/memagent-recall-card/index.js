/**
 * DSH Host 侧入口：把卡片上的「N 有用 / N 没用」按钮变成**真的写入记忆库**。
 *
 * 为什么要绕这一道：DSH 的 Web 客户端只能经「会话命令」到达 Host（`ctx.remote.commands.execute`），
 * 客户端插件不能直接发 HTTP。所以这里注册一条 `/memagent-feedback` 命令，
 * 由客户端卡片调用，Host 侧再按 MCP 协议调记忆库的 `feedback` 工具。
 *
 * 令牌不落配置：每次执行现读引导指针（%APPDATA%/MultiAgent Memory/data-root.json）→
 * `<root>/keys/mcp-token.txt`（回落 `<root>/mcp-token.txt`），所以令牌轮换、数据根搬家都不用改这里。
 * 端点固定 127.0.0.1:8204（桌面端自己起的 MCP 服务），不做远端配置。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENDPOINT = 'http://127.0.0.1:8204/mcp';
/** 显式身份头：审计里 detail.client 就是它（与 MCP 客户端配置里的值一致） */
const CLIENT_ID = 'deepseek-harness';
const COMMAND_NAME = 'memagent-feedback';

/** 引导指针固定位置（按设计永不搬动）；数据根搬家只改指针内容 */
function pointerPath() {
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  return join(appData, 'MultiAgent Memory', 'data-root.json');
}

/** 读指针拿数据根；失败返回原因，不猜路径 */
function readDataRoot() {
  const path = pointerPath();
  if (!existsSync(path)) return { ok: false, error: `未找到数据根指针：${path}` };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed.root !== 'string' || parsed.root.trim() === '') {
      return { ok: false, error: '数据根指针里没有 root 字段' };
    }
    return { ok: true, root: parsed.root };
  } catch (error) {
    return { ok: false, error: `数据根指针无法解析：${String((error && error.message) || error)}` };
  }
}

/** 现读令牌（keys/ 是现行归类位置，根目录是历史兼容位置） */
function readToken(root) {
  for (const path of [join(root, 'keys', 'mcp-token.txt'), join(root, 'mcp-token.txt')]) {
    if (!existsSync(path)) continue;
    const token = readFileSync(path, 'utf8').trim();
    if (token) return token;
  }
  return null;
}

/** 从 MCP 响应里取出 JSON-RPC 结果：兼容纯 JSON 与 SSE（text/event-stream）两种返回 */
function parseRpcBody(text, contentType) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (String(contentType || '').includes('text/event-stream')) {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try { return JSON.parse(payload); } catch { /* 继续找下一条 data */ }
    }
    return null;
  }
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * 调记忆库的 feedback 工具。
 * 不带 Mcp-Session-Id：服务端对「无会话头」的调用不做会话门禁（这是它既有的宽容口径），
 * 身份靠显式 X-Memagent-Client 头，审计里可证。
 */
async function callFeedback(token, args) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'feedback', arguments: args },
  };
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'x-memagent-client': CLIENT_ID,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, error: `连不上记忆库（8204）：${String((error && error.message) || error)}` };
  }
  if (response.status === 401) return { ok: false, error: '令牌无效或已轮换（401），请在应用安全页重新解锁后重试' };
  const text = await response.text();
  const rpc = parseRpcBody(text, response.headers.get('content-type'));
  if (!response.ok) return { ok: false, error: `记忆库返回 HTTP ${response.status}` };
  if (!rpc) return { ok: false, error: '记忆库返回无法解析的响应' };
  if (rpc.error) return { ok: false, error: String(rpc.error.message || 'MCP 调用失败') };
  const content = rpc.result && Array.isArray(rpc.result.content) ? rpc.result.content : [];
  const first = content.find((item) => item && typeof item.text === 'string');
  const payload = (() => {
    if (!first) return null;
    try { return JSON.parse(first.text); } catch { return null; }
  })();
  if (rpc.result && rpc.result.isError) {
    return { ok: false, error: (payload && payload.error) || '记忆库拒绝了这次反馈' };
  }
  if (payload && payload.ok === false) return { ok: false, error: payload.error || '记忆库拒绝了这次反馈' };
  return { ok: true, value: payload };
}

/** `rawInput` = "3 useful mem_xxx req_xxx"（verdict 也接受 confirm / reject） */
function parseArgs(rawInput) {
  const parts = String(rawInput || '').trim().split(/\s+/).filter(Boolean);
  const [orderRaw, verdictRaw, memId, requestId] = parts;
  const order = Number.parseInt(orderRaw, 10);
  if (!Number.isSafeInteger(order) || order < 1) return { ok: false, error: '用法：/memagent-feedback <第几条> <useful|useless> <mem_id> [request_id]' };
  const verdict = /^(useful|confirm|up|yes)$/i.test(verdictRaw || '')
    ? 'confirm'
    : /^(useless|reject|down|no)$/i.test(verdictRaw || '')
      ? 'reject'
      : null;
  if (!verdict) return { ok: false, error: `无法识别的评价「${verdictRaw || ''}」，只接受 useful / useless` };
  if (!memId || memId === '-' || !/^[A-Za-z0-9_:.-]+$/.test(memId)) {
    return { ok: false, error: '缺少合法的 mem_id（卡片命中的 mem_id 字段）' };
  }
  return { ok: true, order, verdict, memId, requestId: requestId && requestId !== '-' ? requestId : undefined };
}

export function apply(ctx) {
  ctx.commands.register({
    name: COMMAND_NAME,
    description: '为本次召回的第 N 条命中记录「有用 / 没用」（MultiAgent Memory）',
    input: { hint: '<第几条> <useful|useless> <mem_id> [request_id]' },
    recordInput: false,
    handler: async ({ rawInput }) => {
      const parsed = parseArgs(rawInput);
      if (!parsed.ok) return { kind: 'error', text: parsed.error };
      const root = readDataRoot();
      if (!root.ok) return { kind: 'error', text: root.error };
      const token = readToken(root.root);
      if (!token) return { kind: 'error', text: `未找到 mcp-token.txt（已查 ${root.root}\\keys 与根目录）` };
      const args = {
        mem_id: parsed.memId,
        verdict: parsed.verdict,
        ...(parsed.requestId ? { recall_id: parsed.requestId } : {}),
      };
      const result = await callFeedback(token, args);
      if (!result.ok) return { kind: 'error', text: result.error };
      const label = parsed.verdict === 'confirm' ? '有用' : '没用';
      return { kind: 'success', text: `已记录：第 ${parsed.order} 条标记${label}` };
    },
  });
}
