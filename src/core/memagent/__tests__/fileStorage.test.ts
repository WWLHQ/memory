// FileStorage 验收（§5.3）：零依赖纯文件实现，与 SqliteStorage 同接口 + 同契约。
// 覆盖 6 方法 + 原子写 + 损坏降级 + close 幂等 + size + 写盘失败不静默丢批（批次25 P0-6）。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { FileStorage, StorageCorruptError, StorageLockedError } from '../fileStorage.ts';
import type { Memory, AuditRecord } from '../types.ts';

function mem(id: string, over: Partial<Memory> = {}): Memory {
  return {
    mem_id: id, project_id: 'p1', enterprise_id: 'e1', team_id: 't1',
    category: 'lesson', layer: 'L1', content: `content-${id}`, decay_class: 'hot',
    pinned: false, locked: false, ...over,
  } as unknown as Memory;
}
function audit(action: AuditRecord['action'], over: Partial<AuditRecord> = {}): AuditRecord {
  return { request_id: `req_${Math.random()}`, action, ts: Date.now(), detail: {}, ...over } as AuditRecord;
}

describe('FileStorage（桌面 P0 主源 · 零依赖纯文件）', () => {
  let dir: string;
  let db: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'filestorage-'));
    db = join(dir, 'memories.db.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('空库 → listMemories/queryAudit 空', async () => {
    const s = new FileStorage(db);
    expect(await s.listMemories({})).toEqual([]);
    expect(await s.queryAudit({})).toEqual([]);
  });

  it('putMemory + getMemory 往返（含完整对象保真）', async () => {
    const s = new FileStorage(db);
    await s.putMemory(mem('m1', { decay_class: 'warm' }));
    const got = await s.getMemory('m1');
    expect(got?.content).toBe('content-m1');
    expect(got?.decay_class).toBe('warm');
    expect(await s.getMemory('nope')).toBeNull();
  });

  it('listMemories 按 filter 下推（project/layer/decay）', async () => {
    const s = new FileStorage(db);
    await s.putMemory(mem('m1', { layer: 'L1', decay_class: 'hot' }));
    await s.putMemory(mem('m2', { layer: 'L2', decay_class: 'cold' }));
    expect((await s.listMemories({ layer: 'L1' })).map((m) => m.mem_id)).toEqual(['m1']);
    expect((await s.listMemories({ decay_class: 'cold' })).map((m) => m.mem_id)).toEqual(['m2']);
    expect((await s.listMemories({ project_id: 'pX' })).length).toBe(0);
  });

  it('putMemory upsert（同 mem_id 覆盖）', async () => {
    const s = new FileStorage(db);
    await s.putMemory(mem('m1', { content: 'v1' }));
    await s.putMemory(mem('m1', { content: 'v2' }));
    expect((await s.listMemories({})).length).toBe(1);
    expect((await s.getMemory('m1'))?.content).toBe('v2');
  });

  it('deleteMemory 移除 + 幂等（删不存在不抛）', async () => {
    const s = new FileStorage(db);
    await s.putMemory(mem('m1'));
    await s.deleteMemory('m1');
    expect(await s.getMemory('m1')).toBeNull();
    await s.deleteMemory('nope'); // 不抛
  });

  it('appendAudit + queryAudit（request_id/action/since 过滤）', async () => {
    const s = new FileStorage(db);
    const base = 1_000_000;
    await s.appendAudit(audit('write', { request_id: 'r1', ts: base }));
    await s.appendAudit(audit('recall', { request_id: 'r2', ts: base + 500 }));
    await s.appendAudit(audit('write', { request_id: 'r3', ts: base + 900 }));
    expect((await s.queryAudit({})).length).toBe(3);
    expect((await s.queryAudit({ action: 'write' })).length).toBe(2);
    expect((await s.queryAudit({ since: base + 600 })).map((a) => a.request_id)).toEqual(['r3']);
    expect((await s.queryAudit({ request_id: 'r2' })).length).toBe(1);
  });

  it('close 后仍可安全调用（幂等），重复 close 不抛', async () => {
    const s = new FileStorage(db);
    await s.putMemory(mem('m1'));
    s.close();
    s.close();
    expect(s.size).toBe(1);
  });

  it('size 与 listMemories 一致（测试辅助契约）', async () => {
    const s = new FileStorage(db);
    await s.putMemory(mem('m1'));
    await s.putMemory(mem('m2'));
    expect(s.size).toBe(2);
    expect((await s.listMemories({})).length).toBe(2);
  });

  it('持久化：新实例重读同 dbPath 恢复（跨进程落盘）', async () => {
    const s1 = new FileStorage(db);
    await s1.putMemory(mem('m1', { content: 'keep' }));
    await s1.appendAudit(audit('write', { request_id: 'r1' }));
    s1.close();
    const s2 = new FileStorage(db);
    expect((await s2.getMemory('m1'))?.content).toBe('keep');
    expect((await s2.queryAudit({})).length).toBe(1);
  });

  it('损坏/非 JSON 文件 → 备份 .corrupt + 显式报错（不静默清空，D3）', async () => {
    writeFileSync(db, '{not-json', 'utf8');
    let err: unknown;
    try {
      new FileStorage(db);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StorageCorruptError);
    expect((err as StorageCorruptError).code).toBe('E_STORAGE_CORRUPT');
    expect((err as StorageCorruptError).backupPath).toBe(`${db}.corrupt`);
    expect(existsSync(`${db}.corrupt`)).toBe(true);
    expect(readFileSync(`${db}.corrupt`, 'utf8')).toBe('{not-json'); // 原件内容原样保全
    expect(existsSync(db)).toBe(false);                          // 损坏文件已挪走，不再反复失败
    // 再次启动 = 空库（首次已显式告警）
    const s = new FileStorage(db);
    expect(await s.listMemories({})).toEqual([]);
    expect(s.size).toBe(0);
  });

  it('损坏隔离后二次启动：sidecar 通知可消费一次，说明备份位置（不静默空库）', () => {
    writeFileSync(db, '{broken', 'utf8');
    expect(() => new FileStorage(db)).toThrowError(StorageCorruptError);
    const noticeFile = `${db}.corrupt-notice.json`;
    expect(existsSync(noticeFile)).toBe(true);

    // 二次启动：库为空，但通知还在（端壳启动时可提示用户）
    const s = new FileStorage(db);
    expect(s.size).toBe(0);
    const notice = s.takeCorruptionNotice();
    expect(notice).toMatchObject({ db_path: db, backup_path: `${db}.corrupt` });
    expect(notice?.error).toMatch(/JSON|Unexpected/i);
    expect(existsSync(noticeFile)).toBe(false); // 消费即删，不重复打扰
    expect(s.takeCorruptionNotice()).toBeNull();
  });

  it('无损坏时 takeCorruptionNotice 返回 null（不产生噪音）', () => {
    const s = new FileStorage(db);
    expect(s.takeCorruptionNotice()).toBeNull();
  });

  it('结构非法（memories 非对象）→ 同样备份 + 报错', () => {
    writeFileSync(db, JSON.stringify({ memories: 'oops', audit: [] }), 'utf8');
    expect(() => new FileStorage(db)).toThrowError(StorageCorruptError);
    expect(existsSync(`${db}.corrupt`)).toBe(true);
  });

  it('已存在 .corrupt 备份 → 加序号，不覆盖历史', () => {
    writeFileSync(`${db}.corrupt`, 'older-backup', 'utf8');
    writeFileSync(db, '[]', 'utf8'); // 根为数组 → 非法结构
    expect(() => new FileStorage(db)).toThrowError(StorageCorruptError);
    expect(readFileSync(`${db}.corrupt`, 'utf8')).toBe('older-backup');
    expect(readFileSync(`${db}.corrupt.1`, 'utf8')).toBe('[]');
  });
});

// 批次25 P0-6：写盘失败必须显式可见，且不能静默丢批 / 留半态。
// 障碍注入不用 mock：原子写的临时文件是 `${db}.tmp`，把它预先占为目录
// → writeFileSync 稳定抛 EISDIR（真实磁盘错误同路径），删掉即恢复正常。
describe('FileStorage · 写盘失败不静默丢批（批次25 P0-6）', () => {
  let dir: string;
  let db: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'filestorage-iofail-'));
    db = join(dir, 'memories.db.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const block = () => mkdirSync(`${db}.tmp`);
  const unblock = () => rmSync(`${db}.tmp`, { recursive: true, force: true });

  it('putMemory 写盘失败 → 抛出原始错误 + 内存回滚（磁盘/内存不分叉）', async () => {
    const s = new FileStorage(db);
    await s.putMemory(mem('m0', { content: 'base' }));
    block();
    await expect(s.putMemory(mem('m1'))).rejects.toThrow(/EISDIR/);
    expect(s.size).toBe(1);                                 // 失败的那条不进内存
    expect(await s.getMemory('m1')).toBeNull();
    unblock();
    await s.putMemory(mem('m2'));
    const s2 = new FileStorage(db);
    expect((await s2.getMemory('m0'))?.content).toBe('base');
    expect((await s2.getMemory('m2'))?.content).toBe('content-m2');
    expect(await s2.getMemory('m1')).toBeNull();            // 不被下次成功写入「顺带」落盘
  });

  it('putMemory 覆盖写失败 → 恢复旧对象（不丢既有内容）', async () => {
    const s = new FileStorage(db);
    await s.putMemory(mem('m1', { content: 'v1' }));
    block();
    await expect(s.putMemory(mem('m1', { content: 'v2' }))).rejects.toThrow(/EISDIR/);
    expect((await s.getMemory('m1'))?.content).toBe('v1');
    unblock();
    expect((await new FileStorage(db).getMemory('m1'))?.content).toBe('v1');
  });

  it('appendAudit 写盘失败 → 回滚（不留半态账本行）', async () => {
    const s = new FileStorage(db);
    await s.appendAudit(audit('write', { request_id: 'r1' }));
    block();
    await expect(s.appendAudit(audit('recall', { request_id: 'r2' }))).rejects.toThrow(/EISDIR/);
    expect((await s.queryAudit({})).map((a) => a.request_id)).toEqual(['r1']);
    unblock();
    await s.appendAudit(audit('recall', { request_id: 'r3' }));
    expect((await new FileStorage(db).queryAudit({})).map((a) => a.request_id)).toEqual(['r1', 'r3']);
  });

  it('deleteMemory 写盘失败 → 撤销删除（不静默丢记忆）', async () => {
    const s = new FileStorage(db);
    await s.putMemory(mem('m1'));
    block();
    await expect(s.deleteMemory('m1')).rejects.toThrow(/EISDIR/);
    expect(await s.getMemory('m1')).not.toBeNull();
    expect(s.size).toBe(1);
  });

  it('commitBatch 写盘失败 → 批次保留：障碍解除后再次提交/close 才真正落盘', async () => {
    const s = new FileStorage(db);
    s.beginBatch();
    await s.putMemory(mem('m1'));
    block();
    expect(() => s.commitBatch()).toThrow(/EISDIR/);
    expect(existsSync(db)).toBe(false);                     // 没落盘就不声称落盘
    expect(() => s.commitBatch()).toThrow(/EISDIR/);        // 批次仍在 → 会重试（旧实现静默 return）
    unblock();
    await s.putMemory(mem('m2'));                            // 仍在批量模式 → 只标脏
    s.commitBatch();
    const s2 = new FileStorage(db);
    expect((await s2.getMemory('m1'))?.content).toBe('content-m1'); // 首批未丢
    expect((await s2.getMemory('m2'))?.content).toBe('content-m2');
  });

  it('commitBatch 失败后 close() 仍重试落盘（退出前不把整批丢掉）', async () => {
    const s = new FileStorage(db);
    s.beginBatch();
    await s.putMemory(mem('m1'));
    s.commitBatch();                                        // 无脏 → 直接结束批量
    s.beginBatch();
    await s.putMemory(mem('m2'));
    block();
    expect(() => s.close()).toThrow(/EISDIR/);              // 失败让调用方可见
    unblock();
    s.close();                                              // 障碍解除后重试
    const s2 = new FileStorage(db);
    expect((await s2.getMemory('m2'))?.content).toBe('content-m2');
  });

  it('beginBatch 不清除已有脏标记（重复 begin 不会吞掉待落盘的批次）', async () => {
    const s = new FileStorage(db);
    s.beginBatch();
    await s.putMemory(mem('m1'));
    s.beginBatch();                                         // 重复开启
    s.commitBatch();
    expect((await new FileStorage(db).getMemory('m1'))?.content).toBe('content-m1');
  });

  it('批量模式：写盘失败在 commitBatch 集中暴露 → 不半途落盘，障碍解除后整批落地', async () => {
    const s = new FileStorage(db);
    s.beginBatch();
    await s.putMemory(mem('m1'));
    await s.appendAudit(audit('write', { request_id: 'r1' }));
    block();
    expect(() => s.commitBatch()).toThrow(/EISDIR/);
    expect(existsSync(db)).toBe(false);                     // 失败不产出半态账本文件
    unblock();
    s.commitBatch();
    const s2 = new FileStorage(db);
    expect((await s2.getMemory('m1'))?.content).toBe('content-m1');
    expect((await s2.queryAudit({ request_id: 'r1' }))).toHaveLength(1);
  });
});

// 批次28-A：写锁 + 只读镜像。单文件账本只允许一个写者；第二实例自动降级只读，
// 防双写损坏；陈旧锁（持锁进程已死）自动回收；只读镜像可跟随 mtime 重载近实时反映写方。
describe('FileStorage · 写锁与只读镜像（批次28-A）', () => {
  let dir: string;
  let db: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'filestorage-lock-'));
    db = join(dir, 'memories.db.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('持锁实例可写；同进程第二实例自动降级只读，写入抛 E_STORAGE_LOCKED', async () => {
    const writer = new FileStorage(db);
    await writer.putMemory(mem('m1', { content: 'writer-only' }));

    const mirror = new FileStorage(db);
    expect(mirror.readOnly).toBe(true);
    expect(mirror.lockedBy?.pid).toBe(process.pid);
    await expect(mirror.putMemory(mem('m2'))).rejects.toThrow(StorageLockedError);
    await expect(mirror.putMemory(mem('m2'))).rejects.toThrow(/其它进程/);
    // 只读镜像仍可读：读到写方已落盘的数据
    expect((await mirror.getMemory('m1'))?.content).toBe('writer-only');
    writer.close();
  });

  it('close 释放写锁后，新实例恢复可写（锁文件被清掉）', async () => {
    const writer = new FileStorage(db);
    expect(existsSync(`${db}.lock`)).toBe(true);
    writer.close();
    expect(existsSync(`${db}.lock`)).toBe(false);
    const next = new FileStorage(db);
    expect(next.readOnly).toBe(false);
    await next.putMemory(mem('m1'));
    next.close();
  });

  it('陈旧锁（持锁 pid 已死）→ 自动回收并取锁可写', async () => {
    const deadPid = 999_999_999; // 假定不存在（进程号上限远低于此）
    writeFileSync(`${db}.lock`, JSON.stringify({ pid: deadPid, at: Date.now() }), 'utf8');
    const s = new FileStorage(db);
    expect(s.readOnly).toBe(false);
    expect(s.lockedBy).toBeNull();
    await s.putMemory(mem('m1'));
    s.close();
  });

  it('readonly 构造：不取锁、写拒绝（不带「其它进程」文案）、close 不落盘', async () => {
    const writer = new FileStorage(db);
    await writer.putMemory(mem('m1'));
    writer.close();

    const ro = new FileStorage(db, { readonly: true, reloadOnMtime: true });
    expect(ro.readOnly).toBe(true);
    expect(ro.lockedBy).toBeNull();
    expect(existsSync(`${db}.lock`)).toBe(false); // 只读绝不抢写锁
    await expect(ro.putMemory(mem('m2'))).rejects.toThrow(/只读模式/);
    ro.close();
  });

  it('reloadOnMtime：写方更新账本后，镜像读操作看到新数据（mtime 触发重载）', async () => {
    const writer = new FileStorage(db);
    await writer.putMemory(mem('m1', { content: 'v1' }));

    const mirror = new FileStorage(db, { readonly: true, reloadOnMtime: true });
    expect((await mirror.getMemory('m1'))?.content).toBe('v1');

    await writer.putMemory(mem('m2', { content: 'v2' }));
    expect((await mirror.getMemory('m2'))?.content).toBe('v2');
    expect((await mirror.listMemories({})).map((m) => m.mem_id)).toEqual(['m1', 'm2']);
    writer.close();
    mirror.close();
  });

  it('未开 reloadOnMtime 的只读实例：不跟随写方更新（保持构造时快照）', async () => {
    const writer = new FileStorage(db);
    await writer.putMemory(mem('m1'));
    const mirror = new FileStorage(db, { readonly: true });
    await writer.putMemory(mem('m2'));
    expect(await mirror.getMemory('m2')).toBeNull();
    writer.close();
    mirror.close();
  });
});
