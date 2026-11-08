// 第一轮个人记忆：HTTP 数据面真路径（真内核 + 真独立存储 + 真审计，非 mock）。
// 覆盖：会话门禁 / 501 诚实不可用 / owner 由会话决定 / 五个原子动作 / 审计与回执。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, registerAccount, resetAuthStore } from '../server.ts';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../../auth/hash.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { InMemoryPersonalStore } from '../../core/memagent/personalStore.ts';
import type { PersonalReceipt, PersonalSnapshot } from '../../core/memagent/personal.ts';

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
  return { status: r.status, body: (await r.json()) as { ok: boolean; result?: T; error?: string; reason?: string } };
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
});
