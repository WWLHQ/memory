// PgSyncHub（REQ-008 §2 Postgres 中枢落地）验收：与内存 SyncHub 语义一致 + pglite 落盘重启 + 引擎集成
// @vitest-environment node
// （pglite 仅存在于 Node 运行时，jsdom 客户端环境无法打包）
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgSyncHub } from '../pgSyncHub.ts';
import { SyncHub, reconcile, sha256hex, syncDown, syncUp } from '../sync.ts';
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

describe('PgSyncHub 与内存 SyncHub 语义一致', () => {
  let hub: PgSyncHub;

  beforeEach(async () => {
    hub = new PgSyncHub();
    await hub.init();
  });
  afterEach(async () => {
    await hub.close();
  });

  it('push 全分支：create / dedup / ahead 覆盖 / behind 跳过 / LWW / conflict 挂队列', async () => {
    // create
    expect(await hub.push(mem({ mem_id: 'm1', content: 'first note' }), 'desktop')).toBe('applied');
    // 同 mem_id 同内容重推（equal + version 相同）→ 非 ahead 非并发，behind? equal+version 相等 → 落到 LWW/conflict 分支前……
    // 内存版语义：equal 且 version 相同 → updated_at 相同 → conflict。此处先验证 dedup（不同 mem_id 同内容）
    expect(await hub.push(mem({ mem_id: 'm2', content: 'first note' }), 'web')).toBe('dedup');

    // ahead：本端时钟占优 → 覆盖 applied
    expect(await hub.push(mem({ mem_id: 'm1', content: 'second note', vclock: { desktop: 2 }, version: 2, updated_at: NOW + 1000 }), 'desktop')).toBe('applied');
    // behind：落后中枢 → dedup
    expect(await hub.push(mem({ mem_id: 'm1', content: 'stale note', vclock: { desktop: 1 }, version: 1 }), 'desktop')).toBe('dedup');

    // concurrent + 本端 updated_at 更晚 → LWW 胜，败者 archived 留档（首推带 desktop 分量，二推 mobile 分量 → concurrent）
    expect(await hub.push(mem({ mem_id: 'm3', content: 'base v1', vclock: { desktop: 1 } }), 'desktop')).toBe('applied');
    expect(await hub.push(mem({ mem_id: 'm3', content: 'later local edit', vclock: { mobile: 1 }, version: 2, updated_at: NOW + 5000 }), 'mobile')).toBe('lww');
    const rec3 = await hub.reconcile({ team_id: 't1' });
    expect(rec3.items.find((m) => m.mem_id === 'm3')!.content).toBe('later local edit');
    expect(rec3.losers.some((m) => m.mem_id === 'm3' && m.decay_class === 'archived')).toBe(true);

    // concurrent + 镜像更晚 → dedup（本地败者同样留档）
    expect(await hub.push(mem({ mem_id: 'm4', content: 'remote wins base', vclock: { desktop: 1 } }), 'desktop')).toBe('applied');
    expect(await hub.push(mem({ mem_id: 'm4', content: 'earlier local edit', vclock: { mobile: 1 }, version: 2, updated_at: NOW - 5000 }), 'mobile')).toBe('dedup');
    const rec4 = await hub.reconcile({ team_id: 't1' });
    expect(rec4.items.find((m) => m.mem_id === 'm4')!.content).toBe('remote wins base');
    expect(rec4.losers.filter((m) => m.mem_id === 'm4')).toHaveLength(1);

    // concurrent + updated_at 相同 → 9.7 裁决队列（首推带 desktop 分量，二推 mobile 分量 → concurrent）
    expect(await hub.push(mem({ mem_id: 'm5', content: 'conflicted base', vclock: { desktop: 1 } }), 'desktop')).toBe('applied');
    expect(await hub.push(mem({ mem_id: 'm5', content: 'parallel edit same ts', vclock: { mobile: 1 }, version: 2 }), 'mobile')).toBe('conflict');
    const pending = await hub.listConflicts();
    expect(pending).toHaveLength(1);
    expect(pending[0].mem_id).toBe('m5');
    // 裁决：local 胜 → 镜像更新 + 败者留档 + 出队
    await hub.resolve(pending[0].conflict_id, 'local');
    expect(await hub.listConflicts()).toHaveLength(0);
    const rec5 = await hub.reconcile({ team_id: 't1' });
    expect(rec5.items.find((m) => m.mem_id === 'm5')!.content).toBe('parallel edit same ts');
    expect(rec5.losers.some((m) => m.mem_id === 'm5')).toBe(true);
  });

  it('pull：since 增量 + team 隔离 + preference user 过滤 + 墓碑不下行', async () => {
    await hub.push(mem({ mem_id: 'a1', content: 'team one note', team_id: 't1' }), 'desktop');
    await hub.push(mem({ mem_id: 'b1', content: 'team two note', team_id: 't2' }), 'desktop');
    await hub.push(mem({ mem_id: 'p1', content: 'alice pref', team_id: 't1', category: 'preference', user_id: 'alice' }), 'desktop');

    const r1 = await hub.pull({ team_id: 't1' }, 0);
    expect(r1.items.map((m) => m.mem_id).sort()).toEqual(['a1', 'p1']);
    // user 隔离：bob 拉不到 alice 的偏好
    const rBob = await hub.pull({ team_id: 't1', user_id: 'bob' }, 0);
    expect(rBob.items.map((m) => m.mem_id)).toEqual(['a1']);
    // team 隔离：t2 只拉到 t2
    const r2 = await hub.pull({ team_id: 't2' }, 0);
    expect(r2.items.map((m) => m.mem_id)).toEqual(['b1']);
    // 增量：since=当前 cursor → 空
    const r3 = await hub.pull({ team_id: 't1' }, r1.cursor);
    expect(r3.items).toHaveLength(0);

    // LWW 产生墓碑 → 不下行
    await hub.push(mem({ mem_id: 'a1', content: 'a1 edited later', vclock: { mobile: 1 }, version: 2, updated_at: NOW + 2000 }), 'mobile');
    const r4 = await hub.pull({ team_id: 't1' }, 0);
    expect(r4.items.filter((m) => m.mem_id === 'a1')).toHaveLength(1);
    expect(r4.items.find((m) => m.mem_id === 'a1')!.content).toBe('a1 edited later');
  });

  it('reconcile：指纹不一致报 missing_local', async () => {
    const bad = mem({ mem_id: 'bad1', content: 'tampered content' });
    // 直接注入与内容不符的 sha256（模拟中枢数据被篡改）
    await hub.push({ ...bad, sha256: sha256hex('original content') }, 'desktop');
    const r = await hub.reconcile({ team_id: 't1' });
    expect(r.missing_local).toEqual(['bad1']);
  });

  it('审计：auditCount/auditsFrom 截取本轮（与内存版 audits.slice 语义一致）', async () => {
    expect(await hub.auditCount()).toBe(0);
    await hub.push(mem({ mem_id: 'm1', content: 'audit note one' }), 'desktop');
    const start = await hub.auditCount();
    expect(start).toBe(1);
    await hub.push(mem({ mem_id: 'm2', content: 'audit note two' }), 'desktop');
    const round = await hub.auditsFrom(start);
    expect(round).toHaveLength(1);
    expect(round[0].action).toBe('sync_up');
    expect(round[0].form).toBe('desktop');
  });
});

describe('PgSyncHub 落盘持久化（dataDir）', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = join(tmpdir(), `pglite-hub-test-${randomUUID()}`);
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('close 后重开同 dataDir：镜像 / 幂等账本 / 游标 / 冲突队列全部保留', async () => {
    const hub1 = new PgSyncHub(dataDir);
    await hub1.init();
    await hub1.push(mem({ mem_id: 'keep1', content: 'persisted note', team_id: 't1' }), 'desktop');
    // 挂一个冲突再 resolve，验证冲突队列状态也落盘（首推带 desktop 分量，二推 mobile 分量 → concurrent + 同 ts → conflict）
    await hub1.push(mem({ mem_id: 'cf1', content: 'conflict base', team_id: 't1', vclock: { desktop: 1 }, version: 1 }), 'desktop');
    await hub1.push(mem({ mem_id: 'cf1', content: 'parallel same ts', team_id: 't1', vclock: { mobile: 1 }, version: 2 }), 'mobile');
    const pending = await hub1.listConflicts();
    expect(pending).toHaveLength(1);
    const cursorBefore = await hub1.getCursor();
    expect(cursorBefore).toBeGreaterThan(0);
    await hub1.close();

    const hub2 = new PgSyncHub(dataDir);
    await hub2.init();
    // 镜像保留
    const rec = await hub2.reconcile({ team_id: 't1' });
    expect(rec.items.map((m) => m.mem_id)).toContain('keep1');
    // 幂等账本保留：同内容不同 mem_id 仍去重
    expect(await hub2.push(mem({ mem_id: 'other-id', content: 'persisted note', team_id: 't1' }), 'web')).toBe('dedup');
    // 游标单调保留（不回卷）
    expect(await hub2.getCursor()).toBe(cursorBefore);
    await hub2.push(mem({ mem_id: 'after-restart', content: 'post restart', team_id: 't1' }), 'desktop');
    expect(await hub2.getCursor()).toBe(cursorBefore + 1);
    // 冲突队列保留 + 可继续裁决
    expect(await hub2.listConflicts()).toHaveLength(1);
    await hub2.resolve(pending[0].conflict_id, 'remote');
    expect(await hub2.listConflicts()).toHaveLength(0);
    await hub2.close();
  });
});

describe('PgSyncHub × 三端引擎集成（syncUp/syncDown/reconcile）', () => {
  it('桌面→中枢→Web 全链路 + 与内存版同路径结果一致', async () => {
    // PgSyncHub 路径
    const pgHub = new PgSyncHub();
    await pgHub.init();
    const desk1 = new InMemoryStorage();
    await desk1.putMemory(mem({ mem_id: 'e1', content: 'engine flow note' }));
    await desk1.putMemory(mem({ mem_id: 'e2', content: 'second note' }));
    const up1 = await syncUp(desk1, pgHub, 'desktop');
    expect(up1.applied).toBe(2);
    expect(up1.audits.length).toBe(2);
    const web1 = new InMemoryStorage();
    const down1 = await syncDown(pgHub, web1, { team_id: 't1' }, 0);
    expect(down1.pulled).toBe(2);
    expect((await web1.getMemory('e2'))!.content).toBe('second note');
    await pgHub.close();

    // 内存版同路径（结果一致）
    const memHub = new SyncHub();
    const desk2 = new InMemoryStorage();
    await desk2.putMemory(mem({ mem_id: 'e1', content: 'engine flow note' }));
    await desk2.putMemory(mem({ mem_id: 'e2', content: 'second note' }));
    const up2 = await syncUp(desk2, memHub, 'desktop');
    expect(up2.applied).toBe(up1.applied);
    const web2 = new InMemoryStorage();
    const down2 = await syncDown(memHub, web2, { team_id: 't1' }, 0);
    expect(down2.pulled).toBe(down1.pulled);
    expect((await web2.getMemory('e2'))!.content).toBe((await web1.getMemory('e2'))!.content);

    // reconcile 引擎 × PgSyncHub：全量补漏
    const pgHub2 = new PgSyncHub();
    await pgHub2.init();
    await pgHub2.push(mem({ mem_id: 'only-hub', content: 'hub only note' }), 'desktop');
    const fresh = new InMemoryStorage();
    const rc = await reconcile(pgHub2, fresh, { team_id: 't1' });
    expect(rc.backfilled).toBe(1);
    expect((await fresh.getMemory('only-hub'))!.content).toBe('hub only note');
    await pgHub2.close();
  });
});
