// REQ-008 云同步契约测试（§8 全 6 用例 + LWW/幂等/隔离细节）
import { describe, expect, it } from 'vitest';
import {
  SyncHub, filterSyncAudits, reconcile, sha256hex, stampForSync, syncDown, syncUp, vcCompare,
} from '../sync.ts';
import { InMemoryStorage } from '../storage.ts';
import type { Memory } from '../types.ts';

const NOW = 1_800_000_000_000;

function mem(o: Partial<Memory> = {}): Memory {
  return {
    mem_id: o.mem_id ?? `m${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2', content: o.content ?? 'some sync content',
    decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: NOW,
    updated_at: NOW,
    ...o,
  };
}

describe('同步原语（§3.1）', () => {
  it('sha256：确定性 + 不同内容不同指纹', () => {
    expect(sha256hex('abc')).toBe(sha256hex('abc'));
    expect(sha256hex('abc')).not.toBe(sha256hex('abd'));
    expect(sha256hex('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('vclock 偏序：ahead/behind/concurrent/equal', () => {
    expect(vcCompare({ desktop: 2 }, { desktop: 1 })).toBe('ahead');
    expect(vcCompare({ desktop: 1 }, { desktop: 2 })).toBe('behind');
    expect(vcCompare({ desktop: 2 }, { mobile: 2 })).toBe('concurrent');
    expect(vcCompare({ desktop: 1 }, { desktop: 1 })).toBe('equal');
  });

  it('stampForSync：sha256 + 本端时钟递增 + version++ + 清 pending', () => {
    const s = stampForSync(mem({ pending_sync: true, vclock: { desktop: 1 } }), 'desktop');
    expect(s.sha256).toBe(sha256hex(s.content));
    expect(s.vclock?.desktop).toBe(2);
    expect(s.version).toBe(2);
    expect(s.pending_sync).toBe(false);
  });
});

describe('§8 用例', () => {
  it('① 桌面→Web：桌面写一条，Web 同账号拉到镜像 + sync_down 审计', async () => {
    const hub = new SyncHub();
    const desk = new InMemoryStorage();
    const web = new InMemoryStorage();
    await desk.putMemory(mem({ mem_id: 'm1', content: 'desktop authored note' }));
    await syncUp(desk, hub, 'desktop');
    const r = await syncDown(hub, web, { team_id: 't1' }, 0);
    expect(r.pulled).toBe(1);
    const got = await web.getMemory('m1');
    expect(got?.content).toBe('desktop authored note');
    // 审计归因：sync_up form=desktop / sync_down（§6 可回答"哪端回传"）
    const ups = filterSyncAudits(hub.audits, { action: 'sync_up', form: 'desktop' });
    expect(ups.length).toBe(1);
  });

  it('② 移动离线：3 条 pending 批量回传，sha256 幂等无重复，pending 清零', async () => {
    const hub = new SyncHub();
    const mobile = new InMemoryStorage();
    for (let i = 0; i < 3; i++) {
      await mobile.putMemory(mem({ mem_id: `off${i}`, content: `offline note ${i}`, pending_sync: true }));
    }
    const r1 = await syncUp(mobile, hub, 'mobile', { onlyPending: true });
    expect(r1.applied).toBe(3);
    expect((await mobile.listMemories({})).every((m) => !m.pending_sync)).toBe(true);
    // 联网后重复回传（模拟重试）→ 幂等去重
    const r2 = await syncUp(mobile, hub, 'mobile', { onlyPending: true });
    expect(r2.applied).toBe(0);
    const image = hub.reconcile({ team_id: 't1' });
    expect(image.items.length).toBe(3); // 无重复
  });

  it('③ 离线冲突：时钟占优直覆盖；并发时 LWW 晚者赢，败者 archived', async () => {
    const hub = new SyncHub();
    const base = mem({ mem_id: 'c1', content: 'original', vclock: { desktop: 1 } });
    hub.push(base, 'desktop');
    // 桌面改（时钟因果占优 desktop:1→2）→ 直接覆盖
    const deskEdit = stampForSync({ ...base, content: 'desktop edit', updated_at: NOW + 2000 }, 'desktop');
    const rDesk = hub.push(deskEdit, 'desktop');
    expect(rDesk).toBe('applied');
    // 移动并发改（mobile:1 vs {desktop:2} → concurrent）→ LWW：updated_at 早 → 输
    const mobEdit = stampForSync({ ...base, content: 'mobile edit', updated_at: NOW + 1000 }, 'mobile');
    const rMob = hub.push(mobEdit, 'mobile');
    expect(rMob).toBe('dedup');
    // 镜像 = 晚者（desktop edit）
    const image = hub.reconcile({ team_id: 't1' });
    const winner = image.items.find((m) => m.mem_id === 'c1');
    expect(winner?.content).toBe('desktop edit');
    // 败者 archived 不物理删（9.7）：losers 单列可查，不混入对账项
    expect(image.losers.length).toBe(1);
  });

  it('④ CLI 隔离：不同 team_id 不混入（§1 账号边界）', async () => {
    const hub = new SyncHub();
    const cli = new InMemoryStorage();
    await cli.putMemory(mem({ mem_id: 'cli1', team_id: 't_sys', content: 'system lib note' }));
    await syncUp(cli, hub, 'cli');
    // 个人桌面（t1）下行看不到 t_sys 的记忆
    const desk = new InMemoryStorage();
    const r = await syncDown(hub, desk, { team_id: 't1' }, 0);
    expect(r.pulled).toBe(0);
    // 同 team 下行可见
    const cliDown = await syncDown(hub, new InMemoryStorage(), { team_id: 't_sys' }, 0);
    expect(cliDown.pulled).toBe(1);
  });

  it('⑤ 对账兜底：短周期漏一条 → 全量对账补回', async () => {
    const hub = new SyncHub();
    const desk = new InMemoryStorage();
    await desk.putMemory(mem({ mem_id: 'full1', content: 'reconcile target' }));
    await syncUp(desk, hub, 'desktop');
    // 另一端只拉到 cursor=0 之前（模拟短周期漏单：跳过 syncDown）
    const web = new InMemoryStorage();
    // 每日全量对账 → 补回
    const r = await reconcile(hub, web, { team_id: 't1' });
    expect(r.backfilled).toBe(1);
    const got = await web.getMemory('full1');
    expect(got?.content).toBe('reconcile target');
  });

  it('⑥ 审计可查：sync_* 按 action/form 过滤（日志页联动）', async () => {
    const hub = new SyncHub();
    const desk = new InMemoryStorage();
    await desk.putMemory(mem({ mem_id: 'a1' }));
    await syncUp(desk, hub, 'desktop');
    await syncDown(hub, new InMemoryStorage(), { team_id: 't1' }, 0);
    const ups = filterSyncAudits(hub.audits, { action: 'sync_up' });
    const downs = filterSyncAudits(hub.audits, { action: 'sync_down' });
    expect(ups.length).toBe(1);
    expect(downs.length).toBe(1);
    expect(ups[0].form).toBe('desktop');
    expect(ups[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('冲突裁决细节（§4）', () => {
  it('全晚（时间戳相同）→ 挂 9.7 队列；resolve 后败者 archived', () => {
    const hub = new SyncHub();
    const base = mem({ mem_id: 'q1', vclock: { desktop: 1 } });
    hub.push(base, 'desktop');
    const a = { ...stampForSync({ ...base, content: 'edit A' }, 'desktop'), updated_at: NOW };
    const b = { ...stampForSync({ ...base, content: 'edit B' }, 'mobile'), updated_at: NOW };
    hub.push(a, 'desktop');
    const r = hub.push(b, 'mobile');
    expect(r).toBe('conflict');
    const pending = hub.listConflicts();
    expect(pending.length).toBe(1);
    expect(pending[0].mem_id).toBe('q1');
    hub.resolve(pending[0].conflict_id, 'remote'); // remote=镜像=edit A（接口语义：local=上行版本）
    expect(hub.listConflicts().length).toBe(0);
    const image = hub.reconcile({ team_id: 't1' });
    // 胜者 remote=edit A 生效；败者（上行 edit B）archived 留档
    expect(image.items.find((m) => m.mem_id === 'q1')?.content).toBe('edit A');
    expect(image.losers.length).toBe(1);
  });

  it('同内容不同 mem_id → 幂等账本去重（5.4）', () => {
    const hub = new SyncHub();
    hub.push(mem({ mem_id: 'x1', content: 'identical content' }), 'desktop');
    const r = hub.push(mem({ mem_id: 'x2', content: 'identical content' }), 'mobile');
    expect(r).toBe('dedup');
  });

  it('behind：本地落后 → 中枢保持最新，无需处理', () => {
    const hub = new SyncHub();
    const newer = stampForSync(mem({ mem_id: 'b1', vclock: { desktop: 3 } }), 'desktop');
    hub.push(newer, 'desktop');
    const older = { ...mem({ mem_id: 'b1', version: 1 }), vclock: { desktop: 1 } };
    expect(hub.push(older, 'desktop')).toBe('dedup');
  });
});
