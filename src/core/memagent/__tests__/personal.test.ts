// 第一轮个人记忆本机闭环：独立存储 / 内核 API / 审计 / 召回准入。
// 第二轮跨端同步：sha256 幂等 / vclock / 显式授权上行 / 失败 stage+code / owner 口径。
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import {
  InMemoryPersonalStore, personalContentHash, parsePersonalOwnerBindings, resolvePersonalOwner,
} from '../personalStore.ts';
import { FilePersonalStore } from '../personalStoreFile.ts';
import { PERSONAL_CONFIDENCE_DELTA, personalList, personalRecallScore, createPersonalApi } from '../personal.ts';
import type { PersonalSyncPort } from '../personal.ts';
import { PgSyncHub } from '../pgSyncHub.ts';
import { sha256hex } from '../sync.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

/** 以内核 account.user_id 召回的 agent（个人存储真实注入） */
function makeAgentWith(store: InMemoryPersonalStore) {
  return createMemAgent({
    form: 'web', account: ACCOUNT,
    llm: new FakeLlmProvider(), vector: new JsVectorBackend(),
    storage: new InMemoryStorage(), personal: store,
  });
}

function makeCtx(store = new InMemoryPersonalStore(), audits: unknown[] = []) {
  return {
    ctx: {
      store,
      owner: 'u1',
      form: 'web' as const,
      appendAudit: async (a: unknown) => { audits.push(a); },
      now: () => 1_700_000_000_000,
    },
    store,
    audits,
  };
}

afterEach(() => {
  /* 每个用例自建存储，无需共享清理 */
});

describe('个人记忆存储：独立落盘 + 墓碑', () => {
  it('FilePersonalStore 写独立文件，重启后读回；删除只写墓碑、记录仍在文件里', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-store-'));
    const file = join(dir, 'personal-memory.db.json');
    try {
      const s1 = new FilePersonalStore(file);
      const api1 = createPersonalApi({ store: s1, owner: 'u1', form: 'desktop', appendAudit: async () => {} });
      const r = await api1.quickAdd('咖啡偏好：美式，不加糖');
      await api1.confirm(r.entry.id);
      expect(existsSync(file)).toBe(true);

      const s2 = new FilePersonalStore(file);
      const snap = await personalList(s2, 'u1');
      expect(snap.confirmed).toHaveLength(1);
      expect(snap.confirmed[0].content).toContain('美式');

      const api2 = createPersonalApi({ store: s2, owner: 'u1', form: 'desktop', appendAudit: async () => {} });
      await api2.remove(r.entry.id, true);
      const snap2 = await personalList(s2, 'u1');
      expect(snap2.confirmed).toHaveLength(0);

      // 墓碑留在文件里：不是物理删除
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { entries: { id: string; deleted: boolean }[] };
      const tomb = raw.entries.find((e) => e.id === r.entry.id);
      expect(tomb?.deleted).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('owner 隔离：不同 owner 互相看不到', async () => {
    const { ctx } = makeCtx();
    const api = createPersonalApi(ctx);
    await api.quickAdd('u1 的私人记录');
    const other = createPersonalApi({ ...ctx, owner: 'u2' });
    const snap = await other.list();
    expect(snap.confirmed).toHaveLength(0);
    expect(snap.pending).toHaveLength(0);
  });
});

describe('个人记忆内核 API：状态机 + 审计 + 回执', () => {
  it('quick_add → pending；confirm → confirmed（审计 confidence +0.1）；reject → rejected（−0.05）', async () => {
    const { ctx, audits } = makeCtx();
    const api = createPersonalApi(ctx);
    const a = await api.quickAdd('习惯：每天早上看一次告警');
    expect(a.entry.state).toBe('pending');
    expect(a.entry.source).toBe('quick_note');
    expect(a.request_id).toMatch(/^pm_/);

    const b = await api.confirm(a.entry.id);
    expect(b.entry.state).toBe('confirmed');
    expect(b.entry.confirmed_at).toBe(1_700_000_000_000);
    expect(b.entry.version).toBe(2);

    const c = await api.quickAdd('不相关的记录');
    const d = await api.reject(c.entry.id);
    expect(d.entry.state).toBe('rejected');
    expect(d.entry.rejected_at).toBe(1_700_000_000_000);

    const auditList = audits as { action: string; request_id: string; detail: Record<string, unknown> }[];
    expect(auditList).toHaveLength(4);
    expect(auditList.every((x) => x.action === 'personal_memory')).toBe(true);
    expect(auditList.every((x) => typeof x.request_id === 'string' && x.request_id.length > 0)).toBe(true);
    const confirmAudit = auditList.find((x) => x.detail.op === 'confirm');
    expect(confirmAudit?.detail.confidence_delta).toBe(PERSONAL_CONFIDENCE_DELTA.confirm);
    const rejectAudit = auditList.find((x) => x.detail.op === 'reject');
    expect(rejectAudit?.detail.confidence_delta).toBe(PERSONAL_CONFIDENCE_DELTA.reject);
    // 审计不复制正文
    expect(JSON.stringify(auditList)).not.toContain('每天早上看一次告警');
  });

  it('revoke：confirmed / rejected 都回到 pending（取消确认 / 撤销剔除）', async () => {
    const { ctx } = makeCtx();
    const api = createPersonalApi(ctx);
    const a = await api.quickAdd('会被取消确认的条目');
    await api.confirm(a.entry.id);
    const back = await api.revoke(a.entry.id);
    expect(back.entry.state).toBe('pending');
    expect(back.entry.confirmed_at).toBeNull();

    await api.reject(a.entry.id);
    const undo = await api.revoke(a.entry.id);
    expect(undo.entry.state).toBe('pending');
    expect(undo.entry.rejected_at).toBeNull();
  });

  it('delete 必须二次确认；未确认时零变更', async () => {
    const { ctx, audits } = makeCtx();
    const api = createPersonalApi(ctx);
    const a = await api.quickAdd('待删除条目');
    await expect(api.remove(a.entry.id, false)).rejects.toThrow(/二次确认/);
    expect((audits as unknown[]).length).toBe(1); // 只有 quick_add 审计
    const del = await api.remove(a.entry.id, true);
    expect(del.entry.deleted).toBe(true);
    const snap = await api.list();
    expect(snap.pending).toHaveLength(0);
  });

  it('非法流转被拒（不写审计、不改状态）', async () => {
    const { ctx, audits } = makeCtx();
    const api = createPersonalApi(ctx);
    const a = await api.quickAdd('条目');
    await api.confirm(a.entry.id);
    await expect(api.confirm(a.entry.id)).rejects.toThrow(/状态不匹配/);
    expect((audits as unknown[]).length).toBe(2);
    await expect(api.quickAdd('   ')).rejects.toThrow(/内容为空/);
  });

  it('未注入存储 → available=false 且读写如实 E_NOT_IMPLEMENTED', async () => {
    const api = createPersonalApi({ store: undefined, owner: 'u1', form: 'web', appendAudit: async () => {} });
    expect(api.available).toBe(false);
    await expect(api.list()).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });
    await expect(api.quickAdd('x')).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });
  });

  it('content_hash 稳定且随正文变化（本机指纹，第二轮换 sha256）', () => {
    expect(personalContentHash('abc')).toBe(personalContentHash('abc'));
    expect(personalContentHash('abc')).not.toBe(personalContentHash('abd'));
    expect(personalContentHash('abc')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('召回准入：只有 confirmed 进召回', () => {
  function agentWith(store: InMemoryPersonalStore) {
    return createMemAgent({
      form: 'web', account: ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(),
      storage: new InMemoryStorage(), personal: store,
    });
  }

  it('confirmed 进 hits；pending / rejected / 墓碑不进', async () => {
    const store = new InMemoryPersonalStore();
    const ma = agentWith(store);
    const keep = await ma.personal.quickAdd('项目部署使用蓝绿发布，回滚走旧槽');
    await ma.personal.confirm(keep.entry.id);
    const pend = await ma.personal.quickAdd('项目部署的待确认草稿');
    const rej = await ma.personal.quickAdd('项目部署的错误结论');
    await ma.personal.reject(rej.entry.id);
    const gone = await ma.personal.quickAdd('项目部署的已删记录');
    await ma.personal.remove(gone.entry.id, true);

    const r = await ma.recall({ query: '项目部署 回滚', project_id: 'P1' });
    const ids = r.hits.map((h) => h.mem_id);
    expect(ids).toContain(`pm:${keep.entry.id}`);
    expect(ids).not.toContain(`pm:${pend.entry.id}`);
    expect(ids).not.toContain(`pm:${rej.entry.id}`);
    expect(ids).not.toContain(`pm:${gone.entry.id}`);

    const personalHit = r.hits.find((h) => h.mem_id === `pm:${keep.entry.id}`);
    expect(personalHit?.evidence_ref).toBe(`personal:${keep.entry.id}`);
    expect(personalHit?.score).toBeGreaterThan(0);
  });

  it('未注入 personal 存储 → 召回与既有行为一致（零改变）', async () => {
    const ma = createMemAgent({
      form: 'web', account: ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage: new InMemoryStorage(),
    });
    const r = await ma.recall({ query: '任意', project_id: 'P1' });
    expect(r.hits.every((h) => !h.mem_id.startsWith('pm:'))).toBe(true);
    expect(ma.personal.available).toBe(false);
  });

  it('score：关键词重合度（中文二元组 + 英文词），不冒充向量相关度', () => {
    expect(personalRecallScore('使用蓝绿发布部署', '蓝绿发布 部署')).toBeGreaterThan(0.5);
    expect(personalRecallScore('使用蓝绿发布部署', '完全无关的查询')).toBe(0);
    expect(personalRecallScore('blue green deploy', 'deploy')).toBe(1);
  });
});

// ─── 第二轮：跨端同步（pending_sync / vclock / sha256 幂等 / 显式授权 / owner 口径） ────

function syncCtx(opts: {
  store?: InMemoryPersonalStore;
  audits?: unknown[];
  sync?: PersonalSyncPort;
  owner?: string;
  kernelUserId?: string;
  bindings?: { account: string; kernel_user_id: string }[];
} = {}) {
  const store = opts.store ?? new InMemoryPersonalStore();
  const audits = opts.audits ?? [];
  return {
    store,
    audits,
    ctx: {
      store,
      owner: opts.owner ?? 'u1',
      kernelUserId: opts.kernelUserId,
      ownerBindings: opts.bindings,
      form: 'desktop' as const,
      team_id: 't1',
      enterprise_id: 'e1',
      sync: opts.sync,
      appendAudit: async (a: unknown) => { audits.push(a); },
      now: () => 1_700_000_000_000,
    } as Parameters<typeof createPersonalApi>[0],
  };
}

describe('第二轮字段：sha256 / vclock / 默认 local（confirm 不提权）', () => {
  it('quick_add 写 sha256 指纹与 vclock；confirm 只改状态，不置 team_shared、不改 sync_state', async () => {
    const { ctx } = makeCtx();
    const api = createPersonalApi(ctx);
    const a = await api.quickAdd('某条内容');
    expect(a.entry.sha256).toBe(sha256hex('某条内容'));
    expect(a.entry.sha256).toHaveLength(64);
    expect(a.entry.vclock).toEqual({ web: 1 });
    expect(a.entry.sync_state).toBe('local');
    expect(a.entry.team_shared).toBe(false);
    expect(a.entry.team_id).toBeNull();

    const b = await api.confirm(a.entry.id);
    expect(b.entry.team_shared).toBe(false);
    expect(b.entry.sync_state).toBe('local');
    expect(b.entry.team_id).toBeNull();
    // 状态变更推进向量时钟
    expect(b.entry.vclock).toEqual({ web: 2 });
    const snap = await api.list();
    expect(snap.counts.team_shared).toBe(0);
  });

  it('旧文件条目兼容：缺 sha256 / vclock / 同步字段读取时补齐，正文与状态保持不变', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-legacy-'));
    const file = join(dir, 'personal-memory.db.json');
    try {
      const legacy = {
        schema: 1,
        entries: [{
          id: 'pm_legacy', owner: 'u1', content: '旧条目内容', source: 'quick_note', source_agent: null,
          delivered_at: 1_690_000_000_000, confirmed_at: 1_690_000_001_000, state: 'confirmed', rejected_at: null,
          layer: 'L1', content_hash: personalContentHash('旧条目内容'), version: 3, deleted: false, deleted_at: null,
        }],
      };
      writeFileSync(file, JSON.stringify(legacy), 'utf8');
      const s = new FilePersonalStore(file);
      const list = await s.list('u1');
      expect(list).toHaveLength(1);
      expect(list[0].content).toBe('旧条目内容');
      expect(list[0].state).toBe('confirmed');
      expect(list[0].sha256).toBe(sha256hex('旧条目内容'));
      expect(list[0].vclock).toEqual({ desktop: 3 });
      expect(list[0].sync_state).toBe('local');
      expect(list[0].team_shared).toBe(false);
      expect(list[0].sync_error).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('第二轮上行：显式授权 + 真实 PgSyncHub + sha256 幂等', () => {
  it('未显式授权（explicit≠true）一律拒绝：零状态变更、零审计', async () => {
    const { ctx, audits } = makeCtx();
    const api = createPersonalApi(ctx);
    const a = await api.quickAdd('未授权的私有条目');
    await api.confirm(a.entry.id);
    const before = audits.length;
    await expect(api.pushToTeam(a.entry.id, { explicit: false })).rejects.toMatchObject({ code: 'E_SYNC_NOT_AUTHORIZED' });
    expect(audits.length).toBe(before);
    const snap = await api.list();
    expect(snap.confirmed[0].team_shared).toBe(false);
    expect(snap.confirmed[0].sync_state).toBe('local');
  });

  it('只有已确认条目可上行；跨团队目标被拒', async () => {
    const { ctx } = makeCtx();
    const api = createPersonalApi({ ...ctx, team_id: 't1' });
    const a = await api.quickAdd('待确认条目');
    await expect(api.pushToTeam(a.entry.id, { explicit: true })).rejects.toMatchObject({ code: 'E_SYNC_STATE' });
    await api.confirm(a.entry.id);
    await expect(api.pushToTeam(a.entry.id, { explicit: true, team_id: 't2' }))
      .rejects.toMatchObject({ code: 'E_SYNC_TEAM_MISMATCH' });
  });

  it('显式授权 → 真实中枢落账；重复上行与同内容条目按 sha256 幂等，不产生重复条目', async () => {
    const hub = new PgSyncHub();
    await hub.init();
    try {
      const { ctx, audits } = syncCtx({ sync: { push: (m, f) => hub.push(m, f) } });
      const api = createPersonalApi(ctx);
      const a = await api.quickAdd('团队共享的部署约定：蓝绿发布 + 旧槽回滚');
      await api.confirm(a.entry.id);
      const r1 = await api.pushToTeam(a.entry.id, { explicit: true });
      expect(r1.sync.outcome).toBe('synced');
      expect(r1.sync.result).toBe('applied');
      expect(r1.entry.sync_state).toBe('synced');
      expect(r1.entry.team_shared).toBe(true);
      expect(r1.entry.team_id).toBe('t1');
      expect(r1.entry.sync_error).toBeNull();

      // 重复上行（同一条目）：幂等重写同 mem_id，中枢不新增条目
      const r2 = await api.pushToTeam(a.entry.id, { explicit: true });
      expect(r2.sync.outcome).toBe('synced');
      const rec = await hub.reconcile({ team_id: 't1' });
      expect(rec.items.filter((m) => m.mem_id === `pm:${a.entry.id}`)).toHaveLength(1);
      // 中枢里存的是真实 sha256 指纹（对账零缺失）
      expect(rec.missing_local).toHaveLength(0);
      expect(rec.items.find((m) => m.mem_id === `pm:${a.entry.id}`)?.sha256).toBe(a.entry.sha256);

      // 另一条同内容条目：中枢 sha256 去重 → dedup（中枢仍只有一条同内容条目）
      const b = await api.quickAdd('团队共享的部署约定：蓝绿发布 + 旧槽回滚');
      await api.confirm(b.entry.id);
      const r3 = await api.pushToTeam(b.entry.id, { explicit: true });
      expect(r3.sync.outcome).toBe('synced');
      expect(r3.sync.result).toBe('dedup');
      const rec2 = await hub.reconcile({ team_id: 't1' });
      expect(rec2.items.filter((m) => m.content === '团队共享的部署约定：蓝绿发布 + 旧槽回滚')).toHaveLength(1);

      // 审计如实：带 sha256 / 同步阶段口径，且不复制正文
      const auditList = audits as { action: string; request_id: string; detail: Record<string, unknown> }[];
      const pushAudits = auditList.filter((x) => x.detail.op === 'push_team');
      expect(pushAudits.length).toBeGreaterThanOrEqual(3);
      expect(pushAudits.every((x) => x.detail.sync_outcome === 'synced')).toBe(true);
      expect(pushAudits.every((x) => x.detail.explicit_authorization === true)).toBe(true);
      expect(pushAudits.every((x) => typeof x.detail.sha256 === 'string')).toBe(true);
      expect(JSON.stringify(auditList)).not.toContain('蓝绿发布 + 旧槽回滚');
    } finally {
      await hub.close();
    }
  });

  it('中枢未接线：如实失败 stage=hub_init / E_SYNC_HUB_UNAVAILABLE，绝不显示已同步；接线后重试成功', async () => {
    const { ctx, audits } = syncCtx();
    const api = createPersonalApi(ctx);
    const a = await api.quickAdd('需要上行的条目');
    await api.confirm(a.entry.id);
    const r = await api.pushToTeam(a.entry.id, { explicit: true });
    expect(r.sync.outcome).toBe('failed');
    expect(r.sync.stage).toBe('hub_init');
    expect(r.sync.code).toBe('E_SYNC_HUB_UNAVAILABLE');
    expect(r.entry.sync_state).toBe('failed');
    expect(r.entry.sync_result).toBeNull();
    expect(r.entry.sync_error).toMatchObject({ stage: 'hub_init', code: 'E_SYNC_HUB_UNAVAILABLE' });
    // 授权已记录（可重试），但不是「已同步」
    expect(r.entry.team_shared).toBe(true);
    const snap = await api.list();
    expect(snap.sync_queue.map((e) => e.id)).toContain(a.entry.id);
    expect(snap.counts.sync_failed).toBe(1);
    expect(snap.counts.pending_sync).toBe(0);
    expect(snap.counts.synced).toBe(0);
    const auditList = audits as { detail: Record<string, unknown> }[];
    const pushAudit = auditList.find((x) => x.detail.op === 'push_team');
    expect(pushAudit?.detail.sync_outcome).toBe('failed');
    expect(pushAudit?.detail.sync_stage).toBe('hub_init');
    expect(pushAudit?.detail.sync_code).toBe('E_SYNC_HUB_UNAVAILABLE');

    // 接线后重试：同一存储，注入真实中枢
    const hub = new PgSyncHub();
    await hub.init();
    try {
      const api2 = createPersonalApi({ ...ctx, sync: { push: (m, f) => hub.push(m, f) } });
      const retry = await api2.retrySync(a.entry.id);
      expect(retry.sync.outcome).toBe('synced');
      expect(retry.entry.sync_state).toBe('synced');
      expect(retry.entry.sync_error).toBeNull();
      const snap2 = await api2.list();
      expect(snap2.counts.sync_failed).toBe(0);
      expect(snap2.counts.synced).toBe(1);
      expect(await hub.reconcile({ team_id: 't1' }));
    } finally {
      await hub.close();
    }
  });

  it('中枢抛错 → stage=hub_push / E_SYNC_PUSH_FAILED；未授权条目不能重试', async () => {
    const { ctx } = syncCtx({
      sync: { push: async () => { throw new Error('中枢连接中断'); } },
    });
    const api = createPersonalApi(ctx);
    const a = await api.quickAdd('中枢抛错条目');
    await api.confirm(a.entry.id);
    const r = await api.pushToTeam(a.entry.id, { explicit: true });
    expect(r.sync).toMatchObject({ outcome: 'failed', stage: 'hub_push', code: 'E_SYNC_PUSH_FAILED' });
    expect(r.entry.sync_error?.message).toContain('中枢连接中断');

    const b = await api.quickAdd('未授权条目');
    await api.confirm(b.entry.id);
    await expect(api.retrySync(b.entry.id)).rejects.toMatchObject({ code: 'E_SYNC_NOT_AUTHORIZED' });
  });
});

describe('第二轮 owner 口径：内核 account.user_id 为准，不同名显式绑定 / 未绑定仅本机', () => {
  it('解析：同名直通 / 显式绑定 / 未绑定 fail-closed / 无内核身份沿用登录账号', () => {
    expect(resolvePersonalOwner('u1', 'u1', [])).toMatchObject({ owner: 'u1', bound: true, via: 'same_name' });
    expect(resolvePersonalOwner('alice', 'u1', [{ account: 'alice', kernel_user_id: 'u1' }]))
      .toMatchObject({ owner: 'u1', bound: true, via: 'binding' });
    expect(resolvePersonalOwner('alice', 'u1', []))
      .toMatchObject({ owner: 'alice', bound: false, via: 'unbound' });
    expect(resolvePersonalOwner('u1', undefined, []))
      .toMatchObject({ owner: 'u1', bound: true, via: 'no_kernel' });
  });

  it('绑定：条目按内核账号写入，agent（内核 user_id）召回命中；未绑定：本机照常可用但 agent 不命中', async () => {
    const boundStore = new InMemoryPersonalStore();
    const bound = createPersonalApi({
      store: boundStore, owner: 'alice', kernelUserId: 'u1',
      ownerBindings: [{ account: 'alice', kernel_user_id: 'u1' }],
      form: 'web', appendAudit: async () => {},
    });
    const a = await bound.quickAdd('绑定后的个人记忆：蓝绿发布约定');
    await bound.confirm(a.entry.id);
    expect(a.entry.owner).toBe('u1');
    const ma = makeAgentWith(boundStore);
    const r = await ma.recall({ query: '蓝绿发布 约定', project_id: 'P1' });
    expect(r.hits.map((h) => h.mem_id)).toContain(`pm:${a.entry.id}`);

    const unboundStore = new InMemoryPersonalStore();
    const unbound = createPersonalApi({
      store: unboundStore, owner: 'bob', kernelUserId: 'u1',
      form: 'web', appendAudit: async () => {},
    });
    const b = await unbound.quickAdd('未绑定的个人记忆：蓝绿发布约定');
    await unbound.confirm(b.entry.id);
    expect(b.entry.owner).toBe('bob');
    const snap = await unbound.list();
    expect(snap.confirmed).toHaveLength(1); // 本机本人照常可用
    expect(snap.owner_binding.bound).toBe(false);
    const ma2 = makeAgentWith(unboundStore);
    const r2 = await ma2.recall({ query: '蓝绿发布 约定', project_id: 'P1' });
    expect(r2.hits.map((h) => h.mem_id)).not.toContain(`pm:${b.entry.id}`);
  });

  it('parsePersonalOwnerBindings：空值 = 空表；坏 JSON / 坏项如实抛错（不静默丢绑定）', () => {
    expect(parsePersonalOwnerBindings(undefined)).toEqual([]);
    expect(parsePersonalOwnerBindings('  ')).toEqual([]);
    expect(parsePersonalOwnerBindings('[{"account":"alice","kernel_user_id":"u1"}]'))
      .toEqual([{ account: 'alice', kernel_user_id: 'u1' }]);
    expect(() => parsePersonalOwnerBindings('{bad json')).toThrow(/JSON/);
    expect(() => parsePersonalOwnerBindings('{"account":"alice"}')).toThrow(/数组/);
    expect(() => parsePersonalOwnerBindings('[{"account":"alice"}]')).toThrow(/kernel_user_id/);
  });
});
