// 批次48 A8：mirror 审计账本的链式签名（G6 证据账本，防静默改写）。
// 此前 home-mirror.json 只是普通 JSON 数组：任何能写该文件的人都能改动作/时间/载荷而不留痕迹。
//
// 方案：每条条目 = sha256(规范 JSON + prev_hash)，再用本机密钥做 HMAC-SHA256 签名；seq/prev_hash 串成链。
// 诚实的边界：密钥文件与本账本同机同目录（home-mirror.key，0600）。能读本机文件的人可以重算签名，
// 所以这条链能发现「账本被改过」，但不能抵御本机管理员/同权限进程。对外文案必须这样说明，不得夸大成防篡改。
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 端壳 mirror 上抛条目（G6：全动作、成对/上下文放 payload） */
export interface MirrorAuditEntry {
  seq: number;
  source: string;                 // 来源页：memory/lifecycle/dispute/audit/write/feedback/params/security
  action: string;                 // 端动作枚举（memory_forget / lifecycle_change / dispute / audit_query…）
  request_id?: string;
  payload?: unknown;
  ts: number;
  // ---- 批次48 A8 链式签名（历史条目可能没有这三个字段，按“未签名旧段”如实报告）----
  prev_hash?: string;
  hash?: string;
  sig?: string;
}

/** 链首：没有前一条时的锚点（固定 64 个 0） */
export const GENESIS_HASH = '0'.repeat(64);
/** 本机密钥文件名（与 home-mirror.json 同目录） */
export const MIRROR_KEY_FILE = 'home-mirror.key';

export interface MirrorIntegrity {
  ok: boolean;
  sealed: number;
  legacy_unsealed: number;
  /** 首个断链/被改写的条目 seq（ok=true 时为 undefined） */
  broken_at_seq?: number;
  reason?: string;
}

/** 稳定 JSON（键排序、丢弃 undefined）：同一内容在不同进程/版本下得到同一字符串 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return 'null';
}

/** 读本机密钥；不存在则首建（0600）。文件存在但内容非法 → 抛错（fail-closed，不用临时密钥顶替） */
export function loadOrCreateMirrorKey(dataDir: string): Buffer {
  const file = join(dataDir, MIRROR_KEY_FILE);
  const parse = (raw: string): Buffer => {
    const t = raw.trim();
    if (!/^[0-9a-f]{64}$/i.test(t)) throw new Error(`mirror 账本密钥文件格式非法（期望 64 位 hex）：${file}`);
    return Buffer.from(t, 'hex');
  };
  try {
    return parse(readFileSync(file, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  mkdirSync(dirname(file), { recursive: true });
  const key = randomBytes(32);
  try {
    writeFileSync(file, key.toString('hex'), { mode: 0o600, flag: 'wx' });
    return key;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return parse(readFileSync(file, 'utf8')); // 并发首建：读回先写者的
    throw e;
  }
}

/** 参与哈希的字段投影：必须与签名时完全一致，且不能把 hash/sig 自身算进去 */
type Hashable = Pick<MirrorAuditEntry, 'seq' | 'source' | 'action' | 'request_id' | 'payload' | 'ts' | 'prev_hash'>;

function projection(e: Hashable): Hashable {
  return {
    seq: e.seq,
    source: e.source,
    action: e.action,
    ...(e.request_id !== undefined ? { request_id: e.request_id } : {}),
    payload: e.payload ?? null,
    ts: e.ts,
    prev_hash: e.prev_hash,
  };
}

function hashOf(e: Hashable): string {
  return createHash('sha256').update(canonicalJson(projection(e))).digest('hex');
}

function sign(key: Buffer, hash: string): string {
  return createHmac('sha256', key).update(hash).digest('hex');
}

/** 给新条目算 prev_hash/hash/sig（不改原对象） */
export function sealMirrorEntry(entry: MirrorAuditEntry, prevHash: string, key: Buffer): MirrorAuditEntry {
  const base = projection({
    seq: entry.seq,
    source: entry.source,
    action: entry.action,
    request_id: entry.request_id,
    payload: entry.payload,
    ts: entry.ts,
    prev_hash: prevHash,
  });
  const hash = hashOf(base);
  return { ...base, hash, sig: sign(key, hash) };
}

/**
 * 校验整条链：旧的无签名字段只能在链首成段；一旦出现签名条目，其后不允许再混入未签名条目。
 * 任何一条被改写（内容/hash/签名/prev 衔接）都会在 broken_at_seq 点名。
 */
export function verifyMirrorChain(entries: readonly MirrorAuditEntry[], key: Buffer): MirrorIntegrity {
  let prev = GENESIS_HASH;
  let sealed = 0;
  let legacy = 0;
  let started = false;
  for (const e of entries) {
    const unsigned = !e.hash || !e.sig || !e.prev_hash;
    if (unsigned) {
      if (started) {
        return { ok: false, sealed, legacy_unsealed: legacy, broken_at_seq: e.seq, reason: '签名链中途出现未签名条目（疑似删除/插入）' };
      }
      legacy += 1;
      continue;
    }
    if (e.prev_hash !== prev) {
      return { ok: false, sealed, legacy_unsealed: legacy, broken_at_seq: e.seq, reason: 'prev_hash 与上一条不衔接（疑似删改条目）' };
    }
    if (hashOf(e) !== e.hash) {
      return { ok: false, sealed, legacy_unsealed: legacy, broken_at_seq: e.seq, reason: '条目内容与 hash 不符（被改写）' };
    }
    if (sign(key, e.hash) !== e.sig) {
      return { ok: false, sealed, legacy_unsealed: legacy, broken_at_seq: e.seq, reason: '签名不匹配（条目被改或密钥文件被换）' };
    }
    prev = e.hash;
    sealed += 1;
    started = true;
  }
  return { ok: true, sealed, legacy_unsealed: legacy };
}

/** 对外如实说明（GET /api/mirror/audit 的 integrity.note 用同一句，禁止页面/文档改写成“防篡改”） */
export const MIRROR_INTEGRITY_NOTE =
  'HMAC-SHA256 链式签名；密钥与本账本同机同目录（home-mirror.key，0600）。能读本机文件者可重算签名——此链用于发现账本被改写，不抵御本机管理员。';
