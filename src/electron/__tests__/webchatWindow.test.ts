import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isWebchatStoragePath } from '../webchatWindow.ts';

describe('isWebchatStoragePath（全局外链闸门的例外判据）', () => {
  it('识别所有网页采集分区的 storagePath', () => {
    expect(isWebchatStoragePath('D:\\MultiAgent Memory\\Partitions\\webchat-deepseek')).toBe(true);
    expect(isWebchatStoragePath('D:/MultiAgent Memory/Partitions/webchat-doubao/')).toBe(true);
    expect(isWebchatStoragePath('/home/u/.config/App/Partitions/webchat-kimi')).toBe(true);
  });

  it('自家默认 Session 与其他持久分区不放行', () => {
    expect(isWebchatStoragePath('D:\\MultiAgent Memory')).toBe(false);
    expect(isWebchatStoragePath('D:\\MultiAgent Memory\\Partitions\\other')).toBe(false);
    expect(isWebchatStoragePath('D:\\MultiAgent Memory\\Partitions\\webchat')).toBe(false);
  });

  it('空值与非字符串都不放行', () => {
    expect(isWebchatStoragePath(null)).toBe(false);
    expect(isWebchatStoragePath(undefined)).toBe(false);
    expect(isWebchatStoragePath(123)).toBe(false);
    expect(isWebchatStoragePath('')).toBe(false);
  });

  it('主进程的全局外链闸门必须跳过网页采集分区', () => {
    const src = readFileSync(join(process.cwd(), 'src/electron/main.ts'), 'utf8');
    expect(src).toMatch(/if\s*\(\s*!isWebchatStoragePath\(win\.webContents\.session\.storagePath\)\s*\)\s*\{[\s\S]{0,500}will-navigate/);
  });
});
