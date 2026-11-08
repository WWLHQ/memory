// 批次42-B：HostSyncHub 渲染层代理验收 —— 方法转发到主进程 PgSyncHub（IPC 语义），
// 权限失败（ok:false）如实抛 MemAgentError，绝不静默吞掉。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hostCall } from '../../../desktop/hostBridge.ts';
import type { HostMethod } from '../../../desktop/hostBridge.ts';
import { HostSyncHub } from '../syncHub.ts';
import { SyncHub } from '../../../core/memagent/sync.ts';
import type { Memory } from '../../../core/memagent/types.ts';

vi.mock('../../../desktop/hostBridge.ts', () => ({
  hostCall: vi.fn(),
  hostCapability: vi.fn(() => 'none' as const),
  installHostBridge: vi.fn(),
  isEmbedded: vi.fn(() => false),
  hostLog: vi.fn(),
}));

const NOW = 1_800_000_000_000;
function mem(o: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'm1', project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2', content: 'proxied note',
    decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: NOW, updated_at: NOW,
    ...o,
  } as Memory;
}

describe('批次42-B HostSyncHub（主进程 PgSyncHub 代理）', () => {
  beforeEach(() => {
    vi.mocked(hostCall).mockReset();
  });

  it('push/pull/审计游标：通道与参数正确转发，unwrap 后交出真值', async () => {
    const h = new HostSyncHub();
    vi.mocked(hostCall).mockImplementation(async (method: string) => {
      if (method === 'sync:push') return { ok: true, result: 'applied' };
      if (method === 'sync:pull') return { ok: true, items: [mem()], cursor: 7 };
      if (method === 'sync:auditCount') return { ok: true, count: 3 };
      if (method === 'sync:auditsFrom') return { ok: true, audits: [] };
      return { ok: false, error: 'unexpected' };
    });
    await expect(h.push(mem(), 'desktop')).resolves.toBe('applied');
    expect(hostCall).toHaveBeenCalledWith('sync:push', [mem(), 'desktop', null]);
    await expect(h.pull({ team_id: 't1', user_id: 'u1' }, 0, 'desktop')).resolves.toEqual({ items: [mem()], cursor: 7 });
    expect(hostCall).toHaveBeenCalledWith('sync:pull', [{ team_id: 't1', user_id: 'u1' }, 0, 'desktop', null]);
    await expect(h.auditCount()).resolves.toBe(3);
    await expect(h.auditsFrom(2)).resolves.toEqual([]);
  });

  it('reconcile/conflicts/resolve/cursor：全方法通道面（42-C 裁决页与每日对账的代理底座）', async () => {
    const h = new HostSyncHub();
    vi.mocked(hostCall).mockImplementation(async (method: string) => {
      if (method === 'sync:reconcile') return { ok: true, items: [mem()], losers: [], missing_local: [] };
      if (method === 'sync:conflicts') return { ok: true, conflicts: [] };
      if (method === 'sync:resolve') return { ok: true };
      if (method === 'sync:cursor') return { ok: true, cursor: 42 };
      return { ok: false, error: 'unexpected' };
    });
    await expect(h.reconcile({ team_id: 't1' })).resolves.toEqual({ items: [mem()], losers: [], missing_local: [] });
    await expect(h.listConflicts('t1')).resolves.toEqual([]);
    await expect(h.resolve('cf_1', 'local')).resolves.toBeUndefined();
    await expect(h.getCursor()).resolves.toBe(42);
    expect(hostCall).toHaveBeenNthCalledWith(3, 'sync:resolve', ['cf_1', 'local', null]);
  });

  it('中枢侧 ok:false → 抛 MemAgentError（如实报错，不静默）', async () => {
    const h = new HostSyncHub();
    vi.mocked(hostCall).mockResolvedValue({ ok: false, code: 'E_NOT_IMPLEMENTED', error: '同步中枢未就绪' });
    await expect(h.push(mem(), 'desktop')).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });
    vi.mocked(hostCall).mockResolvedValue(undefined);
    await expect(h.pull({ team_id: 't1' }, 0, 'desktop')).rejects.toBeInstanceOf(Error);
  });

  it('结构同构：HostSyncHub 可作为引擎 local/hub 参与 syncUp/syncDown 全链路（mock 通道 = 真 SyncHub）', async () => {
    const real = new SyncHub();
    const h = new HostSyncHub();
    vi.mocked(hostCall).mockImplementation(async (method: HostMethod, args: unknown[] = []) => {
      if (method === 'sync:push') return { ok: true, result: await real.push(args[0] as Memory, args[1] as Memory extends never ? never : Parameters<SyncHub['push']>[1]) };
      if (method === 'sync:pull') return { ok: true, ...(await real.pull(args[0] as { team_id: string }, args[1] as number, args[2] as Parameters<SyncHub['pull']>[2])) };
      if (method === 'sync:auditCount') return { ok: true, count: await real.auditCount() };
      if (method === 'sync:auditsFrom') return { ok: true, audits: await real.auditsFrom(args[0] as number) };
      if (method === 'sync:reconcile') return { ok: true, ...(await real.reconcile(args[0] as { team_id: string })) };
      return { ok: false, error: 'unexpected' };
    });
    const desk = { async listMemories() { return [mem()]; }, async putMemory() { /* 引擎写回 */ } };
    const up = await import('../../../core/memagent/sync.ts').then((m) => m.syncUp(desk, h as never, 'desktop'));
    expect(up.applied).toBe(1);
    const web = { async putMemory() { /* 下行落盘 */ }, async getMemory() { return null; } };
    const down = await import('../../../core/memagent/sync.ts').then((m) => m.syncDown(h as never, web as never, { team_id: 't1' }, 0, 'web'));
    expect(down.pulled).toBe(1);
    expect(down.cursor).toBeGreaterThan(0);
  });
});
