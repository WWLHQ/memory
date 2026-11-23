// 原子任务24B · 启动注入编排层单测。
// 重点：默认关闭（不写任何宿主配置）/ 只注入已确认宿主 / 单宿主失败不阻断 / 源目录解析。
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  resolveHostHookSourceDir, runHostHookAutoInject, type AutoInjectDeps,
} from '../runHostHookAutoInject.ts';
import type { HookCapableHost, InjectResult } from '../hostHookInject.ts';
import { DEFAULT_RECALL_HARD_CONFIG, normalizeRecallHardConfig } from '../../shared/recallHardConfig.ts';

let dir = '';
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'hai-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const confirmed: HookCapableHost = { id: 'workbuddy', settingsPath: join(dir, 'wb.json'), confirmed: true, reason: 'test' };
const unconfirmed: HookCapableHost = { id: 'claude-code', settingsPath: join(dir, 'cc.json'), confirmed: false, reason: '未验证' };

const okResult = (host: string): InjectResult => ({
  ok: true, host, changedTags: ['fold_card_check.mjs'], keptTags: [], notLanded: [], rewrote: true,
});

describe('闸门A · 影响面：配置默认与安全边界', () => {
  test('默认配置 host_hook_autoinject=false（安装后不静默写宿主配置）', () => {
    expect(DEFAULT_RECALL_HARD_CONFIG.host_hook_autoinject).toBe(false);
    expect(normalizeRecallHardConfig({}).host_hook_autoinject).toBe(false);
    // 显式开启可被读回
    expect(normalizeRecallHardConfig({ host_hook_autoinject: true }).host_hook_autoinject).toBe(true);
  });

  test('成员可编辑字段不含 host_hook_autoinject（权限不扩散）', async () => {
    const { MEMBER_EDITABLE_KEYS, memberForbiddenFields } = await import('../../shared/recallHardConfig.ts');
    expect(MEMBER_EDITABLE_KEYS).not.toContain('host_hook_autoinject');
    expect(memberForbiddenFields({ host_hook_autoinject: true })).toContain('host_hook_autoinject');
  });

  test('源目录解析：打包态优先 recall-hard/，否则回退开发态 host-hooks/', () => {
    const packed = resolveHostHookSourceDir('/app/dist-electron', (p) => p.endsWith('recall-hard'));
    expect(packed.dir.replace(/\\/g, '/')).toBe('/app/dist-electron/recall-hard'.replace(/\\/g, '/'));
    const dev = resolveHostHookSourceDir('/app/dist-electron', () => false);
    expect(dev.dir.replace(/\\/g, '/')).toContain('src/electron/host-hooks');
    expect(dev.sourceDirFor('fold_card_check.mjs').replace(/\\/g, '/')).toContain('host-hooks/fold_card_check.mjs');
  });
});

describe('闸门B · 效果：探测 + 注入编排', () => {
  test('只注入 confirmed 宿主，unconfirmed 被跳过', async () => {
    const inject = vi.fn(async ({ host }: { host: HookCapableHost }) => okResult(host.id));
    const r = await runHostHookAutoInject({
      dataDir: dir, dirname: '/app', probe: () => [confirmed, unconfirmed], inject: inject as AutoInjectDeps['inject'],
    });
    expect(r.enabled).toBe(true);
    expect(r.confirmedHosts).toEqual(['workbuddy']);
    expect(inject).toHaveBeenCalledTimes(1);
    expect(r.results[0].ok).toBe(true);
  });

  test('无已确认宿主 → 零注入，记录探测原因', async () => {
    const inject = vi.fn();
    const log = vi.fn();
    const r = await runHostHookAutoInject({
      dataDir: dir, dirname: '/app', probe: () => [unconfirmed], inject: inject as never, log,
    });
    expect(r.confirmedHosts).toEqual([]);
    expect(r.results).toEqual([]);
    expect(inject).not.toHaveBeenCalled();
    expect(log.mock.calls.some((c) => c[0] === 'host-hook:no-confirmed-host')).toBe(true);
  });

  test('单宿主失败不阻断，也不传染其它宿主', async () => {
    const inject = vi.fn(async ({ host }: { host: HookCapableHost }) => {
      if (host.id === 'workbuddy') throw new Error('模拟写盘失败');
      return okResult(host.id);
    });
    const secondConfirmed: HookCapableHost = { id: 'codebuddy', settingsPath: join(dir, 'cb.json'), confirmed: true, reason: 'test' };
    const r = await runHostHookAutoInject({
      dataDir: dir, dirname: '/app', probe: () => [confirmed, secondConfirmed], inject: inject as never,
    });
    expect(r.results).toHaveLength(2);
    expect(r.results.find((x) => x.host === 'workbuddy')?.ok).toBe(false);
    expect(r.results.find((x) => x.host === 'workbuddy')?.error).toContain('写盘失败');
    expect(r.results.find((x) => x.host === 'codebuddy')?.ok).toBe(true);
  });

  test('probe 抛错 → 返回 error 摘要，不抛给 bootstrap', async () => {
    const r = await runHostHookAutoInject({
      dataDir: dir, dirname: '/app', probe: () => { throw new Error('探测炸了'); },
    });
    expect(r.enabled).toBe(true);
    expect(r.error).toContain('探测炸了');
    expect(r.results).toEqual([]);
  });
});

describe('闸门C · 变异验证', () => {
  test('若 enabled 判断写反（把 confirmed=false 也注入）→ 此例红', () => {
    const confirmedOnly = [confirmed, unconfirmed].filter((h) => h.confirmed);
    expect(confirmedOnly).toHaveLength(1);
    expect(confirmedOnly[0].id).toBe('workbuddy');
  });
});
