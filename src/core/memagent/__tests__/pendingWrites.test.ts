// 批次44-D4：写入落盘兜底队列的单元契约（内存 / 文件实现 + flush 重放语义）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryPendingStore, PendingWrites, type PendingWrite } from '../pendingWrites.ts';
import { FilePendingStore } from '../pendingStoreFile.ts';

const req = (content: string) => ({
  content,
  category: 'fact' as const,
  project_id: 'P1',
  source_agent: 'mcp-test',
});

describe('PendingWrites（内存实现）', () => {
  it('enqueue → count/list → flush 成功清空，保留原始写入字段', async () => {
    const store = new MemoryPendingStore();
    const q = new PendingWrites(store);
    expect(await q.count()).toBe(0);

    const id = await q.enqueue({ ...req('第一条'), importance: 0.9, tags: ['d4'] });
    expect(id).toMatch(/^pend_/);
    expect(await q.count()).toBe(1);

    const items: PendingWrite[] = await store.list();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('pending');
    expect(items[0].content).toBe('第一条');
    expect(items[0].importance).toBe(0.9);
    expect(items[0].tags).toEqual(['d4']);
    expect(items[0].created_at).toBeGreaterThan(0);

    const seen: string[] = [];
    const out = await q.flush(async (r) => { seen.push(r.content); return {}; });
    expect(out).toEqual({ flushed: 1, failed: 0 });
    expect(seen).toEqual(['第一条']);
    expect(await q.count()).toBe(0);
  });

  it('队列为空 → flush 直接短路，不调用 writeFn', async () => {
    const q = new PendingWrites(new MemoryPendingStore());
    let called = 0;
    const out = await q.flush(async () => { called += 1; return {}; });
    expect(out).toEqual({ flushed: 0, failed: 0 });
    expect(called).toBe(0);
  });

  it('重放失败（仍锁定）→ 该条保留、failed 计数，下次解锁可继续重放', async () => {
    const q = new PendingWrites(new MemoryPendingStore());
    await q.enqueue(req('锁定期写入'));
    const failed = await q.flush(async () => { throw new Error('[E_L0_LOCKED] 写密钥未解锁'); });
    expect(failed).toEqual({ flushed: 0, failed: 1 });
    expect(await q.count()).toBe(1); // 绝不丢

    const ok = await q.flush(async () => ({}));
    expect(ok).toEqual({ flushed: 1, failed: 0 });
    expect(await q.count()).toBe(0);
  });

  it('逐条独立：一条失败不影响其它条重放', async () => {
    const store = new MemoryPendingStore();
    const q = new PendingWrites(store);
    await q.enqueue(req('A'));
    await q.enqueue(req('B'));
    await q.enqueue(req('C'));
    const out = await q.flush(async (r) => {
      if (r.content === 'B') throw new Error('B 写入失败');
      return {};
    });
    expect(out).toEqual({ flushed: 2, failed: 1 });
    const left = await store.list();
    expect(left.map((i) => i.content)).toEqual(['B']);
  });
});

describe('FilePendingStore（落盘 + 重启可恢复）', () => {
  let dir = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memagent-pending-'));
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('写入落盘 → 新实例（模拟进程重启）仍能读回并重放', async () => {
    const first = new FilePendingStore(dir);
    const q1 = new PendingWrites(first);
    const id = await q1.enqueue({ ...req('重启不丢'), half_life_days: 30 });
    expect(id).toMatch(/^pend_/);
    expect(await first.count()).toBe(1);

    // 全新实例（内存态全部丢失），只靠磁盘恢复
    const afterRestart = new FilePendingStore(dir);
    const items = await afterRestart.list();
    expect(items).toHaveLength(1);
    expect(items[0].content).toBe('重启不丢');
    expect(items[0].half_life_days).toBe(30);

    const q2 = new PendingWrites(afterRestart);
    const seen: string[] = [];
    const out = await q2.flush(async (r) => { seen.push(r.content); return {}; });
    expect(out).toEqual({ flushed: 1, failed: 0 });
    expect(seen).toEqual(['重启不丢']);
    expect(await afterRestart.count()).toBe(0);
  });

  it('损坏 / 半写的 JSON 被忽略，不阻断其它条目重放', async () => {
    const store = new FilePendingStore(dir);
    await writeFile(join(dir, 'pending-corrupt.json'), '{not-json', 'utf8');
    await new PendingWrites(store).enqueue(req('完好条目'));
    const items = await store.list();
    expect(items).toHaveLength(1);
    expect(items[0].content).toBe('完好条目');
  });

  it('空目录 / 目录不存在 → list 返回空数组，无异常', async () => {
    const empty = new FilePendingStore(join(dir, 'not-created-yet'));
    expect(await empty.list()).toEqual([]);
    expect(await empty.count()).toBe(0);
    expect(await new PendingWrites(empty).flush(async () => ({}))).toEqual({ flushed: 0, failed: 0 });
  });
});
