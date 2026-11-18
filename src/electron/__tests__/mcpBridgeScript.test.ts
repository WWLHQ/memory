// stdio 桥接脚本端到端单测（2026-11-18）。
// 这一组测的不是「字符串里有没有那几个字」，而是**真的把脚本跑起来**：
//  ① 起一个假 MCP 端点，记录收到的 Authorization / X-Memagent-Client；
//  ② 用子进程跑 mcp-bridge.cjs，从 stdin 灌一条 tools/list，从 stdout 读回一行 JSON；
//  ③ **就地轮换令牌文件内容**，再跑一次 —— 断言第二次请求用的是新令牌。
// 第 ③ 步是整件事的目的（「轮换零维护」）：配置一个字都没改，令牌换了；配置里也确实没有令牌。
import { afterEach, describe, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MCP_BRIDGE_FILE_NAME, MCP_BRIDGE_SCRIPT, ensureMcpBridgeScript } from '../mcpBridgeScript.ts';

const temps: string[] = [];
const servers: Server[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'mam-bridge-'));
  temps.push(d);
  return d;
}

afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 假 MCP 端点：记录每次请求的认证与身份头，按 handler 回包 */
async function fakeEndpoint(
  handler: (headers: Record<string, unknown>) => { status: number; body: string },
): Promise<{ endpoint: string; seen: Array<{ auth?: string; client?: string }> }> {
  const seen: Array<{ auth?: string; client?: string }> = [];
  const server = createServer((req, res) => {
    seen.push({
      auth: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      client: typeof req.headers['x-memagent-client'] === 'string'
        ? String(req.headers['x-memagent-client']) : undefined,
    });
    // 丢掉请求体，避免 socket 挂着
    req.on('data', () => { /* drain */ });
    req.on('end', () => {
      const r = handler(req.headers as Record<string, unknown>);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(r.body);
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { endpoint: `http://127.0.0.1:${port}/mcp`, seen };
}

/** 跑一次桥接脚本：灌一条 JSON-RPC，取 stdout 的第一行 JSON */
function runBridge(
  bridge: string, pointer: string, endpoint: string, client: string,
  msg: Record<string, unknown> = { jsonrpc: '2.0', id: 1, method: 'tools/list' },
): Promise<{ json: Record<string, unknown>; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridge, pointer, endpoint, client], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let errText = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`桥接脚本超时未回包；stderr=${errText}`));
    }, 10_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (s: string) => {
      out += s;
      if (settled || !out.includes('\n')) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      try {
        resolve({ json: JSON.parse(out.split('\n')[0]) as Record<string, unknown>, stderr: errText });
      } catch (e) {
        reject(new Error(`stdout 第一行不是 JSON：${out}；${String(e)}`));
      }
    });
    child.stderr.on('data', (s: string) => { errText += s; });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  });
}

/** 搭一套临时「引导指针 + 数据根 + 桥接脚本」 */
function scaffold(token = 'token-alpha') {
  const dir = tempDir();
  const appDataDir = join(dir, 'MultiAgent Memory');
  const root = join(dir, 'D-drive-root');
  mkdirSync(join(root, 'keys'), { recursive: true });
  writeFileSync(join(root, 'keys', 'mcp-token.txt'), `${token}\n`, 'utf8');
  const pointer = join(appDataDir, 'data-root.json');
  mkdirSync(appDataDir, { recursive: true });
  writeFileSync(pointer, JSON.stringify({ version: 1, root, updatedAt: '2026-11-18T00:00:00.000Z' }), 'utf8');
  const bridge = ensureMcpBridgeScript(appDataDir);
  return { dir, appDataDir, root, pointer, bridge };
}

describe('ensureMcpBridgeScript', () => {
  test('写到指定目录（内容相同不重写）；脚本里不含任何令牌或数据根硬路径', () => {
    const dir = tempDir();
    const file = ensureMcpBridgeScript(dir);
    expect(file).toBe(join(dir, MCP_BRIDGE_FILE_NAME));
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(MCP_BRIDGE_SCRIPT);

    // 内容一致时不动 mtime：重复「一键接入」不该反复改盘
    const before = readFileSync(file, 'utf8');
    writeFileSync(file, before, 'utf8');
    expect(ensureMcpBridgeScript(dir)).toBe(file);
    expect(readFileSync(file, 'utf8')).toBe(before);

    // 柔性路径铁律：脚本不得写死数据根或令牌
    expect(before).not.toMatch(/MultiAgent Memory/i);
    expect(before).not.toMatch(/[0-9a-f]{64}/);
    expect(before).toContain('keys');
    expect(before).toContain('mcp-token.txt');
  });
});

describe('mcp-bridge.cjs 真跑（现读令牌 → 轮换零维护）', () => {
  test('按指针定位数据根 → keys/mcp-token.txt；身份头带客户端 id；轮换令牌文件后无需改配置', async () => {
    const fake = await fakeEndpoint(() => ({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{}, {}] } }) }));
    const s = scaffold('token-alpha');

    const first = await runBridge(s.bridge, s.pointer, fake.endpoint, 'workbuddy');
    expect((first.json.result as { tools: unknown[] }).tools).toHaveLength(2);
    expect(fake.seen[0].auth).toBe('Bearer token-alpha');
    expect(fake.seen[0].client).toBe('workbuddy');

    // 就地轮换：只改令牌文件，脚本与「客户端配置」一个字都不动
    writeFileSync(join(s.root, 'keys', 'mcp-token.txt'), 'token-beta\n', 'utf8');
    const second = await runBridge(s.bridge, s.pointer, fake.endpoint, 'workbuddy');
    expect((second.json.result as { tools: unknown[] }).tools).toHaveLength(2);
    expect(fake.seen[1].auth).toBe('Bearer token-beta');
  });

  test('老平铺布局回落：<root>/mcp-token.txt 也能读到（迁库过渡期不至于全断）', async () => {
    const fake = await fakeEndpoint(() => ({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{}] } }) }));
    const s = scaffold('removed-anyway');
    rmSync(join(s.root, 'keys', 'mcp-token.txt'));
    writeFileSync(join(s.root, 'mcp-token.txt'), 'flat-token\n', 'utf8');
    await runBridge(s.bridge, s.pointer, fake.endpoint, 'codex');
    expect(fake.seen[0].auth).toBe('Bearer flat-token');
  });

  test('401 → 回一条 JSON-RPC error（不卡死客户端、不把失败伪装成成功）', async () => {
    const fake = await fakeEndpoint(() => ({
      status: 401, body: JSON.stringify({ error: { message: 'unauthorized: 令牌无效' } }),
    }));
    const s = scaffold();
    const r = await runBridge(s.bridge, s.pointer, fake.endpoint, 'cursor');
    const err = r.json.error as { message: string };
    expect(err.message).toContain('401');
    expect(err.message).toContain('mcp-token.txt'); // 告诉用户去哪儿看令牌，而不是只说「失败」
    expect(r.json.result).toBeUndefined();
  });

  test('端点连不上 → JSON-RPC error 里点名「桌面端是否在运行」', async () => {
    const s = scaffold();
    // 端口 1 基本不会有人监听 → 连接被拒
    const r = await runBridge(s.bridge, s.pointer, 'http://127.0.0.1:1/mcp', 'cursor');
    const err = r.json.error as { message: string };
    expect(err.message).toContain('连不上本机 MCP 端点');
    expect(err.message).toContain('桌面端');
  });

  test('SSE（data: {...}）响应也能解析成一条 JSON 回给客户端', async () => {
    const fake = await fakeEndpoint(() => ({
      status: 200,
      body: `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{}, {}, {}] } })}\n\n`,
    }));
    const s = scaffold();
    const r = await runBridge(s.bridge, s.pointer, fake.endpoint, 'gemini-cli');
    expect((r.json.result as { tools: unknown[] }).tools).toHaveLength(3);
  });
});
