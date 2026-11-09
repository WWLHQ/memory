// 个人记忆独立文件存储（桌面主进程）：<dataRoot>/personal-memory.db.json。
//
// - 与 memories.db.json / 审计账本分开，互不波及；
// - 每次变更整文件原子写（同目录临时文件 + rename），进程内串行化写入；
// - 单写者（主进程），不做跨进程锁；第二轮同步再做幂等与冲突裁决。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PersonalEntry, PersonalMemoryStore } from './personalStore.ts';
import { normalizePersonalEntry } from './personalStore.ts';

interface FileShape {
  schema: 1;
  entries: PersonalEntry[];
}

function isEntry(v: unknown): v is PersonalEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<PersonalEntry>;
  return typeof e.id === 'string' && typeof e.owner === 'string'
    && typeof e.content === 'string' && typeof e.state === 'string'
    && typeof e.version === 'number' && typeof e.deleted === 'boolean';
}

export class FilePersonalStore implements PersonalMemoryStore {
  private readonly file: string;
  private loaded = false;
  /** key = owner\0id */
  private entries = new Map<string, PersonalEntry>();
  /** 写队列：同一进程内的变更串行落盘 */
  private queue: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  private key(owner: string, id: string): string {
    return `${owner}\u0000${id}`;
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<FileShape>;
      for (const e of Array.isArray(raw.entries) ? raw.entries : []) {
        // 第一轮条目缺 sha256/vclock/同步字段：只补元数据，不改正文与状态（旧值原样可读）
        if (isEntry(e)) this.entries.set(this.key(e.owner, e.id), normalizePersonalEntry(e));
      }
    } catch {
      // 首次启动 / 文件不存在：空表（不创建文件，等第一次真实写入）
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const body: FileShape = { schema: 1, entries: [...this.entries.values()] };
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(body), 'utf8');
    renameSync(tmp, this.file);
  }

  async list(owner: string, opts: { includeDeleted?: boolean } = {}): Promise<PersonalEntry[]> {
    this.ensureLoaded();
    const out: PersonalEntry[] = [];
    for (const e of this.entries.values()) {
      if (e.owner !== owner) continue;
      if (e.deleted && !opts.includeDeleted) continue;
      out.push({ ...e });
    }
    return out.sort((a, b) => (b.delivered_at - a.delivered_at) || b.id.localeCompare(a.id));
  }

  async get(owner: string, id: string): Promise<PersonalEntry | null> {
    this.ensureLoaded();
    const e = this.entries.get(this.key(owner, id));
    if (!e || e.deleted) return null;
    return { ...e };
  }

  async put(entry: PersonalEntry): Promise<void> {
    const run = this.queue.then(() => {
      this.ensureLoaded();
      this.entries.set(this.key(entry.owner, entry.id), normalizePersonalEntry({ ...entry }));
      this.save();
    });
    this.queue = run.catch(() => { /* 队列不因单次失败卡死；错误仍抛给本次调用方 */ });
    return run;
  }
}
