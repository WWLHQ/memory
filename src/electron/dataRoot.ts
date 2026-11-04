// 数据根目录（批次6）：记忆库、采集游标、日志、MCP 令牌、备份配置等全部持久数据
// 统一挂在用户选定的目录下。引导指针固定放在 %APPDATA%\MultiAgent Memory\data-root.json，
// 不随 userData 漂移；主进程在 ready 前读指针并 app.setPath('userData', root)。
// 本模块只做纯文件操作，不依赖 electron，便于单测。
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync,
  statSync, unlinkSync, writeFileSync, type Dirent,
} from 'node:fs';
import { dirname, join, normalize, posix, win32 } from 'node:path';
import { AUDIT_FILE_NAME } from '../core/memagent/auditLog.ts';

/** 默认数据目录名（安装包/便携包/开发态统一使用产品名目录） */
export const DATA_ROOT_DIR_NAME = 'MultiAgent Memory';
export const DATA_ROOT_POINTER_NAME = 'data-root.json';
export const DATA_ROOT_POINTER_VERSION = 1;

/**
 * 迁移白名单（userData 顶层文件）：
 * 记忆库、采集游标、主/悬浮日志、MCP 本地服务令牌、备份配置、账号审计镜像、Agent 接入配置。
 * 批次41-A：内核审计改落独立追加文件 `audit.jsonl`（跟记忆库同目录），必须一起带走——
 * 少了它就等于「换了目录，审计凭空没了」，而审计是合规账本。
 */
export const DATA_ROOT_MIGRATE_FILES = [
  'memories.db.json',
  'memories.l0.json',
  AUDIT_FILE_NAME,
  'collector-cursor.json',
  'main.log',
  'float.log',
  'actions.log',
  'mcp-token.txt',
  'backup-config.json',
  'home-audit.json',
  'home-locks.json',
  'home-accounts.json',
  'home-mirror.json',
  'agent-onboard.json',
  'l0-keyring.json',
  'llm-config.json',
  'llm-keys.json',
  'llm-deepseek-key.txt',
] as const;

/** 迁移数据子目录：备份历史 / 单条记忆导出 / 审计归档（批次41-A，轮转出的旧审计行都在这里） */
export const DATA_ROOT_MIGRATE_DIRS = ['backups', 'memories-export', 'audit-archive'] as const;

export interface DataRootPointer {
  version: number;
  root: string;
  /** 下次启动时先把该目录的数据复制到 root（不覆盖、不删除源；overwrite 时先备份目标同名文件） */
  migrateFrom?: string;
  /** 显式更改到已有数据的目录：目标同名文件先 .bak-<时间戳> 备份再覆盖 */
  migrateOverwrite?: boolean;
  /**
   * 批次37-B：L1–L6 记忆库所在目录（固定文件名 `memories.db.json`）。
   * 缺省=root（旧版指针没有这两个字段 → 首启向导会强制补齐，绝不静默当成「已配置」）。
   */
  ledgerDir?: string;
  /** 批次37-B：L0 原数据库所在目录（固定文件名 `memories.l0.json`，密钥环同目录） */
  l0Dir?: string;
  /** 批次37-B：首启向导是否走完（两库位置 + L0 管理密码 + 恢复卡已导出）；未走完每次都重新拦 */
  setupDone?: boolean;
  updatedAt: string;
}

export type DataRootPointerRead =
  | { status: 'missing' }
  | { status: 'corrupt'; error: string }
  | { status: 'ok'; pointer: DataRootPointer };

export interface DataRootSummary {
  dir: string;
  files: number;
  bytes: number;
  /** 最近一次数据修改时间（ISO）；无数据时为空串 */
  newest: string;
}

export interface DataRootMigration {
  from: string;
  to: string;
  copied: string[];
  skipped: string[];
  backedUp: string[];
  errors: { path: string; error: string }[];
  dbSource?: string;
}

export function defaultDataRoot(appDataDir: string): string {
  return join(normalize(appDataDir), DATA_ROOT_DIR_NAME);
}

export function dataRootPointerPath(appDataDir: string): string {
  return join(defaultDataRoot(appDataDir), DATA_ROOT_POINTER_NAME);
}

export function readDataRootPointer(file: string): DataRootPointerRead {
  if (!existsSync(file)) return { status: 'missing' };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<DataRootPointer> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.root !== 'string' || !parsed.root.trim()) {
      return { status: 'corrupt', error: '缺少有效 root 字段' };
    }
    const migrateFrom = typeof parsed.migrateFrom === 'string' && parsed.migrateFrom.trim()
      ? normalize(parsed.migrateFrom.trim())
      : undefined;
    const dir = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() ? normalize(v.trim()) : undefined;
    return {
      status: 'ok',
      pointer: {
        version: DATA_ROOT_POINTER_VERSION,
        root: normalize(parsed.root.trim()),
        ...(migrateFrom ? { migrateFrom } : {}),
        ...(parsed.migrateOverwrite === true ? { migrateOverwrite: true } : {}),
        ...(dir(parsed.ledgerDir) ? { ledgerDir: dir(parsed.ledgerDir) } : {}),
        ...(dir(parsed.l0Dir) ? { l0Dir: dir(parsed.l0Dir) } : {}),
        ...(parsed.setupDone === true ? { setupDone: true } : {}),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      },
    };
  } catch (e) {
    return { status: 'corrupt', error: String((e as Error)?.message ?? e) };
  }
}

/** 原子写指针（tmp → rename），父目录不存在时创建 */
export function writeDataRootPointer(file: string, pointer: DataRootPointer): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(pointer, null, 2), 'utf8');
  try {
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

/** 迁移完成（无错误）后清除 migrateFrom/migrateOverwrite，避免每次启动重复扫描 */
export function clearDataRootMigrateFrom(file: string): boolean {
  const read = readDataRootPointer(file);
  if (read.status !== 'ok' || !read.pointer.migrateFrom) return false;
  const { root, ledgerDir, l0Dir, setupDone } = read.pointer;
  // 只清迁移源：批次37-B 的两库位置与向导完成标记必须原样留着，否则清一次游标就把用户退回向导
  writeDataRootPointer(file, {
    version: DATA_ROOT_POINTER_VERSION,
    root,
    ...(ledgerDir ? { ledgerDir } : {}),
    ...(l0Dir ? { l0Dir } : {}),
    ...(setupDone ? { setupDone } : {}),
    updatedAt: new Date().toISOString(),
  });
  return true;
}

/** 两个库及其附属文件的固定文件名（位置=目录，名字不由用户填，避免把库写到奇怪路径上） */
export const LEDGER_FILE_NAME = 'memories.db.json';
export const L0_FILE_NAME = 'memories.l0.json';
/** L0 密钥环与 L0 原数据库同目录：拆库后「恢复 L0」需要的两件东西必须放在一起 */
export const L0_KEYRING_FILE_NAME = 'l0-keyring.json';

export interface LibraryPaths {
  /** 数据根（指针 root，日志/账号/备份配置等其余数据仍落这里） */
  root: string;
  ledgerDir: string;
  l0Dir: string;
  ledger: string;
  l0: string;
  keyring: string;
  /**
   * 批次41-A：内核审计账本（追加式 JSONL）。跟记忆库同目录——审计记的就是「这条记忆发生了什么」，
   * 和可检索正文分开放会让人换目录时只带走一半证据。
   */
  audit: string;
}

/**
 * 指针 → 各数据文件的绝对路径（批次37-B 建，批次41-A 补审计账本）。
 * 旧版指针没有 ledgerDir/l0Dir 时都回落到 root——这是**兼容读取**，不是「向导可以跳过」：
 * 是否跳过向导由 isSetupComplete() 判，缺字段一律走向导。
 */
export function resolveLibraryPaths(pointer: Pick<DataRootPointer, 'root' | 'ledgerDir' | 'l0Dir'>): LibraryPaths {
  const root = normalize(pointer.root);
  const ledgerDir = pointer.ledgerDir ? normalize(pointer.ledgerDir) : root;
  const l0Dir = pointer.l0Dir ? normalize(pointer.l0Dir) : root;
  return {
    root,
    ledgerDir,
    l0Dir,
    ledger: join(ledgerDir, LEDGER_FILE_NAME),
    l0: join(l0Dir, L0_FILE_NAME),
    keyring: join(l0Dir, L0_KEYRING_FILE_NAME),
    audit: join(ledgerDir, AUDIT_FILE_NAME),
  };
}

/**
 * 首启向导是否已走完（批次37-B 的唯一门禁口径）。
 * 三个条件缺一不可：两库位置都显式指定过 + setupDone 为真。只设一个目录不算走完——
 * 这正是「升级也走强制向导」的落点：旧指针两个字段都没有，必然返回 false。
 */
export function isSetupComplete(pointer: Pick<DataRootPointer, 'root' | 'ledgerDir' | 'l0Dir' | 'setupDone'> | null): boolean {
  if (!pointer) return false;
  return Boolean(pointer.ledgerDir && pointer.l0Dir && pointer.setupDone === true);
}

/**
 * 批次41-H：首启向导是否强制打开的**主进程判定**收成纯函数（端壳 `main.ts` 的 `isWizardIncomplete`
 * 直接调用它，接线级测试据此覆盖「指针缺失 / 指针损坏 / 老指针没 setupDone → 一律进向导」）。
 * 入参是 `readDataRootPointer` 的结果：只有 `status==='ok'` 才取指针，其余（missing/corrupt）当 null，
 * 走 `isSetupComplete(null)=false` → 强制向导——升级老指针没有 `setupDone`，照样拦（批次37-B 拍板口径）。
 */
export function wizardRequired(read: DataRootPointerRead): boolean {
  return !isSetupComplete(read.status === 'ok' ? read.pointer : null);
}

/** 两库位置是否都已指定（向导第一段完成判据；setupDone 在第二段才置真） */
export function hasLibraryDirs(pointer: Pick<DataRootPointer, 'ledgerDir' | 'l0Dir'> | null): boolean {
  return Boolean(pointer?.ledgerDir && pointer?.l0Dir);
}

/** 目录是否已经有一份记忆库/原数据库（供向导如实显示「这里有 N 行」而不是让用户猜） */
export function libraryFileState(dir: string, fileName: string): { path: string; exists: boolean; bytes: number } {
  const path = join(dir, fileName);
  try {
    const s = statSync(path);
    return { path, exists: s.isFile(), bytes: s.isFile() ? s.size : 0 };
  } catch {
    return { path, exists: false, bytes: 0 };
  }
}

function pathApi(platform: string): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

export function validateDataRootPath(raw: string, platform: string = process.platform): { ok: true; root: string } | { ok: false; error: string } {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return { ok: false, error: '目录不能为空' };
  const api = pathApi(platform);
  const root = api.normalize(trimmed);
  if (!api.isAbsolute(root)) return { ok: false, error: '必须选择绝对路径目录' };
  if (platform === 'win32' && root.startsWith('\\\\')) return { ok: false, error: '不支持网络共享（UNC）路径' };
  return { ok: true, root };
}

export function samePath(a: string, b: string, platform: string = process.platform): boolean {
  const api = pathApi(platform);
  const na = api.normalize(api.resolve(a));
  const nb = api.normalize(api.resolve(b));
  return platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/** 目录可写性：先创建目录，再写/删探针文件（不依赖权限位判断） */
export function ensureDirWritable(dir: string): { ok: true } | { ok: false; error: string } {
  const probe = join(dir, `.write-probe-${process.pid}-${Date.now().toString(36)}`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    unlinkSync(probe);
    return { ok: true };
  } catch (e) {
    try { unlinkSync(probe); } catch { /* 探针可能未创建 */ }
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

export function hasAnyData(dir: string): boolean {
  if (!existsSync(dir)) return false;
  if (DATA_ROOT_MIGRATE_FILES.some((f) => existsSync(join(dir, f)))) return true;
  return DATA_ROOT_MIGRATE_DIRS.some((d) => {
    try { return readdirSync(join(dir, d)).length > 0; } catch { return false; }
  });
}

/** 统计已知数据文件/子目录（不含 data-root.json 指针） */
export function summarizeDataDir(dir: string): DataRootSummary {
  let files = 0;
  let bytes = 0;
  let newest = 0;
  const visit = (file: string): void => {
    try {
      const s = statSync(file);
      if (s.isDirectory()) {
        for (const entry of readdirSync(file, { withFileTypes: true })) visit(join(file, entry.name));
        return;
      }
      if (!s.isFile()) return;
      files += 1;
      bytes += s.size;
      newest = Math.max(newest, s.mtimeMs);
    } catch {
      /* 无权限/已删除：跳过 */
    }
  };
  for (const f of DATA_ROOT_MIGRATE_FILES) visit(join(dir, f));
  for (const d of DATA_ROOT_MIGRATE_DIRS) visit(join(dir, d));
  return { dir: normalize(dir), files, bytes, newest: newest ? new Date(newest).toISOString() : '' };
}

/**
 * 探测旧数据位置：默认目录（MultiAgent Memory）与旧目录（multi-agent-memory）。
 * 排除用户本次选定的目录；按最近修改时间倒序（最新者作为迁移源）。
 */
export function detectDataRoots(appDataDir: string, chosenRoot: string, platform: string = process.platform): DataRootSummary[] {
  const candidates = [defaultDataRoot(appDataDir), join(normalize(appDataDir), 'multi-agent-memory')];
  const seen = new Set<string>();
  const out: DataRootSummary[] = [];
  for (const dir of candidates) {
    const key = platform === 'win32' ? normalize(dir).toLowerCase() : normalize(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    if (samePath(dir, chosenRoot, platform)) continue;
    if (!hasAnyData(dir)) continue;
    out.push(summarizeDataDir(dir));
  }
  return out.sort((a, b) => b.newest.localeCompare(a.newest) || b.bytes - a.bytes);
}

interface LegacyBackupConfig {
  dbDir?: unknown;
  pendingMove?: unknown;
  [k: string]: unknown;
}

function readJsonObject(file: string): LegacyBackupConfig | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as LegacyBackupConfig;
  } catch {
    return null;
  }
}

function copyDirMissing(src: string, dst: string, report: DataRootMigration, rel: string): void {
  if (!existsSync(src)) return;
  try {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true }) as Dirent[]) {
      const s = join(src, entry.name);
      const d = join(dst, entry.name);
      const r = `${rel}/${entry.name}`;
      if (entry.isDirectory()) { copyDirMissing(s, d, report, r); continue; }
      if (!entry.isFile()) continue;
      if (existsSync(d)) { report.skipped.push(r); continue; }
      try {
        copyFileSync(s, d);
        report.copied.push(r);
      } catch (e) {
        report.errors.push({ path: r, error: String((e as Error)?.message ?? e) });
      }
    }
  } catch (e) {
    report.errors.push({ path: rel, error: String((e as Error)?.message ?? e) });
  }
}

/**
 * 旧目录 → 新数据根：只复制白名单文件/目录（源绝不删除）。
 * 目标同名文件默认跳过；overwrite=true（显式更改到已有数据的目录）时先备份为 *.bak-<时间戳> 再覆盖。
 * 旧 backup-config.json 的历史 dbDir/pendingMove 已由全局数据根取代 → 复制时清空。
 * 旧版 dbDir 指向其它目录时，以该目录下的 memories.db.json 作为真实记忆库来源。
 */
export function migrateDataRoot(
  from: string,
  to: string,
  platform: string = process.platform,
  opts: { overwrite?: boolean } = {},
): DataRootMigration {
  const report: DataRootMigration = {
    from: normalize(from), to: normalize(to), copied: [], skipped: [], backedUp: [], errors: [],
  };
  if (samePath(from, to, platform)) {
    report.skipped.push('(same-path)');
    return report;
  }
  mkdirSync(to, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const legacyCfg = readJsonObject(join(from, 'backup-config.json'));
  const legacyDbDir = typeof legacyCfg?.dbDir === 'string' && legacyCfg.dbDir.trim() ? normalize(legacyCfg.dbDir.trim()) : '';
  for (const file of DATA_ROOT_MIGRATE_FILES) {
    let src = join(from, file);
    if (file === 'memories.db.json' && legacyDbDir) {
      const fromCfg = join(legacyDbDir, 'memories.db.json');
      if (existsSync(fromCfg)) { src = fromCfg; report.dbSource = fromCfg; }
    }
    if (!existsSync(src)) continue;
    const dst = join(to, file);
    if (existsSync(dst)) {
      if (!opts.overwrite) { report.skipped.push(file); continue; }
      try {
        const backup = `${dst}.bak-${stamp}`;
        renameSync(dst, backup);
        report.backedUp.push(backup);
      } catch (e) {
        report.errors.push({ path: file, error: `备份目标文件失败：${String((e as Error)?.message ?? e)}` });
        continue;
      }
    }
    try {
      copyFileSync(src, dst);
      report.copied.push(file);
      if (file === 'backup-config.json') {
        const cfg = readJsonObject(dst);
        if (cfg) {
          delete cfg.dbDir;
          delete cfg.pendingMove;
          writeFileSync(dst, JSON.stringify(cfg, null, 2), 'utf8');
        }
      }
    } catch (e) {
      report.errors.push({ path: file, error: String((e as Error)?.message ?? e) });
    }
  }
  for (const dirName of DATA_ROOT_MIGRATE_DIRS) {
    copyDirMissing(join(from, dirName), join(to, dirName), report, dirName);
  }
  return report;
}

/**
 * 换目录时把一个**子目录**逐文件补送到目标（目标同名不动、源绝不删）。
 * 批次41-A 用于 `audit-archive/`：归档里的旧审计行仍然要能在页面里查到，
 * 少送这个目录 = 「换了位置，历史审计凭空消失」，而审计是合规账本。
 */
export function adoptLibraryDirIntoPlace(
  fromDir: string,
  toDir: string,
  dirName: string,
): { copied: number; errors: string[] } {
  if (samePath(fromDir, toDir)) return { copied: 0, errors: [] };
  const report: DataRootMigration = {
    from: normalize(fromDir), to: normalize(toDir), copied: [], skipped: [], backedUp: [], errors: [],
  };
  copyDirMissing(join(fromDir, dirName), join(toDir, dirName), report, dirName);
  return { copied: report.copied.length, errors: report.errors.map((e) => `${e.path}: ${e.error}`) };
}
