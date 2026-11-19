// 壳层常驻设置的纯单测（阶段 A）：
// 只测判据，不测 electron——Tray / setLoginItemSettings 的接线在 main.ts，本文件不 import electron。
import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  APP_SHELL_FILE, DEFAULT_SHELL_SETTINGS, HIDDEN_LAUNCH_ARG, appShellPath, applyShellConstraints,
  isHiddenLaunch, loginItemArgs, normalizeShellSettings, parseShellPatch, readShellSettings,
  resolveCloseAction, writeShellSettings,
} from '../appShell.ts';

const temps: string[] = [];
function tempDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `mam-shell-${tag}-`));
  temps.push(d);
  return d;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('默认值', () => {
  test('两项都开（不做常驻与自启就等于放弃后台采集）', () => {
    expect(DEFAULT_SHELL_SETTINGS).toEqual({ keepInTray: true, autoStart: true });
  });
});

describe('容错解析', () => {
  test('非对象输入 → 全默认', () => {
    for (const raw of [null, undefined, 0, 'x', [], true]) {
      expect(normalizeShellSettings(raw)).toEqual(DEFAULT_SHELL_SETTINGS);
    }
  });

  test('只给一半 → 另一半取默认，不做整体丢弃', () => {
    expect(normalizeShellSettings({ keepInTray: false })).toEqual({ keepInTray: false, autoStart: true });
    expect(normalizeShellSettings({ autoStart: false })).toEqual({ keepInTray: true, autoStart: false });
  });

  test('非 boolean 值一律不采纳（"false" 字符串不得被当成 false）', () => {
    expect(normalizeShellSettings({ keepInTray: 'false', autoStart: 0 })).toEqual(DEFAULT_SHELL_SETTINGS);
  });
});

describe('读写往返', () => {
  test('缺失文件 → 默认值，且不创建文件', () => {
    const dir = tempDir('missing');
    expect(readShellSettings(dir)).toEqual(DEFAULT_SHELL_SETTINGS);
    expect(() => readFileSync(appShellPath(dir), 'utf8')).toThrow();
  });

  test('写入后可读回同一份', () => {
    const dir = tempDir('roundtrip');
    const written = writeShellSettings(dir, { keepInTray: true, autoStart: false });
    expect(written).toEqual({ keepInTray: true, autoStart: false });
    expect(readShellSettings(dir)).toEqual({ keepInTray: true, autoStart: false });
    expect(JSON.parse(readFileSync(appShellPath(dir), 'utf8'))).toEqual({ keepInTray: true, autoStart: false });
  });

  test('关常驻时自启被强制收敛（存不出「自启但无托盘」的死锁组合）', () => {
    const dir = tempDir('constraint');
    // 直接传一个非法组合：落盘前必须被收敛，不能等 UI 自觉
    const written = writeShellSettings(dir, { keepInTray: false, autoStart: true });
    expect(written).toEqual({ keepInTray: false, autoStart: false });
    expect(readShellSettings(dir)).toEqual({ keepInTray: false, autoStart: false });
  });

  test('坏 JSON → 默认值（启动主路径不许抛）', () => {
    const dir = tempDir('corrupt');
    writeFileSync(appShellPath(dir), '{ not json', 'utf8');
    expect(readShellSettings(dir)).toEqual(DEFAULT_SHELL_SETTINGS);
  });

  test('目录不存在时写入会自动建目录', () => {
    const dir = join(tempDir('mkdir'), 'nested', 'deep');
    writeShellSettings(dir, DEFAULT_SHELL_SETTINGS);
    expect(JSON.parse(readFileSync(appShellPath(dir), 'utf8'))).toEqual(DEFAULT_SHELL_SETTINGS);
  });

  test('文件名固定，且不写 .tmp 残留', () => {
    const dir = tempDir('tmpclean');
    writeShellSettings(dir, DEFAULT_SHELL_SETTINGS);
    expect(APP_SHELL_FILE).toBe('app-shell.json');
    expect(() => readFileSync(`${appShellPath(dir)}.tmp`, 'utf8')).toThrow();
  });
});

describe('关窗动作判定', () => {
  test('常驻开启 + 未退出 → 隐藏', () => {
    expect(resolveCloseAction({ quitting: false, keepInTray: true })).toBe('hide');
  });

  test('常驻关闭 → 真关（旧行为）', () => {
    expect(resolveCloseAction({ quitting: false, keepInTray: false })).toBe('close');
  });

  test('已进入退出流程 → 真关，且优先于常驻设置（否则进程退不掉）', () => {
    expect(resolveCloseAction({ quitting: true, keepInTray: true })).toBe('close');
  });
});

describe('静默启动', () => {
  test('识别 --hidden', () => {
    expect(isHiddenLaunch(['app.exe', HIDDEN_LAUNCH_ARG])).toBe(true);
    expect(isHiddenLaunch(['app.exe'])).toBe(false);
    expect(isHiddenLaunch(['app.exe', '--hiddenx'])).toBe(false);
  });

  test('自启参数与识别口径同源（改一处两边一起变）', () => {
    expect(loginItemArgs()).toEqual([HIDDEN_LAUNCH_ARG]);
    expect(isHiddenLaunch(['x', ...loginItemArgs()])).toBe(true);
  });
});

describe('渲染层改动校验（parseShellPatch）', () => {
  test('只接受显式 boolean，且至少改一项', () => {
    expect(parseShellPatch({ keepInTray: false })).toEqual({ ok: true, patch: { keepInTray: false } });
    expect(parseShellPatch({ autoStart: true })).toEqual({ ok: true, patch: { autoStart: true } });
    expect(parseShellPatch({ keepInTray: true, autoStart: false })).toEqual({
      ok: true, patch: { keepInTray: true, autoStart: false },
    });
  });

  test('空 patch / 非对象 / 数组 → 明确拒绝（不许把「什么都没改」当成功）', () => {
    for (const raw of [{}, null, undefined, 1, 'x', []]) {
      expect(parseShellPatch(raw).ok).toBe(false);
    }
  });

  test('类型不对 → 报出字段名，不静默丢弃', () => {
    const r = parseShellPatch({ keepInTray: 'false' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('keepInTray');
  });

  test('未维护的键被忽略（前向兼容：UI 多传不会报错）', () => {
    expect(parseShellPatch({ keepInTray: true, future_field: 1 })).toEqual({
      ok: true, patch: { keepInTray: true },
    });
  });
});

describe('联动收敛（applyShellConstraints）', () => {
  test('没有常驻就不许自启', () => {
    expect(applyShellConstraints({ keepInTray: false, autoStart: true }))
      .toEqual({ keepInTray: false, autoStart: false });
  });

  test('常驻开着时不动自启', () => {
    expect(applyShellConstraints({ keepInTray: true, autoStart: true }))
      .toEqual({ keepInTray: true, autoStart: true });
    expect(applyShellConstraints({ keepInTray: true, autoStart: false }))
      .toEqual({ keepInTray: true, autoStart: false });
  });
});
