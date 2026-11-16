// 批次62 · A 方案钩子主体（recallHook）单测：fail-open 是硬要求——
// 钩子任何故障都只能回 {continue:true}，绝不能因为召回失败拦住用户提问。
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { hookIsLoopback, hookSelfTest, hookStatusFilePath, runHook } from '../recallHook.ts';
import { parseHookRunState, RECALL_PRELUDE_OPEN, type HookRunState } from '../recallPrelude.ts';

let dir = '';
const saved = {
  url: process.env.MEMAGENT_MCP_URL,
  file: process.env.MEMAGENT_MCP_TOKEN_FILE,
  status: process.env.MEMAGENT_HOOK_STATUS_FILE,
};
const statusPath = (): string => join(dir, 'recall-hook-status.json');
const readStatus = async (): Promise<HookRunState | null> =>
  parseHookRunState(await readFile(statusPath(), 'utf8').catch(() => null));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rhook-'));
  // 死端口 + 有令牌 → 走真实 rpc 失败路径（不是提前 return）
  process.env.MEMAGENT_MCP_URL = 'http://127.0.0.1:1/mcp';
  const tokenFile = join(dir, 'mcp-token.txt');
  await writeFile(tokenFile, 'tok_test\n', 'utf8');
  process.env.MEMAGENT_MCP_TOKEN_FILE = tokenFile;
  process.env.MEMAGENT_HOOK_STATUS_FILE = statusPath();
});

afterEach(async () => {
  if (saved.url === undefined) delete process.env.MEMAGENT_MCP_URL; else process.env.MEMAGENT_MCP_URL = saved.url;
  if (saved.file === undefined) delete process.env.MEMAGENT_MCP_TOKEN_FILE; else process.env.MEMAGENT_MCP_TOKEN_FILE = saved.file;
  if (saved.status === undefined) delete process.env.MEMAGENT_HOOK_STATUS_FILE; else process.env.MEMAGENT_HOOK_STATUS_FILE = saved.status;
  await rm(dir, { recursive: true, force: true });
});

describe('失败锁 · 钩子执行状态落盘', () => {
  test('状态文件路径可由环境变量注入，默认不在 cwd', () => {
    expect(hookStatusFilePath()).toBe(statusPath());
  });

  test('空输入 → 写 failed/empty_input，仍 fail-open', async () => {
    expect(await runHook('')).toEqual({ continue: true });
    const st = await readStatus();
    expect(st?.status).toBe('failed');
    expect(st?.reason).toBe('empty_input');
    expect(st?.hits).toBe(0);
  });

  test('坏 JSON → 写 failed/bad_event', async () => {
    await runHook('not json');
    expect((await readStatus())?.reason).toBe('bad_event');
  });

  test('非 loopback → 写 failed/loopback_guard（令牌不出本机）', async () => {
    process.env.MEMAGENT_MCP_URL = 'http://10.0.0.9:8204/mcp';
    await runHook(JSON.stringify({ prompt: '问问' }));
    const st = await readStatus();
    expect(st?.status).toBe('failed');
    expect(st?.reason).toBe('loopback_guard');
  });

  test('令牌缺失 → 写 failed/token_missing', async () => {
    process.env.MEMAGENT_MCP_TOKEN_FILE = join(dir, 'nope.txt');
    await runHook(JSON.stringify({ prompt: '继续' }));
    expect((await readStatus())?.reason).toBe('token_missing');
  });

  test('MCP 死端口 → 写 failed/rpc_error，绝不抛错也不阻断', async () => {
    expect(await runHook(JSON.stringify({ prompt: '继续实现' }))).toEqual({ continue: true });
    const st = await readStatus();
    expect(st?.status).toBe('failed');
    expect(st?.reason).toBe('rpc_error');
  });

  test('状态文件只记分类，不含 prompt 正文/令牌', async () => {
    const secret = 'SUPER_SECRET_PROMPT_12345';
    await runHook(JSON.stringify({ prompt: secret }));
    const raw = await readFile(statusPath(), 'utf8');
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('tok_test');
  });
});

describe('批次62 · recallHook fail-open', () => {
  test('空输入 → 只回 continue:true', async () => {
    expect(await runHook('')).toEqual({ continue: true });
    expect(await runHook('   ')).toEqual({ continue: true });
  });

  test('非 JSON / 没有 prompt → 只回 continue:true', async () => {
    expect(await runHook('not json')).toEqual({ continue: true });
    expect(await runHook(JSON.stringify({ prompt: '' }))).toEqual({ continue: true });
    expect(await runHook(JSON.stringify({ prompt: '   ' }))).toEqual({ continue: true });
  });

  test('MCP 不可达（死端口）→ fail-open，绝不抛错', async () => {
    const out = await runHook(JSON.stringify({ prompt: '继续上次的实现' }));
    expect(out).toEqual({ continue: true });
  });

  test('非 loopback 地址 → 直接放行（令牌不出本机）', async () => {
    process.env.MEMAGENT_MCP_URL = 'http://10.0.0.9:8204/mcp';
    expect(await runHook(JSON.stringify({ prompt: '随便问问' }))).toEqual({ continue: true });
    expect(hookIsLoopback('http://10.0.0.9:8204/mcp')).toBe(false);
    expect(hookIsLoopback('http://127.0.0.1:8204/mcp')).toBe(true);
    expect(hookIsLoopback('https://127.0.0.1:8204/mcp')).toBe(false); // 只认 http loopback
  });

  test('令牌文件不存在 → 放行（不猜令牌）', async () => {
    process.env.MEMAGENT_MCP_TOKEN_FILE = join(dir, 'nope.txt');
    expect(await runHook(JSON.stringify({ prompt: '继续' }))).toEqual({ continue: true });
  });

  test('自检：契约断言全绿且标签带真实条数', async () => {
    const label = await hookSelfTest();
    expect(label).toMatch(/^SELFTEST_OK \d+\/\d+$/);
    const [, n] = label.match(/^SELFTEST_OK (\d+)\//) ?? [];
    expect(Number(n)).toBeGreaterThanOrEqual(10);
  });

  test('拼装契约：prelude 只带正文标记，不带回显话术', async () => {
    // 直接验常量语义（拼装细节在 recallPrelude.test.ts 里逐条覆盖）
    expect(RECALL_PRELUDE_OPEN).toBe('[RECALL_PRELUDE_V1]');
  });
});
