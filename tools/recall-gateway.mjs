#!/usr/bin/env node
// B 方案：本地 LLM Gateway（OpenAI-compatible 反向代理），把召回记忆**真正拼进 system prompt 最前面**。
//
// 链路：客户端 → 本网关 → [强制召回 8204 MCP] → 改写 messages（system 置顶注入） → 上游 LLM。
// 与 A 的区别：A 由宿主塞 additionalContext（位置不可控）；B 由代理直接改写请求里的 system 消息，
// 对任何 OpenAI-compatible 客户端都生效，不依赖宿主是否支持 hooks。
//
// 启动：
//   MEMAGENT_GW_UPSTREAM=https://api.example.com node tools/recall-gateway.mjs
//   然后把客户端 base_url 指到 http://127.0.0.1:8300/v1
// 环境变量：
//   MEMAGENT_GW_UPSTREAM  上游根地址（必填，含 scheme；只走 http/https）
//   MEMAGENT_GW_PORT      监听端口（默认 8300，只绑 127.0.0.1）
//   MEMAGENT_MCP_URL      MCP 端点（默认 http://127.0.0.1:8204/mcp）
//   MEMAGENT_MCP_TOKEN_FILE  令牌文件（缺省同 A 的 %APPDATA%/MultiAgent Memory/mcp-token.txt）
//   MEMAGENT_GW_TIMEOUT   召回超时毫秒（默认 2500）
//
// 安全：令牌只发 loopback；客户端自己的上游 Authorization 原样透传但绝不打印/落盘；
//       prompt 正文不写日志；MCP 故障时 fail-open 原样转发，绝不阻断对话；流式响应直接 pipe 不缓冲。
// 自检：node tools/recall-gateway.mjs --self-test（起本地 mock 上游 + mock MCP，不碰真实服务）
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  RECALL_PRELUDE_OPEN, MAX_QUERY_CHARS, parseMcpRpcBody, extractRecallHits,
  buildRecallPrelude, lastUserQuery, injectSystemPrelude,
} from '../src/core/memagent/recallPrelude.ts';

const DEFAULT_MCP_URL = 'http://127.0.0.1:8204/mcp';
const RECALL_TIMEOUT_MS = 2500;
const CHAT_PATH_RE = /^\/(?:v1\/)?chat\/completions\/?$/;

function tokenFile() {
  if (process.env.MEMAGENT_MCP_TOKEN_FILE) return process.env.MEMAGENT_MCP_TOKEN_FILE;
  const appdata = process.env.APPDATA || process.env.LOCALAPPDATA;
  if (appdata) return `${appdata}/MultiAgent Memory/mcp-token.txt`;
  return `${homedir()}/.config/multiagent-memory/mcp-token.txt`;
}

function isLoopback(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch { return false; }
}

async function rpc(url, token, body, sid) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${token}`,
    'x-memagent-client': 'recall-gateway',
  };
  if (sid) headers['Mcp-Session-Id'] = sid;
  const res = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(RECALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`mcp http ${res.status}`);
  return {
    sid: res.headers.get('Mcp-Session-Id') || res.headers.get('mcp-session-id') || '',
    raw: await res.text(),
  };
}

/** 召回 → 生成 prelude；任何失败返回 null（fail-open），绝不抛到转发主链路。 */
export async function fetchPrelude(query, cfg = {}) {
  try {
    const q = (query || '').trim().slice(0, MAX_QUERY_CHARS);
    if (!q) return null;
    const url = cfg.mcpUrl || process.env.MEMAGENT_MCP_URL || DEFAULT_MCP_URL;
    if (!isLoopback(url)) return null;
    const token = cfg.token ?? (await readFile(tokenFile(), 'utf8')).trim();
    if (!token) return null;
    const init = await rpc(url, token, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-06-18', capabilities: {},
        clientInfo: { name: 'recall-gateway', version: '1.0' },
      },
    });
    const recall = await rpc(url, token, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'recall_memory', arguments: { query: q, top_k: 5, scene: 'task_start' } },
    }, init.sid);
    const parsed = parseMcpRpcBody(recall.raw);
    if (!parsed) return null;
    return buildRecallPrelude(extractRecallHits(parsed));
  } catch (e) {
    process.stderr.write(`[recall-gateway] recall skipped: ${String(e?.message ?? e).slice(0, 120)}\n`);
    return null;
  }
}

/** 纯函数：把 prelude 注入请求体（供单测与 --self-test 复用，不依赖网络）。 */
export function rewriteRequest(body, prelude) {
  if (!prelude || !body || typeof body !== 'object') return { body, injected: false };
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages) return { body, injected: false };
  const next = injectSystemPrelude(messages, prelude);
  const injected = JSON.stringify(next) !== JSON.stringify(messages);
  return { body: { ...body, messages: next }, injected };
}

async function readJson(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return { text, json: text ? JSON.parse(text) : null };
}

function forward(req, res, upstream, bodyText, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(req.url || '/', upstream);
    const client = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const outHeaders = { ...headers };
    delete outHeaders.host;
    delete outHeaders['content-length'];
    delete outHeaders['accept-encoding']; // 让上游返回未压缩流，避免透传时解压
    if (bodyText !== undefined) outHeaders['content-length'] = Buffer.byteLength(bodyText);
    const proxy = client(u, { method: req.method, headers: outHeaders }, (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res); // 流式原样透传（SSE 不缓冲、不改写）
      upRes.on('end', resolve);
    });
    proxy.on('error', reject);
    proxy.setTimeout(120000, () => proxy.destroy(new Error('upstream timeout')));
    if (bodyText !== undefined) proxy.write(bodyText);
    proxy.end();
  });
}

async function handle(req, res) {
  const upstream = process.env.MEMAGENT_GW_UPSTREAM;
  if (!upstream) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'MEMAGENT_GW_UPSTREAM 未配置' }));
    return;
  }
  try {
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    const isChat = req.method === 'POST' && CHAT_PATH_RE.test(pathname);
    let bodyText;
    if (isChat) {
      const { text, json } = await readJson(req);
      bodyText = text;
      if (json && Array.isArray(json.messages)) {
        const prelude = await fetchPrelude(lastUserQuery(json.messages));
        const out = rewriteRequest(json, prelude);
        if (out.injected) bodyText = JSON.stringify(out.body);
      }
    } else {
      const { text } = await readJson(req);
      bodyText = text || undefined;
    }
    await forward(req, res, upstream, bodyText, req.headers);
  } catch (e) {
    process.stderr.write(`[recall-gateway] ${String(e?.message ?? e).slice(0, 160)}\n`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'gateway upstream failure' }));
    }
  }
}

async function selfTest() {
  // 端到端：mock MCP（返回两条命中）+ mock 上游（回显收到的 messages）→ 真实网关 → 断言 system 最前面。
  const assert = (ok, label) => { if (!ok) throw new Error(`FAIL ${label}`); };
  let upstreamBody = '';
  // 自检自备临时令牌文件：不依赖本机是否装了桌面端，CI 也能复现。
  const tmp = await mkdtemp(join(tmpdir(), 'mam-gw-selftest-'));
  const fakeToken = join(tmp, 'mcp-token.txt');
  await writeFile(fakeToken, 'selftest-token-not-real', 'utf8');
  process.env.MEMAGENT_MCP_TOKEN_FILE = fakeToken;
  const mcp = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (body.method === 'initialize') res.setHeader('Mcp-Session-Id', 'sid-test');
      const hits = body.method === 'tools/call' ? [{ content: '记忆甲' }, { content: '记忆乙' }] : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { hits } } }));
    });
  });
  const upstream = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      upstreamBody = raw;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => mcp.listen(0, '127.0.0.1', r));
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const mcpUrl = `http://127.0.0.1:${mcp.address().port}/mcp`;
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  process.env.MEMAGENT_GW_UPSTREAM = upstreamUrl;
  process.env.MEMAGENT_MCP_URL = mcpUrl;

  const gw = createServer(handle);
  await new Promise((r) => gw.listen(0, '127.0.0.1', r));
  const gwUrl = `http://127.0.0.1:${gw.address().port}/v1/chat/completions`;

  const original = [
    { role: 'system', content: '你是助手，必须遵守原有规则' },
    { role: 'user', content: '第一句' },
    { role: 'assistant', content: '回复' },
    { role: 'user', content: '最后一句查询' },
  ];
  const resp = await fetch(gwUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer UPSTREAM_KEY' },
    body: JSON.stringify({ model: 'x', messages: original, stream: false }),
  });
  assert(resp.status === 200, '网关转发成功');
  const sent = JSON.parse(upstreamBody);
  assert(sent.messages[0].role === 'system', 'system 仍在最前面');
  assert(String(sent.messages[0].content).startsWith(RECALL_PRELUDE_OPEN), 'prelude 拼在 system 内容最前面');
  assert(String(sent.messages[0].content).includes('记忆甲') && String(sent.messages[0].content).includes('记忆乙'), '命中正文都进去了');
  assert(String(sent.messages[0].content).includes('原有规则'), '原 system 规则不丢');
  assert(sent.messages.length === original.length, '消息条数不变（没有额外追加一条）');
  assert(sent.messages[3].content === '最后一句查询', 'user 消息逐字不变');
  assert(sent.model === 'x' && sent.stream === false, '其它字段逐字保留');
  assert((String(sent.messages[0].content).match(/\[RECALL_PRELUDE_V1\]/g) || []).length === 1, '单轮只注入一次');

  // 故障放行：MCP 死端口 → 原样转发，不加 prelude
  process.env.MEMAGENT_MCP_URL = 'http://127.0.0.1:1/mcp';
  await fetch(gwUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: '只问一句' }] }),
  });
  const failover = JSON.parse(upstreamBody);
  assert(failover.messages.length === 1 && failover.messages[0].content === '只问一句', 'MCP 故障 fail-open 原样转发');
  assert(!JSON.stringify(failover).includes(RECALL_PRELUDE_OPEN), 'fail-open 时没有任何注入');

  gw.close(); mcp.close(); upstream.close();
  await rm(tmp, { recursive: true, force: true });
  console.log('GATEWAY_SELFTEST_OK 11/11');
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else {
  const port = Number(process.env.MEMAGENT_GW_PORT || 8300);
  if (!process.env.MEMAGENT_GW_UPSTREAM) {
    console.error('缺少 MEMAGENT_GW_UPSTREAM（例如 https://api.example.com）');
    process.exit(1);
  }
  createServer(handle).listen(port, '127.0.0.1', () => {
    console.log(`[recall-gateway] 监听 http://127.0.0.1:${port} → ${process.env.MEMAGENT_GW_UPSTREAM}`);
  });
}
