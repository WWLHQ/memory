// 数据根目录纯文件层单测：指针读写/校验/可写性探测/旧目录探测/白名单迁移（含批次41-A 的审计账本与归档目录）
import { afterEach, describe, expect, test } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  adoptLibraryDirIntoPlace, clearDataRootMigrateFrom, dataRootPointerPath, DATA_ROOT_MIGRATE_DIRS,
  DATA_ROOT_MIGRATE_FILES, defaultDataRoot, detectDataRoots,
  ensureDirWritable, hasAnyData, hasLibraryDirs, isSetupComplete, libraryFileState,
  migrateDataRoot, readDataRootPointer, resolveLibraryPaths, samePath,
  summarizeDataDir, validateDataRootPath, wizardRequired, writeDataRootPointer,
  type DataRootPointer, type DataRootPointerRead,
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

  test('clearDataRootMigrateFrom 只清迁移源，保留 root 与批次37-B 的两库位置/向导标记', () => {
    const appData = tempDir('clear');
    const file = dataRootPointerPath(appData);
    const root = join(appData, 'data');
    writeDataRootPointer(file, {
      version: 1, root, migrateFrom: join(appData, 'old'), updatedAt: '',
      ledgerDir: join(appData, 'ledger'), l0Dir: 'D:\\私密\\l0', setupDone: true,
    });
    expect(clearDataRootMigrateFrom(file)).toBe(true);
    const read = readDataRootPointer(file);
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.pointer.root).toBe(root);
    expect(read.pointer.migrateFrom).toBeUndefined();
    // 清迁移源把向导配置抹掉 = 每次迁移后把用户踢回首启向导，这条必须钉住
    expect(read.pointer.ledgerDir).toBe(join(appData, 'ledger'));
    expect(read.pointer.l0Dir).toBe('D:\\私密\\l0');
    expect(read.pointer.setupDone).toBe(true);
    expect(clearDataRootMigrateFrom(file)).toBe(false);
  });

  test('批次37-B 指针字段往返：两库目录 + setupDone；未置真的字段不凭空补', () => {
    const appData = tempDir('setup');
    const file = dataRootPointerPath(appData);
    const root = join(appData, 'data');
    writeDataRootPointer(file, { version: 1, root, ledgerDir: root, updatedAt: '' });
    const read = readDataRootPointer(file);
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.pointer.ledgerDir).toBe(root);
    expect(read.pointer.l0Dir).toBeUndefined();
    expect(read.pointer.setupDone).toBeUndefined();
    // 只设了一个目录 = 向导没走完
    expect(isSetupComplete(read.pointer)).toBe(false);
    expect(hasLibraryDirs(read.pointer)).toBe(false);
  });

  test('坏 JSON 里 setupDone 只认字面 true（字符串/1 不算走完，防指针被手改绕过向导）', () => {
    const appData = tempDir('flag');
    const file = dataRootPointerPath(appData);
    const root = join(appData, 'data');
    write(file, JSON.stringify({ version: 1, root, ledgerDir: root, l0Dir: root, setupDone: 'true' }));
    const read = readDataRootPointer(file);
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.pointer.setupDone).toBeUndefined();
    expect(isSetupComplete(read.pointer)).toBe(false);
  });
});

describe('批次37-B 两库路径解析', () => {
  test('两个目录各指各的 → 三个文件分别落位；密钥环跟着 L0 库走', () => {
    const p = resolveLibraryPaths({ root: 'C:\\data', ledgerDir: 'D:\\ledger', l0Dir: 'E:\\l0' });
    expect(p.ledger).toBe(join('D:\\ledger', 'memories.db.json'));
    expect(p.l0).toBe(join('E:\\l0', 'memories.l0.json'));
    expect(p.keyring).toBe(join('E:\\l0', 'l0-keyring.json'));
  });

  test('同一目录允许；旧版指针缺字段回落 root（兼容读取，但不算向导走完）', () => {
    const same = resolveLibraryPaths({ root: 'C:\\data', ledgerDir: 'C:\\data', l0Dir: 'C:\\data' });
    expect(same.ledger).toBe(join('C:\\data', 'memories.db.json'));
    expect(same.l0).toBe(join('C:\\data', 'memories.l0.json'));
    const legacy = resolveLibraryPaths({ root: 'C:\\data' });
    expect(legacy.ledgerDir).toBe('C:\\data');
    expect(legacy.l0Dir).toBe('C:\\data');
    expect(isSetupComplete({ root: 'C:\\data' })).toBe(false);
    expect(isSetupComplete(null)).toBe(false);
    expect(isSetupComplete({ root: 'C:\\data', ledgerDir: 'C:\\a', l0Dir: 'C:\\b', setupDone: true })).toBe(true);
  });

  test('libraryFileState 如实报告在不在、多大（向导用它显示"这里有现成的库"）', () => {
    const dir = tempDir('libstate');
    expect(libraryFileState(dir, 'memories.db.json')).toEqual({
      path: join(dir, 'memories.db.json'), exists: false, bytes: 0,
    });
    write(join(dir, 'memories.db.json'), '12345');
    expect(libraryFileState(dir, 'memories.db.json')).toEqual({
      path: join(dir, 'memories.db.json'), exists: true, bytes: 5,
    });
    // 目录不是文件：不算存在，也不炸
    expect(libraryFileState(dir, '').exists).toBe(false);
  });
});

describe('批次41-H：主进程首启向导判定 wizardRequired（端壳 isWizardIncomplete 直接调用）', () => {
  const ok = (p: Partial<DataRootPointer>): DataRootPointerRead =>
    ({ status: 'ok', pointer: { version: 1, root: 'C:\\data', updatedAt: '', ...p } });

  test('指针缺失 / 指针损坏 → 一律强制进向导（认不出配置就不放行）', () => {
    expect(wizardRequired({ status: 'missing' })).toBe(true);
    expect(wizardRequired({ status: 'corrupt', error: '缺少有效 root 字段' })).toBe(true);
  });

  test('老指针没 setupDone（升级上来）→ 照样进向导（批次37-B 拍板口径）', () => {
    expect(wizardRequired(ok({ root: 'C:\\data' }))).toBe(true);
    // 两库位置有、但没走完向导 → 仍进向导
    expect(wizardRequired(ok({ ledgerDir: 'C:\\a', l0Dir: 'C:\\b' }))).toBe(true);
  });

  test('setupDone 但缺库目录 → 仍进向导（向导三段全做完才算走完）', () => {
    expect(wizardRequired(ok({ setupDone: true }))).toBe(true);
    expect(wizardRequired(ok({ ledgerDir: 'C:\\a', setupDone: true }))).toBe(true);
  });

  test('唯一放行：两库目录 + setupDone 三者齐全 → 不进向导', () => {
    expect(wizardRequired(ok({ ledgerDir: 'C:\\a', l0Dir: 'C:\\b', setupDone: true }))).toBe(false);
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

  test('L0 原数据库随记忆库一起迁移（批次37-A：只带走 L1–L6 会让 has_l0 行全部断链）', () => {
    const from = tempDir('l0from');
    const to = tempDir('l0to');
    write(join(from, 'memories.db.json'), '{"memories":{"m1":{"has_l0":true}}}');
    write(join(from, 'memories.l0.json'), '{"version":1,"items":{"m1":{"envelope":"E","sealed_at":1}}}');
    write(join(from, 'memories.l0.json.lock'), '{"pid":1}'); // 锁文件不是数据，不迁

    const report = migrateDataRoot(from, to);
    expect(report.copied).toContain('memories.l0.json');
    expect(readFileSync(join(to, 'memories.l0.json'), 'utf8')).toContain('"envelope":"E"');
    expect(existsSync(join(to, 'memories.l0.json.lock'))).toBe(false);
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

  test('审计账本与归档目录一起带走（批次41-A：换目录后历史审计不能凭空消失）', () => {
    const from = tempDir('audit-from');
    const to = tempDir('audit-to');
    write(join(from, 'memories.db.json'), '{"memories":{}}');
    write(join(from, 'audit.jsonl'), '{"request_id":"r1"}\n');
    write(join(from, 'audit.jsonl.lock'), '{"pid":1}'); // 锁不是数据，不迁
    write(join(from, 'audit-archive', 'audit-2026-11-01T00-00-00-000Z-001.jsonl'), '{"request_id":"r0"}\n');
    write(join(to, 'audit.jsonl'), '{"request_id":"already-there"}\n');

    const report = migrateDataRoot(from, to);
    expect(report.errors).toEqual([]);
    expect(report.skipped).toContain('audit.jsonl');                 // 目标已有 → 绝不覆盖
    expect(report.copied).toContain('audit-archive/audit-2026-11-01T00-00-00-000Z-001.jsonl');
    expect(readFileSync(join(to, 'audit.jsonl'), 'utf8')).toContain('already-there');
    expect(readFileSync(join(to, 'audit-archive', 'audit-2026-11-01T00-00-00-000Z-001.jsonl'), 'utf8'))
      .toContain('"request_id":"r0"');
    expect(existsSync(join(to, 'audit.jsonl.lock'))).toBe(false);
    expect(existsSync(join(from, 'audit.jsonl'))).toBe(true);        // 源保留

    // 目标没有审计账本时正常带走（上面那轮只是被"不覆盖"挡下）
    const to2 = tempDir('audit-to2');
    expect(migrateDataRoot(from, to2).copied).toContain('audit.jsonl');
    expect(readFileSync(join(to2, 'audit.jsonl'), 'utf8')).toContain('"request_id":"r1"');
  });
});

describe('批次41-A 审计账本位置与白名单', () => {
  test('审计账本跟记忆库同目录（不跟 L0 库走：正文与审计是一套可检索账本）', () => {
    const p = resolveLibraryPaths({ root: 'C:\\data', ledgerDir: 'D:\\ledger', l0Dir: 'E:\\l0' });
    expect(p.audit).toBe(join('D:\\ledger', 'audit.jsonl'));
  });

  test('旧版指针缺 ledgerDir → 审计回落到 root（与记忆库同一位置，兼容读取）', () => {
    const legacy = resolveLibraryPaths({ root: 'C:\\data' });
    expect(legacy.audit).toBe(join('C:\\data', 'audit.jsonl'));
    expect(legacy.audit).toBe(join(legacy.ledgerDir, 'audit.jsonl'));
  });

  test('迁移白名单：文件含 audit.jsonl，目录含 audit-archive（改了这里必须同步 AGENTS §6）', () => {
    expect(DATA_ROOT_MIGRATE_FILES).toContain('audit.jsonl');
    expect(DATA_ROOT_MIGRATE_DIRS).toContain('audit-archive');
  });

  test('只有审计账本也算「这里有数据」（不能因为记忆库为空就认定空目录）', () => {
    const root = tempDir('audit-only');
    expect(hasAnyData(root)).toBe(false);
    write(join(root, 'audit.jsonl'), '{"request_id":"r1"}\n');
    expect(hasAnyData(root)).toBe(true);
    const s = summarizeDataDir(root);
    expect(s.files).toBe(1);
    expect(s.bytes).toBe(Buffer.byteLength('{"request_id":"r1"}\n'));
  });

  test('只有归档目录非空也算有数据，且计入体积统计', () => {
    const root = tempDir('archive-only');
    mkdirSync(join(root, 'audit-archive'), { recursive: true });
    expect(hasAnyData(root)).toBe(false);
    write(join(root, 'audit-archive', 'audit-2026-11-01T00-00-00-000Z-001.jsonl'), 'x');
    expect(hasAnyData(root)).toBe(true);
    expect(summarizeDataDir(root).files).toBe(1);
  });

  test('adoptLibraryDirIntoPlace：逐文件补送、目标同名不动、同目录跳过、源不删', () => {
    const from = tempDir('adopt-from');
    const to = tempDir('adopt-to');
    write(join(from, 'audit-archive', 'a.jsonl'), 'A');
    write(join(from, 'audit-archive', 'b.jsonl'), 'B');
    write(join(to, 'audit-archive', 'b.jsonl'), 'KEEP');

    const r = adoptLibraryDirIntoPlace(from, to, 'audit-archive');
    expect(r).toEqual({ copied: 1, errors: [] });
    expect(readFileSync(join(to, 'audit-archive', 'a.jsonl'), 'utf8')).toBe('A');
    expect(readFileSync(join(to, 'audit-archive', 'b.jsonl'), 'utf8')).toBe('KEEP');
    expect(existsSync(join(from, 'audit-archive', 'a.jsonl'))).toBe(true);

    // 源没有该目录 → 什么都不做，不建空目录
    const empty = tempDir('adopt-empty');
    expect(adoptLibraryDirIntoPlace(empty, to, 'audit-archive')).toEqual({ copied: 0, errors: [] });
    // 同一目录 → 直接跳过
    expect(adoptLibraryDirIntoPlace(to, to, 'audit-archive')).toEqual({ copied: 0, errors: [] });
  });
});
