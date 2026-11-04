// 批次37-A 渲染层 L0 只读门面：拆库后页面只能经 l0:blobs 向主进程批量要密文，永远不是写者。
// 覆盖：正常批量回读 / 分片 / 会话透传 / 主进程拒绝→断链错误 / 缺 id 不补空信封 / 写删枚举一律 E_NOT_IMPLEMENTED。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { L0BlobStore } from '../../../core/memagent/l0Store.ts';
import { hostCall } from '../../../desktop/hostBridge.ts';
import { HostL0BlobStore } from '../l0BlobStore.ts';

vi.mock('../../../desktop/hostBridge.ts', () => ({
  hostCapability: vi.fn(() => 'bridge' as const),
  hostCall: vi.fn(),
  installHostBridge: vi.fn(),
  isEmbedded: vi.fn(() => false),
  hostLog: vi.fn(),
}));

describe('批次37-A HostL0BlobStore（页面侧 L0 只读端口）', () => {
  const store = new HostL0BlobStore();

  beforeEach(() => {
    vi.mocked(hostCall).mockReset();
    localStorage.clear();
  });

  it('正常回读：只返回主进程给出的 id，透传当前登录会话', async () => {
    localStorage.setItem('session:realpage', 'sid_42');
    vi.mocked(hostCall).mockResolvedValue({ ok: true, envelopes: { m1: '{"v":2}', m3: '{"v":2}' } });
    const got = await store.getAll(['m1', 'm2', 'm3']);
    expect([...got.keys()]).toEqual(['m1', 'm3']);
    expect(got.get('m2')).toBeUndefined();
    const [channel, args] = vi.mocked(hostCall).mock.calls[0];
    expect(channel).toBe('l0:blobs');
    expect(args?.[0]).toEqual(['m1', 'm2', 'm3']);
    expect(args?.[1]).toBe('sid_42');
  });

  it('超过 200 条分片取，各片结果合并（整库查阅不打爆单次 IPC）', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `m${i}`);
    vi.mocked(hostCall).mockImplementation(async () => {
      const chunk = vi.mocked(hostCall).mock.calls.at(-1)?.[1]?.[0] as string[];
      return { ok: true, envelopes: Object.fromEntries(chunk.map((id) => [id, '{"v":2}'])) };
    });
    const got = await store.getAll(ids);
    expect(hostCall).toHaveBeenCalledTimes(3);
    expect(got.size).toBe(450);
    expect(vi.mocked(hostCall).mock.calls[2]?.[1]?.[0]).toHaveLength(50);
  });

  it('主进程拒绝（未登录/超限）→ E_L0_MISSING_BLOB，绝不退化成「L0 是空的」', async () => {
    vi.mocked(hostCall).mockResolvedValue({ ok: false, error: '需要登录后操作（会话已过期或未登录）' });
    await expect(store.getAll(['m1'])).rejects.toMatchObject({ code: 'E_L0_MISSING_BLOB' });
  });

  it('宿主桥未就绪（返回 undefined）同样显式报错，不静默给空 Map', async () => {
    vi.mocked(hostCall).mockResolvedValue(undefined);
    await expect(store.getAll(['m1'])).rejects.toThrow(/L0/);
  });

  it('get：命中给信封，缺的给 null（断链由内核判定）', async () => {
    vi.mocked(hostCall).mockResolvedValue({ ok: true, envelopes: { m1: 'env1' } });
    await expect(store.get('m1')).resolves.toEqual({ envelope: 'env1', sealed_at: 0 });
    vi.mocked(hostCall).mockResolvedValue({ ok: true, envelopes: {} });
    await expect(store.get('m9')).resolves.toBeNull();
  });

  it('写/删/整库枚举/计数一律 E_NOT_IMPLEMENTED：页面侧永远不是 L0 库的写者', async () => {
    // 按端口类型调用（实现类把这些参数声明为无参，正是「不可写」的字面证据）
    const port: L0BlobStore = store;
    for (const call of [
      () => port.put('m1', { envelope: 'x', sealed_at: 1 }),
      () => port.delete('m1'),
      () => port.ids(),
      () => port.count(),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });
    }
    expect(store.readOnly).toBe(true);
    expect(store.bytes()).toBe(0);
    expect(() => store.beginBatch()).not.toThrow();
    expect(() => store.commitBatch()).not.toThrow();
    expect(() => store.close()).not.toThrow();
  });
});
