// FileStorage（§5.3）：桌面/CLI 本地库 = P0 主源（零依赖，纯文件系统，无 node:sqlite）。
// 与 SqliteStorage 接口同构：完整记忆对象以 JSON 落盘（原子写，单文件单进程安全）。
// 设计取舍：
//   · 不引入 node:sqlite（Electron 34 打包后运行时缺该内置模块，双击即崩）→ 纯 fs 实现，安装包零外部依赖。
//   · 单文件 <userData>/memories.db.json + 同步原子写（写 tmp → rename）保证崩溃一致性；
//     桌面壳为单进程主源，无并发写竞争，故不需 WAL/锁。
//   · 与 SqliteStorage 相同的方法签名 + 测试辅助（size/close），可被同一套测试消费（见 __tests__）。
//   · 批次41-A：审计不再落在这个文件里，改由 auditLog.ts 的追加式 JSONL 承载——
//     每追加一条审计不再等于「整库 stringify + fsync + rename」（评审 P1-5 的写放大）。
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, openSync, fsyncSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { L0BlobStore } from './l0Store.ts';
import { isSealedL0 } from './l0Store.ts';
import type { AuditLogStats } from './auditLog.ts';
import { AUDIT_FILE_NAME, AuditLogCorruptError, FileAuditLog } from './auditLog.ts';
import type { AuditAction, AuditRecord, CreateProjectInput, Filter, ListProjectsFilter, Memory, ProjectRecord, StorageBackend } from './types.ts';

interface FileDoc {
  memories: Record<string, Memory>;
  /** 历史字段（批次41-A 之前审计写在这里）：读到非空即一次性迁进 audit.jsonl，迁移后恒为空数组 */
  audit: AuditRecord[];
  /** 批次46-D6：项目注册表（多用户三池基础）；缺省 {} 向后兼容旧库 */
  projects: Record<string, ProjectRecord>;
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

/** 批次28-A：只读存储上的写操作显式失败（web 镜像另一个进程的账本时），绝不静默假成功 */
export class StorageLockedError extends Error {
  readonly code = 'E_STORAGE_LOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'StorageLockedError';
  }
}

export interface FileStorageOptions {
  /** 只读模式（批次28-A）：绝不写盘、绝不取写锁；读操作可选跟随 mtime 重载 */
  readonly?: boolean;
  /** 只读模式下每次读前检查账本文件 mtime，变了就重载（镜像持有写锁的进程，近实时） */
  reloadOnMtime?: boolean;
  /**
   * 批次37：L0 原数据库。给了它，本文件就**只存 L1–L6**（审计自批次41-A 起在 audit.jsonl）——
   * putMemory 时把行上的 `content_l0_enc` 搬进 L0 库、行上改记 `has_l0`，
   * deleteMemory / 清掉 L0 的改写会同步把密文从 L0 库删掉。
   * 不给（测试、旧数据未拆库）则完全保持批次36 及以前的行为：信封照旧写在行上。
   */
  l0?: L0BlobStore;
  /**
   * 批次41-A：审计账本文件路径。缺省 = 与记忆库同目录的 `audit.jsonl`
   * （跟着记忆库所在目录走：审计是这本账本的账，不该分开放）。
   */
  auditPath?: string;
  /** 批次41-A：在档文件大小闸门（单测用它触发轮转；生产用默认值） */
  auditMaxBytes?: number;
}

export class FileStorage implements StorageBackend {
  private doc: FileDoc;
  private open = true;
  /** 批量模式：true 时 putMemory 只改内存、不逐次同步写盘，审计攒进审计账本缓冲；
   *  由 commitBatch() 一次性落盘（把 N 次全量同步写盘降为 1 次，避免卡死事件循环）。 */
  private batching = false;
  private dirty = false;
  /** 批次28-A：生效的只读态（构造传入，或写锁被其它活进程持有时自动降级） */
  private readonly mode: boolean;
  private readonly reloadOnMtime: boolean;
  private lastMtimeMs: number | null = null;
  private lockPath: string;
  private ownsLock = false;
  /** 写锁被其它活进程持有 → 自动降级只读；只读构造不取锁恒为 null */
  private lockHolder: { pid: number; at: number } | null = null;
  /** 批次37：L0 原数据库（未配置 = L0 仍写在行上，保持旧行为） */
  private readonly l0?: L0BlobStore;
  /** 批次41-A：追加式审计账本（audit.jsonl）——审计不再进记忆库文件 */
  private readonly auditLog: FileAuditLog;
  /** 批次41-A：审计账本本次启动被隔离过（原件已改名 *.corrupt）：回显用，绝不静默开空账本 */
  private auditCorruption: CorruptionNotice | null = null;
  /** 批次41-A：存量迁移是否发生过（回显给设置页/日志，迁移只在可写进程做一次） */
  private auditMigratedRows = 0;

  constructor(private readonly dbPath: string, opts: FileStorageOptions = {}) {
    const dir = dirname(dbPath);
    mkdirSync(dir, { recursive: true });
    this.lockPath = `${dbPath}.lock`;
    this.reloadOnMtime = opts.reloadOnMtime === true;
    this.l0 = opts.l0;
    this.mode = opts.readonly === true || !this.acquireLock();
    this.doc = this.load();
    this.lastMtimeMs = this.statMtime();
    const auditPath = opts.auditPath ?? join(dir, AUDIT_FILE_NAME);
    try {
      this.auditLog = new FileAuditLog(auditPath, {
        readonly: this.mode,
        maxBytes: opts.auditMaxBytes,
      });
    } catch (e) {
      // 审计账本读不认：原件已改名隔离，本次按空账本继续，但必须留下可消费的通知（与库损坏同口径）。
      // 不让它掀掉整个存储——记忆库还读得动，用户不该因为审计文件坏了打不开应用。
      const err = e as AuditLogCorruptError;
      this.auditCorruption = {
        db_path: auditPath,
        backup_path: err?.backupPath ?? null,
        error: String(err?.message ?? e),
        ts: new Date().toISOString(),
      };
      this.auditLog = new FileAuditLog(auditPath, { readonly: this.mode, maxBytes: opts.auditMaxBytes });
    }
  }

  /**
   * 批次41-A 一次性存量迁移：老库里 `doc.audit` 的数组整批搬进 audit.jsonl，然后把库里那格清空并落盘。
   * **构造时不自动搬**：搬之前必须有备份（项目不变量「批量改写账本前先备份，备份失败就拒绝改写」），
   * 而备份是端壳的活（`main.ts` 启动时先 `backupBeforeKernelChange` 再调本方法）。
   * 没调本方法不影响任何读与查：历史审计照旧合进 `queryAudit` 的全量视图。
   * 只在可写进程生效（只读镜像不改别人的账本）；重复调用幂等（库里已空即直接返回 0）。
   * 迁移中断留下的重复风险按「宁重复不缺失」处理：审计是账本，多一行远比少一行好，
   * 且发生过一次就写进 stats 里可见，不假装两边一致。返回本次搬走的行数。
   */
  migrateLegacyAudit(): number {
    const legacy = this.doc.audit;
    if (!Array.isArray(legacy) || legacy.length === 0) return 0;
    if (this.mode) return 0; // 只读：历史审计留在库里照旧可查，等持有写锁的进程搬
    const overlap = this.auditLog.count() > 0; // 账本已有内容 + 库里也有历史 = 上次迁移没走完
    this.auditLog.appendMany(legacy);
    this.doc.audit = [];
    this.auditMigratedRows = legacy.length;
    this.persist();
    if (overlap) {
      // 明确记一条审计：不改动任何数据，只把「可能有重复行」这件事写进账本本身
      this.auditLog.append({
        request_id: `req_audit_migrate_${Date.now().toString(36)}`,
        action: 'security_change',
        ts: Date.now(),
        detail: {
          op: 'audit_log_migrate',
          moved: legacy.length,
          overlap_possible: true,
          note: '检测到上一次审计迁移中断的痕迹：历史审计已补齐，可能与已落盘部分重复（宁重复不缺失）',
        },
      });
    }
    return legacy.length;
  }

  /** 批次37：配了就只存 L1–L6，L0 密文在另一个文件里 */
  get l0Store(): L0BlobStore | null {
    return this.l0 ?? null;
  }

  /** 批次41-A：审计账本真实状态（路径/条数/字节/归档/坏行数），设置页与诊断用 */
  get auditStats(): AuditLogStats & {
    migrated_rows: number;
    /** 库里仍未搬走的历史审计行数（只读镜像上属正常状态；端壳备份完成后调 migrateLegacyAudit 才搬） */
    legacy_rows_in_ledger: number;
    corruption: CorruptionNotice | null;
  } {
    const s = this.auditLog.stats();
    return {
      ...s,
      rows: s.rows + this.doc.audit.length, // 只读镜像上库里还没迁走的历史审计同样算进可查总数
      migrated_rows: this.auditMigratedRows,
      legacy_rows_in_ledger: this.doc.audit.length,
      corruption: this.auditCorruption,
    };
  }

  /** 独占写锁：<db>.lock（O_EXCL 原子创建，内容含 pid）。锁被活进程持有 → 自动只读；
   *  陈旧锁（持锁进程已死）→ 打开并重取。True = 本进程持锁可写。 */
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
          return false; // 其它活进程在写：本实例降级只读，绝不双写损坏账本
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

  /** 只读写保护：统一报错文案（web 镜像只读 / 写锁被占），绝不静默假成功 */
  private assertWritable(): void {
    if (this.mode) {
      throw new StorageLockedError(
        this.lockHolder
          ? '记忆库正被其它进程写入（桌面端运行中），当前为只读镜像；写入请用桌面端或 MCP。'
          : '存储处于只读模式，不可写入。',
      );
    }
  }

  /** 只读镜像：账本文件 mtime 变化（桌面端写入）→ 整体重载，近实时反映写方数据 */
  private maybeReload(): void {
    if (!this.mode || !this.reloadOnMtime) return;
    const mtime = this.statMtime();
    if (mtime === null || mtime === this.lastMtimeMs) return;
    this.doc = this.load();
    this.lastMtimeMs = mtime;
  }

  private statMtime(): number | null {
    try { return statSync(this.dbPath).mtimeMs; } catch { return null; }
  }

  /** 写锁持有者信息（只读降级时非空；设置页/诊断用） */
  get readOnly(): boolean {
    return this.mode;
  }

  get lockedBy(): { pid: number; at: number } | null {
    return this.lockHolder;
  }

  /** 开启批量模式（会话采集等大批量入库场景）。需配合 commitBatch 结束。
   *  不清脏标记：上一次提交若因写盘失败被中止，这里的待落盘批次仍要由下次 commit 完成。 */
  beginBatch(): void {
    this.assertWritable();
    this.batching = true;
    this.l0?.beginBatch(); // 批次37：两个库一起进批量，避免 N 次全量写盘
    this.auditLog.beginBatch(); // 批次41-A：审计同样攒批，commit 时一次追加
  }

  /** 提交批量：一次性同步写盘。写盘失败则原样上抛并保留批次（batching/dirty 不动），
   *  由调用方重试或 close() 兜底——绝不「标已提交、实际没落盘」。
   *  落盘顺序固定三段：
   *  ① L0 库先落、记忆库后落——反过来会留下「行说有自己的 L0、L0 库里没有」的断链；
   *  ② 审计最后落——审计是「发生了什么」的账，绝不能先写下一条数据没落盘的审计（批次41-A）。 */
  commitBatch(): void {
    if (!this.batching) return;
    this.l0?.commitBatch();
    if (this.dirty) {
      this.persist();
      this.dirty = false;
    }
    this.auditLog.commitBatch();
    this.batching = false;
  }

  /** 读盘 → 结构：仅"文件不存在"视为空库；损坏/非法结构 → 备份 .corrupt + 显式抛错（D3） */
  private load(): FileDoc {
    let raw: string;
    try {
      raw = readFileSync(this.dbPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { memories: {}, audit: [], projects: {} };
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
      if (doc.projects !== undefined && (typeof doc.projects !== 'object' || doc.projects === null || Array.isArray(doc.projects))) {
        throw new Error('shape: projects 非对象');
      }
      return { memories: doc.memories ?? {}, audit: doc.audit ?? [], projects: doc.projects ?? {} };
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

  /**
   * 批次37：把行上的 L0 密文搬进 L0 原数据库，返回「该写进记忆库的行」+ 失败时的尽力回滚。
   * 规则（只动 L0，不碰 L1–L6 正文）：
   *  · 行带合法信封 → 先写 L0 库，再把行改成 `content_l0_enc: undefined` + `has_l0: true`；
   *  · 行带 `has_l0` 而无信封 → 原样（密文已在 L0 库）；
   *  · 行既无信封也无 `has_l0`，但 L0 库里有本条（删除/清 L0 的改写）→ 同步删掉密文，不留孤儿。
   *  · 信封形状不合法（明文混进来）→ **不搬、不删、不静默**，原样留在行上由上层报错。
   * 顺序保证：L0 库写失败时**根本不碰记忆库**（不会出现「行上说有 L0、库里没有」）。
   * 反向（L0 已写、记忆库写失败）只会留下「库里有密文、行上没有」的孤儿——读不到、不可检索，
   * 由 `scanLedgerForSplit`/完整性核对点名，绝不假装两边一致。
   */
  private async splitL0FromRow(m: Memory): Promise<Memory> {
    const l0 = this.l0;
    if (!l0) return m;
    const envelope = m.content_l0_enc;
    if (envelope) {
      if (!isSealedL0(envelope)) return m; // 不合法信封：不搬不删，留给上层显式处理
      await l0.put(m.mem_id, { envelope, sealed_at: m.updated_at ?? m.created_at });
      return { ...m, content_l0_enc: undefined, has_l0: true };
    }
    if (m.has_l0) return m;
    const stale = await l0.get(m.mem_id);
    if (stale) {
      try {
        await l0.delete(m.mem_id);
      } catch (e) {
        // 记忆库里这条已经没有 L0 了，密文却删不掉：如实上抛，不留下「以为清了」的假状态
        throw new Error(`L0 原数据库清理失败（${m.mem_id}）：${String((e as Error)?.message ?? e)}`);
      }
    }
    return m;
  }

  async putMemory(m: Memory): Promise<void> {
    this.assertWritable();
    const row = this.l0 ? await this.splitL0FromRow(m) : m;
    const prev = this.doc.memories[row.mem_id];
    this.doc.memories[row.mem_id] = row;
    this.touchOrRollback(() => {
      if (prev === undefined) delete this.doc.memories[row.mem_id];
      else this.doc.memories[row.mem_id] = prev;
    });
  }

  async getMemory(mem_id: string): Promise<Memory | null> {
    this.maybeReload();
    const m = this.doc.memories[mem_id];
    return m && !m.deleted ? m : null; // 墓碑对常规读取不可见
  }

  async listMemories(filter: Filter): Promise<Memory[]> {
    this.maybeReload();
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
    this.assertWritable();
    const prev = this.doc.memories[mem_id];
    if (prev === undefined) return; // 幂等：删不存在不抛
    // 批次37：这条记忆物理消失 → L0 原数据库里的密文也必须同步消失（不留可解的孤儿）
    const blob = this.l0 ? await this.l0.get(mem_id) : null;
    if (this.l0 && blob) await this.l0.delete(mem_id);
    delete this.doc.memories[mem_id];
    this.touchOrRollback(() => {
      this.doc.memories[mem_id] = prev; // 写盘失败 → 撤销删除，不静默丢记忆
      if (this.l0 && blob) void this.l0.put(mem_id, blob).catch(() => { /* 回滚失败：由完整性核对点名孤儿行 */ });
    });
  }

  // ── 批次46-D6：项目注册表（多用户三池基础）──
  // 库内持久化于 FileDoc.projects（缺省 {} 向后兼容旧库）；写盘失败按 touchOrRollback 撤销内存改动。
  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    this.assertWritable();
    const project_id = input.project_id.trim();
    if (!project_id) throw new Error('createProject.project_id 不能为空');
    if (project_id in this.doc.projects) throw new Error(`项目已存在：${project_id}`);
    const rec: ProjectRecord = {
      project_id,
      kind: input.kind ?? 'general',
      owner_user_id: input.owner_user_id,
      display_name: input.display_name,
      created_at: Date.now(),
      created_by: input.created_by,
    };
    this.doc.projects[project_id] = rec;
    this.touchOrRollback(() => { delete this.doc.projects[project_id]; });
    return rec;
  }

  async getProject(project_id: string): Promise<ProjectRecord | null> {
    this.maybeReload(); // 只读镜像跟随写方新增/删除的项目注册项
    return this.doc.projects[project_id] ?? null;
  }

  async listProjects(filter?: ListProjectsFilter): Promise<ProjectRecord[]> {
    this.maybeReload();
    let recs = Object.values(this.doc.projects);
    if (filter?.kind) recs = recs.filter((p) => p.kind === filter.kind);
    if (filter?.owner_user_id) recs = recs.filter((p) => p.owner_user_id === filter.owner_user_id);
    return recs;
  }

  /** 批次41-A：审计落追加式 JSONL（一条 = 一次 append+fsync），不再进记忆库文件；失败不留内存半态 */
  async appendAudit(a: AuditRecord): Promise<void> {
    this.assertWritable();
    this.auditLog.append(a); // append-only（4.3）：只追加，本方法从不删任何已有行
  }

  async queryAudit(filter: {
    request_id?: string;
    action?: AuditAction;
    since?: number;
  }): Promise<AuditRecord[]> {
    this.maybeReload();
    const inLog = this.auditLog.query(filter);
    // 迁移前（或只读镜像尚未被写方迁移）：库里那格历史审计照样查得到，绝不出现「拆了文件就查不到」
    const legacy = this.doc.audit.filter((a) => {
      if (filter.request_id && a.request_id !== filter.request_id) return false;
      if (filter.action && filter.action !== a.action) return false;
      if (filter.since !== undefined && a.ts < filter.since) return false;
      return true;
    });
    return legacy.length === 0 ? inLog : [...legacy, ...inLog];
  }

  /** 优雅关闭（测试/进程退出前调用）；幂等，重复调用无害。
   *  若批量未提交，关闭前自动 commitBatch，避免丢失未落盘数据。
   *  落盘失败时原样上抛且**不置为已关闭**：调用方可见、记录日志，障碍解除后可再次 close 重试。 */
  close(): void {
    if (!this.open) return;
    if (this.mode) {
      this.open = false;
      this.l0?.close();
      this.auditLog.close();
      return; // 只读实例无待落盘批次，直接关闭
    }
    this.commitBatch();
    this.open = false;
    // 批次37：L0 库与记忆库各自持锁，关闭时一并落盘并释放，否则残留 <l0>.lock 会让下个实例误判只读
    this.l0?.close();
    this.auditLog.close(); // 批次41-A：审计缓冲同样在退出前落盘
    if (this.ownsLock) {
      try { unlinkSync(this.lockPath); } catch { /* 锁文件删不掉：陈旧锁由下个实例按死 pid 判定 */ }
      this.ownsLock = false;
    }
  }

  /** 测试辅助：与 InMemoryStorage.size / SqliteStorage.size 语义一致 */
  get size(): number {
    return Object.keys(this.doc.memories).length;
  }
}

export default FileStorage;
