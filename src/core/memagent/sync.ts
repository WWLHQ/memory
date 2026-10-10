// REQ-008 云同步（同步机制详细设计 §1–§8）：sha256 幂等 + 向量时钟 LWW + SyncHub 中枢 + 三端引擎
// 三项锁定：桌面主源 / 自动 LWW（仅语义互斥进 9.7 队列）/ 中枢账本。内存 SyncHub 接口同构 Postgres 中枢。
import { ulid } from './ulid.ts';
import type { Form, Memory } from './types.ts';

// ---------- sha256（5.4 幂等指纹，纯 JS，浏览器 + Node 通用） ----------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 纯 JS SHA-256（紧凑实现，仅供演示级指纹） */
export function sha256hex(msg: string): string {
  const bytes = new TextEncoder().encode(msg);
  const bitLen = bytes.length * 8;
  const withPad = new Uint8Array(((bytes.length + 9) >> 6 << 6) || 64);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, bitLen >>> 0);
  dv.setUint32(withPad.length - 8, Math.floor(bitLen / 2 ** 32));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    for (let i = 0; i < 8; i++) H[i] = (H[i] + [a, b, c, d, e, f, g, h][i]) >>> 0;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}

// ---------- 向量时钟（§3.1） ----------
export type VClock = Record<string, number>;

/** 偏序判定：ahead / behind / concurrent / equal */
export function vcCompare(a: VClock, b: VClock): 'ahead' | 'behind' | 'concurrent' | 'equal' {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aGreater = false, bGreater = false;
  for (const k of keys) {
    const va = a[k] ?? 0, vb = b[k] ?? 0;
    if (va > vb) aGreater = true;
    if (va < vb) bGreater = true;
  }
  if (aGreater && bGreater) return 'concurrent';
  if (aGreater) return 'ahead';
  if (bGreater) return 'behind';
  return 'equal';
}

/** 递增本端时钟 */
export function vcTick(clock: VClock | undefined, form: Form): VClock {
  const c = { ...(clock ?? {}) };
  c[form] = (c[form] ?? 0) + 1;
  return c;
}

// ---------- 冲突类型（§4） ----------
export interface SyncConflict {
  conflict_id: string;
  mem_id: string;
  team_id: string;
  project_id: string;
  local: Memory;          // 上行版本
  remote: Memory;         // 镜像版本
  local_form: Form;
  remote_form: Form;
  /** last-writer-wins 还是挂 9.7 队列（自动 LWW 锁定，仅全晚挂队列） */
  status: 'pending' | 'resolved';
}

export interface SyncAudit {
  request_id: string;
  action: 'sync_up' | 'sync_down' | 'sync_reconcile' | 'conflict_resolve' | 'sync_fail';
  form: Form;
  team_id: string;
  mem_ids: string[];
  version?: number;
  sha256?: string;
  ts: number;
  detail: Record<string, unknown>;
}

// ---------- SyncHub（§2 服务端中枢：镜像 + 幂等账本 + 裁决） ----------
export class SyncHub {
  /** 镜像：team_id → mem_id → 记忆 */
  private mirror = new Map<string, Map<string, Memory>>();
  /** 幂等账本：team_id → sha256 → mem_id（§5 回传去重） */
  private seen = new Map<string, Map<string, string>>();
  /** 全局版本游标（§3.3 since=version_cursor 增量下行） */
  private cursor = 0;
  private versions = new Map<string, number>(); // mem_id → 全局单调版本
  private conflicts = new Map<string, SyncConflict>();
  /** 中枢审计（日志页可查，§6） */
  audits: SyncAudit[] = [];

  private audit(a: Omit<SyncAudit, 'request_id' | 'ts'>): SyncAudit {
    const rec: SyncAudit = { ...a, request_id: `req_${ulid()}`, ts: Date.now() };
    this.audits.push(rec);
    return rec;
  }

  private bucket(team: string) {
    if (!this.mirror.has(team)) this.mirror.set(team, new Map());
    return this.mirror.get(team)!;
  }

  private seenBucket(team: string) {
    if (!this.seen.has(team)) this.seen.set(team, new Map());
    return this.seen.get(team)!;
  }

  /**
   * 上行（§3.2）：sha256 幂等去重；向量时钟判冲突。
   * 返回：'applied' 已落镜像 / 'dedup' 幂等跳过 / 'conflict' 挂队列 / 'lww' LWW 覆盖
   */
  push(mem: Memory, form: Form): 'applied' | 'dedup' | 'conflict' | 'lww' {
    const sha = mem.sha256 ?? sha256hex(mem.content);
    const sb = this.seenBucket(mem.team_id);
    if (sb.get(sha) && sb.get(sha) !== mem.mem_id) return 'dedup'; // 不同 mem_id 同内容 → 幂等跳过

    const bucket = this.bucket(mem.team_id);
    const remote = bucket.get(mem.mem_id);
    if (!remote) {
      bucket.set(mem.mem_id, { ...mem, sha256: sha });
      this.versions.set(mem.mem_id, ++this.cursor);
      sb.set(sha, mem.mem_id);
      this.audit({ action: 'sync_up', form, team_id: mem.team_id, mem_ids: [mem.mem_id], version: mem.version, sha256: sha, detail: { op: 'create' } });
      return 'applied';
    }

    const cmp = vcCompare(mem.vclock ?? {}, remote.vclock ?? {});
    if (cmp === 'ahead' || (cmp === 'equal' && mem.version > remote.version)) {
      // 因果占优 → 覆盖
      bucket.set(mem.mem_id, { ...mem, sha256: sha });
      this.versions.set(mem.mem_id, ++this.cursor);
      sb.set(sha, mem.mem_id);
      this.audit({ action: 'sync_up', form, team_id: mem.team_id, mem_ids: [mem.mem_id], version: mem.version, sha256: sha, detail: { op: 'overwrite', clock: cmp } });
      return 'applied';
    }
    if (cmp === 'behind') {
      return 'dedup'; // 本地落后 → 中枢已是最新，无需处理
    }
    // concurrent：§4 自动 LWW —— 时间戳晚者赢（带 vector clock 因果判定）
    if (mem.updated_at && remote.updated_at && mem.updated_at !== remote.updated_at) {
      const localWins = mem.updated_at > remote.updated_at;
      if (localWins) {
        // 败者转 archived（9.7 生命周期，不物理删）
        bucket.set(mem.mem_id, { ...mem, sha256: sha });
        const loser = { ...remote, decay_class: 'archived' as const, version: remote.version + 1 };
        bucket.set(`${mem.mem_id}#loser#${ulid()}`, loser);
        this.versions.set(mem.mem_id, ++this.cursor);
        sb.set(sha, mem.mem_id);
        this.audit({ action: 'sync_up', form, team_id: mem.team_id, mem_ids: [mem.mem_id], version: mem.version, sha256: sha, detail: { op: 'lww', winner: 'local', loser_archived: true } });
        return 'lww';
      }
      this.audit({ action: 'sync_up', form, team_id: mem.team_id, mem_ids: [mem.mem_id], version: mem.version, sha256: sha, detail: { op: 'lww', winner: 'remote' } });
      // 败者（本次上行版本）同样转 archived，不物理删（9.7 对称）
      bucket.set(`${mem.mem_id}#loser#${ulid()}`, { ...mem, sha256: sha, decay_class: 'archived' as const, version: mem.version + 1 });
      return 'dedup'; // 镜像版本更晚 → 本地版本将被下行覆盖
    }
    // 全晚（时间戳相同无法判序）→ 9.7 裁决队列（P8）
    const c: SyncConflict = {
      conflict_id: `cf_${ulid()}`, mem_id: mem.mem_id, team_id: mem.team_id, project_id: mem.project_id,
      local: mem, remote, local_form: form, remote_form: 'desktop', status: 'pending',
    };
    this.conflicts.set(c.conflict_id, c);
    this.audit({ action: 'sync_fail', form, team_id: mem.team_id, mem_ids: [mem.mem_id], version: mem.version, sha256: sha, detail: { reason: 'concurrent_unresolvable', conflict_id: c.conflict_id } });
    return 'conflict';
  }

  /** 下行（§3.3）：since=cursor 增量，team_id 隔离（§1：不同 team 不混入） */
  pull(scope: { team_id: string; user_id?: string }, since: number, form: Form = 'web'): { items: Memory[]; cursor: number } {
    const bucket = this.bucket(scope.team_id);
    const items: Memory[] = [];
    for (const [mem_id, m] of bucket) {
      if (mem_id.includes('#loser#')) continue; // 败者墓碑不下行（9.7：仅留档可查）
      const v = this.versions.get(mem_id) ?? 0;
      if (v > since) {
        // user 级偏好只同步给同 user（§1 个人偏好 user_id 级）
        if (m.category === 'preference' && scope.user_id && m.user_id && m.user_id !== scope.user_id) continue;
        items.push({ ...m });
      }
    }
    this.audit({ action: 'sync_down', form, team_id: scope.team_id, mem_ids: items.map((m) => m.mem_id), detail: { since, count: items.length } });
    return { items, cursor: this.cursor };
  }

  /** 每日全量对账（§3.4 补偿通道）：sha256 比对；losers 单列（败者留档可查，不混入对账项） */
  reconcile(scope: { team_id: string }): { items: Memory[]; losers: Memory[]; missing_local: string[] } {
    const bucket = this.bucket(scope.team_id);
    const all = [...bucket.entries()]; // [key, mem]：#loser# 标记在 key 上，对象 mem_id 保持原值
    const items = all.filter(([k]) => !k.includes('#loser#')).map(([, m]) => m);
    const losers = all.filter(([k, m]) => k.includes('#loser#') && m.decay_class === 'archived').map(([, m]) => m);
    const missing: string[] = [];
    for (const m of items) {
      if (!m.sha256 || m.sha256 !== sha256hex(m.content)) missing.push(m.mem_id); // 指纹不一致 → 需修复
    }
    this.audit({ action: 'sync_reconcile', form: 'desktop', team_id: scope.team_id, mem_ids: items.map((m) => m.mem_id), detail: { total: items.length, losers: losers.length, missing_local: missing.length } });
    return { items, losers, missing_local: missing };
  }

  /** 9.7 裁决队列 */
  listConflicts(): SyncConflict[] {
    return [...this.conflicts.values()].filter((c) => c.status === 'pending');
  }

  resolve(conflict_id: string, winner: 'local' | 'remote'): void {
    const c = this.conflicts.get(conflict_id);
    if (!c) return;
    const bucket = this.bucket(c.team_id);
    const win = winner === 'local' ? c.local : c.remote;
    const lose = winner === 'local' ? c.remote : c.local;
    bucket.set(c.mem_id, { ...win, version: win.version + 1 });
    bucket.set(`${c.mem_id}#loser#${ulid()}`, { ...lose, decay_class: 'archived', version: lose.version + 1 });
    c.status = 'resolved';
    this.versions.set(c.mem_id, ++this.cursor);
    this.audit({ action: 'conflict_resolve', form: c.local_form, team_id: c.team_id, mem_ids: [c.mem_id], version: win.version, detail: { conflict_id, winner } });
  }

  getCursor(): number {
    return this.cursor;
  }
}

// ---------- 各端引擎（§3.2/§3.3/§5） ----------
/** 上行前包装：打 sha256 + 本端时钟 + version++（写操作本地先落盘，§3.1） */
export function stampForSync(m: Memory, form: Form): Memory {
  return {
    ...m,
    sha256: sha256hex(m.content),
    vclock: vcTick(m.vclock, form),
    version: m.version + 1,
    updated_at: m.updated_at ?? Date.now(), // 写时已定，sync 打戳不覆盖（否则 LWW 判序失真）
    pending_sync: false,
  };
}

export interface SyncUpReport {
  applied: number; dedup: number; conflicts: string[]; lww: number;
  audits: SyncAudit[];
}

/** 上行（桌面实时 / Web 即时 / 移动批量回传 / CLI 命令触发） */
export async function syncUp(local: { listMemories(f: { project_id?: string }): Promise<Memory[]>; putMemory(m: Memory): Promise<void> }, hub: SyncHub, form: Form, filter?: { onlyPending?: boolean }): Promise<SyncUpReport> {
  const mems = await local.listMemories({});
  const report: SyncUpReport = { applied: 0, dedup: 0, conflicts: [], lww: 0, audits: [] };
  const auditStart = hub.audits.length;
  for (const m of mems) {
    if (filter?.onlyPending && !m.pending_sync) continue;
    if (m.mem_id.includes('#loser#')) continue; // 败者不回传
    const stamped = stampForSync(m, form);
    const r = hub.push(stamped, form);
    await local.putMemory({ ...stamped, pending_sync: false }); // §5：回传后清 pending_sync
    if (r === 'applied') report.applied++;
    else if (r === 'dedup') report.dedup++;
    else if (r === 'lww') report.lww++;
    else report.conflicts.push(...hub.listConflicts().filter((c) => c.mem_id === m.mem_id).map((c) => c.conflict_id));
  }
  report.audits = hub.audits.slice(auditStart); // 本轮产生的审计（§6 form 归因）
  return report;
}

/** 下行（§3.3）：镜像增量 → 本地落盘（补"自己没的、别人改的"） */
export async function syncDown(hub: SyncHub, local: { putMemory(m: Memory): Promise<void>; getMemory(id: string): Promise<Memory | null> }, scope: { team_id: string; user_id?: string }, since: number, form: Form = 'web'): Promise<{ pulled: number; cursor: number }> {
  const { items, cursor } = hub.pull(scope, since, form);
  let pulled = 0;
  for (const m of items) {
    const existing = await local.getMemory(m.mem_id);
    if (!existing || existing.version < m.version) {
      await local.putMemory({ ...m, pending_sync: false });
      pulled++;
    }
  }
  return { pulled, cursor };
}

/** 每日全量对账（§3.4）：补漏 + 指纹校验 */
export async function reconcile(hub: SyncHub, local: { putMemory(m: Memory): Promise<void>; getMemory(id: string): Promise<Memory | null> }, scope: { team_id: string; user_id?: string }): Promise<{ backfilled: number; integrity_issues: string[] }> {
  const { items, missing_local } = hub.reconcile(scope);
  let backfilled = 0;
  for (const m of items) {
    const existing = await local.getMemory(m.mem_id);
    if (!existing) {
      await local.putMemory({ ...m, pending_sync: false });
      backfilled++;
    }
  }
  return { backfilled, integrity_issues: missing_local };
}

/** 审计查询辅助（日志页可查 sync_*，§6） */
export function filterSyncAudits(audits: SyncAudit[], f: { action?: SyncAudit['action']; form?: Form; since?: number }): SyncAudit[] {
  return audits.filter((a) => {
    if (f.action && a.action !== f.action) return false;
    if (f.form && a.form !== f.form) return false;
    if (f.since && a.ts < f.since) return false;
    return true;
  });
}
