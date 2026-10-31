// 数据根目录纯文件层单测：指针读写/校验/可写性探测/旧目录探测/白名单迁移
import { afterEach, describe, expect, test } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  clearDataRootMigrateFrom, dataRootPointerPath, defaultDataRoot, detectDataRoots,
  ensureDirWritable, hasAnyData, migrateDataRoot, readDataRootPointer, samePath,
  summarizeDataDir, validateDataRootPath, writeDataRootPointer,
} from '../dataRoot.ts';

const temps: string[] = [];
function tempDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `mam-dataroot-${tag}-`));
  temps.push(d);
  return d;
}
function write(file: string, content = 'x'): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content, 'utf8');
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('data-root 指针', () => {
  test('缺失 → missing；读写往返保留 migrateFrom/migrateOverwrite', () => {
    const appData = tempDir('appdata');
    const file = dataRootPointerPath(appData);
    expect(readDataRootPointer(file)).toEqual({ status: 'missing' });

    const root = join(appData, 'data');
    writeDataRootPointer(file, { version: 1, root, migrateFrom: join(appData, 'old'), migrateOverwrite: true, updatedAt: '2026-10-30T00:00:00.000Z' });
    const read = readDataRootPointer(file);
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.pointer.root).toBe(root);
    expect(read.pointer.migrateFrom).toBe(join(appData, 'old'));
    expect(read.pointer.migrateOverwrite).toBe(true);
  });

  test('坏 JSON / 缺 root → corrupt（诚实重新询问，不静默用默认）', () => {
    const appData = tempDir('corrupt');
    const file = dataRootPointerPath(appData);
    write(file, '{bad');
    expect(readDataRootPointer(file).status).toBe('corrupt');
    write(file, JSON.stringify({ version: 1 }));
    expect(readDataRootPointer(file).status).toBe('corrupt');
  });

  test('clearDataRootMigrateFrom 只清迁移源，保留 root', () => {
    const appData = tempDir('clear');
    const file = dataRootPointerPath(appData);
    const root = join(appData, 'data');
    writeDataRootPointer(file, { version: 1, root, migrateFrom: join(appData, 'old'), updatedAt: '' });
    expect(clearDataRootMigrateFrom(file)).toBe(true);
    const read = readDataRootPointer(file);
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.pointer.root).toBe(root);
    expect(read.pointer.migrateFrom).toBeUndefined();
    expect(clearDataRootMigrateFrom(file)).toBe(false);
  });
});

describe('路径校验', () => {
  test('空/相对路径拒绝；绝对路径通过', () => {
    expect(validateDataRootPath('').ok).toBe(false);
    expect(validateDataRootPath('   ').ok).toBe(false);
    expect(validateDataRootPath('data/root', 'linux').ok).toBe(false);
    expect(validateDataRootPath('/data/root', 'linux')).toEqual({ ok: true, root: '/data/root' });
  });

  test('Windows UNC 拒绝；盘符路径通过', () => {
    expect(validateDataRootPath('\\\\server\\share', 'win32').ok).toBe(false);
    expect(validateDataRootPath('D:\\Data\\Memory', 'win32').ok).toBe(true);
  });

  test('samePath：Windows 大小写不敏感，POSIX 敏感', () => {
    expect(samePath('D:\\Data\\Memory', 'd:\\data\\memory\\', 'win32')).toBe(true);
    expect(samePath('/data/Memory', '/data/memory', 'linux')).toBe(false);
  });
});

describe('可写性与数据探测', () => {
  test('ensureDirWritable 创建目录并清理探针文件', () => {
    const root = join(tempDir('writable'), 'nested', 'data');
    expect(ensureDirWritable(root)).toEqual({ ok: true });
    expect(existsSync(root)).toBe(true);
    expect(readdirSync(root)).toEqual([]);
  });

  test('目标路径被文件占用 → 诚实返回错误', () => {
    const base = tempDir('blocked');
    const file = join(base, 'not-a-dir');
    write(file, 'x');
    const r = ensureDirWritable(file);
    expect(r.ok).toBe(false);
  });

  test('hasAnyData / summarizeDataDir 只统计白名单数据，不把指针当数据', () => {
    const root = tempDir('data');
    expect(hasAnyData(root)).toBe(false);
    writeDataRootPointer(dataRootPointerPath(root), { version: 1, root, updatedAt: '' });
    expect(hasAnyData(root)).toBe(false);
    write(join(root, 'memories.db.json'), '{"memories":{}}');
    write(join(root, 'backups', 'memories-1.json'), 'xx');
    expect(hasAnyData(root)).toBe(true);
    const s = summarizeDataDir(root);
    expect(s.files).toBe(2);
    expect(s.bytes).toBe(Buffer.byteLength('{"memories":{}}') + 2);
    expect(s.newest).not.toBe('');
  });

  test('detectDataRoots 排除本次选定目录并按最近修改倒序', () => {
    const appData = tempDir('detect');
    const def = defaultDataRoot(appData);
    const legacy = join(appData, 'multi-agent-memory');
    write(join(def, 'memories.db.json'), '{}');
    write(join(legacy, 'memories.db.json'), '{}');
    const detected = detectDataRoots(appData, def);
    expect(detected.map((d) => d.dir)).toEqual([legacy]);
    const chosen = tempDir('chosen');
    const both = detectDataRoots(appData, chosen);
    expect(both).toHaveLength(2);
    expect(both[0].newest >= both[1].newest).toBe(true);
  });
});

describe('migrateDataRoot（复制、不覆盖、不删除）', () => {
  test('白名单复制 + 目标已有文件跳过 + 源保留 + 旧备份配置清空 dbDir/pendingMove', () => {
    const from = tempDir('from');
    const to = tempDir('to');
    write(join(from, 'memories.db.json'), '{"memories":{"m1":{}}}');
    write(join(from, 'collector-cursor.json'), '{"cursor":{"a":1}}');
    write(join(from, 'mcp-token.txt'), 'a'.repeat(64) + '\n');
    write(join(from, 'main.log'), 'line\n');
    write(join(from, 'backup-config.json'), JSON.stringify({ enabled: true, hour: 3, minute: 0, keepCount: 7, dir: '', dbDir: join(from, 'custom'), pendingMove: { from: 'x', toDir: 'y' } }));
    write(join(from, 'backups', 'memories-2026.json'), 'backup');
    write(join(to, 'collector-cursor.json'), '{"cursor":{"keep":true}}');

    const report = migrateDataRoot(from, to);
    expect(report.errors).toEqual([]);
    expect(report.copied).toContain('memories.db.json');
    expect(report.copied).toContain('mcp-token.txt');
    expect(report.copied).toContain('backups/memories-2026.json');
    expect(report.skipped).toContain('collector-cursor.json');
    expect(readFileSync(join(to, 'collector-cursor.json'), 'utf8')).toBe('{"cursor":{"keep":true}}');
    // 源数据保留
    expect(existsSync(join(from, 'memories.db.json'))).toBe(true);
    const cfg = JSON.parse(readFileSync(join(to, 'backup-config.json'), 'utf8')) as Record<string, unknown>;
    expect(cfg.enabled).toBe(true);
    expect(cfg.dbDir).toBeUndefined();
    expect(cfg.pendingMove).toBeUndefined();
  });

  test('旧版 dbDir 指向其它目录 → 以该目录记忆库为真实来源', () => {
    const from = tempDir('legacy-from');
    const custom = tempDir('legacy-custom');
    const to = tempDir('legacy-to');
    write(join(from, 'memories.db.json'), '{"memories":{"old":true}}');
    write(join(custom, 'memories.db.json'), '{"memories":{"real":true}}');
    write(join(from, 'backup-config.json'), JSON.stringify({ dbDir: custom }));
    const report = migrateDataRoot(from, to);
    expect(report.dbSource).toBe(join(custom, 'memories.db.json'));
    expect(readFileSync(join(to, 'memories.db.json'), 'utf8')).toBe('{"memories":{"real":true}}');
  });

  test('overwrite=true：目标同名文件先 .bak 备份再覆盖（显式更改回旧目录不丢当前库）', () => {
    const from = tempDir('ow-from');
    const to = tempDir('ow-to');
    write(join(from, 'memories.db.json'), '{"memories":{"current":true}}');
    write(join(to, 'memories.db.json'), '{"memories":{"stale":true}}');
    const report = migrateDataRoot(from, to, process.platform, { overwrite: true });
    expect(report.errors).toEqual([]);
    expect(readFileSync(join(to, 'memories.db.json'), 'utf8')).toBe('{"memories":{"current":true}}');
    expect(report.backedUp).toHaveLength(1);
    expect(readFileSync(report.backedUp[0], 'utf8')).toBe('{"memories":{"stale":true}}');
    expect(existsSync(join(from, 'memories.db.json'))).toBe(true);
  });

  test('同一目录 → 直接跳过，不复制不删除', () => {
    const dir = tempDir('same');
    write(join(dir, 'memories.db.json'), '{}');
    const report = migrateDataRoot(dir, dir);
    expect(report.copied).toEqual([]);
    expect(report.skipped).toEqual(['(same-path)']);
    expect(existsSync(join(dir, 'memories.db.json'))).toBe(true);
  });
});
