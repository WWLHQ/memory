// 第一轮个人记忆本机闭环：独立存储 / 内核 API / 审计 / 召回准入。
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import { InMemoryPersonalStore, personalContentHash } from '../personalStore.ts';
import { FilePersonalStore } from '../personalStoreFile.ts';
import { PERSONAL_CONFIDENCE_DELTA, personalList, personalRecallScore, createPersonalApi } from '../personal.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

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
