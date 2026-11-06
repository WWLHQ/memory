// 批次47 P0-3 验收：存储数据面四条读写通道必须凭登录会话。
// 用真实 InMemoryStorage（真实 StorageBackend 实现）跑真实调用链，而不是读源码断言。
// 批次48 A7 追加：putMemory 归属校验（跨租户/跨用户被拒，admin 不受限）。
import { describe, it, expect } from 'vitest';
import { createStorageReadWriteHandlers } from '../storageIpc.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import type { Memory } from '../../core/memagent/types.ts';
import type { SessionTenant } from '../../shared/memoryOwnership.ts';

const MEMBER: SessionTenant = { enterprise_id: 'e1', team_id: 't1', user_id: 'u1', role: 'member' };
const ADMIN: SessionTenant = { enterprise_id: 'local', team_id: 'admin-team', user_id: 'admin', role: 'admin' };

const MEM: Memory = {
  mem_id: 'm1', project_id: 'P1', enterprise_id: 'e1', team_id: 't1', user_id: 'u1',
  category: 'fact', layer: 'L1', content: 'hello', decay_class: 'hot',
  pinned: false, locked: false, version: 1, created_at: 1,
};

/** 与 main.ts requireDataPlaneSession 同语义：缺会话立刻抛（调用方按 reject 处理） */
function gate() {
  return (sessionId: unknown, channel: string): void => {
    const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!sid) throw new Error(`需要登录后操作（${channel}）`);
  };
}

function make(session: SessionTenant = MEMBER) {
  const storage = new InMemoryStorage();
  const h = createStorageReadWriteHandlers({
    storage,
    requireSession: gate(),
    getSessionContext: (sid) => (typeof sid === 'string' && sid.trim() ? session : null),
  });
  return { storage, h };
}

describe('存储读写通道会话闸门（P0-3）', () => {
  it('无会话：putMemory/getMemory/listMemories/queryAudit 全部拒绝，且拒绝时不落盘', async () => {
    const { storage, h } = make();

    await expect(h.putMemory(MEM)).rejects.toThrow('需要登录');
    await expect(h.getMemory('m1')).rejects.toThrow('需要登录');
    await expect(h.listMemories({})).rejects.toThrow('需要登录');
    await expect(h.queryAudit({})).rejects.toThrow('需要登录');

    // 关键：被拒的 put 不能产生任何写入（不是"先写后校验"）
    expect(await storage.getMemory('m1')).toBeNull();
  });

  it('有效会话：真实读写链路可用（put → get → list）', async () => {
    const { h } = make();

    await h.putMemory(MEM, 's_ok');
    const got = await h.getMemory('m1', 's_ok');
    expect(got?.mem_id).toBe('m1');
    expect(got?.content).toBe('hello');
    const list = await h.listMemories({}, 's_ok');
    expect(list.map((m) => m.mem_id)).toEqual(['m1']);
    expect(await h.queryAudit({}, 's_ok')).toEqual([]);
  });
});

describe('putMemory 归属校验（A7）', () => {
  it('member 跨租户新建 / 覆盖他人记忆 / 覆盖他租户墓碑 全部拒绝，原文不变', async () => {
    const { storage, h } = make(MEMBER);

    // 1) 新建到别的租户
    await expect(h.putMemory({ ...MEM, mem_id: 'm_foreign', enterprise_id: 'e2', team_id: 't2' }, 's_ok'))
      .rejects.toThrow('禁止跨租户写入');
    expect(await storage.getMemory('m_foreign')).toBeNull();

    // 2) 同租户内覆盖他人行
    await storage.putMemory({ ...MEM, mem_id: 'm_other', user_id: 'u2' });
    await expect(h.putMemory({ ...MEM, mem_id: 'm_other', content: '被篡改' }, 's_ok'))
      .rejects.toThrow('禁止覆盖他人记忆');
    expect((await storage.getMemory('m_other'))?.content).toBe('hello');

    // 3) 覆盖他租户已有行（写入行伪装成本会话租户）
    await storage.putMemory({ ...MEM, mem_id: 'm_x', enterprise_id: 'e2', team_id: 't2', user_id: 'u2' });
    await expect(h.putMemory({ ...MEM, mem_id: 'm_x', content: '被篡改' }, 's_ok'))
      .rejects.toThrow('禁止跨租户覆盖');

    // 4) 覆盖他租户的删除墓碑
    await storage.putMemory({ ...MEM, mem_id: 'm_tomb', deleted: true, enterprise_id: 'e2', team_id: 't2', user_id: 'u2' });
    await expect(h.putMemory({ ...MEM, mem_id: 'm_tomb' }, 's_ok'))
      .rejects.toThrow('禁止跨租户覆盖');

    // 5) 自己的行仍可写
    await expect(h.putMemory(MEM, 's_ok')).resolves.toBeUndefined();
  });

  it('缺租户字段的记录被拒（宁可诚实失败，不写无归属行）', async () => {
    const { storage, h } = make(MEMBER);
    const noTenant = { ...MEM, mem_id: 'm_bare', enterprise_id: undefined, team_id: undefined } as unknown as Memory;
    await expect(h.putMemory(noTenant, 's_ok')).rejects.toThrow('禁止跨租户写入');
    expect(await storage.getMemory('m_bare')).toBeNull();
  });

  it('admin 不受归属限制（跨租户维护能力保留）', async () => {
    const { storage, h } = make(ADMIN);
    await h.putMemory({ ...MEM, mem_id: 'm_admin_put', enterprise_id: 'e2', team_id: 't2', user_id: 'u2' }, 's_admin');
    expect((await storage.getMemory('m_admin_put'))?.enterprise_id).toBe('e2');
  });
});
