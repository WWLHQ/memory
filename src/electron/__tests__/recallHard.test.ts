// 批次62 · A/B/C 主进程控制器单测（A 宿主钩子真值 / C 门禁运行时求值 / 配置落盘）。
// 不测 B 的真实端口转发（会依赖网络与端口占用），B 的纯函数改写规则在 recallPrelude / recallGateway 侧覆盖。
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifiedPath, DATA_SUBDIRS } from '../../shared/dataLayout.ts';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  RECALL_HARD_HOOK_TAG, RecallHardController, findInstalledHookPath, hostHookInstalled, mergeHostHooks,
  readHookRunState, HOOK_STATUS_FILE,
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

  test('findInstalledHookPath：路径含空格也完整取出（2026-11-16 误报根因）', () => {
    // 真实值就长这样：%APPDATA% 是 C:\Users\LHQ\AppData\Roaming\MultiAgent Memory
    const host = {
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: 'node "C:/Users/LHQ/AppData/Roaming/MultiAgent Memory/recall-hard/force_recall.mjs"', timeout: 5 }],
        }],
      },
    };
    expect(findInstalledHookPath(host))
      .toBe('C:/Users/LHQ/AppData/Roaming/MultiAgent Memory/recall-hard/force_recall.mjs');
    // 反斜杠写法同样要完整（不能只剩 Memory\...）
    const win = {
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ command: 'node "C:\\Users\\LHQ\\AppData\\Roaming\\MultiAgent Memory\\recall-hard\\force_recall.mjs"' }],
        }],
      },
    };
    expect(findInstalledHookPath(win))
      .toBe('C:/Users/LHQ/AppData/Roaming/MultiAgent Memory/recall-hard/force_recall.mjs');
  });

  test('findInstalledHookPath：无引号 / 无路径 / 无钩子三种边界', () => {
    expect(findInstalledHookPath({ hooks: { UserPromptSubmit: [{ hooks: [{ command: 'node D:/x/force_recall.mjs' }] }] } }))
      .toBe('D:/x/force_recall.mjs');
    expect(findInstalledHookPath({ hooks: { UserPromptSubmit: [{ hooks: [{ command: 'node x.mjs' }] }] } })).toBeNull();
    expect(findInstalledHookPath({})).toBeNull();
    expect(findInstalledHookPath(null)).toBeNull();
  });
});

describe('失败锁 · 钩子执行状态读取', () => {
  let dir = '';
  const savedStatus = process.env.MEMAGENT_HOOK_STATUS_FILE;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rh-status-'));
    for (const sub of Object.values(DATA_SUBDIRS)) await mkdir(join(dir, sub), { recursive: true });
    delete process.env.MEMAGENT_HOOK_STATUS_FILE; // 用 dataDir 默认路径
  });
  afterEach(async () => {
    if (savedStatus === undefined) delete process.env.MEMAGENT_HOOK_STATUS_FILE;
    else process.env.MEMAGENT_HOOK_STATUS_FILE = savedStatus;
    await rm(dir, { recursive: true, force: true });
  });

  test('无状态文件 → null（UI 据此不显示角标，不猜）', async () => {
    expect(await readHookRunState(dir)).toBeNull();
  });

  test('读到成功状态：ok + hits', async () => {
    await writeFile(classifiedPath(dir, HOOK_STATUS_FILE), JSON.stringify({ schema: 1, status: 'ok', at: '2026-01-01T00:00:00.000Z', hits: 3 }) + '\n', 'utf8');
    const st = await readHookRunState(dir);
    expect(st?.status).toBe('ok');
    expect(st?.hits).toBe(3);
  });

  test('读到失败状态：failed + reason，供 UI 显示人话', async () => {
    await writeFile(classifiedPath(dir, HOOK_STATUS_FILE), JSON.stringify({ schema: 1, status: 'failed', at: '2026-01-01T00:00:00.000Z', hits: 0, reason: 'rpc_error' }) + '\n', 'utf8');
    const st = await readHookRunState(dir);
    expect(st?.status).toBe('failed');
    expect(st?.reason).toBe('rpc_error');
  });

  test('坏文件 → null，不抛错', async () => {
    await writeFile(classifiedPath(dir, HOOK_STATUS_FILE), 'not json', 'utf8');
    expect(await readHookRunState(dir)).toBeNull();
  });

  test('state().a.lastRun 暴露真值', async () => {
    await writeFile(classifiedPath(dir, HOOK_STATUS_FILE), JSON.stringify({ schema: 1, status: 'empty', at: '2026-01-01T00:00:00.000Z', hits: 0 }) + '\n', 'utf8');
    const c = new RecallHardController({ dataDir: dir, hookScript: join(dir, 'hook.mjs'), hostSettingsPath: join(dir, 'settings.json'), log: () => undefined });
    expect((await c.state()).a.lastRun?.status).toBe('empty');
  });
});

describe('批次62 · RecallHardController', () => {
  let dir = '';
  let hostPath = '';
  let hookScript = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rh-'));
    for (const sub of Object.values(DATA_SUBDIRS)) await mkdir(join(dir, sub), { recursive: true });
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

  test('init：A 已装但宿主钩子指向旧路径 → 重写为当前 hookScript（A3 修复）', async () => {
    // 模拟开发态遗留：settings 里指向一个已不存在的旧路径
    const oldPath = join(dir, 'old-force_recall.mjs');
    await writeFile(hostPath, JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node "${oldPath}"`, timeout: 5 }] }] },
    }), 'utf8');
    const c = make();
    await c.init();
    const after = JSON.parse(await readFile(hostPath, 'utf8')) as Record<string, unknown>;
    const installedPath = findInstalledHookPath(after);
    expect(installedPath).not.toBeNull();
    expect(installedPath!.replace(/\\/g, '/').toLowerCase()).toBe(hookScript.replace(/\\/g, '/').toLowerCase());
    // 同时暴露在 state，供卡片显示实际指向路径
    const st = await c.state();
    expect(st.a.installed).toBe(true);
    expect(st.a.installedPath).not.toBeNull();
    expect(st.a.needsRestart).toBe(true); // 配置被改写了，需重启宿主
  });

  test('init：A 已装且路径已正确 → 不重写（保留外部改动，也不标需重启）', async () => {
    await writeFile(hostPath, JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node "${hookScript}"`, timeout: 5 }] }] },
    }), 'utf8');
    const c = make();
    await c.init();
    const st = await c.state();
    expect(st.a.installed).toBe(true);
    expect(st.a.needsRestart).toBe(false);
    expect(st.a.overwritten).toBe(false);
  });

  test('写入后被宿主回写覆盖 → overwritten=true，且话术指向「先退出宿主」而不是「再点保存」', async () => {
    // 模拟 2026-11-16 实测事故：我们写对了路径，宿主用它内存里的旧配置盖回去
    await writeFile(hostPath, JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "D:/old/app.asar/force_recall.mjs"', timeout: 5 }] }] },
    }), 'utf8');
    const c = make();
    await c.init(); // 会把路径重写成 hookScript（rewrote=true → aTouchedSinceBoot）
    const fixed = JSON.parse(await readFile(hostPath, 'utf8')) as Record<string, unknown>;
    expect(findInstalledHookPath(fixed)?.replace(/\\/g, '/').toLowerCase())
      .toBe(hookScript.replace(/\\/g, '/').toLowerCase());

    // 宿主回写覆盖：文件又变回旧路径
    await writeFile(hostPath, JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "D:/old/app.asar/force_recall.mjs"', timeout: 5 }] }] },
    }), 'utf8');

    const st = await c.state();
    expect(st.a.overwritten).toBe(true);
    expect(st.a.installedPath).toContain('app.asar');
    expect(st.a.note).toContain('又被宿主改回去了');
    expect(st.a.note).toContain('退出宿主');
    expect(st.a.note).not.toContain('保存或重启后会自动修正'); // 已经保存过了，这句会误导
  });

  test('本次没写过（路径本就正确）→ 文件被外部改掉也只报不符，不诬告成「被覆盖」', async () => {
    await writeFile(hostPath, JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node "${hookScript}"`, timeout: 5 }] }] },
    }), 'utf8');
    const c = make();
    await c.init(); // 路径已正确 → rewrote=false → aTouchedSinceBoot 保持 false
    await writeFile(hostPath, JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "D:/other/force_recall.mjs"', timeout: 5 }] }] },
    }), 'utf8');

    const st = await c.state();
    expect(st.a.overwritten).toBe(false);
    expect(st.a.note).toContain('宿主钩子指向路径与当前不符');
  });

  test('钩子脚本在含空格目录里（真实 %APPDATA%\\MultiAgent Memory 场景）→ 写对就是写对，不许误报被覆盖', async () => {
    const spaced = join(dir, 'MultiAgent Memory');
    await mkdir(join(spaced, 'recall-hard'), { recursive: true });
    const script = join(spaced, 'recall-hard', 'force_recall.mjs');
    await writeFile(script, '// hook\n', 'utf8');

    const c = new RecallHardController({ dataDir: dir, hookScript: script, hostSettingsPath: hostPath, log: () => undefined });
    await c.init(); // a_hook 默认 true → 写入宿主配置
    const st = await c.state();

    expect(st.a.installed).toBe(true);
    // 关键：解析出来的必须和写进去的逐字一致（旧正则会把前半段含空格的部分吃掉）
    expect(st.a.installedPath).toBe(script.replace(/\\/g, '/'));
    expect(st.a.overwritten).toBe(false);
    expect(st.a.note).not.toContain('不符');
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
    const cfg = JSON.parse(await readFile(classifiedPath(dir, 'recall-hard-config.json'), 'utf8')) as Record<string, unknown>;
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
