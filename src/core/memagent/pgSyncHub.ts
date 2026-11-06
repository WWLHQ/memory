// PgSyncHub（REQ-008 §2 服务端中枢 Postgres 落地）：与内存版 SyncHub 接口同构、语义一致。
// 基于 @electric-sql/pglite（进程内真 Postgres WASM）：无参 = 内存库；传 dataDir = 落盘持久化。
//
// B4（批次B类）：中枢可配置——默认（SYNC_HUB_PG_URL 未设）= 单机 pglite 落盘（现状行为零变化）；
//   设了 URL = 接远端 Postgres（共享中枢，多机前提），SQL 为标准 PG 方言，pglite / pg 双后端同构。
// B1（批次B类）：多机硬过滤——SYNC_MULTI_TENANT=1 且传入 canonicalTenant 时，push/pull 拒绝非规范
//   团队的读写（跨机伪造 team_id fail-closed）；单机 pglite 各端独立，B1 无意义、默认不启用。
//
// 账本：hub_memories（镜像 + 全局单调 version_seq + #loser# 墓碑行）/ hub_seen（sha256 幂等）
//       / hub_conflicts（9.7 裁决队列）/ hub_audits（§6 审计）/ hub_meta（cursor 游标 + canonical_tenant）。
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { ulid } from './ulid.ts';
import { sha256hex, type SyncAudit, type SyncConflict, vcCompare } from './sync.ts';
import type { Form, Memory } from './types.ts';

type PushResult = 'applied' | 'dedup' | 'behind' | 'conflict' | 'lww';

/** 中枢底层数据访问抽象：pglite 与远端 pg 共用同一套标准 PG SQL（B4 双后端同构） */
export interface HubDb {
  exec(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

/** pglite 后端（默认）：进程内 WASM Postgres，无参=内存、dataDir=落盘 */
class PgliteBackend implements HubDb {
  private db: PGlite;
  constructor(dataDir?: string) {
    this.db = new PGlite(dataDir);
  }
  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    return this.db.query<T>(sql, params);
  }
  async close(): Promise<void> {
    await this.db.close();
  }
}

/** 远端 pg 后端（B4）：依赖 `pg` 客户端；构造期只存 URL，connect()（init 内）才动态加载并建连接。
 *  未安装 pg 或未提供服务端时，仅当 SYNC_HUB_PG_URL 被设置才触发加载——默认 pglite 路径零依赖。 */
class PgRemoteBackend implements HubDb {
  private pool: Pool | null = null;
  constructor(private readonly pgUrl: string) {}

  async connect(): Promise<void> {
    if (this.pool) return;
    // 动态加载：避免默认 pglite 路径硬依赖 pg（纯 JS 客户端，但仅远端模式需要）
    const pg = await import('pg');
    this.pool = new pg.Pool({ connectionString: this.pgUrl });
  }

  async exec(sql: string): Promise<void> {
    if (!this.pool) throw new Error('PgRemoteBackend 未连接（先调 connect）');
    // 简单查询协议支持多语句（SCHEMA 内含多条 CREATE TABLE）
    await this.pool.query(sql);
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    if (!this.pool) throw new Error('PgRemoteBackend 未连接（先调 connect）');
    const res = await (params ? this.pool.query(sql, params) : this.pool.query(sql));
    return { rows: (res.rows ?? []) as T[] };
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

/** B1 多机规范三元组（中枢层硬过滤比对基准） */
export interface CanonicalTenant {
  team_id: string;
  enterprise_id: string;
  user_id?: string;
}

export interface PgSyncHubOptions {
  /** B4：远端 PG 连接串；设了且 pg 已安装 → 走远端后端 */
  pgUrl?: string;
  /** B1：多机规范三元组（与 45-A1 tenant.json 同域） */
  canonicalTenant?: CanonicalTenant;
  /** B1：开启跨机团队硬过滤（默认关；单机 pglite 无意义） */
  multiTenant?: boolean;
}

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
  private db: HubDb;
  private readonly canonicalTenant?: CanonicalTenant;
  private readonly multiTenant: boolean;
  private readonly isRemote: boolean;

  /** 构造向后兼容：可只传 dataDir（现状）；B4 用 opts.pgUrl 接远端；B1 用 opts.canonicalTenant/multiTenant 开硬过滤 */
  constructor(dataDir?: string, opts?: PgSyncHubOptions) {
    this.multiTenant = opts?.multiTenant === true;
    this.canonicalTenant = opts?.canonicalTenant;
    if (opts?.pgUrl) {
      this.isRemote = true;
      this.db = new PgRemoteBackend(opts.pgUrl);
    } else {
      this.isRemote = false;
      this.db = new PgliteBackend(dataDir);
    }
  }

  /** 建表（幂等）；构造后调用一次。B4 远端后端在此动态加载 pg 并建连；B1 在此登记规范三元组 */
  async init(): Promise<void> {
    if (this.isRemote) await (this.db as PgRemoteBackend).connect();
    await this.db.exec(SCHEMA);
    await this.db.exec("INSERT INTO hub_meta (k, v) VALUES ('cursor', '0') ON CONFLICT (k) DO NOTHING");
    if (this.multiTenant && this.canonicalTenant) {
      // 用 query（带参）而非 exec（exec 接口无参，pglite/pg 均不支持 exec 绑定参数）
      await this.db.query(
        `INSERT INTO hub_meta (k, v) VALUES ('canonical_tenant', $1) ON CONFLICT (k) DO NOTHING`,
        [JSON.stringify(this.canonicalTenant)],
      );
    }
  }

  /** 优雅关闭（测试/进程退出前；B4 远端 = pool.end，pglite = WASM 存储层刷盘） */
  async close(): Promise<void> {
    await this.db.close();
  }

  /** B1 多机硬过滤：非规范团队的读写 fail-closed（跨机伪造 team_id 不得落中枢） */
  private assertSameTenant(teamId: string): void {
    if (!this.multiTenant || !this.canonicalTenant) return;
    if (teamId !== this.canonicalTenant.team_id) {
      throw new Error(
        `B1 跨机团队硬过滤拒绝：team_id=${teamId} 越权访问规范团队 ${this.canonicalTenant.team_id} 的中枢`,
      );
    }
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
    this.assertSameTenant(mem.team_id); // B1
    const sha = mem.sha256 ?? sha256hex(mem.content);

    // sha256 幂等去重（§5：不同 mem_id 同内容 → 跳过）；墓碑内容为空，不参与该去重
    if (!mem.deleted) {
      const seenRow = await this.db.query<{ mem_id: string }>(
        'SELECT mem_id FROM hub_seen WHERE team_id = $1 AND sha256 = $2', [mem.team_id, sha],
      );
      if (seenRow.rows.length > 0 && seenRow.rows[0].mem_id !== mem.mem_id) return 'dedup';
    }

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
      if (!mem.deleted) {
        await this.db.query(
          `INSERT INTO hub_seen (team_id, sha256, mem_id) VALUES ($1, $2, $3)
           ON CONFLICT (team_id, sha256) DO UPDATE SET mem_id = excluded.mem_id`,
          [mem.team_id, sha, mem.mem_id],
        );
      }
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
      return 'behind'; // 本地落后 → 中枢已是最新；本地不得改动（D2）
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
      return 'behind'; // 镜像版本更晚 → 本地版本将被下行覆盖（本地不得改动）
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
    this.assertSameTenant(scope.team_id); // B1
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
    this.assertSameTenant(scope.team_id); // B1
    const rows = await this.db.query<{ key: string; doc: Memory }>(
      'SELECT key, doc FROM hub_memories WHERE team_id = $1 ORDER BY version_seq', [scope.team_id],
    );
    const items = rows.rows.filter((r) => !r.key.includes('#loser#')).map((r) => r.doc);
    const losers = rows.rows.filter((r) => r.key.includes('#loser#') && r.doc.decay_class === 'archived').map((r) => r.doc);
    const missing = items
      .filter((m) => !m.deleted) // 墓碑无正文，不参与指纹校验
      .filter((m) => !m.sha256 || m.sha256 !== sha256hex(m.content))
      .map((m) => m.mem_id);
    await this.audit({ action: 'sync_reconcile', form: 'desktop', team_id: scope.team_id, mem_ids: items.map((m) => m.mem_id), detail: { total: items.length, losers: losers.length, missing_local: missing.length } });
    return { items, losers, missing_local: missing };
  }

  /** 9.7 裁决队列（仅 pending；可按 team 隔离） */
  async listConflicts(team_id?: string): Promise<SyncConflict[]> {
    const rows = await this.db.query<{ doc: SyncConflict }>(
      `SELECT doc FROM hub_conflicts WHERE status = 'pending'
       AND ($1::text IS NULL OR doc->>'team_id' = $1)
       ORDER BY conflict_id`,
      [team_id ?? null],
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

  /** 审计游标（syncUp 引擎截取本轮审计用）：返回最大 seq，与 auditsFrom 的 seq 口径一致 */
  async auditCount(): Promise<number> {
    const r = await this.db.query<{ n: string }>('SELECT COALESCE(MAX(seq), 0)::text AS n FROM hub_audits');
    return Number(r.rows[0].n);
  }

  async auditsFrom(start: number, team_id?: string): Promise<SyncAudit[]> {
    const r = await this.db.query<SyncAudit & { ts: string }>(
      `SELECT request_id, action, form, team_id, mem_ids, version, sha256, ts, detail
       FROM hub_audits WHERE seq > $1 AND ($2::text IS NULL OR team_id = $2)
       ORDER BY seq`, [start, team_id ?? null],
    );
    return r.rows.map((row) => ({ ...row, ts: Number(row.ts) }));
  }
}
