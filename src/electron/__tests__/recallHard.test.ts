// 批次62 · A/B/C 主进程控制器单测（A 宿主钩子真值 / C 门禁运行时求值 / 配置落盘）。
// 不测 B 的真实端口转发（会依赖网络与端口占用），B 的纯函数改写规则在 recallPrelude / recallGateway 侧覆盖。
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  RECALL_HARD_HOOK_TAG, RecallHardController, hostHookInstalled, mergeHostHooks,
} from '../recallHard.ts';

describe('批次62 · A 宿主钩子合并规则（纯函数）', () => {
  test('空配置 → 只多一个 UserPromptSubmit 条目', () => {
    const out = mergeHostHooks({}, true, 'node "D:/repo/.codebuddy/hooks/force_recall.mjs"');
    const ups = (out.hooks as Record<string, unknown[]>).UserPromptSubmit;
    expect(ups).toHaveLength(1);
    expect(JSON.stringify(ups[0])).toContain(RECALL_HARD_HOOK_TAG);
  });

  test('已有别的 UserPromptSubmit 钩子 → 保留并追加（不覆盖别人的钩子）', () => {
    const existing = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node other.mjs' }] }] } };
    const out = mergeHostHooks(existing, true, 'node "x/force_recall.mjs"');
    const ups = (out.hooks as Record<string, unknown[]>).UserPromptSubmit;
    expect(ups).toHaveLength(2);
    expect(JSON.stringify(ups[0])).toContain('other.mjs');
    expect(JSON.stringify(ups[1])).toContain(RECALL_HARD_HOOK_TAG);
  });

  test('停用 → 只摘本钩子，别人的与其它顶层键逐字保留', () => {
    const existing = {
      theme: 'dark',
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'node "x/force_recall.mjs"', timeout: 5 }] },
          { hooks: [{ type: 'command', command: 'node keep-me.mjs' }] },
        ],
        PreToolUse: [{ hooks: [{ type: 'command', command: 'node guard.mjs' }] }],
      },
    };
    const out = mergeHostHooks(existing, false, 'node "x/force_recall.mjs"');
    const hooks = out.hooks as Record<string, unknown[]>;
    expect(hooks.UserPromptSubmit).toHaveLength(1);
    expect(JSON.stringify(hooks.UserPromptSubmit)).toContain('keep-me.mjs');
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(out.theme).toBe('dark');
  });

  test('停用后 hooks 为空 → 整个 hooks 键消失（不留空壳）', () => {
    const existing = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "x/force_recall.mjs"' }] }] } };
    const out = mergeHostHooks(existing, false, 'node "x/force_recall.mjs"');
    expect(out.hooks).toBeUndefined();
  });

  test('hostHookInstalled：null / 无钩子 / 有钩子', () => {
    expect(hostHookInstalled(null)).toBe(false);
    expect(hostHookInstalled({})).toBe(false);
    expect(hostHookInstalled({ hooks: { UserPromptSubmit: [{ hooks: [{ command: 'node other.mjs' }] }] } })).toBe(false);
    expect(hostHookInstalled({ hooks: { UserPromptSubmit: [{ hooks: [{ command: 'node "x/force_recall.mjs"' }] }] } })).toBe(true);
  });
});

describe('批次62 · RecallHardController', () => {
  let dir = '';
  let hostPath = '';
  let hookScript = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rh-'));
    hostPath = join(dir, 'settings.json');
    hookScript = join(dir, 'force_recall.mjs');
    await writeFile(hookScript, '// hook\n', 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const make = (over: { hostSettingsPath?: string } = {}) => new RecallHardController({
    dataDir: dir,
    hookScript,
    hostSettingsPath: over.hostSettingsPath ?? hostPath,
    log: () => undefined,
  });

  test('init：意图 a_hook=true 但宿主没钩子 → 真的写进宿主配置', async () => {
    await writeFile(hostPath, JSON.stringify({ theme: 'dark' }), 'utf8');
    const c = make();
    await c.init();
    const after = JSON.parse(await readFile(hostPath, 'utf8')) as Record<string, unknown>;
    expect(hostHookInstalled(after)).toBe(true);
    expect(after.theme).toBe('dark');
    expect((await c.state()).a.installed).toBe(true);
  });

  test('init：意图与真值已一致时不重写宿主文件（不覆盖外部改动）', async () => {
    const c1 = make();
    await c1.init();
    const first = await readFile(hostPath, 'utf8');
    await writeFile(hostPath, JSON.stringify({ ...JSON.parse(first), extra: 1 }, null, 2), 'utf8');
    const c2 = make();
    await c2.init();
    const second = JSON.parse(await readFile(hostPath, 'utf8')) as Record<string, unknown>;
    expect(second.extra).toBe(1); // 外部加进来的键没被启动流程抹掉
  });

  test('apply({a_hook:false}) → 摘钩子 + 落配置 + state 读真值', async () => {
    const c = make();
    await c.init();
    const st = await c.apply({ a_hook: false });
    expect(st.ok).toBe(true);
    expect(st.a.installed).toBe(false);
    expect(st.a.enabled).toBe(false);
    const host = JSON.parse(await readFile(hostPath, 'utf8')) as Record<string, unknown>;
    expect(hostHookInstalled(host)).toBe(false);
    const cfg = JSON.parse(await readFile(join(dir, 'recall-hard-config.json'), 'utf8')) as Record<string, unknown>;
    expect(cfg.a_hook).toBe(false);
  });

  test('钩子脚本不存在：启用 A 被拒绝，且绝不往宿主配置里写死路径', async () => {
    await rm(hookScript);
    const c = new RecallHardController({ dataDir: dir, hookScript, hostSettingsPath: hostPath, log: () => undefined });
    await c.init();
    const st = await c.apply({ a_hook: true });
    expect(st.ok).toBe(false);
    expect(st.error).toContain('钩子脚本不存在');
    expect(st.a.scriptExists).toBe(false);
    // 宿主文件可能不存在（init 也没写）——存在时也绝不能装钩子
    const host = await readFile(hostPath, 'utf8').then((t) => JSON.parse(t) as Record<string, unknown>).catch(() => ({}));
    expect(hostHookInstalled(host)).toBe(false);
  });

  test('C 切换：cStrict() 立即反映新值（服务端每请求求值，无需重启）', async () => {
    const c = make();
    await c.init();
    expect(c.cStrict()).toBe(true);
    const st = await c.apply({ c_strict_gate: false });
    expect(st.c.effective).toBe(false);
    expect(c.cStrict()).toBe(false);
    await c.apply({ c_strict_gate: true });
    expect(c.cStrict()).toBe(true);
  });

  test('B 启用但上游为空 → 拒绝，且不留下半个网关', async () => {
    const c = make();
    await c.init();
    const st = await c.apply({ b_gateway: true, b_upstream: '' });
    expect(st.ok).toBe(false);
    expect(st.error).toContain('上游地址');
    expect(st.b.running).toBe(false);
  });

  test('stop() 幂等：没起过网关时也是空操作', async () => {
    const c = make();
    await c.init();
    await c.stop();
    await c.stop();
    expect((await c.state()).b.running).toBe(false);
  });

  test('宿主配置是坏 JSON → 拒绝改写（不猜、不覆盖用户文件）', async () => {
    await writeFile(hostPath, '{ this is not json', 'utf8');
    const before = await stat(hostPath);
    const c = make();
    await c.init();
    const st = await c.apply({ a_hook: false });
    const after = await stat(hostPath);
    expect(await readFile(hostPath, 'utf8')).toBe('{ this is not json');
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(st.a.installed).toBe(false);
  });
});
