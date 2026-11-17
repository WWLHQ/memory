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
import { readFile, writeFile, mkdir, appendFile, stat, open } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import {
  MAX_QUERY_CHARS, buildHookOutput, buildRecallPrelude, extractRecallHits, lastUserQuery,
  parseMcpRpcBody, RECALL_PRELUDE_OPEN, RECALL_EMPTY_HINT, injectSystemPrelude,
  buildHookRunState, serializeHookRunState, parseHookRunState, type HookRunState,
} from './recallPrelude.ts';

export const DEFAULT_MCP_URL = 'http://127.0.0.1:8204/mcp';
export const HOOK_TIMEOUT_MS = 2500;
/** 自检通过时打印的标签前缀（回归脚本按它判绿）；条数由实际断言数决定，不写死。 */
export const HOOK_SELFTEST_PREFIX = 'SELFTEST_OK';
/** 钩子执行状态文件：相对数据根，与桌面端共享同一路径（不依赖 cwd）。 */
export const HOOK_STATUS_FILE = 'recall-hook-status.json';
/**
 * 钩子执行**流水账**（第 3 层防复发，2026-11-17 用户明确）。
 *
 * 为什么另开一个文件：`recall-hook-status.json` 是覆盖写，只留最后一次 ——
 * 事后根本回答不了「第几轮没查」，于是每次争论都只能靠模型自述（等于没有证据）。
 * 这里逐轮追加一行；配合 MCP 审计里的 `first_call` / `recalled_before`，
 * 就能把「你觉得我没查」变成「账本里第几轮没查」。
 */
export const HOOK_LOG_FILE = 'recall-hook-log.jsonl';
/** 流水账超过这个大小就裁剪，只留最近 HOOK_LOG_KEEP_LINES 行（防无界增长）。 */
export const HOOK_LOG_MAX_BYTES = 512 * 1024;
export const HOOK_LOG_KEEP_LINES = 2000;

function log(msg: string): void {
  // 只写 stderr：stdout 必须是纯 JSON，且绝不打印令牌、prompt 正文。
  process.stderr.write(`[force_recall] ${msg}\n`);
}

/** 状态文件路径：优先环境变量（测试可注入），否则 %APPDATA%/MultiAgent Memory/。 */
export function hookStatusFilePath(): string {
  if (process.env.MEMAGENT_HOOK_STATUS_FILE) return process.env.MEMAGENT_HOOK_STATUS_FILE;
  const appdata = process.env.APPDATA || process.env.LOCALAPPDATA;
  if (appdata) return join(appdata, 'MultiAgent Memory', HOOK_STATUS_FILE);
  return join(homedir(), '.config', 'multiagent-memory', HOOK_STATUS_FILE);
}

/** 流水账路径：与状态文件同目录，可被 MEMAGENT_HOOK_LOG_FILE 覆盖（测试注入用）。 */
export function hookLogFilePath(): string {
  if (process.env.MEMAGENT_HOOK_LOG_FILE) return process.env.MEMAGENT_HOOK_LOG_FILE;
  // 状态文件被显式指定时（测试 / 多实例），流水账跟着放同目录——
  // 否则单测会写进真实用户目录 %APPDATA%/MultiAgent Memory，污染线上账本。
  if (process.env.MEMAGENT_HOOK_STATUS_FILE) {
    return join(dirname(process.env.MEMAGENT_HOOK_STATUS_FILE), HOOK_LOG_FILE);
  }
  const appdata = process.env.APPDATA || process.env.LOCALAPPDATA;
  if (appdata) return join(appdata, 'MultiAgent Memory', HOOK_LOG_FILE);
  return join(homedir(), '.config', 'multiagent-memory', HOOK_LOG_FILE);
}

/** 追加一行流水账；超过上限时保留最近 N 行。任何失败都只记 stderr，不影响钩子返回。 */
async function appendRunLog(state: HookRunState): Promise<void> {
  try {
    const path = hookLogFilePath();
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, serializeHookRunState(state), 'utf8');
    const info = await stat(path);
    if (info.size <= HOOK_LOG_MAX_BYTES) return;
    const text = await readFile(path, 'utf8');
    const kept = text.split('\n').filter(Boolean).slice(-HOOK_LOG_KEEP_LINES).join('\n');
    await writeFile(path, `${kept}\n`, 'utf8');
  } catch (e) {
    log(`run-log-write-failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }
}

/**
 * 读「钩子账本里最近一轮」的时间戳（ms）；读不到（没装钩子/没有流水账）返回 null。
 *
 * 为什么需要它（第四层·轮级放行，2026-11-17 用户明确）：
 *   MCP 内核原来用 `recalledBySession`（会话级）判「召回过没有」——一次召回就把整个会话
 *   解锁了，之后每一轮都放行，硬拦截形同虚设。改判「轮」才符合真实要求：
 *   每轮用户提问都必须重新召回。而「现在是第几轮」的唯一可靠信号就是钩子账本——
 *   它由 UserPromptSubmit 每轮追加一行，时间戳即本轮起点。
 *
 * 只读文件尾部 8KB：门禁每次工具调用都要问一次，账本可能有几百 KB，不能整读。
 */
export async function readLatestHookRoundAt(): Promise<number | null> {
  try {
    const fh = await open(hookLogFilePath(), 'r');
    try {
      const info = await fh.stat();
      const size = info.size;
      if (size <= 0) return null;
      const take = Math.min(size, 8192);
      const buf = Buffer.alloc(take);
      await fh.read(buf, 0, take, size - take);
      const lines = buf.toString('utf8').split('\n').filter(Boolean);
      const st = parseHookRunState(lines[lines.length - 1] ?? '');
      if (!st) return null;
      const ms = Date.parse(st.at);
      return Number.isFinite(ms) ? ms : null;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/** 读最近 N 轮流水账（新的在后）。读不到返回空数组，不猜、不抛。 */
export async function readHookRunLog(limit = 50): Promise<HookRunState[]> {
  try {
    const text = await readFile(hookLogFilePath(), 'utf8');
    const lines = text.split('\n').filter(Boolean).slice(-Math.max(1, limit));
    return lines
      .map((line) => parseHookRunState(line))
      .filter((s): s is HookRunState => s !== null);
  } catch {
    return [];
  }
}

/**
 * 写一次执行状态；失败只记 stderr，绝不影响钩子返回（fail-open 的延伸）。
 * 结构化 stderr 行以 STATUS 开头，便于日志检索，且不含任何敏感正文。
 * 第 3 层：除覆盖写最新快照外，再**逐轮追加**一条流水账（可事后核验）。
 */
async function recordStatus(state: HookRunState): Promise<void> {
  const line = `STATUS status=${state.status} at=${state.at} hits=${state.hits}${state.reason ? ` reason=${state.reason}` : ''}`;
  log(line);
  try {
    const path = hookStatusFilePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serializeHookRunState(state), 'utf8');
  } catch (e) {
    log(`status-write-failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }
  await appendRunLog(state);
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
  const now = (): string => new Date().toISOString();
  // 每个失败/空分支都 recordStatus —— 这是「失败锁」：钩子跑没跑、成没成，必须留痕，绝不静默。
  try {
    const raw = (text || '').trim();
    if (!raw) {
      await recordStatus(buildHookRunState('failed', now(), 0, 'empty_input'));
      return out;
    }

    let event: { prompt?: unknown };
    try {
      event = JSON.parse(raw) as { prompt?: unknown };
    } catch {
      await recordStatus(buildHookRunState('failed', now(), 0, 'bad_event'));
      return out;
    }
    const prompt = typeof event.prompt === 'string' ? event.prompt.trim() : '';
    if (!prompt) {
      await recordStatus(buildHookRunState('failed', now(), 0, 'bad_event'));
      return out;
    }

    const url = process.env.MEMAGENT_MCP_URL || DEFAULT_MCP_URL;
    if (!hookIsLoopback(url)) {
      await recordStatus(buildHookRunState('failed', now(), 0, 'loopback_guard'));
      return out;
    }

    let token: string;
    try {
      token = (await readFile(tokenFile(), 'utf8')).trim();
    } catch {
      token = '';
    }
    if (!token) {
      await recordStatus(buildHookRunState('failed', now(), 0, 'token_missing'));
      return out;
    }

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
    if (!parsed) {
      await recordStatus(buildHookRunState('failed', now(), 0, 'bad_response'));
      return out;
    }
    const hits = extractRecallHits(parsed);
    const prelude = buildRecallPrelude(hits);
    /**
     * 状态必须按「注入了什么」判，不能按「prelude 是否为 null」判：
     * 第 2 层起零命中也会下发强制重试指令 → prelude 恒非 null，
     * 若仍写 `prelude ? 'ok' : 'empty'` 会把零命中误记成成功（等于把漏洞藏起来）。
     * 成功但零命中 = 合法结果（如新项目），记 empty 而非 failed，避免误报故障。
     */
    const hasHits = prelude !== RECALL_EMPTY_HINT;
    await recordStatus(buildHookRunState(hasHits ? 'ok' : 'empty', now(), hasHits ? hits.length : 0));
    return buildHookOutput(prelude);
  } catch (e) {
    log(`skip: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    await recordStatus(buildHookRunState('failed', now(), 0, 'rpc_error'));
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

  // 第 2 层（2026-11-17）：零命中必须下发「强制重试」指令，不能静默放行。
  const zero = buildRecallPrelude([]);
  assert(zero !== null && zero.includes('不同的 query'), '零命中下发强制重试指令');
  assert(zero !== null && zero.includes('已回退现查'), '零命中要求显式声明回退');
  const zeroOut = buildHookOutput(zero);
  const zeroHso = zeroOut.hookSpecificOutput as Record<string, unknown> | undefined;
  assert(typeof zeroHso?.additionalContext === 'string', '零命中指令真的进 additionalContext');

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

  // 失败锁：状态记录的构造/序列化/解析闭环 + 坏数据不猜。
  const st = buildHookRunState('failed', '2026-01-01T00:00:00.000Z', 0, 'rpc_error');
  assert(st.status === 'failed' && st.reason === 'rpc_error' && st.schema === 1, '状态记录带原因分类');
  const round = parseHookRunState(serializeHookRunState(st));
  assert(round?.status === 'failed' && round.reason === 'rpc_error', '状态序列化→解析闭环');
  assert(parseHookRunState('not json') === null && parseHookRunState('{"schema":9}') === null, '坏状态不猜');
  assert(buildHookRunState('ok', 'x').reason === undefined, '成功态不写原因');
  return `${HOOK_SELFTEST_PREFIX} ${passed}/${passed}`;
}
