// 批次37-C 落盘验收：splitLedger 跑在**真实 FileStorage + FileL0BlobStore**（两个文件）上。
// 单测里用内存实现只能证明判定，证明不了「写出去的记忆库文件里真的一个字节原文都不剩」，
// 而这条正是本批次存在的理由（本机实测 1641 行明文 content_orig ≈ 5.5 MB）。
// 四件事逐一钉死：① 明文封存后搬进 L0 文件，记忆库文件里搜不到原文；② 行只留 has_l0，可检索正文不动；
// ③ 遗留 v1 信封原样搬家（不重封——重封要旧密码，是 l0:migrate 的活）；④ 重开两个文件后查阅能取回原文。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStorage } from '../fileStorage.ts';
import { FileL0BlobStore } from '../l0Store.ts';
import { scanLedgerForSplit, splitLedger } from '../l0Split.ts';
import { coreBrowse } from '../memories.ts';
import type { Memory } from '../types.ts';
import { createTestVault, TEST_ADMIN_PW } from './l0Kit.ts';

const NOW = 1_800_000_000_000;
const L1 = '拆库需求：L0 原文与 L1–L6 分两个文件，首次启动强制指定位置。';
const RAW = '数据库连接串 postgres://admin:pass@10.0.0.1:5432/prod 报错 ECONNREFUSED，端口 5432 未放行';
/** 遗留 v1 信封（逐条 KDF，重封需要旧密码）：本模块只搬家，绝不重封 */
const ENV_V1 = '{"v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":100000,"salt":"c2FsdA","iv":"aGl2","tag":"aHRhZw","ct":"Y3Qz"}';

function mem(id: string, over: Partial<Memory> = {}): Memory {
  return {
    mem_id: id, project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'lesson', layer: 'L1', content: L1, content_l1: L1, decay_class: 'hot',
    pinned: false, locked: false, created_at: NOW, updated_at: NOW, version: 1,
    ...over,
  } as unknown as Memory;
}

describe('splitLedger 真实落盘（批次37-C：两个文件各归各位）', () => {
  let dir: string;
  let dbPath: string;
  let l0Path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'l0split-'));
    dbPath = join(dir, 'memories.db.json');
    l0Path = join(dir, 'memories.l0.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('明文行 → 封存搬进 L0 文件；记忆库文件里没有原文、也没有信封，行只剩 has_l0', async () => {
    const { vault } = await createTestVault();
    const l0 = new FileL0BlobStore(l0Path);
    const storage = new FileStorage(dbPath, { l0 });
    // 真实写入路径：批次37-A 只搬「行上的信封」，明文 content_orig 留在行里——这正是存量形态
    await storage.putMemory(mem('m1', { content_orig: RAW }));
    expect((await storage.getMemory('m1'))?.content_orig).toBe(RAW);
    expect(readFileSync(dbPath, 'utf8')).toContain(RAW);

    const report = await splitLedger({
      storage, l0Blobs: l0, seal: (p) => vault.seal(p),
      admin_user_id: 'admin', request_id: 'req_split_file_1', now: NOW, backup_confirmed: true,
    });
    expect(report).toMatchObject({ moved: 1, sealed_from_plaintext: 1, cipher_moved: 0, failed: 0 });

    // 记忆库文件：原文与信封都不该再出现（这是本批次唯一的红线）
    const ledgerDump = readFileSync(dbPath, 'utf8');
    expect(ledgerDump).not.toContain(RAW);
    expect(ledgerDump).not.toContain('ECONNREFUSED');
    expect(ledgerDump).not.toContain('content_l0_enc');
    expect(ledgerDump).toContain('"has_l0":true');
    // L0 文件：有密文，且密文里不含原文
    const l0Dump = readFileSync(l0Path, 'utf8');
    expect(l0Dump).toContain('AES-256-GCM');
    expect(l0Dump).not.toContain(RAW);
    // 可检索正文一字未动
    const row = (await storage.getMemory('m1'))!;
    expect(row.content_l1).toBe(L1);
    expect(row.version).toBe(2);
    storage.close();
    l0.close();
  });

  it('遗留 v1 信封原样搬家（不重封）：L0 文件里存的就是行上那一条', async () => {
    const { vault } = await createTestVault();
    const l0 = new FileL0BlobStore(l0Path);
    const storage = new FileStorage(dbPath, { l0 });
    await storage.putMemory(mem('m2', { content_l0_enc: ENV_V1 }));
    // 先确认 FileStorage 的自动搬家已经把 v1 挪进 L0 库（行只剩 has_l0），本模块此时应「无活可干」
    const afterWrite = await scanLedgerForSplit(storage, l0);
    expect(afterWrite).toMatchObject({ on_row_cipher: 0, already_split: 1, to_move: 0, l0_count: 1 });
    expect((await l0.get('m2'))!.envelope).toBe(ENV_V1);

    const report = await splitLedger({
      storage, l0Blobs: l0, seal: (p) => vault.seal(p),
      admin_user_id: 'admin', request_id: 'req_split_file_2', now: NOW, backup_confirmed: true,
    });
    expect(report.moved).toBe(0);
    // 幂等：已搬走的 v1 不会被二次改写，更不会偷偷重封（写入时的自动搬家也不叠 version）
    expect((await l0.get('m2'))!.envelope).toBe(ENV_V1);
    expect((await storage.getMemory('m2'))!.version).toBe(1);
    storage.close();
    l0.close();
  });

  it('重开两个文件 → 授权查阅按 has_l0 从 L0 库取回信封，解出原文明细一致', async () => {
    const { vault } = await createTestVault();
    const l0 = new FileL0BlobStore(l0Path);
    const storage = new FileStorage(dbPath, { l0 });
    await storage.putMemory(mem('m3', { content_orig: RAW }));
    await splitLedger({
      storage, l0Blobs: l0, seal: (p) => vault.seal(p),
      admin_user_id: 'admin', request_id: 'req_split_file_3', now: NOW, backup_confirmed: true,
    });
    storage.close();
    l0.close();

    // 重新打开（进程重启口径）：两库各自从磁盘读回，行上无原文，查阅仍能还原
    const l0Re = new FileL0BlobStore(l0Path);
    const storageRe = new FileStorage(dbPath, { l0: l0Re });
    const reRow = (await storageRe.getMemory('m3'))!;
    expect(reRow.content_orig).toBeFalsy();
    expect(reRow.has_l0).toBe(true);
    const preview = await scanLedgerForSplit(storageRe, l0Re);
    expect(preview).toMatchObject({ plaintext_orig: 0, to_move: 0, already_split: 1, l0_count: 1, broken_links: 0, orphan_blobs: 0 });

    const unlock = await vault.unlock({ password: TEST_ADMIN_PW, user_id: 'u1' });
    const r = await coreBrowse(
      { layer: 'L0', project_id: 'P1', l0_auth: { l0_session_id: unlock.l0_session_id } },
      { storage: storageRe, request_id: 'req_split_browse', now: NOW, l0: vault, user_id: 'u1', l0Blobs: l0Re },
    );
    expect(r.l0_masked).toBe(false);
    expect(r.rows[0].content).toBe(RAW);
    storageRe.close();
    l0Re.close();
  });

  it('没解锁写密钥 → 整轮拒绝且磁盘一个字节不变（绝不把明文当 L0 存）', async () => {
    const l0 = new FileL0BlobStore(l0Path);
    const storage = new FileStorage(dbPath, { l0 });
    await storage.putMemory(mem('m4', { content_orig: RAW }));
    const before = readFileSync(dbPath, 'utf8');
    await expect(splitLedger({
      storage, l0Blobs: l0, admin_user_id: 'admin', request_id: 'req_split_file_4', now: NOW, backup_confirmed: true,
    })).rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    expect(readFileSync(dbPath, 'utf8')).toBe(before);
    expect(await l0.count()).toBe(0);
    storage.close();
    l0.close();
  });
});
