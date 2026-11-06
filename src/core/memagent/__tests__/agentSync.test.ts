// 42-A：内核 sync() 接真验收 —— hub 注入后真调 syncUp/syncDown 引擎；hub 未注入保留诚实降级。
// 红线：L0 密文层不进同步上行（has_l0 / content_l0_enc 行引擎层跳过 + l0_skipped 计数如实回报）。
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import { SyncHub, syncUp } from '../sync.ts';
import type { Memory } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const NOW = 1_800_000_000_000;

function mem(o: Partial<Memory> = {}): Memory {
  return {
    mem_id: o.mem_id ?? `m${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2', content: 'some sync content',
    decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: NOW,
    updated_at: NOW,
    ...o,
  };
}

function makeAgent(storage: InMemoryStorage, hub?: SyncHub) {
  return createMemAgent({
    form: 'desktop' as const, account: ACCOUNT,
    llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
    ...(hub ? { hub } : {}),
  });
}

describe('42-A 内核 sync() 接真', () => {
  it('push：明文行真上行落中枢；L0 行（has_l0 / content_l0_enc）不进上行，l0_skipped 如实计数', async () => {
    const storage = new InMemoryStorage();
    const hub = new SyncHub();
    const ma = makeAgent(storage, hub);
    await storage.putMemory(mem({ mem_id: 'plain1', content: 'plain note one' }));
    await storage.putMemory(mem({ mem_id: 'l0row', content: 'ciphertext row', has_l0: true }));
    await storage.putMemory(mem({ mem_id: 'l0row2', content: 'legacy envelope row', content_l0_enc: '{"v":2}' }));
    const r = await ma.sync({ direction: 'push', project_id: 'P1' });
    expect(r.pushed).toBe(1);          // 仅明文行上行
    expect(r.l0_skipped).toBe(2);      // 红线计数如实回报
    const mirrored = hub.reconcile({ team_id: 't1' }).items;
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0].mem_id).toBe('plain1');
    // L0 行本地原样保留（不打版本戳、不清 pending 之外的状态变动）
    expect((await storage.getMemory('l0row'))?.has_l0).toBe(true);
    const audits = await storage.queryAudit({ action: 'sync' });
    expect(audits[0].detail).toMatchObject({ implemented: true, direction: 'push', pushed: 1, l0_skipped: 2 });
  });

  it('pull：他端上行的行真下行落本地；since 游标透传（增量不重复拉已新行）', async () => {
    const hub = new SyncHub();
    // 他端上行两行
    const other = new InMemoryStorage();
    await other.putMemory(mem({ mem_id: 'm9', content: 'from web end' }));
    await other.putMemory(mem({ mem_id: 'm10', content: 'second from web' }));
    await syncUp(other, hub, 'web');
    const storage = new InMemoryStorage();
    const ma = makeAgent(storage, hub);
    // 第一次 pull：since=0 全量 → 2 行
    const r1 = await ma.sync({ direction: 'pull', project_id: 'P1' });
    expect(r1.pulled).toBe(2);
    expect(r1.cursor).toBeGreaterThan(0);
    expect((await storage.getMemory('m9'))?.content).toBe('from web end');
    // 第二次 pull：since=上次 cursor → 无新行可拉
    const r2 = await ma.sync({ direction: 'pull', project_id: 'P1', since: r1.cursor });
    expect(r2.pulled).toBe(0);
    const audits = await storage.queryAudit({ action: 'sync' });
    // 两次 pull 两轮审计；queryAudit 时间正序 → 最后一轮是第二次 pull
    expect(audits).toHaveLength(2);
    expect(audits[audits.length - 1].detail).toMatchObject({ implemented: true, direction: 'pull', pulled: 0 });
  });

  it('push 冲突透传：语义互斥（同 updated_at 全晚）→ conflicts 计数 + 本地版本不动', async () => {
    const hub = new SyncHub();
    // 远端先上行 m1（web 端视角）
    const other = new InMemoryStorage();
    await other.putMemory(mem({ mem_id: 'm1', content: 'web version', vclock: { web: 1 } }));
    await syncUp(other, hub, 'web');
    // 本端同 mem_id、同 updated_at、不同时钟分支 → 全晚进 §9.7 队列
    const storage = new InMemoryStorage();
    await storage.putMemory(mem({ mem_id: 'm1', content: 'desktop version', vclock: { desktop: 1 } }));
    const ma = makeAgent(storage, hub);
    const r = await ma.sync({ direction: 'push', project_id: 'P1' });
    expect(r.conflicts).toBe(1);
    expect(hub.listConflicts()).toHaveLength(1);
    // 本地版本/内容不被改动（等 9.7 裁决）
    const local = await storage.getMemory('m1');
    expect(local?.content).toBe('desktop version');
    expect(local?.version).toBe(1);
  });

  it('hub 未注入 → 诚实降级（E_NOT_IMPLEMENTED + implemented:false），与注入路径互不污染', async () => {
    const storage = new InMemoryStorage();
    const ma = makeAgent(storage);
    await storage.putMemory(mem({ mem_id: 'local1' }));
    await expect(ma.sync({ direction: 'push', project_id: 'P1' })).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });
    // 本地数据零变动（降级路径绝不动账本）
    expect((await storage.getMemory('local1'))?.version).toBe(1);
    const audits = await storage.queryAudit({ action: 'sync' });
    expect(audits[0].detail).toMatchObject({ implemented: false });
    expect(audits[0].detail).not.toHaveProperty('pushed');
  });
});
