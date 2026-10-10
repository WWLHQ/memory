// PgSyncHub（REQ-008 §2 服务端中枢 Postgres 落地）：与内存版 SyncHub 接口同构、语义一致。
// 基于 @electric-sql/pglite（进程内真 Postgres WASM）：无参 = 内存库；传 dataDir = 落盘持久化。
// 账本：hub_memories（镜像 + 全局单调 version_seq + #loser# 墓碑行）/ hub_seen（sha256 幂等）
//       / hub_conflicts（9.7 裁决队列）/ hub_audits（§6 审计）/ hub_meta（cursor 游标）。
import { PGlite } from '@electric-sql/pglite';
import { ulid } from './ulid.ts';
import { sha256hex, type SyncAudit, type SyncConflict, vcCompare } from './sync.ts';
import type { Form, Memory } from './types.ts';

type PushResult = 'applied' | 'dedup' | 'conflict' | 'lww';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS hub_memories (
    team_id     TEXT NOT NULL,
    key         TEXT NOT NULL,          -- mem_id 或 mem_id#loser#ulid
    mem_id      TEXT NOT NULL,          -- 原始 mem_id（不含 #loser# 标记）
    is_loser    BOOLEAN NOT NULL DEFAULT false,
    version_seq INTEGER NOT NULL,       -- 入账时分配的全局单调版本
    sha256      TEXT,
    doc         JSONB NOT NULL,         -- 完整 Memory 保真
    PRIMARY KEY (team_id, key)
  );
  CREATE TABLE IF NOT EXISTS hub_seen (
    team_id TEXT NOT NULL,
    sha256  TEXT NOT NULL,
    mem_id  TEXT NOT NULL,
    PRIMARY KEY (team_id, sha256)
  );
  CREATE TABLE IF NOT EXISTS hub_conflicts (
    conflict_id TEXT PRIMARY KEY,
    status      TEXT NOT NULL,          -- pending / resolved
    doc         JSONB NOT NULL          -- 完整 SyncConflict
  );
  CREATE TABLE IF NOT EXISTS hub_audits (
    seq        BIGSERIAL PRIMARY KEY,
    request_id TEXT NOT NULL,
    action     TEXT NOT NULL,
    form       TEXT NOT NULL,
    team_id    TEXT NOT NULL,
    mem_ids    JSONB NOT NULL,
    version    INTEGER,
    sha256     TEXT,
    ts         BIGINT NOT NULL,
    detail     JSONB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hub_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export class PgSyncHub {
  private db: PGlite;

  constructor(dataDir?: string) {
    this.db = new PGlite(dataDir);
  }

  /** 建表（幂等）；构造后调用一次 */
  async init(): Promise<void> {
    await this.db.exec(SCHEMA);
    await this.db.exec("INSERT INTO hub_meta (k, v) VALUES ('cursor', '0') ON CONFLICT (k) DO NOTHING");
  }

  /** 优雅关闭（测试/进程退出前） */
  async close(): Promise<void> {
    await this.db.close();
  }

  private async audit(a: Omit<SyncAudit, 'request_id' | 'ts'>): Promise<void> {
    await this.db.query(
      `INSERT INTO hub_audits (request_id, action, form, team_id, mem_ids, version, sha256, ts, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb)`,
      [`req_${ulid()}`, a.action, a.form, a.team_id,
        JSON.stringify(a.mem_ids), a.version ?? null, a.sha256 ?? null, Date.now(), JSON.stringify(a.detail)],
    );
  }

  /** 全局单调版本：事务内自增游标并返回新值 */
  private async nextVersionSeq(): Promise<number> {
    const r = await this.db.query<{ v: string }>(
      `UPDATE hub_meta SET v = ((v::bigint) + 1)::text WHERE k = 'cursor' RETURNING v`,
    );
    return Number(r.rows[0].v);
  }

  async push(mem: Memory, form: Form): Promise<PushResult> {
    const sha = mem.sha256 ?? sha256hex(mem.content);

    // sha256 幂等去重（§5：不同 mem_id 同内容 → 跳过）
    const seenRow = await this.db.query<{ mem_id: string }>(
      'SELECT mem_id FROM hub_seen WHERE team_id = $1 AND sha256 = $2', [mem.team_id, sha],
    );
    if (seenRow.rows.length > 0 && seenRow.rows[0].mem_id !== mem.mem_id) return 'dedup';

    const remoteRow = await this.db.query<{ doc: Memory }>(
      'SELECT doc FROM hub_memories WHERE team_id = $1 AND key = $2', [mem.team_id, mem.mem_id],
    );
    const put = async (m: Memory) => {
      const seq = await this.nextVersionSeq();
      await this.db.query(
        `INSERT INTO hub_memories (team_id, key, mem_id, is_loser, version_seq, sha256, doc)
         VALUES ($1, $2, $2, false, $3, $4, $5::jsonb)
         ON CONFLICT (team_id, key) DO UPDATE SET
           version_seq = excluded.version_seq, sha256 = excluded.sha256, doc = excluded.doc`,
        [mem.team_id, mem.mem_id, seq, sha, JSON.stringify(m)],
      );
      await this.db.query(
        `INSERT INTO hub_seen (team_id, sha256, mem_id) VALUES ($1, $2, $3)
         ON CONFLICT (team_id, sha256) DO UPDATE SET mem_id = excluded.mem_id`,
        [mem.team_id, sha, mem.mem_id],
      );
    };
    const putLoser = async (loser: Memory) => {
      const seq = await this.nextVersionSeq();
      await this.db.query(
        `INSERT INTO hub_memories (team_id, key, mem_id, is_loser, version_seq, sha256, doc)
         VALUES ($1, $2 || '#loser#' || $3, $2, true, $4, $5, $6::jsonb)`,
        [mem.team_id, mem.mem_id, ulid(), seq, null, JSON.stringify(loser)],
      );
    };

    if (remoteRow.rows.length === 0) {
      await put({ ...mem, sha256: sha });
      await this.audit({ action: 'sync_up', form, team_id: mem.team_id, mem_ids: [mem.mem_id], version: mem.version, sha256: sha, detail: { op: 'create' } });
      return 'applied';
    }

    const remote = remoteRow.rows[0].doc;
    const cmp = vcCompare(mem.vclock ?? {}, remote.vclock ?? {});
    if (cmp === 'ahead' || (cmp === 'equal' && mem.version > remote.version)) {
      // 因果占优 → 覆盖
      await put({ ...mem, sha256: sha });
      await this.audit({ action: 'sync_up', form, team_id: mem.team_id, mem_ids: [mem.mem_id], version: mem.version, sha256: sha, detail: { op: 'overwrite', clock: cmp } });
      return 'applied';
    }
    if (cmp === 'behind') {
      return 'dedup'; // 本地落后 → 中枢已是最新
    }
    // concurrent：§4 自动 LWW —— 时间戳晚者赢
    if (mem.updated_at && remote.updated_at && mem.updated_at !== remote.updated_at) {
      if (mem.updated_at > remote.updated_at) {
        await put({ ...mem, sha256: sha });
        await putLoser({ ...remote, decay_class: 'archived' as const, version: remote.version + 1 }); // 败者转 archived（9.7 不物理删）
        await this.audit({ action: 'sync_up', form, team_id: mem.team_id, mem_ids: [mem.mem_id], version: mem.version, sha256: sha, detail: { op: 'lww', winner: 'local', loser_archived: true } });
        return 'lww';
      }
      await putLoser({ ...mem, sha256: sha, decay_class: 'archived' as const, version: mem.version + 1 }); // 败者（本次上行版本）对称留档
      await this.audit({ action: 'sync_up', form, team_id: mem.team_id, mem_ids: [mem.mem_id], version: mem.version, sha256: sha, detail: { op: 'lww', winner: 'remote' } });
      return 'dedup'; // 镜像版本更晚 → 本地版本将被下行覆盖
    }
    // 全晚（时间戳相同无法判序）→ 9.7 裁决队列
    const c: SyncConflict = {
      conflict_id: `cf_${ulid()}`,
      mem_id: mem.mem_id, team_id: mem.team_id, project_id: mem.project_id,
      local: mem, remote, local_form: form, remote_form: 'desktop', status: 'pending',
    };
    await this.db.query('INSERT INTO hub_conflicts (conflict_id, status, doc) VALUES ($1, $2, $3::jsonb)',
      [c.conflict_id, 'pending', JSON.stringify(c)]);
    await this.audit({ action: 'sync_fail', form, team_id: mem.team_id, mem_ids: [mem.mem_id], version: mem.version, sha256: sha, detail: { reason: 'concurrent_unresolvable', conflict_id: c.conflict_id } });
    return 'conflict';
  }

  /** 下行（§3.3）：since=version_seq 增量，team_id 隔离，败者墓碑与异 user 偏好不下发 */
  async pull(scope: { team_id: string; user_id?: string }, since: number, form: Form = 'web'): Promise<{ items: Memory[]; cursor: number }> {
    const rows = await this.db.query<{ doc: Memory }>(
      `SELECT doc FROM hub_memories WHERE team_id = $1 AND is_loser = false AND version_seq > $2 ORDER BY version_seq`,
      [scope.team_id, since],
    );
    const items = rows.rows
      .map((r) => r.doc)
      .filter((m) => !(m.category === 'preference' && scope.user_id && m.user_id && m.user_id !== scope.user_id));
    await this.audit({ action: 'sync_down', form, team_id: scope.team_id, mem_ids: items.map((m) => m.mem_id), detail: { since, count: items.length } });
    return { items, cursor: await this.getCursor() };
  }

  /** 每日全量对账（§3.4）：sha256 比对；losers 单列（败者留档可查，不混入对账项） */
  async reconcile(scope: { team_id: string }): Promise<{ items: Memory[]; losers: Memory[]; missing_local: string[] }> {
    const rows = await this.db.query<{ key: string; doc: Memory }>(
      'SELECT key, doc FROM hub_memories WHERE team_id = $1 ORDER BY version_seq', [scope.team_id],
    );
    const items = rows.rows.filter((r) => !r.key.includes('#loser#')).map((r) => r.doc);
    const losers = rows.rows.filter((r) => r.key.includes('#loser#') && r.doc.decay_class === 'archived').map((r) => r.doc);
    const missing = items.filter((m) => !m.sha256 || m.sha256 !== sha256hex(m.content)).map((m) => m.mem_id);
    await this.audit({ action: 'sync_reconcile', form: 'desktop', team_id: scope.team_id, mem_ids: items.map((m) => m.mem_id), detail: { total: items.length, losers: losers.length, missing_local: missing.length } });
    return { items, losers, missing_local: missing };
  }

  /** 9.7 裁决队列（仅 pending） */
  async listConflicts(): Promise<SyncConflict[]> {
    const rows = await this.db.query<{ doc: SyncConflict }>(
      "SELECT doc FROM hub_conflicts WHERE status = 'pending' ORDER BY conflict_id",
    );
    return rows.rows.map((r) => r.doc);
  }

  async resolve(conflict_id: string, winner: 'local' | 'remote'): Promise<void> {
    const rows = await this.db.query<{ doc: SyncConflict }>(
      'SELECT doc FROM hub_conflicts WHERE conflict_id = $1', [conflict_id],
    );
    if (rows.rows.length === 0) return;
    const c = rows.rows[0].doc;
    const win = winner === 'local' ? c.local : c.remote;
    const lose = winner === 'local' ? c.remote : c.local;
    const seq = await this.nextVersionSeq();
    await this.db.query(
      `INSERT INTO hub_memories (team_id, key, mem_id, is_loser, version_seq, sha256, doc)
       VALUES ($1, $2, $2, false, $3, $4, $5::jsonb)
       ON CONFLICT (team_id, key) DO UPDATE SET version_seq = excluded.version_seq, doc = excluded.doc`,
      [c.team_id, c.mem_id, seq, win.sha256 ?? null, JSON.stringify({ ...win, version: win.version + 1 })],
    );
    await this.db.query(
      `INSERT INTO hub_memories (team_id, key, mem_id, is_loser, version_seq, sha256, doc)
       VALUES ($1, $2 || '#loser#' || $3, $2, true, $4, $5, $6::jsonb)
       ON CONFLICT (team_id, key) DO UPDATE SET version_seq = excluded.version_seq, doc = excluded.doc`,
      [c.team_id, c.mem_id, ulid(), await this.nextVersionSeq(), lose.sha256 ?? null,
        JSON.stringify({ ...lose, decay_class: 'archived' as const, version: lose.version + 1 })],
    );
    await this.db.query("UPDATE hub_conflicts SET status = 'resolved' WHERE conflict_id = $1", [conflict_id]);
    await this.audit({ action: 'conflict_resolve', form: c.local_form, team_id: c.team_id, mem_ids: [c.mem_id], version: win.version, detail: { conflict_id, winner } });
  }

  async getCursor(): Promise<number> {
    const r = await this.db.query<{ v: string }>("SELECT v FROM hub_meta WHERE k = 'cursor'");
    return r.rows.length > 0 ? Number(r.rows[0].v) : 0;
  }

  /** 审计游标（syncUp 引擎截取本轮审计用） */
  async auditCount(): Promise<number> {
    const r = await this.db.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM hub_audits');
    return Number(r.rows[0].n);
  }

  async auditsFrom(start: number): Promise<SyncAudit[]> {
    const r = await this.db.query<SyncAudit & { ts: string }>(
      `SELECT request_id, action, form, team_id, mem_ids, version, sha256, ts, detail
       FROM hub_audits WHERE seq > $1 ORDER BY seq`, [start],
    );
    return r.rows.map((row) => ({ ...row, ts: Number(row.ts) }));
  }
}
