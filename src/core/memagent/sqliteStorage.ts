// SqliteStorage（§5.3）：桌面/CLI 本地库 = P0 主源（需求规格书 §2 端壳注入、§5.3 存储端点表）。
// 基于 node:sqlite（Node ≥22.13 内置，零依赖），与 InMemoryStorage 接口同构：
// memories/audit 两表，领域列冗余建索引供 Filter 下推，完整对象以 JSON doc 保真存取。
import { DatabaseSync } from 'node:sqlite';
import type { AuditAction, AuditRecord, Filter, Memory, StorageBackend } from './types.ts';

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
    return row ? (JSON.parse(row.doc) as Memory) : null;
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
    return rows.map((r) => JSON.parse(r.doc) as Memory);
  }

  async deleteMemory(mem_id: string): Promise<void> {
    this.db.prepare('DELETE FROM memories WHERE mem_id = ?').run(mem_id);
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
