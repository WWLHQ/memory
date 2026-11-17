// 批次62 · A 方案钩子主体（recallHook）单测：fail-open 是硬要求——
// 钩子任何故障都只能回 {continue:true}，绝不能因为召回失败拦住用户提问。
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { hookIsLoopback, hookLogFilePath, hookSelfTest, hookStatusFilePath, readHookRunLog, readLatestHookRoundAt, runHook } from '../recallHook.ts';
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

  // 第 3 层（2026-11-17）：状态文件是覆盖写 → 事后再也查不到「第几轮没查」。
  // 流水账必须**追加**，否则「你觉得我没查」永远只能靠模型自述。
  test('两次执行 → 流水账追加两行（不是覆盖）', async () => {
    expect(hookLogFilePath()).toBe(join(dir, 'recall-hook-log.jsonl'));
    await runHook('');
    await runHook('');
    const rows = await readHookRunLog(10);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.status === 'failed' && r.reason === 'empty_input')).toBe(true);
    // 最新快照仍然只有一条（覆盖语义不变，UI 读口不受影响）
    expect((await readStatus())?.status).toBe('failed');
  });

  test('readHookRunLog(limit) 只取最近 N 条', async () => {
    await runHook('');
    await runHook('');
    await runHook('');
    expect((await readHookRunLog(1)).length).toBe(1);
  });

  // 第四层（2026-11-17）：轮级门禁靠「账本最近一轮的时间戳」判「本轮召回了吗」。
  // 这个读口必须只读尾部（账本可能几百 KB，每次工具调用都要问），且读不到要如实返回 null。
  describe('readLatestHookRoundAt（轮级判定的唯一时钟）', () => {
    test('没有流水账 → null（不猜、不抛）', async () => {
      expect(await readLatestHookRoundAt()).toBeNull();
    });

    test('取最后一行的 at（不是第一行、不是状态文件）', async () => {
      const early = '2026-01-01T00:00:00.000Z';
      const late = '2026-11-17T12:00:00.000Z';
      await writeFile(
        join(dir, 'recall-hook-log.jsonl'),
        `${JSON.stringify({ schema: 1, status: 'ok', at: early, hits: 3 })}\n`
        + `${JSON.stringify({ schema: 1, status: 'empty', at: late, hits: 0 })}\n`,
        'utf8',
      );
      expect(await readLatestHookRoundAt()).toBe(Date.parse(late));
    });

    test('坏行 / 坏时间戳 → null（宁可退回会话级，也不猜一个时间出来）', async () => {
      await writeFile(join(dir, 'recall-hook-log.jsonl'), 'not json\n', 'utf8');
      expect(await readLatestHookRoundAt()).toBeNull();
      await writeFile(join(dir, 'recall-hook-log.jsonl'), `${JSON.stringify({ schema: 1, status: 'ok', at: 'x', hits: 1 })}\n`, 'utf8');
      expect(await readLatestHookRoundAt()).toBeNull();
    });
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

// 第 2 层（2026-11-17）：这一条是「不查记忆库」反复复发的根因回归——
// 以前零命中 = 什么都不注入，钩子明明查过，模型上下文里却一个字都没有。
describe('第 2 层 · 零命中端到端下发强制重试指令', () => {
  test('MCP 返回零命中 → additionalContext 带指令，状态记 empty 而非 ok', async () => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}') as { id?: number; method?: string };
        res.setHeader('Content-Type', 'application/json');
        if (parsed.method === 'initialize') {
          res.setHeader('Mcp-Session-Id', 'sid_test');
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { protocolVersion: '2025-06-18' } }));
          return;
        }
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { structuredContent: { hits: [] } } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    process.env.MEMAGENT_MCP_URL = `http://127.0.0.1:${port}/mcp`;
    try {
      const out = await runHook(JSON.stringify({ prompt: '本次为什么不查记忆库' }));
      const hso = out.hookSpecificOutput as Record<string, unknown> | undefined;
      const ctx = String(hso?.additionalContext ?? '');
      expect(ctx).toContain('不同的 query');
      expect(ctx).toContain('已回退现查');
      // 关键：不能因为「下发了指令」就把零命中记成成功，否则漏洞又被藏起来
      expect((await readStatus())?.status).toBe('empty');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
