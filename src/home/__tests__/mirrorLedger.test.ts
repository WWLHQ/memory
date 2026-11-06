// 批次48 A8：mirror 账本链式签名纯逻辑验收（真实 HMAC/哈希，不读源码断言）。
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GENESIS_HASH, MIRROR_KEY_FILE, canonicalJson, loadOrCreateMirrorKey, sealMirrorEntry, verifyMirrorChain,
  type MirrorAuditEntry,
} from '../mirrorLedger.ts';

const KEY = Buffer.from('a'.repeat(64), 'hex');
const OTHER_KEY = Buffer.from('b'.repeat(64), 'hex');

function base(seq: number, payload: unknown = { op: 'x' }): MirrorAuditEntry {
  return { seq, source: 'memory', action: 'memory_forget', request_id: `req_${seq}`, payload, ts: 1_800_000_000_000 };
}

describe('canonicalJson', () => {
  it('键顺序无关、undefined 忽略，同一内容得到同一字符串', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 'x', c: null }] })).toBe('{"a":[2,{"c":null,"d":"x"}],"b":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('链式签名与校验', () => {
  it('两条连续条目校验通过；hash 依赖上一条并覆盖 payload', () => {
    const e1 = sealMirrorEntry(base(1), GENESIS_HASH, KEY);
    const e2 = sealMirrorEntry(base(2), e1.hash!, KEY);
    expect(e1.prev_hash).toBe(GENESIS_HASH);
    expect(e2.prev_hash).toBe(e1.hash);
    expect(verifyMirrorChain([e1, e2], KEY)).toMatchObject({ ok: true, sealed: 2, legacy_unsealed: 0 });
  });

  it('改写条目内容（保留旧 hash）→ 校验点名该条', () => {
    const e1 = sealMirrorEntry(base(1), GENESIS_HASH, KEY);
    const e2 = sealMirrorEntry(base(2), e1.hash!, KEY);
    const tampered = { ...e1, payload: { op: 'forged' } };
    expect(verifyMirrorChain([tampered, e2], KEY)).toMatchObject({ ok: false, broken_at_seq: 1, reason: '条目内容与 hash 不符（被改写）' });
  });

  it('攻击者无密钥：内容篡改并重算 hash → 签名不匹配', () => {
    const e1 = sealMirrorEntry(base(1), GENESIS_HASH, KEY);
    const forged = sealMirrorEntry({ ...base(1), payload: { op: 'forged' } }, GENESIS_HASH, KEY); // hash 自洽，但签名仍是真密钥的
    const forgedWithoutKey = { ...forged, sig: sealMirrorEntry({ ...base(1), payload: { op: 'forged' } }, GENESIS_HASH, OTHER_KEY).sig };
    expect(verifyMirrorChain([forgedWithoutKey], KEY)).toMatchObject({ ok: false, broken_at_seq: 1, reason: '签名不匹配（条目被改或密钥文件被换）' });
    // 用错密钥校验整条真链也必须失败（密钥被替换时要报出来）
    expect(verifyMirrorChain([e1], OTHER_KEY)).toMatchObject({ ok: false, broken_at_seq: 1 });
  });

  it('删除中间条目 → prev_hash 不衔接', () => {
    const e1 = sealMirrorEntry(base(1), GENESIS_HASH, KEY);
    const e2 = sealMirrorEntry(base(2), e1.hash!, KEY);
    const e3 = sealMirrorEntry(base(3), e2.hash!, KEY);
    expect(verifyMirrorChain([e1, e3], KEY)).toMatchObject({ ok: false, broken_at_seq: 3, reason: 'prev_hash 与上一条不衔接（疑似删改条目）' });
  });

  it('旧的无签名条目只允许在链首：链首旧段如实计数，混在签名段之后即断链', () => {
    const legacy1: MirrorAuditEntry = { seq: 1, source: 'audit', action: 'audit_query', ts: 1 };
    const legacy2: MirrorAuditEntry = { seq: 2, source: 'audit', action: 'audit_query', ts: 2 };
    const e3 = sealMirrorEntry({ ...base(3), source: 'audit' }, GENESIS_HASH, KEY);
    expect(verifyMirrorChain([legacy1, legacy2, e3], KEY)).toMatchObject({ ok: true, sealed: 1, legacy_unsealed: 2 });
    expect(verifyMirrorChain([e3, legacy1], KEY)).toMatchObject({ ok: false, broken_at_seq: 1, reason: '签名链中途出现未签名条目（疑似删除/插入）' });
  });
});

describe('本机密钥文件', () => {
  it('首建 64 位 hex 密钥并复用；内容非法则抛错（不静默换新密钥）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mirror-key-'));
    try {
      const k1 = loadOrCreateMirrorKey(dir);
      const file = join(dir, MIRROR_KEY_FILE);
      expect(readFileSync(file, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/i);
      expect(k1.length).toBe(32);
      expect(loadOrCreateMirrorKey(dir).equals(k1)).toBe(true);

      writeFileSync(file, 'not-a-key');
      expect(() => loadOrCreateMirrorKey(dir)).toThrow('密钥文件格式非法');

      // 文件权限：POSIX 上应为 0600（Windows 的 mode 语义不同，跳过该断言）
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
