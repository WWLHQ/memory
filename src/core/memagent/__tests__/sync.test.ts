// REQ-008 云同步契约测试（§8 全 6 用例 + LWW/幂等/隔离细节）
import { describe, expect, it } from 'vitest';
import {
  SyncHub, filterSyncAudits, reconcile, sha256hex, stampForSync, syncDown, syncUp, vcCompare,
} from '../sync.ts';
import { coreMemoryOp } from '../memories.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
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

  it('sha256：与 Node crypto 一致（含 55/56/64/120 字节填充边界）', () => {
    expect(sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256hex('a'.repeat(55))).toBe('9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318');
    expect(sha256hex('a'.repeat(56))).toBe('b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a');
    expect(sha256hex('a'.repeat(64))).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb');
    expect(sha256hex('a'.repeat(120))).toBe('2f3d335432c70b580af0e8e1b3674a7c020d683aa5f73aaaedfdc55af904c21c');
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
    // 移动并发改（mobile:1 vs {desktop:2} → concurrent）→ LWW：updated_at 早 → 输（D2：behind，本地不动）
    const mobEdit = stampForSync({ ...base, content: 'mobile edit', updated_at: NOW + 1000 }, 'mobile');
    const rMob = hub.push(mobEdit, 'mobile');
    expect(rMob).toBe('behind');
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

  it('behind：本地落后 → 中枢保持最新，返回 behind（D2）', () => {
    const hub = new SyncHub();
    const newer = stampForSync(mem({ mem_id: 'b1', vclock: { desktop: 3 } }), 'desktop');
    hub.push(newer, 'desktop');
    const older = { ...mem({ mem_id: 'b1', version: 1 }), vclock: { desktop: 1 } };
    expect(hub.push(older, 'desktop')).toBe('behind');
  });
});

describe('D2 收敛与删除墓碑', () => {
  it('冲突不改本地 version/pending；resolve 后下行 + 重试收敛', async () => {
    const hub = new SyncHub();
    const base = mem({ mem_id: 'c1', vclock: { desktop: 1 } });
    hub.push(base, 'desktop');
    // 双端并发编辑且时间戳相同 → 无法 LWW，挂 9.7 队列
    const editA = stampForSync({ ...base, content: 'edit A' }, 'desktop');
    const editB = stampForSync({ ...base, content: 'edit B' }, 'mobile');
    hub.push(editA, 'desktop');
    const mob = new InMemoryStorage();
    await mob.putMemory({ ...editB, pending_sync: true });

    const r = await syncUp(mob, hub, 'mobile');
    expect(r.conflicts.length).toBe(1);
    const local = await mob.getMemory('c1');
    expect(local?.version).toBe(editB.version); // 未被 stamp 覆盖
    expect(local?.pending_sync).toBe(true);     // 待裁决，仍待上行
    expect(local?.content).toBe('edit B');

    // 裁决 remote → 下行覆盖 → 重试上行收敛（不再冲突，镜像保持胜者）
    hub.resolve(r.conflicts[0], 'remote');
    const down = await syncDown(hub, mob, { team_id: 't1' }, 0);
    expect(down.pulled).toBe(1);
    expect((await mob.getMemory('c1'))?.content).toBe('edit A');
    const retry = await syncUp(mob, hub, 'mobile');
    expect(retry.conflicts.length).toBe(0);
    expect(retry.applied).toBe(1);
    expect(hub.listConflicts().length).toBe(0);
    expect(hub.reconcile({ team_id: 't1' }).items.find((m) => m.mem_id === 'c1')?.content).toBe('edit A');
  });

  it('behind 不动本地：因果落后保留 version/pending，等下行覆盖', async () => {
    const hub = new SyncHub();
    hub.push(mem({ mem_id: 'b1', content: 'hub newer', vclock: { desktop: 3 }, version: 5, updated_at: NOW + 5000 }), 'desktop');
    const local = new InMemoryStorage();
    await local.putMemory({
      ...mem({ mem_id: 'b1', content: 'local old', vclock: { desktop: 1 }, version: 2, updated_at: NOW }),
      pending_sync: true,
    });
    const r = await syncUp(local, hub, 'desktop');
    expect(r.behind).toBe(1);
    expect(r.applied).toBe(0);
    const got = await local.getMemory('b1');
    expect(got?.version).toBe(2);
    expect(got?.pending_sync).toBe(true);
    expect(got?.content).toBe('local old');
    // 下行覆盖后收敛到中枢版本
    await syncDown(hub, local, { team_id: 't1' }, 0);
    expect((await local.getMemory('b1'))?.content).toBe('hub newer');
  });

  it('删除墓碑：本端隐藏 + 跨端传播（多墓碑同空正文不被幂等吞掉）+ 对账不重复补单', async () => {
    const hub = new SyncHub();
    const desk = new InMemoryStorage();
    const web = new InMemoryStorage();
    await desk.putMemory(mem({ mem_id: 't1a', content: 'delete me A' }));
    await desk.putMemory(mem({ mem_id: 't1b', content: 'delete me B' }));
    expect((await syncUp(desk, hub, 'desktop')).applied).toBe(2);

    const vector = new JsVectorBackend();
    for (const id of ['t1a', 't1b']) {
      const r = await coreMemoryOp(id, 'delete', { storage: desk, vector, request_id: `req_${id}`, now: NOW });
      expect(r.ok).toBe(true);
    }
    expect(await desk.getMemory('t1a')).toBeNull(); // 默认列表/读取不展示墓碑
    expect((await desk.listMemories({})).length).toBe(0);
    const tombs = await desk.listMemories({ include_deleted: true });
    expect(tombs.map((m) => m.mem_id).sort()).toEqual(['t1a', 't1b']);
    expect(tombs.every((m) => m.deleted && m.content === '' && m.pending_sync && m.sha256 === undefined)).toBe(true);

    // 上行：两个墓碑 sha256('') 相同，仍须分别入账（墓碑不参与跨 mem_id 幂等）
    expect((await syncUp(desk, hub, 'desktop')).applied).toBe(2);
    expect((await desk.listMemories({ include_deleted: true })).every((m) => !m.pending_sync)).toBe(true);

    // 下行：Web 端同样隐藏正文，墓碑落到本地
    const down = await syncDown(hub, web, { team_id: 't1' }, 0);
    expect(down.pulled).toBe(2);
    expect(await web.getMemory('t1a')).toBeNull();
    expect((await web.listMemories({})).length).toBe(0);
    const webTombs = await web.listMemories({ include_deleted: true });
    expect(webTombs.length).toBe(2);
    expect(webTombs.every((m) => m.deleted && m.content === '')).toBe(true);
    // 对账：墓碑已存在 → 不重复补单，也不参与指纹校验
    expect((await reconcile(hub, web, { team_id: 't1' })).backfilled).toBe(0);
    expect(hub.reconcile({ team_id: 't1' }).missing_local).toEqual([]);
  });

  it('resolve 抬高胜者版本后，另一端的删除墓碑仍能下行（版本不阻挡删除传播）', async () => {
    const hub = new SyncHub();
    const base = mem({ mem_id: 'r1', vclock: { desktop: 1 } });
    expect(hub.push(base, 'desktop')).toBe('applied');
    // 桌面先推进一版，Web 从旧时钟并发编辑（同时间戳）→ 无法 LWW
    expect(hub.push(stampForSync({ ...base, content: 'desktop edit' }, 'desktop'), 'desktop')).toBe('applied');

    // 9.7 队列 → 裁决 local：镜像版本抬到 webEdit.version + 1
    const webEdit = stampForSync({ ...base, content: 'web edit' }, 'web');
    expect(hub.push(webEdit, 'web')).toBe('conflict');
    const [c] = hub.listConflicts();
    hub.resolve(c.conflict_id, 'local');
    const web = new InMemoryStorage();
    await web.putMemory({ ...webEdit, pending_sync: true });
    await syncDown(hub, web, { team_id: 't1' }, 0);
    expect((await web.getMemory('r1'))?.version).toBe(webEdit.version + 1);

    // 桌面删除：与裁决版本因果并发 + 时间戳更晚 → LWW 采纳，但墓碑版本仍低于 Web 本地版本
    const tomb: Memory = {
      ...base, content: '', deleted: true, deleted_at: NOW + 1000,
      vclock: { desktop: 3 }, version: base.version + 1, updated_at: NOW + 2000, pending_sync: true,
    };
    expect(hub.push(tomb, 'desktop')).toBe('lww');
    expect((await web.getMemory('r1'))!.version).toBeGreaterThan(tomb.version);

    // 删除传播不受版本比较阻挡
    await syncDown(hub, web, { team_id: 't1' }, 0);
    expect(await web.getMemory('r1')).toBeNull();
    expect((await web.listMemories({ include_deleted: true })).find((m) => m.mem_id === 'r1')?.deleted).toBe(true);
  });
});
