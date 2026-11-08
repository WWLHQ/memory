// 批次42-B：kernel 装配验收 —— 桌面壳（hostCapability=native）注入 HostSyncHub，
// agent.sync 真跑（mock IPC 通道 = 真 SyncHub 支撑）；纯浏览器不注入 → E_NOT_IMPLEMENTED 诚实降级。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { getKernel, getKernelWithSeed, resetKernelForTests } from '../kernel.ts';
import { SyncHub } from '../../core/memagent/sync.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';

vi.mock('../../desktop/hostBridge.ts', () => ({
  hostCall: vi.fn(),
  hostCapability: vi.fn(() => 'none' as const),
  installHostBridge: vi.fn(),
  isEmbedded: vi.fn(() => false),
  hostLog: vi.fn(),
}));

/** mock sync:* IPC 通道 → 真 SyncHub 支撑（模拟主进程 PgSyncHub 语义） */
function mockSyncHost(hub: SyncHub): void {
  vi.mocked(hostCapability).mockReturnValue('native');
  vi.mocked(hostCall).mockImplementation(async (method: string, args: unknown[] = []) => {
    if (method === 'sync:push') return { ok: true, result: await hub.push(args[0] as never, args[1] as never) };
    if (method === 'sync:pull') return { ok: true, ...(await hub.pull(args[0] as { team_id: string }, args[1] as number, args[2] as never)) };
    if (method === 'sync:reconcile') return { ok: true, ...(await hub.reconcile(args[0] as { team_id: string })) };
    if (method === 'sync:conflicts') return { ok: true, conflicts: await hub.listConflicts() };
    if (method === 'sync:resolve') { await hub.resolve(args[0] as string, args[1] as 'local' | 'remote'); return { ok: true }; }
    if (method === 'sync:cursor') return { ok: true, cursor: await hub.getCursor() };
    if (method === 'sync:auditCount') return { ok: true, count: await hub.auditCount() };
    if (method === 'sync:auditsFrom') return { ok: true, audits: await hub.auditsFrom(args[0] as number) };
    return { ok: true };
  });
}

describe('批次42-B kernel 同步中枢装配', () => {
  beforeEach(() => {
    localStorage.clear();
    resetKernelForTests();
    vi.mocked(hostCapability).mockReturnValue('none');
    vi.mocked(hostCall).mockResolvedValue({ ok: true });
  });

  it('桌面壳：hub 注入 → agent.sync push 真跑（seed 行落 mock 中枢 + implemented:true 审计）', async () => {
    const hub = new SyncHub();
    mockSyncHost(hub);
    const ma = getKernel({ llm: new FakeLlmProvider(), vector: new JsVectorBackend() });
    getKernelWithSeed()._seedMemory({ content: '42-B kernel sync row', category: 'fact', project_id: 'P1' });
    const r = await ma.sync({ direction: 'push', project_id: 'P1' });
    expect(r.pushed).toBe(1);
    // syncUp 引擎真跑过：经代理通道上行（auditCount + push 两次调用都发生；form = KERNEL_FORM 'web'）
    // 末尾透传渲染层真实会话（此处 localStorage 已清空 → null，主进程会按 401 如实拒绝）
    expect(hostCall).toHaveBeenCalledWith('sync:push', [expect.anything(), 'web', null]);
    expect(hostCall).toHaveBeenCalledWith('sync:auditCount', [null]);
    // mock 中枢真实收到镜像（seed 行 ULID 归属，比对 content 更稳）
    const mirrored = hub.reconcile({ team_id: 't1' }).items;
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0].content).toBe('42-B kernel sync row');
  });

  it('桌面壳：pull 真下行 —— 他端上行进 mock 中枢，kernel agent sync pull 落本地账本', async () => {
    const hub = new SyncHub();
    mockSyncHost(hub);
    // 直接经 mock 通道上行一行（模拟另一端）
    const remoteRow = {
      mem_id: 'm_remote42', project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
      category: 'fact' as const, layer: 'L2' as const, content: 'from other end',
      decay_class: 'hot' as const, pinned: false, locked: false,
      version: 2, created_at: 1_800_000_000_000, updated_at: 1_800_000_000_000,
    };
    await hub.push(remoteRow as never, 'web');
    const ma = getKernel({ llm: new FakeLlmProvider(), vector: new JsVectorBackend() });
    const r = await ma.sync({ direction: 'pull', project_id: 'P1' });
    expect(r.pulled).toBe(1);
    expect(r.cursor).toBeGreaterThan(0);
  });

  it('纯浏览器：hub 不注入 → E_NOT_IMPLEMENTED 诚实降级（绝不假装接通）', async () => {
    const ma = getKernel({ llm: new FakeLlmProvider(), vector: new JsVectorBackend() });
    await expect(ma.sync({ direction: 'push', project_id: 'P1' })).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });
    expect(hostCall).not.toHaveBeenCalledWith('sync:push', expect.anything());
  });
});
