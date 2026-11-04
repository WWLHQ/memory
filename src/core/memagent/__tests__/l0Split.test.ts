// 存量拆分迁移回归（批次37-C）：明文必须封存才许搬、行上密文原样搬、缺备份/缺写密钥一律拒绝且不改数据、
// 完整性核对（孤儿/断链）如实点名、单行失败不中断整轮、再跑一遍幂等零写盘、审计成对且不含正文。
import { describe, it, expect, vi } from 'vitest';
import { scanLedgerForSplit, splitLedger } from '../l0Split.ts';
import { InMemoryL0BlobStore } from '../l0Store.ts';
import { InMemoryStorage } from '../storage.ts';
import type { Memory } from '../types.ts';

const NOW = 1_800_000_000_000;
const L1 = '需求：把 L0 原文与 L1–L6 拆成两个库文件，首次启动强制指定位置。';
const PLAIN = '用户的原始对话：错误码 E_STORAGE_CORRUPT，端口 8204，密钥 hunter2';
/** 合法 v2 信封（形状可解析即可；本模块不解密，也不该解密） */
const ENV_V2 = '{"v":2,"alg":"AES-256-GCM","iv":"aGl2","tag":"aHRhZw","ct":"Y3Qx"}';
const ENV_V1 = '{"v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":100000,"salt":"c2FsdA","iv":"aGl2","tag":"aHRhZw","ct":"Y3Qy"}';
const GARBAGE = 'base64-or-plaintext-not-an-envelope';

function mem(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_sp_1', project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L1', content: L1, content_l1: L1,
    decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: NOW,
    ...over,
  };
}

async function seeded(mems: Memory[]) {
  const storage = new InMemoryStorage();
  for (const m of mems) await storage.putMemory(m);
  return storage;
}

/** 假封存只做形状可辨：本模块不解密，测试也不验证密码学 */
const OK_SEAL = async (): Promise<string> => ENV_V2;

const base = { admin_user_id: 'admin', request_id: 'req_sp_1', now: NOW, backup_confirmed: true } as const;

describe('scanLedgerForSplit 只读预览', () => {
  it('分类计数 + 完整性核对，且不写任何数据与审计', async () => {
    const l0 = new InMemoryL0BlobStore();
    await l0.put('mem_sp_3', { envelope: ENV_V2, sealed_at: NOW });
    await l0.put('mem_orphan', { envelope: ENV_V2, sealed_at: NOW });
    const storage = await seeded([
      mem({ content_orig: PLAIN }),                                     // 明文 → 待封存搬走
      mem({ mem_id: 'mem_sp_2', content_l0_enc: ENV_V1 }),               // 行上遗留 v1 → 只搬家
      mem({ mem_id: 'mem_sp_3', has_l0: true }),                         // 已拆好
      mem({ mem_id: 'mem_sp_4', has_l0: true }),                         // 断链：行说有、库里没有
      mem({ mem_id: 'mem_sp_5', content_l0_enc: GARBAGE }),              // 垃圾信封 → 不搬
      mem({ mem_id: 'mem_sp_6', deleted: true, content_orig: PLAIN }),   // 墓碑 → 不搬
    ]);
    const beforeAudit = await storage.queryAudit({});
    const p = await scanLedgerForSplit(storage, l0);
    expect(p).toMatchObject({
      total: 6, tombstones: 1, plaintext_orig: 1, on_row_cipher: 1,
      on_row_cipher_v: { v2: 0, legacy_v1: 1 }, invalid_envelope: 1,
      already_split: 2, to_move: 2, l0_count: 2, orphan_blobs: 1, broken_links: 1,
    });
    expect(p.broken_link_ids).toEqual(['mem_sp_4']);
    expect(p.l0_bytes).toBeGreaterThan(0);
    expect(await storage.queryAudit({})).toEqual(beforeAudit);
    expect((await storage.getMemory('mem_sp_1'))!.content_orig).toBe(PLAIN);
  });

  it('没有 L0 库（浏览器镜像/未接线）→ 库侧数字为 0，行侧分类照常给出，不炸', async () => {
    const storage = await seeded([mem({ content_orig: PLAIN }), mem({ mem_id: 'mem_sp_2', has_l0: true })]);
    const p = await scanLedgerForSplit(storage, undefined);
    expect(p).toMatchObject({ l0_count: 0, l0_bytes: 0, orphan_blobs: 0, broken_links: 1, plaintext_orig: 1 });
  });
});

describe('splitLedger 执行', () => {
  it('缺备份确认 / 缺管理员 → 直接拒绝，一个字节都不改', async () => {
    const storage = await seeded([mem({ content_orig: PLAIN })]);
    const l0 = new InMemoryL0BlobStore();
    await expect(splitLedger({
      storage, l0Blobs: l0, seal: OK_SEAL, request_id: 'r', now: NOW, admin_user_id: 'admin',
      backup_confirmed: false as unknown as true,
    })).rejects.toThrow(/备份/);
    await expect(splitLedger({
      storage, l0Blobs: l0, seal: OK_SEAL, request_id: 'r', now: NOW, admin_user_id: '', backup_confirmed: true,
    })).rejects.toThrow(/管理员/);
    expect((await storage.getMemory('mem_sp_1'))!.content_orig).toBe(PLAIN);
    expect(await l0.count()).toBe(0);
  });

  it('有明文行却没解锁写密钥 → E_L0_LOCKED，且整轮不执行（绝不把明文塞进 L0 库）', async () => {
    const storage = await seeded([mem({ content_orig: PLAIN }), mem({ mem_id: 'mem_sp_2', content_l0_enc: ENV_V2 })]);
    const l0 = new InMemoryL0BlobStore();
    await expect(splitLedger({ storage, l0Blobs: l0, ...base })).rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    expect(await l0.count()).toBe(0);
    expect((await storage.getMemory('mem_sp_2'))!.content_l0_enc).toBe(ENV_V2);
  });

  it('正常路径：明文封存后搬走、行上密文原样搬走，记忆库里既无原文也无信封，行只剩 has_l0', async () => {
    const storage = await seeded([
      mem({ content_orig: PLAIN }),
      mem({ mem_id: 'mem_sp_2', content_l0_enc: ENV_V1 }),
      mem({ mem_id: 'mem_sp_5', content_l0_enc: GARBAGE }),
    ]);
    const l0 = new InMemoryL0BlobStore();
    const report = await splitLedger({ storage, l0Blobs: l0, seal: async (p) => (p === PLAIN ? ENV_V2 : ENV_V1), ...base });
    expect(report).toMatchObject({ moved: 2, sealed_from_plaintext: 1, cipher_moved: 1, failed: 0, invalid_envelope: 1, to_move: 0 });

    const row1 = (await storage.getMemory('mem_sp_1'))!;
    expect(row1.has_l0).toBe(true);
    expect(row1.content_orig).toBeFalsy();
    expect(row1.content_l0_enc).toBeFalsy();
    expect(row1.version).toBe(2);
    expect(row1.content_l1).toBe(L1); // 可检索层一字不动
    expect((await storage.getMemory('mem_sp_5'))!.content_l0_enc).toBe(GARBAGE); // 垃圾留在原处，如实计数

    expect(await l0.count()).toBe(2);
    expect((await l0.get('mem_sp_1'))!.envelope).toBe(ENV_V2);
    expect((await l0.get('mem_sp_2'))!.envelope).toBe(ENV_V1);
    expect((await l0.get('mem_sp_1'))!.sealed_at).toBe(NOW);

    const ops = (await storage.queryAudit({ action: 'memory_op' as never })).filter((a) => (a.detail as any)?.op === 'l0_split');
    expect(ops).toHaveLength(2);
    const sum = (await storage.queryAudit({ action: 'security_change' as never })).find((a) => (a.detail as any)?.op === 'l0_split');
    expect((sum!.detail as any)).toMatchObject({ moved: 2, l0_count: 2, broken_links: 0, orphan_blobs: 0, failed: 0 });
    // 审计里绝不出现原文/信封正文
    const dump = JSON.stringify(ops) + JSON.stringify(sum);
    expect(dump).not.toContain(PLAIN);
    expect(dump).not.toContain('AES-256-GCM');
    expect(dump).not.toContain('hunter2');
  });

  it('全库都是明文（本机实测形态：1641 行明文 content_orig）→ 逐行封存搬走，跑完记忆库里搜不到任何原文', async () => {
    const storage = await seeded(Array.from({ length: 25 }, (_, i) => mem({ mem_id: `m${i}`, content_orig: `原文 ${i}` })));
    const l0 = new InMemoryL0BlobStore();
    const report = await splitLedger({ storage, l0Blobs: l0, seal: OK_SEAL, ...base });
    // 回执里的 plaintext_orig 是**执行后**的核对：应当归零（记忆库里再没有原文）
    expect(report).toMatchObject({
      sealed_from_plaintext: 25, moved: 25, plaintext_orig: 0,
      already_split: 25, broken_links: 0, orphan_blobs: 0,
    });
    expect(await l0.count()).toBe(25);
  });

  it('幂等：再跑一遍 to_move=0、零改写（version 不再叠加）', async () => {
    const storage = await seeded([mem({ content_orig: PLAIN })]);
    const l0 = new InMemoryL0BlobStore();
    const first = await splitLedger({ storage, l0Blobs: l0, seal: OK_SEAL, ...base });
    const vAfterFirst = (await storage.getMemory('mem_sp_1'))!.version;
    const opsAfterFirst = (await storage.queryAudit({ action: 'memory_op' as never })).length;
    const second = await splitLedger({ ...base, request_id: 'req_sp_2', storage, l0Blobs: l0, seal: OK_SEAL });
    expect(first.moved).toBe(1);
    expect(second).toMatchObject({ to_move: 0, moved: 0, plaintext_orig: 0, already_split: 1 });
    expect((await storage.getMemory('mem_sp_1'))!.version).toBe(vAfterFirst);
    expect((await storage.queryAudit({ action: 'memory_op' as never })).length).toBe(opsAfterFirst);
    expect(await l0.count()).toBe(1);
  });

  it('单行写盘失败不中断整轮：失败行如实计数并保留原状，其余照常搬走', async () => {
    const storage = await seeded([
      mem({ content_orig: 'A' }),
      mem({ mem_id: 'mem_sp_2', content_orig: 'B' }),
    ]);
    const realPut = storage.putMemory.bind(storage);
    const boom = vi.spyOn(storage, 'putMemory').mockImplementation(async (m) => {
      if (m.mem_id === 'mem_sp_2') throw new Error('disk full');
      return realPut(m);
    });
    const l0 = new InMemoryL0BlobStore();
    const report = await splitLedger({ storage, l0Blobs: l0, seal: OK_SEAL, ...base });
    expect(report).toMatchObject({ moved: 1, failed: 1 });
    expect(report.failed_ids).toEqual(['mem_sp_2']);
    expect((await storage.getMemory('mem_sp_2'))!.content_orig).toBe('B');
    boom.mockRestore();
  });

  it('搬完发现断链（记忆库有 has_l0、L0 库没有）→ 回执如实报出，不粉饰成"已拆干净"', async () => {
    const storage = await seeded([mem({ content_orig: PLAIN }), mem({ mem_id: 'mem_sp_9', has_l0: true })]);
    const l0 = new InMemoryL0BlobStore();
    const report = await splitLedger({ storage, l0Blobs: l0, seal: OK_SEAL, ...base });
    expect(report.moved).toBe(1);
    expect(report.broken_links).toBe(1);
    expect(report.broken_link_ids).toEqual(['mem_sp_9']);
  });
});
