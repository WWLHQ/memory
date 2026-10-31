// 批次7：主进程动作日志落盘与轮转（electron/actionLog）单测。
// 覆盖：未初始化空操作、真实写盘、脱敏、轮转保留份数、任何失败不影响调用方、路径查询。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initActionLog,
  actionLog,
  actionLogError,
  actionLogPath,
  resetActionLog,
  tailActionLog,
} from '../actionLog.ts';

let tmp: string;

/** 单行约 10KB：20 个 500 字节字符串，确保少量写入即可越过 64KiB 轮转下限 */
function bigDetail(tag: string): { items: string[] } {
  return { items: Array.from({ length: 20 }, () => `${tag}${'x'.repeat(497)}`) };
}

beforeEach(() => {
  resetActionLog();
  tmp = mkdtempSync(join(tmpdir(), 'action-log-'));
});

afterEach(() => {
  resetActionLog();
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe('未初始化', () => {
  it('actionLog 返回 false 且不抛错；actionLogPath 为 null', () => {
    expect(actionLogPath()).toBeNull();
    expect(actionLog('ui', 'click', { id: 'x' })).toBe(false);
  });

  it('actionLogError 未初始化同样静默', () => {
    expect(() => actionLogError('ipc', 'boom', new Error('x'))).not.toThrow();
  });
});

describe('初始化与写盘', () => {
  it('初始化后返回 true，行格式为 [ts] [level] [scope:action] [rid] {json}', () => {
    const file = join(tmp, 'data', 'actions.log');
    initActionLog({ file, mirrorConsole: false });
    expect(actionLogPath()).toBe(file);

    expect(actionLog('ipc', 'storage:putMemory', { mem_id: 'm1' }, { requestId: 'req_1' })).toBe(true);
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\] \[info\] \[ipc:storage:putMemory\] \[req_1\] \{"mem_id":"m1"\}$/);
  });

  it('自动创建父目录；多行追加不覆盖', () => {
    const file = join(tmp, 'a', 'b', 'actions.log');
    initActionLog({ file, mirrorConsole: false });
    actionLog('ui', 'page_view');
    actionLog('ui', 'click', { id: 'btn' });
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('[ui:page_view]');
    expect(lines[1]).toContain('[ui:click]');
  });

  it('敏感字段落盘前已脱敏（密码绝不出现在文件里）', () => {
    const file = join(tmp, 'actions.log');
    initActionLog({ file, mirrorConsole: false });
    actionLog('home', 'login', { account: 'admin', password: 'Admin@123456', token: 'tok_secret_value' });
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('Admin@123456');
    expect(text).not.toContain('tok_secret_value');
    expect(text).toContain('"password":"***"');
  });

  it('级别映射到 console（error→console.error，info→console.log）；关闭镜像则静默', () => {
    initActionLog({ file: join(tmp, 'actions.log'), mirrorConsole: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    actionLog('ui', 'click');
    actionLogError('ipc', 'boom', new Error('kaput'), { channel: 'x' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain('[ipc:boom]');

    resetActionLog();
    initActionLog({ file: join(tmp, 'quiet.log'), mirrorConsole: false });
    log.mockClear();
    actionLog('ui', 'click');
    expect(log).not.toHaveBeenCalled();
  });
});

describe('尾读（程序运行日志窗口）', () => {
  it('未初始化：返回 ok=false + 原因，不抛错', () => {
    const r = tailActionLog(5);
    expect(r.ok).toBe(false);
    expect(r.path).toBeNull();
    expect(r.lines).toEqual([]);
    expect(r.error).toContain('未初始化');
  });

  it('初始化但文件尚未创建：ok=true + 空数组（真实空态）', () => {
    const file = join(tmp, 'not-yet.log');
    initActionLog({ file, mirrorConsole: false });
    expect(tailActionLog(5)).toEqual({ ok: true, path: file, lines: [] });
  });

  it('返回最近 N 行且保持旧→新顺序', () => {
    const file = join(tmp, 'actions.log');
    initActionLog({ file, mirrorConsole: false });
    for (let i = 1; i <= 7; i++) actionLog('ui', `step${i}`);
    const r = tailActionLog(3);
    expect(r.ok).toBe(true);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[0]).toContain('[ui:step5]');
    expect(r.lines[1]).toContain('[ui:step6]');
    expect(r.lines[2]).toContain('[ui:step7]');
  });

  it('当前文件不足时回退轮转文件，拼出连续最近日志', () => {
    const file = join(tmp, 'actions.log');
    initActionLog({ file, keep: 3, mirrorConsole: false });
    writeFileSync(
      `${file}.1`,
      `${Array.from({ length: 3 }, (_, i) => `[2026-10-31T00:00:0${i}.000Z] [info] [ui:old${i}]`).join('\n')}\n`,
      'utf8',
    );
    actionLog('ui', 'current');
    const r = tailActionLog(4);
    expect(r.lines).toHaveLength(4);
    expect(r.lines[0]).toContain('[ui:old0]');
    expect(r.lines[1]).toContain('[ui:old1]');
    expect(r.lines[2]).toContain('[ui:old2]');
    expect(r.lines[3]).toContain('[ui:current]');
  });

  it('limit 钳制在 1..50（0→1，超大→50；批次24 日志窗口可回看 50 条）', () => {
    const file = join(tmp, 'actions.log');
    initActionLog({ file, mirrorConsole: false });
    for (let i = 1; i <= 60; i++) actionLog('ui', `n${i}`);
    expect(tailActionLog(0).lines).toHaveLength(1);
    expect(tailActionLog(999).lines).toHaveLength(50);
    expect(tailActionLog(50).lines[49]).toContain('[ui:n60]');
    expect(tailActionLog(Number.NaN).lines).toHaveLength(5);
  });
});

describe('轮转', () => {
  it('超过上限后 actions.log → actions.log.1，当前文件只保留新内容', () => {
    const file = join(tmp, 'actions.log');
    initActionLog({ file, maxBytes: 64 * 1024, keep: 3, mirrorConsole: false });
    for (let i = 0; i < 8; i++) actionLog('ui', 'big', bigDetail(`w${i}-`));

    expect(existsSync(`${file}.1`)).toBe(true);
    const rotated = readFileSync(`${file}.1`, 'utf8');
    expect(rotated).toContain('w0-');
    const current = readFileSync(file, 'utf8');
    expect(current).not.toContain('w0-');
    expect(current).toContain('w7-');
  });

  it('keep=2：只保留当前 + 1 份历史，不产生 .2', () => {
    const file = join(tmp, 'actions.log');
    initActionLog({ file, maxBytes: 64 * 1024, keep: 2, mirrorConsole: false });

    for (let i = 0; i < 16; i++) actionLog('ui', 'big', bigDetail(`r${i}-`));

    const files = readdirSync(tmp).sort();
    expect(files).toEqual(['actions.log', 'actions.log.1']);
    // 第二轮覆盖第一轮：最老的 w 内容不再保留
    expect(readFileSync(`${file}.1`, 'utf8')).not.toContain('r0-');
  });

  it('轮转失败不丢新日志（最旧槽位不可删时仍继续写当前文件）', () => {
    const file = join(tmp, 'actions.log');
    initActionLog({ file, maxBytes: 64 * 1024, keep: 3, mirrorConsole: false });
    // 目录占住 .2：unlinkSync 抛错 → 轮转被跳过，但 append 必须照常
    mkdirSync(`${file}.2`);
    for (let i = 0; i < 8; i++) actionLog('ui', 'big', bigDetail(`x${i}-`));
    expect(readFileSync(file, 'utf8')).toContain('x7-');
  });
});
