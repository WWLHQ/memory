// 内核审计账本（批次41-A）：从 memories.db.json 里搬出来，独立成追加式 JSONL。
// 为什么要搬：审计此前是记忆库对象里的一个数组，每追加一条 = 整库 JSON.stringify + fsync + rename。
//   本机实测 11,600 条审计时库文件 12.89 MiB → 写放大 O(n²)，UI 卡顿与掉电风险同步上升（评审 P1-5）。
//   现在：一条审计 = 一次 append + fsync（O(记录大小)），记忆库体积不再随审计增长。
// 口径不变的两件事：
//   · append-only（§4.3）：本模块从不删除已写入的审计内容；轮转只是把整档移到 audit-archive/ 继续可读。
//   · queryAudit 仍是全量真数据：归档与在档记录都在同一内存视图里，页面看到的条数不因拆文件而变化。
// 只读镜像（批次28-A 同一套）：跟随文件字节数**增量**读取——追加式文件只需读新字节，比整库重载便宜。
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, readSync,
  renameSync, statSync, writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { AuditAction, AuditRecord } from './types.ts';

/** 在档审计文件名（与记忆库同目录；跟着 ledgerDir 走） */
export const AUDIT_FILE_NAME = 'audit.jsonl';

/** 在档文件（audit.jsonl）超过这个字节数就整档归档、另起一份。归档不删数据，只换文件。 */
export const AUDIT_ACTIVE_MAX_BYTES = 16 * 1024 * 1024;

/** 审计账本结构完全读不认：原件改名保留 + 显式抛错（与记忆库 D3 同口径），绝不静默当空账本 */
export class AuditLogCorruptError extends Error {
  readonly code = 'E_AUDIT_LOG_CORRUPT';
  constructor(
    readonly path: string,
    readonly backupPath: string | null,
    override readonly cause?: unknown,
  ) {
    super(`内核审计账本无法读取：${path}${backupPath ? `（原件已备份到 ${backupPath}）` : ''}`);
    this.name = 'AuditLogCorruptError';
  }
}

/** 只读镜像上的写（绝不在别人的账本上追加/改名） */
export class AuditLogLockedError extends Error {
  readonly code = 'E_AUDIT_LOG_LOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'AuditLogLockedError';
  }
}

export interface AuditFilter {
  request_id?: string;
  action?: AuditAction;
  since?: number;
  /** 截止时间（含上界）；与 since 组合成真实时间窗筛选 */
  until?: number;
  /** 宿主 Agent（AuditRecord.agent） */
  agent?: string;
}

/** 回显给设置页/诊断的真实账本状态（数字全部实测，不估算） */
export interface AuditLogStats {
  path: string;
  archive_dir: string;
  /** 当前可查的审计条数（归档 + 在档，同一内存视图） */
  rows: number;
  /** 在档文件字节数 */
  bytes: number;
  archive_files: number;
  archive_bytes: number;
  /** 已移进归档的行数（仍在 rows 里，这里只让「轮转发生过」可见） */
  archived_rows: number;
  /** 解析不出来的行（截断/损坏）——必须可见，不许静默丢弃 */
  skipped_lines: number;
  readonly: boolean;
}

export interface FileAuditLogOptions {
  /** 只读（镜像另一个进程的账本）：绝不写盘、绝不轮转、绝不改名别人的文件 */
  readonly?: boolean;
  /** 在档文件大小闸门（单测用小数触发轮转） */
  maxBytes?: number;
}

interface ParsedFile {
  records: AuditRecord[];
  skipped: number;
}

/** 一行一个审计记录；认不出结构的行只计数，不猜 */
function parseLine(line: string): AuditRecord | null {
  try {
    const raw = JSON.parse(line) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const a = raw as Partial<AuditRecord>;
    if (typeof a.request_id !== 'string' || typeof a.action !== 'string' || typeof a.ts !== 'number') return null;
    return {
      ...a,
      request_id: a.request_id,
      action: a.action as AuditAction,
      ts: a.ts,
      detail: a.detail && typeof a.detail === 'object' ? a.detail : {},
    } as AuditRecord;
  } catch {
    return null;
  }
}

function lineOf(a: AuditRecord): string {
  return `${JSON.stringify(a)}\n`;
}

function matches(a: AuditRecord, filter: AuditFilter): boolean {
  if (filter.request_id && a.request_id !== filter.request_id) return false;
  if (filter.action && a.action !== filter.action) return false;
  if (filter.since !== undefined && a.ts < filter.since) return false;
  if (filter.until !== undefined && a.ts > filter.until) return false;
  if (filter.agent && a.agent !== filter.agent) return false;
  return true;
}

/**
 * 追加式审计账本。
 * 落盘布局：`<dir>/audit.jsonl`（在档）+ `<dir>/audit-archive/audit-<UTC时间戳>-<序号>.jsonl`（归档，永不自动删）。
 */
export class FileAuditLog {
  private records: AuditRecord[] = [];
  private batching = false;
  private pending: string[] = [];
  private open = true;
  /** 已读到的字节数：只读镜像据此判断「写方追加了什么」 */
  private loadedBytes = 0;
  private archivedRows = 0;
  private skipped = 0;
  private readonly mode: boolean;
  private readonly maxBytes: number;

  constructor(
    private readonly filePath: string,
    opts: FileAuditLogOptions = {},
  ) {
    this.mode = opts.readonly === true;
    this.maxBytes = opts.maxBytes ?? AUDIT_ACTIVE_MAX_BYTES;
    mkdirSync(dirname(filePath), { recursive: true });
    this.loadAll();
  }

  get path(): string {
    return this.filePath;
  }

  get archiveDir(): string {
    return join(dirname(this.filePath), 'audit-archive');
  }

  get readOnly(): boolean {
    return this.mode;
  }

  // ---------------- 写 ----------------

  beginBatch(): void {
    this.assertWritable();
    this.batching = true;
  }

  /** 落盘失败原样上抛、批次保留：绝不「标已提交、实际没落盘」（与 FileStorage 同口径） */
  commitBatch(): void {
    if (!this.batching) return;
    if (this.pending.length > 0) {
      this.writeBytes(this.pending.join(''));
      this.pending = [];
    }
    this.batching = false;
    this.rotateIfNeeded();
  }

  /** 追加一条：先落盘成功，再进内存视图（失败不留「内存有、磁盘没有」的半态） */
  append(a: AuditRecord): void {
    this.assertWritable();
    const line = lineOf(a);
    if (this.batching) {
      this.pending.push(line);
      this.records.push(a);
      return;
    }
    this.writeBytes(line);
    this.records.push(a);
    this.rotateIfNeeded();
  }

  /** 一次性补齐（存量迁移用）：整批一次落盘；落盘失败原样上抛，内存视图不会多出半批 */
  appendMany(list: readonly AuditRecord[]): void {
    this.assertWritable();
    if (list.length === 0) return;
    const text = list.map(lineOf).join('');
    if (this.batching) this.pending.push(text);
    else this.writeBytes(text);
    // 逐条 push：`...list` 展开在几万行时会顶到实参上限（存量迁移正是这种量级）
    for (const a of list) this.records.push(a);
    if (!this.batching) this.rotateIfNeeded();
  }

  private assertWritable(): void {
    if (this.mode) throw new AuditLogLockedError('审计账本处于只读模式（本进程未持有写入权），不可追加。');
  }

  /** 追加 + fsync：掉电后要么拿到完整行，要么是旧内容；不会破坏已有行 */
  private writeBytes(text: string): void {
    const fd = openSync(this.filePath, 'a');
    try {
      writeSync(fd, text, null, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.loadedBytes = this.sizeOf(this.filePath);
  }

  /** 在档超闸门 → 整档移进 audit-archive/、另起新文件。一条不删，内存视图（可查范围）不变。 */
  private rotateIfNeeded(): void {
    if (this.mode) return;
    const bytes = this.sizeOf(this.filePath);
    if (bytes === 0 || bytes <= this.maxBytes) return;
    let target: string | null = null;
    try {
      mkdirSync(this.archiveDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      // 序号恒定存在并补零：同一毫秒轮转两次时，纯字典序仍等于时间序（不带序号的名字会排到带序号的后面）
      let seq = 1;
      target = join(this.archiveDir, `audit-${stamp}-${String(seq).padStart(3, '0')}.jsonl`);
      for (; existsSync(target); seq++) target = join(this.archiveDir, `audit-${stamp}-${String(seq).padStart(3, '0')}.jsonl`);
      const moved = this.countLines(this.filePath);
      renameSync(this.filePath, target);
      this.archivedRows += moved;
      this.loadedBytes = 0;
    } catch {
      // 归档没挪成（被占用/权限）：继续在在档文件上追加，下次写再试。轮转失败绝不能丢审计。
    }
  }

  // ---------------- 读 ----------------

  query(filter: AuditFilter): AuditRecord[] {
    this.maybeReload();
    return this.records.filter((a) => matches(a, filter));
  }

  /** 全量真数据：归档在前、在档在后（与旧实现「按写入先后」同序） */
  list(): AuditRecord[] {
    this.maybeReload();
    return [...this.records];
  }

  count(): number {
    this.maybeReload();
    return this.records.length;
  }

  stats(): AuditLogStats {
    this.maybeReload();
    const archives = this.archiveFileNames();
    return {
      path: this.filePath,
      archive_dir: this.archiveDir,
      rows: this.records.length,
      bytes: this.sizeOf(this.filePath),
      archive_files: archives.length,
      archive_bytes: archives.reduce((sum, name) => sum + this.sizeOf(join(this.archiveDir, name)), 0),
      archived_rows: this.archivedRows,
      skipped_lines: this.skipped,
      readonly: this.mode,
    };
  }

  close(): void {
    if (!this.open) return;
    if (this.batching && !this.mode) this.commitBatch();
    this.batching = false;
    this.open = false;
  }

  /** 只读镜像：文件变长 = 写方追加 → 只读新字节；变短 = 轮转/重建 → 整体重载 */
  private maybeReload(): void {
    if (!this.mode) return;
    const size = this.sizeOf(this.filePath);
    if (size === this.loadedBytes) return;
    if (size < this.loadedBytes) {
      this.loadAll();
      return;
    }
    const chunk = readFrom(this.filePath, this.loadedBytes, size);
    if (chunk === null) return;
    this.loadedBytes = size;
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      const rec = parseLine(line);
      if (rec) this.records.push(rec);
      else this.skipped += 1;
    }
  }

  /** 归档（文件名含 UTC 时间戳，升序 = 时间升序）+ 在档，一次装进内存视图 */
  private loadAll(): void {
    const rows: AuditRecord[] = [];
    let skipped = 0;
    for (const name of this.archiveFileNames()) {
      const parsed = this.readWhole(join(this.archiveDir, name));
      rows.push(...parsed.records);
      skipped += parsed.skipped;
    }
    const active = this.readWhole(this.filePath);
    rows.push(...active.records);
    this.records = rows;
    this.archivedRows = rows.length - active.records.length;
    this.skipped = skipped + active.skipped;
    this.loadedBytes = this.sizeOf(this.filePath);
  }

  /**
   * 读一整档。逐行解析：坏行只计数（掉电截断的尾行属正常残留）。
   * 整档一行都没认出来 → 结构不对，不是截断：可写时改名隔离 + 抛错（绝不静默空账本）；
   * 只读时不改名别人的文件，原样抛出。
   */
  private readWhole(file: string): ParsedFile {
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], skipped: 0 };
      if (this.mode) throw new AuditLogCorruptError(file, null, e);
      throw new AuditLogCorruptError(file, this.backupCorrupt(file), e);
    }
    if (!raw.trim()) return { records: [], skipped: 0 };
    const records: AuditRecord[] = [];
    let skipped = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const rec = parseLine(line);
      if (rec) records.push(rec);
      else skipped += 1;
    }
    if (records.length === 0 && skipped > 0) {
      if (this.mode) throw new AuditLogCorruptError(file, null, `解析失败 ${skipped} 行`);
      throw new AuditLogCorruptError(file, this.backupCorrupt(file), `解析失败 ${skipped} 行`);
    }
    return { records, skipped };
  }

  private backupCorrupt(file: string): string | null {
    try {
      let target = `${file}.corrupt`;
      for (let i = 1; existsSync(target); i++) target = `${file}.corrupt.${i}`;
      renameSync(file, target);
      return target;
    } catch {
      return null;
    }
  }

  private archiveFileNames(): string[] {
    try {
      return readdirSync(this.archiveDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.startsWith('audit-') && e.name.endsWith('.jsonl'))
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  private sizeOf(file: string): number {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  }

  private countLines(file: string): number {
    try {
      let n = 0;
      for (const line of readFileSync(file, 'utf8').split('\n')) if (line.trim()) n += 1;
      return n;
    } catch {
      return 0;
    }
  }
}

/** 从指定字节位置读到 to（不用 allocUnsafe：短读时未初始化堆内存可能混进结果） */
function readFrom(file: string, from: number, to: number): string | null {
  const len = to - from;
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const read = readSync(fd, buf, 0, len, from);
    return read > 0 ? buf.subarray(0, read).toString('utf8') : null;
  } finally {
    closeSync(fd);
  }
}

export default FileAuditLog;
