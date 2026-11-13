// 硬前置召回 A 方案 · 钩子主体逻辑（单一真源）。
//
// 为什么单独成文件：开发态由 `.codebuddy/hooks/force_recall.mjs` 动态 import 本模块（Node 22 原生 TS 剥离），
// 打包态由 `tools/build-electron.cjs` 用 esbuild 把 `recallHookCli.ts`（本模块 + CLI 壳）bundle 成
// `dist-electron/recall-hard/force_recall.mjs` 自包含单文件。两条路径共用**同一份**实现，不各写一遍。
//
// 契约（与 src/core/memagent/recallPrelude.ts 一致）：
//   · 只注入 hits[].content 正文，绝不注入 display.markdown / 回显话术 / 统计数字；
//   · 不硬编码令牌，令牌只从本机 mcp-token.txt 读，且只发往 loopback；
//   · MCP 未启动 / 超时 / 令牌缺失 → fail-open（只回 {continue:true}），绝不阻断用户提问。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  MAX_QUERY_CHARS, buildHookOutput, buildRecallPrelude, extractRecallHits, lastUserQuery,
  parseMcpRpcBody, RECALL_PRELUDE_OPEN, injectSystemPrelude,
} from './recallPrelude.ts';

export const DEFAULT_MCP_URL = 'http://127.0.0.1:8204/mcp';
export const HOOK_TIMEOUT_MS = 2500;
/** 自检通过时打印的标签前缀（回归脚本按它判绿）；条数由实际断言数决定，不写死。 */
export const HOOK_SELFTEST_PREFIX = 'SELFTEST_OK';

function log(msg: string): void {
  // 只写 stderr：stdout 必须是纯 JSON，且绝不打印令牌、prompt 正文。
  process.stderr.write(`[force_recall] ${msg}\n`);
}

function tokenFile(): string {
  if (process.env.MEMAGENT_MCP_TOKEN_FILE) return process.env.MEMAGENT_MCP_TOKEN_FILE;
  const appdata = process.env.APPDATA || process.env.LOCALAPPDATA;
  if (appdata) return join(appdata, 'MultiAgent Memory', 'mcp-token.txt');
  return join(homedir(), '.config', 'multiagent-memory', 'mcp-token.txt');
}

/** 令牌只允许发往 loopback：防配置被改成远端地址时把机器级凭据送出去。 */
export function hookIsLoopback(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]');
  } catch {
    return false;
  }
}

async function rpc(url: string, token: string, body: unknown, sid?: string): Promise<{ newSid: string; raw: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${token}`,
    'x-memagent-client': 'codebuddy-recall-hook',
  };
  if (sid) headers['Mcp-Session-Id'] = sid;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const newSid = res.headers.get('Mcp-Session-Id') || res.headers.get('mcp-session-id') || '';
  return { newSid, raw: await res.text() };
}

/**
 * 处理一条 UserPromptSubmit 事件（stdin 原文）→ stdout 契约对象。
 * 任何异常都收敛成 {continue:true}，因为钩子失败绝不能拦住用户提问。
 */
export async function runHook(text: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { continue: true };
  try {
    const raw = (text || '').trim();
    if (!raw) return out;

    const event = JSON.parse(raw) as { prompt?: unknown };
    const prompt = typeof event.prompt === 'string' ? event.prompt.trim() : '';
    if (!prompt) return out;

    const url = process.env.MEMAGENT_MCP_URL || DEFAULT_MCP_URL;
    if (!hookIsLoopback(url)) return out;
    const token = (await readFile(tokenFile(), 'utf8')).trim();
    if (!token) return out;

    const init = await rpc(url, token, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-06-18', capabilities: {},
        clientInfo: { name: 'codebuddy-recall-hook', version: '1.0' },
      },
    });
    const recall = await rpc(url, token, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: {
        name: 'recall_memory',
        arguments: { query: prompt.slice(0, MAX_QUERY_CHARS), top_k: 5, scene: 'task_start' },
      },
    }, init.newSid);

    const parsed = parseMcpRpcBody(recall.raw);
    if (!parsed) return out;
    return buildHookOutput(buildRecallPrelude(extractRecallHits(parsed)));
  } catch (e) {
    log(`skip: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    return out;
  }
}

/** 不依赖 8204 在线的自检：验证拼装契约与 stdout 契约；返回 `SELFTEST_OK n/n`。 */
export async function hookSelfTest(): Promise<string> {
  let passed = 0;
  const assert = (ok: unknown, label: string): void => {
    if (!ok) throw new Error(`FAIL ${label}`);
    passed += 1;
  };

  const empty = buildHookOutput(null);
  assert(empty.continue === true && !empty.hookSpecificOutput, '空命中只放行、不塞空上下文');

  const hits = extractRecallHits({ result: { structuredContent: { hits: [{ content: '记忆A' }, { content: '记忆B' }] } } });
  assert(hits.length === 2, '从 structuredContent 抽 hits');
  const block = buildRecallPrelude(hits);
  assert(block && block.includes('记忆A') && block.includes(RECALL_PRELUDE_OPEN), '拼装命中正文');
  assert(!block?.includes('display.markdown') && !block?.includes('【展示要求】'), '不注入回显话术');
  const out = buildHookOutput(block);
  const hso = out.hookSpecificOutput as Record<string, unknown> | undefined;
  assert(hso?.hookEventName === 'UserPromptSubmit', 'stdout 契约 hookEventName 正确');
  assert(hso?.additionalContext === block, 'additionalContext 命中正文');

  const sse = parseMcpRpcBody('event: message\ndata: {"result":{"structuredContent":{"hits":[]}}}\n\n');
  const sseResult = sse?.result as Record<string, unknown> | undefined;
  const sseSc = sseResult?.structuredContent as Record<string, unknown> | undefined;
  assert(Array.isArray(sseSc?.hits), 'SSE 兼容');
  assert(parseMcpRpcBody('not json') === null, '坏 JSON 返回 null');

  assert(lastUserQuery([{ role: 'system', content: 'sys' }, { role: 'user', content: [{ type: 'text', text: '最后一句' }] }]) === '最后一句', '取最后一条 user 文本');

  const injected = injectSystemPrelude([{ role: 'system', content: '原有规则' }, { role: 'user', content: 'hi' }], block);
  assert(injected[0].role === 'system' && String(injected[0].content).startsWith(RECALL_PRELUDE_OPEN), 'B：prelude 在 system 最前面');
  assert(String(injected[0].content).includes('原有规则'), 'B：原 system 内容不丢');
  const twice = injectSystemPrelude(injected, buildRecallPrelude([{ content: '记忆C' }]));
  assert((String(twice[0].content).match(/\[RECALL_PRELUDE_V1\]/g) || []).length === 1, '幂等：不重复叠加');

  assert(extractRecallHits({ result: { content: [{ text: '{"hits":[]}' }] } }).length === 0, '不猜 content 文本块');
  return `${HOOK_SELFTEST_PREFIX} ${passed}/${passed}`;
}
