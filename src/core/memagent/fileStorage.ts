// FileStorage（§5.3）：桌面/CLI 本地库 = P0 主源（零依赖，纯文件系统，无 node:sqlite）。
// 与 SqliteStorage 接口同构：memories/audit 两集合，完整对象以 JSON 落盘（原子写，单文件单进程安全）。
// 设计取舍：
//   · 不引入 node:sqlite（Electron 34 打包后运行时缺该内置模块，双击即崩）→ 纯 fs 实现，安装包零外部依赖。
//   · 单文件 <userData>/memories.db.json + 同步原子写（写 tmp → rename）保证崩溃一致性；
//     桌面壳为单进程主源，无并发写竞争，故不需 WAL/锁。
//   · 与 SqliteStorage 相同的方法签名 + 测试辅助（size/close），可被同一套测试消费（见 __tests__）。
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, openSync, fsyncSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditAction, AuditRecord, Filter, Memory, StorageBackend } from './types.ts';

interface FileDoc {
  memories: Record<string, Memory>;
  audit: AuditRecord[];
}

/** 损坏隔离通知（D3）：首次损坏时落 sidecar，端壳下次启动消费并提示，避免"静默空库" */
export interface CorruptionNotice {
  db_path: string;
  backup_path: string | null;
  error: string;
  ts: string;
}

/** 本地库损坏（D3）：显式抛出，由端壳弹窗提示；原文件已备份为 *.corrupt，绝不静默清空 */
export class StorageCorruptError extends Error {
  readonly code = 'E_STORAGE_CORRUPT';
  constructor(
    readonly dbPath: string,
    readonly backupPath: string | null,
    override readonly cause?: unknown,
  ) {
    super(`本地记忆库损坏，无法读取：${dbPath}${backupPath ? `（原件已备份到 ${backupPath}）` : ''}`);
    this.name = 'StorageCorruptError';
  }
}

export class FileStorage implements StorageBackend {
  private doc: FileDoc;
  private open = true;
  /** 批量模式：true 时 putMemory/appendAudit 只改内存、不逐次同步写盘；
   *  由 commitBatch() 一次性 persist（把 N 次全量同步写盘降为 1 次，避免卡死事件循环）。 */
  private batching = false;
  private dirty = false;

  constructor(private readonly dbPath: string) {
    const dir = dirname(dbPath);
    mkdirSync(dir, { recursive: true });
    this.doc = this.load();
  }

  /** 开启批量模式（会话采集等大批量入库场景）。需配合 commitBatch 结束。
   *  不清脏标记：上一次提交若因写盘失败被中止，这里的待落盘批次仍要由下次 commit 完成。 */
  beginBatch(): void {
    this.batching = true;
  }

  /** 提交批量：一次性同步写盘。写盘失败则原样上抛并保留批次（batching/dirty 不动），
   *  由调用方重试或 close() 兜底——绝不「标已提交、实际没落盘」。无脏则直接结束批量。 */
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

  /** 读盘 → 结构：仅"文件不存在"视为空库；损坏/非法结构 → 备份 .corrupt + 显式抛错（D3） */
  private load(): FileDoc {
    let raw: string;
    try {
      raw = readFileSync(this.dbPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { memories: {}, audit: [] };
      this.writeCorruptionNotice(null, e);
      throw new StorageCorruptError(this.dbPath, null, e);
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape: root 非对象');
      const doc = parsed as Partial<FileDoc>;
      if (doc.memories !== undefined && (typeof doc.memories !== 'object' || doc.memories === null || Array.isArray(doc.memories))) {
        throw new Error('shape: memories 非对象');
      }
      if (doc.audit !== undefined && !Array.isArray(doc.audit)) throw new Error('shape: audit 非数组');
      return { memories: doc.memories ?? {}, audit: doc.audit ?? [] };
    } catch (e) {
      const backup = this.backupCorrupt();
      this.writeCorruptionNotice(backup, e);
      throw new StorageCorruptError(this.dbPath, backup, e);
    }
  }

  /** 损坏隔离通知 sidecar：下一次启动（空库）仍能告知用户原件去哪了 */
  private get noticePath(): string {
    return `${this.dbPath}.corrupt-notice.json`;
  }

  private writeCorruptionNotice(backup: string | null, cause: unknown): void {
    const notice: CorruptionNotice = {
      db_path: this.dbPath,
      backup_path: backup,
      error: String((cause as Error)?.message ?? cause),
      ts: new Date().toISOString(),
    };
    try {
      writeFileSync(this.noticePath, JSON.stringify(notice), 'utf8');
    } catch {
      // 通知落盘失败不得掩盖原始损坏错误
    }
  }

  /**
   * 消费一次损坏通知（读过即删）：端壳启动时调用并弹窗/记日志。
   * 无通知返回 null；sidecar 损坏时同样清理并返回 null（不阻塞启动）。
   */
  takeCorruptionNotice(): CorruptionNotice | null {
    let raw: string;
    try {
      raw = readFileSync(this.noticePath, 'utf8');
    } catch {
      return null;
    }
    try {
      unlinkSync(this.noticePath);
    } catch {
      // 删除失败不阻塞；下次启动会再次提示
    }
    try {
      const n = JSON.parse(raw) as CorruptionNotice;
      return n && typeof n.db_path === 'string' ? n : null;
    } catch {
      return null;
    }
  }

  /** 损坏原件备份为 <db>.corrupt（已存在则加序号）；移动而非删除，原件数据始终可人工恢复 */
  private backupCorrupt(): string | null {
    try {
      let target = `${this.dbPath}.corrupt`;
      for (let i = 1; existsSync(target); i++) target = `${this.dbPath}.corrupt.${i}`;
      renameSync(this.dbPath, target);
      return target;
    } catch {
      return null;
    }
  }

  /** 同步原子写：写 .tmp → fsync → rename（断电/崩溃后旧文件或新文件至少有一个完整版本） */
  private persist(): void {
    const tmp = `${this.dbPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.doc), 'utf8');
    // fsync 数据文件：避免 rename 已返回但页缓存未落盘，断电后得到 0 字节/截断文件
    const fd = openSync(tmp, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.dbPath);
    // 目录 fsync 保证 rename 本身持久化（Windows 不支持打开目录 → 尽力而为）
    try {
      const dirFd = openSync(dirname(this.dbPath), 'r');
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // 平台不支持目录 fsync：忽略（文件级 fsync 已生效）
    }
  }

  /** 写盘策略：批量模式下只标脏（延迟到 commitBatch），否则立即同步写。 */
  private touch(): void {
    if (this.batching) {
      this.dirty = true;
    } else {
      this.persist();
    }
  }

  /** 立即写模式下的失败回滚：写盘抛错则撤销本次内存改动再上抛。
   *  否则内存留新状态、磁盘留旧状态，失败行会被下一次成功写入「顺带」落盘（半态账本不可分诊）。 */
  private touchOrRollback(undo: () => void): void {
    try {
      this.touch();
    } catch (e) {
      undo();
      throw e;
    }
  }

  async putMemory(m: Memory): Promise<void> {
    const prev = this.doc.memories[m.mem_id];
    this.doc.memories[m.mem_id] = m;
    this.touchOrRollback(() => {
      if (prev === undefined) delete this.doc.memories[m.mem_id];
      else this.doc.memories[m.mem_id] = prev;
    });
  }

  async getMemory(mem_id: string): Promise<Memory | null> {
    const m = this.doc.memories[mem_id];
    return m && !m.deleted ? m : null; // 墓碑对常规读取不可见
  }

  async listMemories(filter: Filter): Promise<Memory[]> {
    const out: Memory[] = [];
    for (const m of Object.values(this.doc.memories)) {
      if (m.deleted && !filter.include_deleted) continue; // 墓碑默认隐藏（D2）
      if (filter.project_id && m.project_id !== filter.project_id) continue;
      if (filter.layer && m.layer !== filter.layer) continue;
      if (filter.decay_class && m.decay_class !== filter.decay_class) continue;
      out.push(m);
    }
    return out;
  }

  async deleteMemory(mem_id: string): Promise<void> {
    const prev = this.doc.memories[mem_id];
    if (prev === undefined) return; // 幂等：删不存在不抛
    delete this.doc.memories[mem_id];
    this.touchOrRollback(() => {
      this.doc.memories[mem_id] = prev; // 写盘失败 → 撤销删除，不静默丢记忆
    });
  }

  async appendAudit(a: AuditRecord): Promise<void> {
    this.doc.audit.push(a); // append-only（4.3）
    this.touchOrRollback(() => {
      if (this.doc.audit[this.doc.audit.length - 1] === a) this.doc.audit.pop();
    });
  }

  async queryAudit(filter: {
    request_id?: string;
    action?: AuditAction;
    since?: number;
  }): Promise<AuditRecord[]> {
    return this.doc.audit.filter((a) => {
      if (filter.request_id && a.request_id !== filter.request_id) return false;
      if (filter.action && filter.action !== a.action) return false;
      if (filter.since !== undefined && a.ts < filter.since) return false;
      return true;
    });
  }

  /** 优雅关闭（测试/进程退出前调用）；幂等，重复调用无害。
   *  若批量未提交，关闭前自动 commitBatch，避免丢失未落盘数据。
   *  落盘失败时原样上抛且**不置为已关闭**：调用方可见、记录日志，障碍解除后可再次 close 重试。 */
  close(): void {
    if (!this.open) return;
    this.commitBatch();
    this.open = false;
  }

  /** 测试辅助：与 InMemoryStorage.size / SqliteStorage.size 语义一致 */
  get size(): number {
    return Object.keys(this.doc.memories).length;
  }
}

export default FileStorage;
