// L0 原数据库（批次37）：把每条记忆的 L0 密文从「记忆库」里搬出来，单独落一个文件。
//   · 记忆库 memories.db.json = L1–L6 精炼产物（可检索层，L0 正文不在此；审计自批次41-A 起另落 audit.jsonl）。
//   · 原数据库 memories.l0.json = { version, items: { [mem_id]: { envelope, sealed_at } } }，只放 v2/v1 信封密文。
//   · 各库文件各自原子写（写 tmp → fsync → rename）、各自 <path>.lock 建议性写锁（与 FileStorage 同口径）。
//   · 只认密文：写入明文会被拒绝（E_L0_NOT_SEALED）——搬家不等于加密，绝不把明文当 L0 库存。
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseL0Envelope, parseL0EnvelopeV2 } from './crypto.ts';

/** L0 库里的单条原始数据：信封密文 + 封存时刻 */
export interface L0Blob {
  envelope: string;
  sealed_at: number;
}

/** L0 库读写端口（桌面端 = FileL0BlobStore；测试 = InMemoryL0BlobStore） */
export interface L0BlobStore {
  readonly path: string;
  /** 只读态：本进程没拿到写锁（另一个活进程在写）或构造时显式只读 */
  readonly readOnly: boolean;
  get(mem_id: string): Promise<L0Blob | null>;
  /**
   * 批量回读（批次37-A）：查阅整库 L0 时逐条取会打爆 IPC，一次取完。
   * 返回值只包含**取到**的 id——缺的留给调用方判「断链」（行说有 L0、库里没有），绝不补空信封。
   */
  getAll?(mem_ids: readonly string[]): Promise<Map<string, string>>;
  put(mem_id: string, blob: L0Blob): Promise<void>;
  delete(mem_id: string): Promise<void>;
  /** 全部持有 L0 的 mem_id（完整性核对/重建扫描用） */
  ids(): Promise<string[]>;
  count(): Promise<number>;
  /** 当前落盘字节数（预览与安全页回显；未落盘时为 0） */
  bytes(): number;
  beginBatch(): void;
  commitBatch(): void;
  close(): void;
}

/** 明文冒充 L0：显式拒绝，不做「先存明文、以后再说」 */
export class L0NotSealedError extends Error {
  readonly code = 'E_L0_NOT_SEALED';
  constructor(message: string) {
    super(message);
    this.name = 'L0NotSealedError';
  }
}

/** L0 库不可写（本进程只读构造，或写锁被另一个活进程持有）——与记忆库 StorageLockedError 同口径 */
export class L0StoreLockedError extends Error {
  readonly code = 'E_L0_STORE_LOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'L0StoreLockedError';
  }
}

/** L0 库损坏隔离（与记忆库同一口径：原件改名保留，绝不静默当空库） */
export class L0StoreCorruptError extends Error {
  readonly code = 'E_L0_STORE_CORRUPT';
  constructor(
    readonly path: string,
    readonly backupPath: string | null,
    override readonly cause?: unknown,
  ) {
    super(`L0 原数据库无法读取：${path}${backupPath ? `（原件已备份到 ${backupPath}）` : ''}`);
    this.name = 'L0StoreCorruptError';
  }
}

interface L0Doc {
  version: number;
  items: Record<string, L0Blob>;
}

const L0_DOC_VERSION = 1;
const emptyDoc = (): L0Doc => ({ version: L0_DOC_VERSION, items: {} });

/** 只接受能解析出内容的 v2（推荐）或 v1（遗留待迁移）信封 */
export function isSealedL0(raw: string): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  return parseL0EnvelopeV2(raw) !== null || parseL0Envelope(raw) !== null;
}

function assertMemId(mem_id: string): void {
  if (typeof mem_id !== 'string' || !mem_id.trim()) throw new Error('E_L0_BAD_MEM_ID: L0 库写入缺少 mem_id');
}

export interface FileL0BlobStoreOptions {
  /** 只读（镜像别的进程的账本）：绝不写盘、绝不取锁 */
  readonly?: boolean;
  /** 文件权限，默认 0600（只有密文，仍按敏感文件处理） */
  mode?: number;
}

/** 落盘版 L0 库：单进程主源，写锁被活进程持有时自动降级只读 */
export class FileL0BlobStore implements L0BlobStore {
  private doc: L0Doc;
  private open = true;
  private batching = false;
  private dirty = false;
  private readonly mode: boolean;
  private readonly lockPath: string;
  private ownsLock = false;
  private lockHolder: { pid: number; at: number } | null = null;
  private readonly fileMode: number;

  constructor(private readonly filePath: string, opts: FileL0BlobStoreOptions = {}) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.lockPath = `${filePath}.lock`;
    this.fileMode = opts.mode ?? 0o600;
    this.mode = opts.readonly === true || !this.acquireLock();
    this.doc = this.load();
  }

  get path(): string {
    return this.filePath;
  }

  get readOnly(): boolean {
    return this.mode;
  }

  get lockedBy(): { pid: number; at: number } | null {
    return this.lockHolder;
  }

  private acquireLock(): boolean {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(this.lockPath, 'wx');
        try {
          writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }), 'utf8');
        } finally {
          closeSync(fd);
        }
        this.ownsLock = true;
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const holder = this.readLockHolder();
        if (holder && this.pidAlive(holder.pid)) {
          this.lockHolder = holder;
          return false;
        }
        try { unlinkSync(this.lockPath); } catch { /* 陈旧锁删不掉：下一轮再试 */ }
      }
    }
    return false;
  }

  private readLockHolder(): { pid: number; at: number } | null {
    try {
      const raw = JSON.parse(readFileSync(this.lockPath, 'utf8')) as { pid?: unknown; at?: unknown };
      if (typeof raw?.pid === 'number') return { pid: raw.pid, at: typeof raw.at === 'number' ? raw.at : 0 };
    } catch { /* 锁文件损坏视同陈旧 */ }
    return null;
  }

  private pidAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  private assertWritable(): void {
    if (this.mode) {
      throw new L0StoreLockedError(
        this.lockHolder
          ? 'L0 原数据库正被其它进程写入（桌面端运行中），当前为只读；写入请用桌面端。'
          : 'L0 原数据库处于只读模式，不可写入。',
      );
    }
  }

  private load(): L0Doc {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (e) {
      // 不存在 = 空库（首次启动/新目录），这是正常态，不报损坏
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyDoc();
      throw new L0StoreCorruptError(this.filePath, null, e);
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape: root 非对象');
      const doc = parsed as Partial<L0Doc>;
      if (doc.items !== undefined && (typeof doc.items !== 'object' || doc.items === null || Array.isArray(doc.items))) {
        throw new Error('shape: items 非对象');
      }
      const items: Record<string, L0Blob> = {};
      for (const [id, blob] of Object.entries(doc.items ?? {})) {
        const b = blob as Partial<L0Blob> | null;
        if (!b || typeof b.envelope !== 'string' || !b.envelope) throw new Error(`shape: ${id} 缺 envelope`);
        items[id] = { envelope: b.envelope, sealed_at: typeof b.sealed_at === 'number' ? b.sealed_at : 0 };
      }
      return { version: typeof doc.version === 'number' ? doc.version : L0_DOC_VERSION, items };
    } catch (e) {
      throw new L0StoreCorruptError(this.filePath, this.backupCorrupt(), e);
    }
  }

  /** 损坏原件改名保留（人工仍可取回），返回备份路径 */
  private backupCorrupt(): string | null {
    try {
      let target = `${this.filePath}.corrupt`;
      for (let i = 1; existsSync(target); i++) target = `${this.filePath}.corrupt.${i}`;
      renameSync(this.filePath, target);
      return target;
    } catch {
      return null;
    }
  }

  private persist(): void {
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.doc), { encoding: 'utf8', mode: this.fileMode });
    const fd = openSync(tmp, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.filePath);
    try { chmodSync(this.filePath, this.fileMode); } catch { /* Windows 权限尽力而为 */ }
  }

  private touch(): void {
    if (this.batching) this.dirty = true;
    else this.persist();
  }

  /** 写盘失败回滚内存：绝不留「内存有密文、磁盘没有」的半态 */
  private touchOrRollback(undo: () => void): void {
    try {
      this.touch();
    } catch (e) {
      undo();
      throw e;
    }
  }

  async get(mem_id: string): Promise<L0Blob | null> {
    const blob = this.doc.items[mem_id];
    return blob ? { ...blob } : null;
  }

  async getAll(mem_ids: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of mem_ids) {
      const blob = this.doc.items[id];
      if (blob) out.set(id, blob.envelope);
    }
    return out;
  }

  async put(mem_id: string, blob: L0Blob): Promise<void> {
    this.assertWritable();
    assertMemId(mem_id);
    if (!isSealedL0(blob?.envelope ?? '')) {
      throw new L0NotSealedError(`L0 库只收已封存信封：${mem_id} 的正文不是 v2/v1 信封（明文不许进 L0 库）`);
    }
    const prev = this.doc.items[mem_id];
    this.doc.items[mem_id] = { envelope: blob.envelope, sealed_at: blob.sealed_at };
    this.touchOrRollback(() => {
      if (prev === undefined) delete this.doc.items[mem_id];
      else this.doc.items[mem_id] = prev;
    });
  }

  async delete(mem_id: string): Promise<void> {
    this.assertWritable();
    const prev = this.doc.items[mem_id];
    if (prev === undefined) return; // 幂等
    delete this.doc.items[mem_id];
    this.touchOrRollback(() => {
      this.doc.items[mem_id] = prev;
    });
  }

  async ids(): Promise<string[]> {
    return Object.keys(this.doc.items);
  }

  async count(): Promise<number> {
    return Object.keys(this.doc.items).length;
  }

  bytes(): number {
    try {
      return statSync(this.filePath).size;
    } catch {
      return 0;
    }
  }

  beginBatch(): void {
    this.assertWritable();
    this.batching = true;
  }

  /** 与 FileStorage.commitBatch 同口径：写盘失败保留批次，绝不「标已提交、实际没落盘」 */
  commitBatch(): void {
    if (!this.batching) return;
    if (!this.dirty) {
      this.batching = false;
      return;
    }
    this.persist();
    this.batching = false;
    this.dirty = false;
  }

  close(): void {
    if (!this.open) return;
    if (this.mode) { this.open = false; return; }
    this.commitBatch();
    this.open = false;
    if (this.ownsLock) {
      try { unlinkSync(this.lockPath); } catch { /* 陈旧锁由下个实例按死 pid 判定 */ }
      this.ownsLock = false;
    }
  }
}

/** 测试用内存 L0 库（与 InMemoryStorage 配套，保持同一套断言写法） */
export class InMemoryL0BlobStore implements L0BlobStore {
  private readonly items = new Map<string, L0Blob>();
  readonly path = '<memory>';
  readonly readOnly = false;

  async get(mem_id: string): Promise<L0Blob | null> {
    return this.items.get(mem_id) ?? null;
  }

  async getAll(mem_ids: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of mem_ids) {
      const blob = this.items.get(id);
      if (blob) out.set(id, blob.envelope);
    }
    return out;
  }

  async put(mem_id: string, blob: L0Blob): Promise<void> {
    assertMemId(mem_id);
    if (!isSealedL0(blob?.envelope ?? '')) {
      throw new L0NotSealedError(`L0 库只收已封存信封：${mem_id}`);
    }
    this.items.set(mem_id, { ...blob });
  }

  async delete(mem_id: string): Promise<void> {
    this.items.delete(mem_id);
  }

  async ids(): Promise<string[]> {
    return [...this.items.keys()];
  }

  async count(): Promise<number> {
    return this.items.size;
  }

  bytes(): number {
    let n = 0;
    for (const b of this.items.values()) n += b.envelope.length;
    return n;
  }

  beginBatch(): void { /* 内存实现无需批量 */ }
  commitBatch(): void { /* 内存实现无需批量 */ }
  close(): void { /* 内存实现无需关闭 */ }
}

export default FileL0BlobStore;
