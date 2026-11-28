// 宿主钩子自动注入框架单测（2026-11-23 · 原子任务 24a）
// 三闸门：A 影响面（召回钩子单钩子逻辑不受影响）/ B 效果（幂等 upsert、多事件、路径修正、停用、探测、回读）/ C 变异。
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  HOST_HOOK_REGISTRY, extractTagPath, installedHookTags, mergeAllHostHooks,
  probeHookHosts, stageAllHookScripts, injectHooksIntoHost, type HookCapableHost,
} from '../hostHookInject.ts';

let dir = '';
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'hhi-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const pathFor = (tag: string) => join(dir, 'recall-hard', tag);

describe('闸门A · 影响面：注册表与召回钩子口径', () => {
  test('注册表含五个钩子，tag 唯一，事件正确', () => {
    expect(HOST_HOOK_REGISTRY).toHaveLength(5);
    const tags = HOST_HOOK_REGISTRY.map((s) => s.tag);
    expect(new Set(tags).size).toBe(5);
    expect(HOST_HOOK_REGISTRY.find((s) => s.tag === 'force_recall.mjs')?.event).toBe('UserPromptSubmit');
    expect(HOST_HOOK_REGISTRY.filter((s) => s.event === 'Stop')).toHaveLength(3);
  });

  test('空配置合并 → 默认四条启用、auto_feedback 默认关（UserPromptSubmit 2 / Stop 2）', () => {
    const r = mergeAllHostHooks({}, {}, pathFor);
    const hooks = r.config.hooks as Record<string, unknown[]>;
    expect(hooks.UserPromptSubmit).toHaveLength(2); // force_recall + session_review_patch
    expect(hooks.Stop).toHaveLength(2);             // session_review + fold_card_check
    expect(r.changedTags).toContain('fold_card_check.mjs');
    expect(r.changedTags).not.toContain('auto_feedback.mjs');
  });

  test('extractTagPath：路径含空格也完整取出', () => {
    const cmd = 'node "C:/Users/LHQ/AppData/Roaming/MultiAgent Memory/recall-hard/fold_card_check.mjs"';
    expect(extractTagPath(cmd, 'fold_card_check.mjs'))
      .toBe('C:/Users/LHQ/AppData/Roaming/MultiAgent Memory/recall-hard/fold_card_check.mjs');
  });
});

describe('闸门B · 效果：幂等 upsert / 多事件 / 路径修正 / 停用 / 探测 / 回读', () => {
  test('幂等：第二次合并 same 配置 → changedTags 为空，kept 为已装 tag', () => {
    const first = mergeAllHostHooks({}, {}, pathFor);
    const second = mergeAllHostHooks(first.config, {}, pathFor);
    expect(second.changedTags).toEqual([]);
    expect(second.keptTags.length).toBeGreaterThan(0);
  });

  test('保留别人的钩子与其它事件、顶层键逐字不动', () => {
    const current = {
      theme: 'dark',
      hooks: {
        UserPromptSubmit: [{ hooks: [{ command: 'node other.mjs' }] }],
        PreToolUse: [{ hooks: [{ command: 'node guard.mjs' }] }],
      },
    };
    const r = mergeAllHostHooks(current, {}, pathFor);
    const hooks = r.config.hooks as Record<string, unknown[]>;
    expect(r.config.theme).toBe('dark');
    expect(JSON.stringify(hooks.UserPromptSubmit)).toContain('other.mjs');
    expect(JSON.stringify(hooks.PreToolUse)).toContain('guard.mjs');
    // 别人的 other.mjs 没被本框架的 tag 摘掉
    expect(hooks.UserPromptSubmit.some((e) => JSON.stringify(e).includes('other.mjs'))).toBe(true);
  });

  test('路径修正：已装 tag 指向旧路径 → 重写为当前稳定路径', () => {
    const current = {
      hooks: {
        Stop: [{ hooks: [{ command: 'node "D:/old/app.asar/fold_card_check.mjs"', timeout: 10 }] }],
      },
    };
    const r = mergeAllHostHooks(current, {}, pathFor);
    expect(r.changedTags).toContain('fold_card_check.mjs');
    const installed = installedHookTags(r.config);
    expect(installed.get('fold_card_check.mjs')?.replace(/\\/g, '/'))
      .toBe(pathFor('fold_card_check.mjs').replace(/\\/g, '/'));
  });

  test('停用：enabled=false 摘除该 tag，其它钩子保留', () => {
    const first = mergeAllHostHooks({}, { 'auto_feedback.mjs': true }, pathFor);
    expect(installedHookTags(first.config).has('auto_feedback.mjs')).toBe(true);
    const off = mergeAllHostHooks(first.config, { 'auto_feedback.mjs': false }, pathFor);
    expect(installedHookTags(off.config).has('auto_feedback.mjs')).toBe(false);
    expect(installedHookTags(off.config).has('session_review.mjs')).toBe(true);
  });

  test('去重：宿主把同一 tag 塞进两个事件 → 收敛为唯一正确条目', () => {
    const current = {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ command: `node "${pathFor('fold_card_check.mjs')}"` }] }],
        Stop: [{ hooks: [{ command: `node "${pathFor('fold_card_check.mjs')}"` }] }],
      },
    };
    const r = mergeAllHostHooks(current, {}, pathFor);
    const allStr = JSON.stringify(r.config.hooks);
    // 只应剩 Stop 事件里的一条（注册事件）
    const count = allStr.split('fold_card_check.mjs').length - 1;
    expect(count).toBe(1);
  });

  test('probeHookHosts：配置不存在→未确认；有 hooks 段的 workbuddy→确认；claude 不盲写', () => {
    const home = join(dir, 'home');
    const wb = join(home, '.workbuddy', 'settings.json');
    const cc = join(home, '.claude', 'settings.json');
    const exists = (p: string) => p === wb || p === cc;
    const readText = (p: string) => p === wb ? '{"hooks":{"Stop":[]}}' : '{"hooks":{"Stop":[]}}';
    const hosts = probeHookHosts({ exists, readText, home: () => home });
    expect(hosts.find((h) => h.id === 'workbuddy')?.confirmed).toBe(true);
    expect(hosts.find((h) => h.id === 'claude-code')?.confirmed).toBe(false);
    expect(hosts.find((h) => h.id === 'codebuddy')?.reason).toContain('不存在');
  });

  test('injectHooksIntoHost：未确认宿主拒绝注入', async () => {
    const host: HookCapableHost = { id: 'x', settingsPath: join(dir, 'x.json'), confirmed: false, reason: 'test' };
    const r = await injectHooksIntoHost({ host, sourceDirFor: () => '', dataDir: dir });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('未确认');
  });

  test('injectHooksIntoHost：端到端注入 + 写后回读 + .bak 备份', async () => {
    const src = join(dir, 'src');
    await mkdir(src, { recursive: true });
    for (const spec of HOST_HOOK_REGISTRY) await writeFile(join(src, spec.tag), `// ${spec.tag}\n`, 'utf8');
    const dataRoot = join(dir, 'data');
    await mkdir(dataRoot, { recursive: true });
    const settings = join(dir, 'settings.json');
    await writeFile(settings, JSON.stringify({ theme: 'dark' }), 'utf8');
    const host: HookCapableHost = { id: 'workbuddy', settingsPath: settings, confirmed: true, reason: 'test' };

    const r = await injectHooksIntoHost({
      host, sourceDirFor: (tag) => join(src, tag), dataDir: dataRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.rewrote).toBe(true);
    expect(r.notLanded).toEqual([]);
    expect(r.changedTags.length).toBeGreaterThan(0);

    const after = JSON.parse(await readFile(settings, 'utf8')) as Record<string, unknown>;
    expect(after.theme).toBe('dark');
    expect(installedHookTags(after).has('force_recall.mjs')).toBe(true);
    expect(installedHookTags(after).has('fold_card_check.mjs')).toBe(true);
    // .bak 留有注入前内容
    expect(await readFile(`${settings}.bak`, 'utf8')).toContain('dark');
    // 稳定副本落数据根
    const staged = stageAllHookScripts((tag) => join(src, tag), dataRoot);
    expect(staged.every((s) => !s.degraded)).toBe(true);
  });
});

describe('闸门C · 变异验证：判据被改坏必须失败', () => {
  test('若注册表 tag 被改坏 → extractTagPath 取不到该 tag（防假成功）', () => {
    const cmd = 'node "D:/x/fold_card_check.mjs"';
    expect(extractTagPath(cmd, 'fold_card_check.mjs')).not.toBeNull();
    // 变体：换成不存在的 tag → 必须 null（若实现里写死返回非 null，此例会红）
    expect(extractTagPath(cmd, 'WRONG_TAG.mjs')).toBeNull();
  });

  test('若路径归一被改坏（大小写敏感）→ 幂等失效（此例钉住小写归一）', () => {
    const first = mergeAllHostHooks({}, {}, pathFor);
    // 手工把路径改成大写盘符，仍应识别为已装（normPath 小写）
    const upper = JSON.parse(JSON.stringify(first.config).replace(/D:\//g, 'D://').replace(pathFor('force_recall.mjs'), pathFor('force_recall.mjs').toUpperCase())) as Record<string, unknown>;
    const second = mergeAllHostHooks(upper, {}, pathFor);
    expect(second.changedTags).not.toContain('force_recall.mjs');
  });
});
