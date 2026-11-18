// stdio 桥接脚本（2026-11-18，用户要求「客户端配置改成 stdio launcher 现读令牌，轮换零维护」）。
// 说明：`dirname` 只出现在下面 **脚本正文** 里（由 node 执行），TS 侧不需要它，别 import。
//
// 为什么需要它：HTTP 接入把 Bearer **抄进**每个客户端配置，令牌一轮换就 7 处全 401（当天实测 6 处已死）。
// 换成 stdio 后客户端配置里**没有令牌**，只有一句 `node <bridge> <指针> <端点> <客户端 id>`。
//
// 路径策略（柔性路径铁律，AGENTS §6）：
//  · 脚本落在**引导指针同目录**（`%APPDATA%\MultiAgent Memory\mcp-bridge.cjs`）。指针按设计永不搬
//    （档1 只搬数据根），因此这条绝对路径跨数据根迁移/重装都稳定 —— 客户端配置一次写好后不用再改。
//  · 令牌与端点都不写死：脚本运行时读指针 `data-root.json` → `<root>/keys/mcp-token.txt`
//    （回落老布局 `<root>/mcp-token.txt` 与指针目录本身）。数据根搬家、令牌轮换，配置零改动。
//
// 铁律：stdout 只出 JSON（客户端按行解析协议），诊断一律走 stderr。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_BRIDGE_FILE_NAME } from '../agentOnboard/mcpClients.ts';

export { MCP_BRIDGE_FILE_NAME };

/**
 * 自包含 CJS 桥接脚本正文。约束：
 *  · **stdout 只允许 JSON**（客户端按 NDJSON 协议解析，多一个字符就废）；
 *  · 所有诊断走 stderr；
 *  · 令牌每次调用现读文件（先读指针定位数据根），读不到就回一条 JSON-RPC error（不让客户端卡死）；
 *  · 不改写 id/method/params，原样转发。
 */
export const MCP_BRIDGE_SCRIPT = String.raw`#!/usr/bin/env node
// MCP stdio ↔ streamable-http 桥（由桌面端生成，勿手改；令牌每次现读）
const { readFileSync } = require('node:fs');
const { join, dirname } = require('node:path');
const http = require('node:http');

const POINTER = process.argv[2] || '';
const ENDPOINT = process.argv[3] || 'http://127.0.0.1:8204/mcp';
const CLIENT = process.argv[4] || 'stdio-bridge';
const log = (m) => process.stderr.write('[mcp-bridge] ' + m + '\n');

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return null; } }

// 令牌现读：指针 → 数据根 → keys/mcp-token.txt（回落老平铺布局与指针目录自身）
function token() {
  const roots = [];
  if (POINTER) {
    const p = readJson(POINTER);
    if (p && typeof p.root === 'string' && p.root) roots.push(p.root);
    roots.push(dirname(POINTER));
  }
  for (const root of roots) {
    for (const rel of [join('keys', 'mcp-token.txt'), 'mcp-token.txt']) {
      try {
        const t = readFileSync(join(root, rel), 'utf8').trim();
        if (t) return t;
      } catch (e) { /* 换下一个候选 */ }
    }
  }
  log('读不到令牌：指针 ' + POINTER + ' 不可用，或数据根里缺少 keys/mcp-token.txt');
  return '';
}

function post(payload) {
  return new Promise((resolve) => {
    const url = new URL(ENDPOINT);
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(body),
        Authorization: 'Bearer ' + token(),
        'X-Memagent-Client': CLIENT,
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, text: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, text: String((e && e.code) || e.message) }));
    req.write(body);
    req.end();
  });
}
function emitJson(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function sseToJson(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^data:\s*(\{.*)$/.exec(line.trim());
    if (m) { try { out.push(JSON.parse(m[1])); } catch (e) { /* 跳过坏行 */ } }
  }
  return out;
}

async function handle(msg) {
  const r = await post(msg);
  if (r.status === 200) {
    const direct = (() => { try { return [JSON.parse(r.text.trim())]; } catch (e) { return null; } })();
    const list = direct || sseToJson(r.text);
    if (list.length === 0) { emitJson({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: '空响应（端点未返回 JSON）' } }); return; }
    for (const one of list) emitJson(one);
    return;
  }
  const why = r.status === 401 ? '令牌无效（401）——请确认桌面端已启动，且数据根 keys/mcp-token.txt 是最新令牌'
    : r.status === 0 ? '连不上本机 MCP 端点（' + r.text + '）：桌面端是否在运行？'
    : 'HTTP ' + r.status + ': ' + r.text.slice(0, 200);
  log(why);
  emitJson({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: why } });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { log('非 JSON 输入，已忽略'); continue; }
    void handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
`;

/**
 * 把桥接脚本写到 `<dir>/mcp-bridge.cjs`（内容不同才写，返回绝对路径）。
 * `dir` 必须是**引导指针所在目录**（稳定、不随数据根迁移），不要传数据根。
 */
export function ensureMcpBridgeScript(dir: string): string {
  const file = join(dir, MCP_BRIDGE_FILE_NAME);
  mkdirSync(dir, { recursive: true });
  const needWrite = !existsSync(file) || readFileSync(file, 'utf8') !== MCP_BRIDGE_SCRIPT;
  if (needWrite) writeFileSync(file, MCP_BRIDGE_SCRIPT, 'utf8');
  return file;
}
