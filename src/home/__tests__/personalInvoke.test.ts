// 第一轮个人记忆：HTTP 数据面真路径（真内核 + 真独立存储 + 真审计，非 mock）。
// 第二轮：显式授权上行走真实 PgSyncHub（非 mock）；失败如实回传 stage + code；owner 内核口径。
// 覆盖：会话门禁 / 501 诚实不可用 / owner 由会话决定 / 原子动作 / 审计与回执 / 同步上行与幂等。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, registerAccount, resetAuthStore } from '../server.ts';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../../auth/hash.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { InMemoryPersonalStore } from '../../core/memagent/personalStore.ts';
import type { PersonalReceipt, PersonalSnapshot, PersonalSyncReceipt } from '../../core/memagent/personal.ts';
import { PgSyncHub } from '../../core/memagent/pgSyncHub.ts';

const ACCOUNT = 'pm_user';

let server: Server;
let base: string;
let tmp: string;
let dataFile: string;
let storage: InMemoryStorage;
let store: InMemoryPersonalStore;

async function listen(s: Server): Promise<string> {
  await new Promise<void>((r) => s.listen(0, () => r()));
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}

async function login(): Promise<string> {
  const r = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: ACCOUNT, password: 'pw', form: 'desktop' }),
  });
  expect(r.status).toBe(200);
  return ((await r.json()) as { sessionId: string }).sessionId;
}

async function invoke<T>(sid: string, op: string, payload: Record<string, unknown> = {}) {
  const r = await fetch(`${base}/api/personal/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
    body: JSON.stringify({ op, payload }),
  });
  return { status: r.status, body: (await r.json()) as { ok: boolean; result?: T; error?: string; reason?: string; code?: string } };
}

async function closeServer(s: Server): Promise<void> {
  await new Promise<void>((r) => s.close(() => r()));
}

describe('个人记忆 HTTP 数据面（真实内核）', () => {
  beforeEach(async () => {
    resetAuthStore();
    tmp = mkdtempSync(join(tmpdir(), 'pm-http-'));
    dataFile = join(tmp, 'audit.json');
    registerAccount(ACCOUNT, hashPassword('pw'), { enterprise_id: 'ent_pm', team_id: 'team_pm', perspective: 'team' });
    storage = new InMemoryStorage();
    store = new InMemoryPersonalStore();
    server = createServer({ port: 0, dataFile, kernelStorage: storage, personalStore: store });
    base = await listen(server);
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(tmp, { recursive: true, force: true });
  });

  it('匿名 401；未挂独立存储 501（诚实不可用）', async () => {
    const anon = await fetch(`${base}/api/personal/invoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'list' }),
    });
    expect(anon.status).toBe(401);

    const tmp2 = mkdtempSync(join(tmpdir(), 'pm-http-none-'));
    const bare = createServer({ port: 0, dataFile: join(tmp2, 'a.json'), kernelStorage: storage });
    const bareBase = await listen(bare);
    try {
      const r = await fetch(`${bareBase}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: ACCOUNT, password: 'pw', form: 'desktop' }),
      });
      const sid = ((await r.json()) as { sessionId: string }).sessionId;
      const res = await fetch(`${bareBase}/api/personal/invoke`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
        body: JSON.stringify({ op: 'list' }),
      });
      expect(res.status).toBe(501);
    } finally {
      await new Promise<void>((r) => bare.close(() => r()));
      rmSync(tmp2, { recursive: true, force: true });
    }
  });

  it('owner 取会话：请求体自报 owner 被忽略', async () => {
    const sid = await login();
    const r = await invoke<PersonalReceipt>(sid, 'quick_add', { content: '我的私人偏好：深色主题', owner: 'someone_else' });
    expect(r.body.ok).toBe(true);
    expect(r.body.result?.entry.owner).toBe(ACCOUNT);
    expect(r.body.result?.request_id).toMatch(/^pm_/);
  });

  it('quick_add → confirm → revoke → reject → delete（二次确认）+ 审计逐条可查', async () => {
    const sid = await login();
    const add = await invoke<PersonalReceipt>(sid, 'quick_add', { content: '部署习惯：先跑全量测试' });
    const id = add.body.result!.entry.id;

    let snap = await invoke<PersonalSnapshot>(sid, 'list');
    expect(snap.body.result?.counts.pending_quick).toBe(1);

    const conf = await invoke<PersonalReceipt>(sid, 'confirm', { id });
    expect(conf.body.result?.entry.state).toBe('confirmed');
    expect(conf.body.result?.entry.confirmed_at).toBeTypeOf('number');

    const rev = await invoke<PersonalReceipt>(sid, 'revoke', { id });
    expect(rev.body.result?.entry.state).toBe('pending');

    const rej = await invoke<PersonalReceipt>(sid, 'reject', { id });
    expect(rej.body.result?.entry.state).toBe('rejected');
    const undo = await invoke<PersonalReceipt>(sid, 'revoke', { id });
    expect(undo.body.result?.entry.state).toBe('pending');

    const nope = await invoke<PersonalReceipt>(sid, 'delete', { id, confirm: false });
    expect(nope.body.ok).toBe(false);
    expect(nope.body.error).toMatch(/二次确认/);

    const del = await invoke<PersonalReceipt>(sid, 'delete', { id, confirm: true });
    expect(del.body.result?.entry.deleted).toBe(true);

    snap = await invoke<PersonalSnapshot>(sid, 'list');
    expect(snap.body.result?.counts.pending).toBe(0);
    expect(snap.body.result?.counts.confirmed).toBe(0);
    expect(snap.body.result?.counts.rejected).toBe(0);

    // 真实审计：五个写动作各一条 personal_memory，且不含正文
    const audits = await storage.queryAudit({ action: 'personal_memory' });
    const ops = audits.map((a) => (a.detail as { op?: string }).op);
    expect(ops).toEqual(expect.arrayContaining(['quick_add', 'confirm', 'revoke', 'reject', 'delete']));
    expect(JSON.stringify(audits)).not.toContain('部署习惯：先跑全量测试');
    const confAudit = audits.find((a) => (a.detail as { op?: string }).op === 'confirm');
    const confDetail = (confAudit?.detail ?? {}) as { confidence_delta?: number };
    expect(confDetail.confidence_delta).toBe(0.1);
  });

  it('第二轮 HTTP：未接中枢时上行如实回传阶段 + 错误码（ok 但 sync.outcome=failed，绝不「已同步」）', async () => {
    const sid = await login();
    const add = await invoke<PersonalReceipt>(sid, 'quick_add', { content: '中枢未接线时的个人条目' });
    const id = add.body.result!.entry.id;
    await invoke<PersonalReceipt>(sid, 'confirm', { id });

    // 未显式授权：拒绝且带错误码
    const denied = await invoke<PersonalSyncReceipt>(sid, 'push_team', { id, explicit: false });
    expect(denied.body.ok).toBe(false);
    expect(denied.body.code).toBe('E_SYNC_NOT_AUTHORIZED');

    const r = await invoke<PersonalSyncReceipt>(sid, 'push_team', { id, explicit: true });
    expect(r.body.ok).toBe(true);
    expect(r.body.result?.sync).toMatchObject({
      outcome: 'failed', stage: 'hub_init', code: 'E_SYNC_HUB_UNAVAILABLE',
    });
    expect(r.body.result?.entry.sync_state).toBe('failed');
    expect(r.body.result?.entry.sync_error?.stage).toBe('hub_init');
    expect(r.body.result?.entry.sync_result).toBeNull();

    const snap = await invoke<PersonalSnapshot>(sid, 'list');
    expect(snap.body.result?.counts.sync_failed).toBe(1);
    expect(snap.body.result?.counts.synced).toBe(0);
    expect(snap.body.result?.sync_queue.map((e) => e.id)).toContain(id);
  });

  it('第二轮 HTTP：显式授权 → 真实 PgSyncHub 落账；重复上行按 sha256/mem_id 幂等，不产生重复条目', async () => {
    await closeServer(server);
    const hub = new PgSyncHub();
    await hub.init();
    server = createServer({ port: 0, dataFile, kernelStorage: storage, personalStore: store, personalSyncHub: hub });
    base = await listen(server);
    try {
      const sid = await login();
      const add = await invoke<PersonalReceipt>(sid, 'quick_add', { content: 'HTTP 链路真实上行条目' });
      const id = add.body.result!.entry.id;
      await invoke<PersonalReceipt>(sid, 'confirm', { id });

      const ok = await invoke<PersonalSyncReceipt>(sid, 'push_team', { id, explicit: true });
      expect(ok.body.result?.sync.outcome).toBe('synced');
      expect(ok.body.result?.sync.result).toBe('applied');
      expect(ok.body.result?.entry.sync_state).toBe('synced');
      expect(ok.body.result?.entry.team_shared).toBe(true);
      expect(ok.body.result?.entry.team_id).toBe('team_pm');

      const again = await invoke<PersonalSyncReceipt>(sid, 'push_team', { id, explicit: true });
      expect(again.body.result?.sync.outcome).toBe('synced');
      const rec = await hub.reconcile({ team_id: 'team_pm' });
      expect(rec.items.filter((m) => m.mem_id === `pm:${id}`)).toHaveLength(1);
      expect(rec.items.find((m) => m.mem_id === `pm:${id}`)?.sha256).toBe(ok.body.result?.entry.sha256);

      // 跨团队目标：拒绝（不把个人条目丢到别的团队）
      const wrongTeam = await invoke<PersonalSyncReceipt>(sid, 'push_team', { id, explicit: true, team_id: 'team_other' });
      expect(wrongTeam.body.ok).toBe(false);
      expect(wrongTeam.body.code).toBe('E_SYNC_TEAM_MISMATCH');

      // 真实内核审计：上行审计带 sha256 / 结果口径，且不复制正文
      const audits = await storage.queryAudit({ action: 'personal_memory' });
      const pushAudits = audits.filter((a) => (a.detail as { op?: string }).op === 'push_team');
      expect(pushAudits.length).toBeGreaterThanOrEqual(2);
      expect((pushAudits[0].detail as { sync_outcome?: string }).sync_outcome).toBe('synced');
      expect(JSON.stringify(audits)).not.toContain('HTTP 链路真实上行条目');
    } finally {
      await hub.close();
    }
  });

  it('第二轮 HTTP owner 口径：绑定内核账号后按内核 user_id 写入；未绑定不改写但如实标记 bound=false', async () => {
    // 已绑定：账号 pm_user → 内核 u_kernel
    await closeServer(server);
    server = createServer({
      port: 0, dataFile, kernelStorage: storage, personalStore: store,
      personalKernelUserId: 'u_kernel',
      personalOwnerBindings: [{ account: ACCOUNT, kernel_user_id: 'u_kernel' }],
    });
    base = await listen(server);
    const sid2 = await login();
    const add = await invoke<PersonalReceipt>(sid2, 'quick_add', { content: '绑定内核账号后的条目' });
    expect(add.body.result?.entry.owner).toBe('u_kernel');
    const snap = await invoke<PersonalSnapshot>(sid2, 'list');
    expect(snap.body.result?.owner_binding).toMatchObject({
      owner: 'u_kernel', login_account: ACCOUNT, kernel_user_id: 'u_kernel', bound: true, via: 'binding',
    });

    // 未绑定（不同名、无绑定表）：条目仍按登录账号本机可用，但 bound=false（不静默并号）
    const store2 = new InMemoryPersonalStore();
    const tmp2 = mkdtempSync(join(tmpdir(), 'pm-http-owner-'));
    const s2 = createServer({
      port: 0, dataFile: join(tmp2, 'a.json'), kernelStorage: new InMemoryStorage(), personalStore: store2,
      personalKernelUserId: 'u_kernel',
    });
    const b2 = await listen(s2);
    try {
      const r = await fetch(`${b2}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: ACCOUNT, password: 'pw', form: 'desktop' }),
      });
      const sid2 = ((await r.json()) as { sessionId: string }).sessionId;
      const r2 = await fetch(`${b2}/api/personal/invoke`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid2 },
        body: JSON.stringify({ op: 'quick_add', payload: { content: '未绑定内核账号的条目' } }),
      });
      const body2 = (await r2.json()) as { ok: boolean; result?: PersonalReceipt };
      expect(body2.ok).toBe(true);
      expect(body2.result?.entry.owner).toBe(ACCOUNT);
      const snap2 = await fetch(`${b2}/api/personal/invoke`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid2 },
        body: JSON.stringify({ op: 'list' }),
      }).then((x) => x.json()) as { result?: PersonalSnapshot };
      expect(snap2.result?.owner_binding).toMatchObject({ owner: ACCOUNT, bound: false, via: 'unbound' });
    } finally {
      await closeServer(s2);
      rmSync(tmp2, { recursive: true, force: true });
    }
  });
});
