// A2：IPC 清单单一真源 + 启动自检 + 失败可见化
// 静态断言：preload 暴露的每个 channel 都必须在 main 中真正注册，
// 否则渲染层拿到的是「永远 reject 的死桥」（历史 bug：floatAttribution:open / hostScan:run）。
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { IPC, PRELOAD_CHANNELS, missingChannels, formatBootFailure, handleBootFailure } from '../ipcChannels.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MAIN_SRC = readFileSync(join(here, '..', 'main.ts'), 'utf8');
const PRELOAD_SRC = readFileSync(join(here, '..', 'preload.ts'), 'utf8');
const KEYS = Object.keys(IPC) as Array<keyof typeof IPC>;

describe('A2 IPC 清单单一真源', () => {
  it('PRELOAD_CHANNELS = IPC 全量且无重复', () => {
    expect(PRELOAD_CHANNELS.length).toBe(KEYS.length);
    expect(new Set(PRELOAD_CHANNELS).size).toBe(PRELOAD_CHANNELS.length);
    expect([...PRELOAD_CHANNELS].sort()).toEqual(KEYS.map((k) => IPC[k]).sort());
  });

  it('main.ts 为每个 channel 注册了 handle（handleIpc / handleIpcEvent）', () => {
    const registered = new Set(
      [...MAIN_SRC.matchAll(/handleIpc(?:Event)?\(IPC\.(\w+)/g)].map((m) => m[1]),
    );
    const missing = KEYS.filter((k) => !registered.has(k));
    expect(missing, `main.ts 未注册: ${missing.join(', ')}`).toEqual([]);
  });

  it('main.ts 不再出现裸 channel 字符串注册', () => {
    expect(MAIN_SRC).not.toMatch(/handleIpc(?:Event)?\(\s*['"]/);
  });

  it('preload.ts 只经 IPC 常量调用，不再硬编码 channel 字符串', () => {
    for (const key of KEYS) expect(PRELOAD_SRC).toContain(`IPC.${key}`);
    expect(PRELOAD_SRC).not.toMatch(/(?:invoke|send)\(\s*['"](?:storage|hostScan|hostAgentDetect|collector|backup|floatAttribution):/);
  });

  it('missingChannels：全注册为空数组，缺失项如实报出', () => {
    expect(missingChannels(PRELOAD_CHANNELS)).toEqual([]);
    expect(missingChannels(PRELOAD_CHANNELS.filter((c) => c !== IPC.dataRootGet))).toEqual([IPC.dataRootGet]);
    expect(missingChannels([])).toEqual([...PRELOAD_CHANNELS]);
  });
});

describe('A3 启动失败可见化', () => {
  it('formatBootFailure：Error 带栈，非 Error 转字符串', () => {
    const e = new Error('boom');
    expect(formatBootFailure(e)).toContain('boom');
    expect(formatBootFailure('plain')).toBe('plain');
  });

  it('handleBootFailure：日志 → 弹窗 → exit(1)', () => {
    const log = vi.fn();
    const showError = vi.fn();
    const exit = vi.fn();
    handleBootFailure(new Error('port in use'), { log, showError, exit });

    expect(log).toHaveBeenCalledOnce();
    expect(showError).toHaveBeenCalledOnce();
    expect(showError.mock.calls[0][0]).toContain('启动失败');
    expect(showError.mock.calls[0][1]).toContain('port in use');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('弹窗本身抛错也必须退出（不产生无窗口僵尸进程）', () => {
    const exit = vi.fn();
    handleBootFailure(new Error('x'), {
      log: vi.fn(),
      showError: () => {
        throw new Error('no gui');
      },
      exit,
    });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
