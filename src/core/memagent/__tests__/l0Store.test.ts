// 批次37-A 验收：L0 原数据库（独立文件）+ 记忆库抽出/回读 + browse 双源信封。
// 三条红线在这里逐一钉死：① L0 库只收密文（明文拒收）；② 两库都不静默空库（损坏改名抛错）；
// ③ 行说有自己的 L0、库里却没有 → 显式断链错误，绝不当空正文返回。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  FileL0BlobStore, InMemoryL0BlobStore, L0NotSealedError, L0StoreCorruptError, L0StoreLockedError, isSealedL0,
} from '../l0Store.ts';
import { FileStorage } from '../fileStorage.ts';
import type { Memory } from '../types.ts';
import { coreBrowse } from '../memories.ts';
import { createTestVault, TEST_ADMIN_PW } from './l0Kit.ts';

/** 形状合法的 v2 信封（isSealedL0 按可解析判定，不断言可解密——解密语义在 l0vault.test.ts） */
const ENV_A = '{"v":2,"alg":"AES-256-GCM","iv":"aGl2","tag":"aHRhZw","ct":"Y3Qx"}';
const ENV_B = '{"v":2,"alg":"AES-256-GCM","iv":"aGl2","tag":"aHRhZw","ct":"Y3Qy"}';
/** 遗留 v1 信封（密码派生 KEK 逐条 KDF）：仍算已封存，迁移前不许把它当明文丢掉 */
const ENV_V1 = '{"v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":100000,"salt":"c2FsdA","iv":"aGl2","tag":"aHRhZw","ct":"Y3Qz"}';
const PLAINTEXT = '用户的原始对话：密码 hunter2，端口 5432';

function mem(id: string, over: Partial<Memory> = {}): Memory {
  return {
    mem_id: id, project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'lesson', layer: 'L1', content: `content-${id}`, decay_class: 'hot',
    pinned: false, locked: false, created_at: 1_800_000_000_000, updated_at: 1_800_000_000_000,
    version: 1, ...over,
  } as unknown as Memory;
}

describe('FileL0BlobStore（批次37-A：L0 原数据库独立文件）', () => {
  let dir: string;
  let l0Path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'l0store-'));
    l0Path = join(dir, 'memories.l0.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('新建（文件不存在）= 空库，不是损坏', async () => {
    const s = new FileL0BlobStore(l0Path);
    expect(await s.count()).toBe(0);
    expect(await s.get('m1')).toBeNull();
    expect(s.readOnly).toBe(false);
  });

  it('put/get/ids/count 往返 + 重新打开仍在盘上', async () => {
    const s = new FileL0BlobStore(l0Path);
    await s.put('m1', { envelope: ENV_A, sealed_at: 111 });
    await s.put('m2', { envelope: ENV_B, sealed_at: 222 });
    expect((await s.get('m1'))?.envelope).toBe(ENV_A);
    expect(await s.ids()).toEqual(['m1', 'm2']);
    expect(await s.count()).toBe(2);
    s.close();

    const reopened = new FileL0BlobStore(l0Path);
    expect((await reopened.get('m2'))?.sealed_at).toBe(222);
    expect(await reopened.count()).toBe(2);
  });

  it('只收密文：明文正文 → E_L0_NOT_SEALED（搬家不等于加密）', async () => {
    const s = new FileL0BlobStore(l0Path);
    await expect(s.put('m1', { envelope: PLAINTEXT, sealed_at: 1 }))
      .rejects.toBeInstanceOf(L0NotSealedError);
    await expect(s.put('m1', { envelope: '', sealed_at: 1 }))
      .rejects.toMatchObject({ code: 'E_L0_NOT_SEALED' });
    expect(await s.count()).toBe(0);
  });

  it('v1/v2 信封都算已封存，其它一律不收（按可解析形状判，不按语义猜）', () => {
    expect(isSealedL0(ENV_A)).toBe(true);
    expect(isSealedL0(ENV_V1)).toBe(true);
    // 既不是合法 v2（缺 tag）也不是合法 v1（缺 salt/iter）→ 不收
    expect(isSealedL0('{"v":9,"alg":"AES-256-GCM","iv":"a","tag":"b","ct":"c"}')).toBe(false);
    expect(isSealedL0('not json at all')).toBe(false);
    expect(isSealedL0('')).toBe(false);
  });

  it('缺 mem_id 显式报错（不静默写进一个空键）', async () => {
    const s = new FileL0BlobStore(l0Path);
    await expect(s.put('  ', { envelope: ENV_A, sealed_at: 1 }))
      .rejects.toThrow(/E_L0_BAD_MEM_ID/);
  });

  it('delete 幂等 + 删后取不到', async () => {
    const s = new FileL0BlobStore(l0Path);
    await s.put('m1', { envelope: ENV_A, sealed_at: 1 });
    await s.delete('m1');
    expect(await s.get('m1')).toBeNull();
    await expect(s.delete('不存在的条目')).resolves.toBeUndefined();
  });

  it('损坏文件 → 改名保留原件 + 显式抛错，绝不静默开空库', () => {
    writeFileSync(l0Path, '{ this is not json', 'utf8');
    let caught: unknown;
    try {
      new FileL0BlobStore(l0Path);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(L0StoreCorruptError);
    expect((caught as L0StoreCorruptError).code).toBe('E_L0_STORE_CORRUPT');
    expect(existsSync(`${l0Path}.corrupt`)).toBe(true);
    expect(readFileSync(`${l0Path}.corrupt`, 'utf8')).toContain('this is not json');
  });

  it('结构非法（items 非对象）同样隔离，不落空库', () => {
    writeFileSync(l0Path, JSON.stringify({ version: 1, items: [] }), 'utf8');
    expect(() => new FileL0BlobStore(l0Path)).toThrow(L0StoreCorruptError);
  });

  it('显式只读：写入抛 E_L0_STORE_LOCKED，读取可用', async () => {
    writeFileSync(l0Path, JSON.stringify({ version: 1, items: { m1: { envelope: ENV_A, sealed_at: 1 } } }), 'utf8');
    const ro = new FileL0BlobStore(l0Path, { readonly: true });
    expect(ro.readOnly).toBe(true);
    expect((await ro.get('m1'))?.envelope).toBe(ENV_A);
    await expect(ro.put('m2', { envelope: ENV_B, sealed_at: 2 })).rejects.toBeInstanceOf(L0StoreLockedError);
    await expect(ro.delete('m1')).rejects.toMatchObject({ code: 'E_L0_STORE_LOCKED' });
  });

  it('写锁被另一个活进程持有 → 自动降级只读并点名持锁 pid', async () => {
    writeFileSync(`${l0Path}.lock`, JSON.stringify({ pid: process.pid, at: 1 }), 'utf8');
    const s = new FileL0BlobStore(l0Path);
    expect(s.readOnly).toBe(true);
    expect(s.lockedBy?.pid).toBe(process.pid);
    await expect(s.put('m1', { envelope: ENV_A, sealed_at: 1 })).rejects.toBeInstanceOf(L0StoreLockedError);
  });

  it('陈旧锁（持锁 pid 已死）→ 回收并重取写锁', async () => {
    const deadPid = 999_999_999; // 与 fileStorage.test.ts 同口径：进程号上限远低于此
    writeFileSync(`${l0Path}.lock`, JSON.stringify({ pid: deadPid, at: 1 }), 'utf8');
    const s = new FileL0BlobStore(l0Path);
    expect(s.readOnly).toBe(false);
    await expect(s.put('m1', { envelope: ENV_A, sealed_at: 1 })).resolves.toBeUndefined();
  });

  it('批量模式：beginBatch 后不落盘，commitBatch 一次写完', () => {
    const s = new FileL0BlobStore(l0Path);
    s.beginBatch();
    void s.put('m1', { envelope: ENV_A, sealed_at: 1 });
    void s.put('m2', { envelope: ENV_B, sealed_at: 2 });
    expect(existsSync(l0Path)).toBe(false); // 还没写过盘
    s.commitBatch();
    expect(JSON.parse(readFileSync(l0Path, 'utf8')).items.m1.envelope).toBe(ENV_A);
  });

  it('close 前自动提交未落盘批次，并释放写锁', () => {
    const s = new FileL0BlobStore(l0Path);
    s.beginBatch();
    void s.put('m1', { envelope: ENV_A, sealed_at: 1 });
    s.close();
    expect(JSON.parse(readFileSync(l0Path, 'utf8')).items.m1.envelope).toBe(ENV_A);
    expect(existsSync(`${l0Path}.lock`)).toBe(false);
  });

  it('bytes() 反映落盘大小（未落盘为 0，不拿内存估算冒充）', async () => {
    const s = new FileL0BlobStore(l0Path);
    expect(s.bytes()).toBe(0);
    await s.put('m1', { envelope: ENV_A, sealed_at: 1 });
    expect(s.bytes()).toBe(readFileSync(l0Path, 'utf8').length);
  });

  it('内存实现同口径：明文一样拒收（测试双不能比生产宽松）', async () => {
    const s = new InMemoryL0BlobStore();
    await expect(s.put('m1', { envelope: PLAINTEXT, sealed_at: 1 }))
      .rejects.toMatchObject({ code: 'E_L0_NOT_SEALED' });
    await s.put('m1', { envelope: ENV_A, sealed_at: 1 });
    expect(await s.count()).toBe(1);
  });
});

describe('FileStorage × L0 原数据库（批次37-A：记忆库只留 L1–L6）', () => {
  let dir: string;
  let db: string;
  let l0Path: string;
  let l0: FileL0BlobStore;
  let s: FileStorage;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'l0split-fs-'));
    db = join(dir, 'memories.db.json');
    l0Path = join(dir, 'memories.l0.json');
    l0 = new FileL0BlobStore(l0Path);
    s = new FileStorage(db, { l0 });
  });
  afterEach(() => {
    s.close();
    l0.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('写入信封 → 搬进 L0 库，记忆库行只剩 has_l0（盘上两处都核对）', async () => {
    await s.putMemory(mem('m1', { content_l0_enc: ENV_A }));
    const onDisk = JSON.parse(readFileSync(db, 'utf8')).memories.m1;
    expect(onDisk.has_l0).toBe(true);
    expect(onDisk.content_l0_enc).toBeUndefined();
    expect(readFileSync(db, 'utf8')).not.toContain('AES-256-GCM');
    expect(JSON.parse(readFileSync(l0Path, 'utf8')).items.m1.envelope).toBe(ENV_A);
    expect(await l0.count()).toBe(1);
  });

  it('读回的行不带信封（getMemory/listMemories 都不把密文带回检索层）', async () => {
    await s.putMemory(mem('m1', { content_l0_enc: ENV_A }));
    expect((await s.getMemory('m1'))?.content_l0_enc).toBeUndefined();
    expect((await s.listMemories({}))[0].has_l0).toBe(true);
  });

  it('非法信封（明文冒充）→ 不搬、不删、不静默：原样留在行上', async () => {
    await s.putMemory(mem('m1', { content_l0_enc: PLAINTEXT }));
    expect((await s.getMemory('m1'))?.content_l0_enc).toBe(PLAINTEXT);
    expect(await l0.count()).toBe(0);
    expect((await s.getMemory('m1'))?.has_l0).toBeUndefined();
  });

  it('改写去掉 L0（行上无信封、无 has_l0）→ L0 库同步清理，不留孤儿', async () => {
    await s.putMemory(mem('m1', { content_l0_enc: ENV_A }));
    expect(await l0.count()).toBe(1);
    await s.putMemory(mem('m1', { content: 'v2' }));
    expect(await l0.get('m1')).toBeNull();
  });

  it('deleteMemory 连带删掉 L0 密文（记忆物理消失，库里不许留可解的残留）', async () => {
    await s.putMemory(mem('m1', { content_l0_enc: ENV_A }));
    await s.deleteMemory('m1');
    expect(await s.getMemory('m1')).toBeNull();
    expect(await l0.get('m1')).toBeNull();
  });

  it('未配置 L0 库 = 批次36 及以前的行为（信封照旧写在行上）', async () => {
    const plain = new FileStorage(join(dir, 'other.db.json'));
    await plain.putMemory(mem('m1', { content_l0_enc: ENV_A }));
    expect((await plain.getMemory('m1'))?.content_l0_enc).toBe(ENV_A);
    expect(plain.l0Store).toBeNull();
    plain.close();
  });

  it('批量提交顺序固定 L0 先落、记忆库后落（断链比孤儿危险）', async () => {
    const order: string[] = [];
    const spyL0 = new FileL0BlobStore(join(dir, 'spy.l0.json'));
    const origCommit = spyL0.commitBatch.bind(spyL0);
    spyL0.commitBatch = () => { order.push('l0'); origCommit(); };
    const spyFs = new FileStorage(join(dir, 'spy.db.json'), { l0: spyL0 });
    const origPersist = Reflect.get(spyFs, 'persist') as () => void;
    Reflect.set(spyFs, 'persist', () => { order.push('db'); origPersist.call(spyFs); });

    spyFs.beginBatch();
    await spyFs.putMemory(mem('m1', { content_l0_enc: ENV_A }));
    spyFs.commitBatch();
    expect(order).toEqual(['l0', 'db']);
    spyFs.close();
    spyL0.close();
  });

  it('l0Store 暴露给上层（装配与完整性核对都从这里拿）', () => {
    expect(s.l0Store?.path).toBe(l0Path);
  });
});

describe('coreBrowse 双源 L0 信封（批次37-A：行上 / L0 库都要能查）', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'l0split-browse-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const RAW = '数据库连接串 postgres://admin:pass@10.0.0.1:5432/prod 报错 ECONNREFUSED，端口 5432 未放行';

  it('拆库后的行（只有 has_l0）→ 授权查阅从 L0 库取信封，返回原文', async () => {
    const l0Path = join(dir, 'memories.l0.json');
    const l0Store = new FileL0BlobStore(l0Path);
    const storage = new FileStorage(join(dir, 'memories.db.json'), { l0: l0Store });
    const { vault } = await createTestVault();
    // 走真实写入：coreWrite 封信封 → FileStorage 自动搬到 L0 库
    await storage.putMemory(mem('m1', { content_l0_enc: await vault.seal(RAW) }));
    expect((await storage.getMemory('m1'))?.content_l0_enc).toBeUndefined();

    const unlock = await vault.unlock({ password: TEST_ADMIN_PW, user_id: 'u1' });
    const r = await coreBrowse(
      { layer: 'L0', project_id: 'P1', l0_auth: { l0_session_id: unlock.l0_session_id } },
      { storage, request_id: 'req_split_1', now: 1, l0: vault, user_id: 'u1', l0Blobs: l0Store },
    );
    expect(r.l0_masked).toBe(false);
    expect(r.rows[0].content).toBe(RAW);
    storage.close();
    l0Store.close();
  });

  it('未授权 → has_l0 的行照样遮罩（不是空白，让用户知道有 L0 存在）', async () => {
    const l0Store = new FileL0BlobStore(join(dir, 'memories.l0.json'));
    const storage = new FileStorage(join(dir, 'memories.db.json'), { l0: l0Store });
    const { vault } = await createTestVault();
    await storage.putMemory(mem('m1', { content_l0_enc: await vault.seal(RAW) }));
    const r = await coreBrowse(
      { layer: 'L0', project_id: 'P1' },
      { storage, request_id: 'req_split_2', now: 1, l0: vault, user_id: 'u1' },
    );
    expect(r.l0_masked).toBe(true);
    expect(r.rows[0].content).toBe('[L0 已加密 · 需授权]');
    storage.close();
    l0Store.close();
  });

  it('断链（行带 has_l0、L0 库取不到）→ E_L0_MISSING_BLOB + 审计，绝不返回空正文', async () => {
    const l0Store = new InMemoryL0BlobStore();
    const storage = new FileStorage(join(dir, 'broken.db.json'));
    // 直接把「已拆库」的行写进不带 L0 库的记忆后端 → 模拟两库不同步
    await storage.putMemory(mem('m1', { has_l0: true }));
    const { vault } = await createTestVault({ audit: storage });
    const unlock = await vault.unlock({ password: TEST_ADMIN_PW, user_id: 'u1' });
    await expect(coreBrowse(
      { layer: 'L0', project_id: 'P1', l0_auth: { l0_session_id: unlock.l0_session_id } },
      { storage, request_id: 'req_split_3', now: 1, l0: vault, user_id: 'u1', l0Blobs: l0Store },
    )).rejects.toMatchObject({ code: 'E_L0_MISSING_BLOB' });
    const fails = await storage.queryAudit({ action: 'l0_auth_fail' });
    expect(fails.some((a) => a.detail.reason === 'missing_blob')).toBe(true);
    storage.close();
  });

  it('没有 l0Blobs 通道（浏览器镜像）+ 未授权 → 仍走遮罩，不因取不到密文而报错', async () => {
    const storage = new FileStorage(join(dir, 'mirror.db.json'));
    await storage.putMemory(mem('m1', { has_l0: true }));
    const r = await coreBrowse(
      { layer: 'L0', project_id: 'P1' },
      { storage, request_id: 'req_split_4', now: 1 },
    );
    expect(r.l0_masked).toBe(true);
    expect(r.rows[0].content).toBe('[L0 已加密 · 需授权]');
    storage.close();
  });
});
