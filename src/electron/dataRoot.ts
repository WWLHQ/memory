// 数据根目录（批次6）：记忆库、采集游标、日志、MCP 令牌、备份配置等全部持久数据
// 统一挂在用户选定的目录下。引导指针固定放在 %APPDATA%\MultiAgent Memory\data-root.json，
// 不随 userData 漂移；主进程在 ready 前读指针并 app.setPath('userData', root)。
// 本模块只做纯文件操作，不依赖 electron，便于单测。
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync,
  statSync, unlinkSync, writeFileSync, type Dirent,
} from 'node:fs';
import { dirname, join, normalize, posix, win32 } from 'node:path';

/** 默认数据目录名（安装包/便携包/开发态统一使用产品名目录） */
export const DATA_ROOT_DIR_NAME = 'MultiAgent Memory';
export const DATA_ROOT_POINTER_NAME = 'data-root.json';
export const DATA_ROOT_POINTER_VERSION = 1;

/**
 * 迁移白名单（userData 顶层文件）：
 * 记忆库、采集游标、主/悬浮日志、MCP 本地服务令牌、备份配置、账号审计镜像、Agent 接入配置。
 */
export const DATA_ROOT_MIGRATE_FILES = [
  'memories.db.json',
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
  'llm-deepseek-key.txt',
] as const;

/** 迁移数据子目录：备份历史 / 单条记忆导出 */
export const DATA_ROOT_MIGRATE_DIRS = ['backups', 'memories-export'] as const;

export interface DataRootPointer {
  version: number;
  root: string;
  /** 下次启动时先把该目录的数据复制到 root（不覆盖、不删除源；overwrite 时先备份目标同名文件） */
  migrateFrom?: string;
  /** 显式更改到已有数据的目录：目标同名文件先 .bak-<时间戳> 备份再覆盖 */
  migrateOverwrite?: boolean;
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
    return {
      status: 'ok',
      pointer: {
        version: DATA_ROOT_POINTER_VERSION,
        root: normalize(parsed.root.trim()),
        ...(migrateFrom ? { migrateFrom } : {}),
        ...(parsed.migrateOverwrite === true ? { migrateOverwrite: true } : {}),
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
  writeDataRootPointer(file, {
    version: DATA_ROOT_POINTER_VERSION,
    root: read.pointer.root,
    updatedAt: new Date().toISOString(),
  });
  return true;
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
