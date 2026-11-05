// SqliteStorage（§5.3）：桌面/CLI 本地库 = P0 主源（需求规格书 §2 端壳注入、§5.3 存储端点表）。
// 基于 node:sqlite（Node ≥22.13 内置，零依赖），与 InMemoryStorage 接口同构：
// memories/audit 两表，领域列冗余建索引供 Filter 下推，完整对象以 JSON doc 保真存取。
import { DatabaseSync } from 'node:sqlite';
import type { AuditAction, AuditRecord, CreateProjectInput, Filter, ListProjectsFilter, Memory, ProjectRecord, StorageBackend } from './types.ts';

export class SqliteStorage implements StorageBackend {
  private db: DatabaseSync;
  private open = true; // node:sqlite（22.x）无稳定 isOpen 属性，自管幂等关闭

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        mem_id      TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        layer       TEXT NOT NULL,
        decay_class TEXT NOT NULL,
        doc         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_filter
        ON memories (project_id, layer, decay_class);
      CREATE TABLE IF NOT EXISTS audit (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        action     TEXT NOT NULL,
        ts         INTEGER NOT NULL,
        doc        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_query
        ON audit (request_id, action, ts);
      CREATE TABLE IF NOT EXISTS projects (
        project_id   TEXT PRIMARY KEY,
        kind         TEXT NOT NULL,
        owner_user_id TEXT,
        display_name TEXT,
        created_at   INTEGER NOT NULL,
        created_by   TEXT NOT NULL,
        doc          TEXT NOT NULL
      );
    `);
  }

  async putMemory(m: Memory): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO memories (mem_id, project_id, layer, decay_class, doc)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(mem_id) DO UPDATE SET
           project_id = excluded.project_id,
           layer = excluded.layer,
           decay_class = excluded.decay_class,
           doc = excluded.doc`,
      )
      .run(m.mem_id, m.project_id, m.layer, m.decay_class, JSON.stringify(m));
  }

  async getMemory(mem_id: string): Promise<Memory | null> {
    const row = this.db.prepare('SELECT doc FROM memories WHERE mem_id = ?').get(mem_id) as
      | { doc: string }
      | undefined;
    const m = row ? (JSON.parse(row.doc) as Memory) : null;
    return m && !m.deleted ? m : null; // 墓碑对常规读取不可见
  }

  async listMemories(filter: Filter): Promise<Memory[]> {
    const conds: string[] = [];
    const params: string[] = [];
    if (filter.project_id) {
      conds.push('project_id = ?');
      params.push(filter.project_id);
    }
    if (filter.layer) {
      conds.push('layer = ?');
      params.push(filter.layer);
    }
    if (filter.decay_class) {
      conds.push('decay_class = ?');
      params.push(filter.decay_class);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT doc FROM memories ${where} ORDER BY rowid`)
      .all(...params) as { doc: string }[];
    return rows
      .map((r) => JSON.parse(r.doc) as Memory)
      .filter((m) => filter.include_deleted || !m.deleted); // 墓碑默认隐藏（D2）
  }

  async deleteMemory(mem_id: string): Promise<void> {
    this.db.prepare('DELETE FROM memories WHERE mem_id = ?').run(mem_id);
  }

  // ── 批次46-D6：项目注册表（多用户三池基础）──
  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const project_id = input.project_id.trim();
    if (!project_id) throw new Error('createProject.project_id 不能为空');
    const existing = this.db.prepare('SELECT 1 FROM projects WHERE project_id = ?').get(project_id);
    if (existing) throw new Error(`项目已存在：${project_id}`);
    const rec: ProjectRecord = {
      project_id,
      kind: input.kind ?? 'general',
      owner_user_id: input.owner_user_id,
      display_name: input.display_name,
      created_at: Date.now(),
      created_by: input.created_by,
    };
    this.db
      .prepare('INSERT INTO projects (project_id, kind, owner_user_id, display_name, created_at, created_by, doc) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(rec.project_id, rec.kind, rec.owner_user_id ?? null, rec.display_name ?? null, rec.created_at, rec.created_by, JSON.stringify(rec));
    return rec;
  }

  async getProject(project_id: string): Promise<ProjectRecord | null> {
    const row = this.db.prepare('SELECT doc FROM projects WHERE project_id = ?').get(project_id) as { doc: string } | undefined;
    if (!row) return null;
    const rec = JSON.parse(row.doc) as ProjectRecord;
    // 落库时 undefined 以 null 存储，回读归一化为 undefined（与接口类型 ProjectRecord 一致）
    if (rec.owner_user_id === null) delete (rec as Partial<ProjectRecord>).owner_user_id;
    if (rec.display_name === null) delete (rec as Partial<ProjectRecord>).display_name;
    return rec;
  }

  async listProjects(filter?: ListProjectsFilter): Promise<ProjectRecord[]> {
    const conds: string[] = [];
    const params: (string | null)[] = [];
    if (filter?.kind) { conds.push('kind = ?'); params.push(filter.kind); }
    if (filter?.owner_user_id) { conds.push('owner_user_id = ?'); params.push(filter.owner_user_id); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT doc FROM projects ${where} ORDER BY project_id`).all(...params) as { doc: string }[];
    return rows.map((r) => {
      const rec = JSON.parse(r.doc) as ProjectRecord;
      if (rec.owner_user_id === null) delete (rec as Partial<ProjectRecord>).owner_user_id;
      if (rec.display_name === null) delete (rec as Partial<ProjectRecord>).display_name;
      return rec;
    });
  }

  async appendAudit(a: AuditRecord): Promise<void> {
    this.db
      .prepare('INSERT INTO audit (request_id, action, ts, doc) VALUES (?, ?, ?, ?)')
      .run(a.request_id, a.action, a.ts, JSON.stringify(a)); // append-only（4.3）
  }

  async queryAudit(filter: {
    request_id?: string;
    action?: AuditAction;
    since?: number;
  }): Promise<AuditRecord[]> {
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (filter.request_id) {
      conds.push('request_id = ?');
      params.push(filter.request_id);
    }
    if (filter.action) {
      conds.push('action = ?');
      params.push(filter.action);
    }
    if (filter.since) {
      conds.push('ts >= ?');
      params.push(filter.since);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT doc FROM audit ${where} ORDER BY seq`)
      .all(...params) as { doc: string }[];
    return rows.map((r) => JSON.parse(r.doc) as AuditRecord);
  }

  /** 优雅关闭（测试/进程退出前调用，确保 WAL 落盘）；幂等，重复调用无害 */
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.db.close();
  }

  /** 测试辅助：与 InMemoryStorage.size 语义一致 */
  get size(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number };
    return row.n;
  }
}
