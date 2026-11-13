// 批次62 · A 方案钩子主体（recallHook）单测：fail-open 是硬要求——
// 钩子任何故障都只能回 {continue:true}，绝不能因为召回失败拦住用户提问。
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { hookIsLoopback, hookSelfTest, runHook } from '../recallHook.ts';
import { RECALL_PRELUDE_OPEN } from '../recallPrelude.ts';

let dir = '';
const saved = { url: process.env.MEMAGENT_MCP_URL, file: process.env.MEMAGENT_MCP_TOKEN_FILE };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rhook-'));
  // 死端口 + 有令牌 → 走真实 rpc 失败路径（不是提前 return）
  process.env.MEMAGENT_MCP_URL = 'http://127.0.0.1:1/mcp';
  const tokenFile = join(dir, 'mcp-token.txt');
  await writeFile(tokenFile, 'tok_test\n', 'utf8');
  process.env.MEMAGENT_MCP_TOKEN_FILE = tokenFile;
});

afterEach(async () => {
  if (saved.url === undefined) delete process.env.MEMAGENT_MCP_URL; else process.env.MEMAGENT_MCP_URL = saved.url;
  if (saved.file === undefined) delete process.env.MEMAGENT_MCP_TOKEN_FILE; else process.env.MEMAGENT_MCP_TOKEN_FILE = saved.file;
  await rm(dir, { recursive: true, force: true });
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
