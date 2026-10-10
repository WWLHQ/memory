// T10 验收（提前规划的测试）：登录后端 HTTP 服务（零依赖，§4.1/§4.3）
// 对应 specs/tasks/HOME-LOGIN.md T10 「验收（提前规划的测试）」
// 真起 node:http 服务，覆盖 /api/login /api/logout /api/me + 锁定/审计/持久化。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../server.ts';
import type { Server } from 'node:http';
import { registerAccount, resetAuthStore } from '../server.ts';
import { hashPassword } from '../../auth/hash.ts';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ACCOUNT = 'user_001';
const TEAM = 'team_001';

let server: Server;
let base: string;
let tmp: string;
let dataFile: string;

async function listen(s: Server): Promise<string> {
  await new Promise<void>((r) => s.listen(0, () => r()));
  const addr = s.address() as { port: number };
  return `http://127.0.0.1:${addr.port}`;
}
async function close(s: Server): Promise<void> {
  await new Promise<void>((r) => s.close(() => r()));
}

function postLogin(url: string, account: string, password: string, sessionId?: string) {
  return fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(sessionId ? { 'x-session-id': sessionId } : {}) },
    body: JSON.stringify({ account, password, form: 'desktop' }),
  });
}

describe('T10 登录后端 HTTP 服务', () => {
  beforeEach(async () => {
    resetAuthStore();
    tmp = mkdtempSync(join(tmpdir(), 'home-srv-'));
    dataFile = join(tmp, 'audit.json');
    registerAccount(ACCOUNT, hashPassword('pw'), { enterprise_id: 'ent_001', team_id: TEAM, perspective: 'team' });
    server = createServer({ port: 0, dataFile });
    base = await listen(server);
  });
  afterEach(async () => {
    await close(server);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('POST /api/login 正确 → 200 + 返回 TenantContext', async () => {
    const r = await postLogin(base, ACCOUNT, 'pw');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { context: { user_id: string; team_id: string } };
    expect(body.context.user_id).toBe(ACCOUNT);
    expect(body.context.team_id).toBe(TEAM); // 管理员分配只读
  });

  it('密码错 → 401 + 审计含 login_fail', async () => {
    const r = await postLogin(base, ACCOUNT, 'wrong');
    expect(r.status).toBe(401);
    const audit = JSON.parse(readFileSync(dataFile, 'utf8')) as Array<{ action: string; account: string }>;
    expect(audit.some((a) => a.action === 'login_fail' && a.account === ACCOUNT)).toBe(true);
  });

  it('连续错 5 次 → 第 6 次 423', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await postLogin(base, ACCOUNT, 'wrong');
      expect(r.status).toBe(401);
    }
    const r6 = await postLogin(base, ACCOUNT, 'wrong');
    expect(r6.status).toBe(423);
  });

  it('账号不存在 → 401', async () => {
    const r = await postLogin(base, 'ghost', 'pw');
    expect(r.status).toBe(401);
  });

  it('POST /api/logout → 200 + 审计 logout', async () => {
    const loginRes = await postLogin(base, ACCOUNT, 'pw');
    const { sessionId } = (await loginRes.json()) as { sessionId: string };
    const r = await fetch(`${base}/api/logout`, {
      method: 'POST',
      headers: { 'x-session-id': sessionId },
    });
    expect(r.status).toBe(200);
    const audit = JSON.parse(readFileSync(dataFile, 'utf8')) as Array<{ action: string }>;
    expect(audit.some((a) => a.action === 'logout')).toBe(true);
  });

  it('GET /api/me：登录态返回 context，未登录 401', async () => {
    const loginRes = await postLogin(base, ACCOUNT, 'pw');
    const { sessionId } = (await loginRes.json()) as { sessionId: string };
    const me = await fetch(`${base}/api/me`, { headers: { 'x-session-id': sessionId } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { context: { user_id: string } };
    expect(body.context.user_id).toBe(ACCOUNT);

    const anon = await fetch(`${base}/api/me`);
    expect(anon.status).toBe(401);
  });

  it('持久化：重启后锁定表 / 审计保留（.data/）', async () => {
    // server1（beforeEach）：5 次错误登录 → 锁定落盘
    for (let i = 0; i < 5; i++) {
      const r = await postLogin(base, ACCOUNT, 'wrong');
      expect(r.status).toBe(401);
    }
    await close(server); // 模拟进程重启

    // 清内存并重启（同 dataFile），从文件恢复锁定表 + 审计
    resetAuthStore();
    registerAccount(ACCOUNT, hashPassword('pw'), { enterprise_id: 'ent_001', team_id: TEAM, perspective: 'team' });
    const server2 = createServer({ port: 0, dataFile });
    base = await listen(server2);
    server = server2; // 交由 afterEach 关闭

    // 重启后第 6 次 → 应从文件恢复锁定态 → 423
    const r6 = await postLogin(base, ACCOUNT, 'wrong');
    expect(r6.status).toBe(423);

    // 审计文件仍保留 login_fail 记录
    const audit = JSON.parse(readFileSync(dataFile, 'utf8')) as Array<{ action: string }>;
    expect(audit.filter((a) => a.action === 'login_fail').length).toBeGreaterThanOrEqual(5);
  });
});

describe('mirror 审计上抛端点（REQ-006 G6 持久账本）', () => {
  beforeEach(async () => {
    resetAuthStore();
    tmp = mkdtempSync(join(tmpdir(), 'home-srv-'));
    dataFile = join(tmp, 'audit.json');
    registerAccount(ACCOUNT, hashPassword('pw'), { enterprise_id: 'ent_001', team_id: TEAM, perspective: 'team' });
    server = createServer({ port: 0, dataFile });
    base = await listen(server);
  });

  it('POST /api/mirror/audit 上抛 → 200 + seq 自增；GET 回填可查', async () => {
    const r1 = await fetch(`${base}/api/mirror/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'memory', action: 'memory_forget', payload: { mem_id: 'mem_002', op: 'forget' } }),
    });
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { seq: number }).seq).toBe(1);

    const r2 = await fetch(`${base}/api/mirror/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'dispute', action: 'dispute', request_id: 'req_d1', payload: { old_id: 'a', new_id: 'b', verdict: 'auto_override' } }),
    });
    expect(((await r2.json()) as { seq: number }).seq).toBe(2);

    const q = (await (await fetch(`${base}/api/mirror/audit`)).json()) as { items: Array<{ source: string; action: string }>; total: number };
    expect(q.total).toBe(2);
    expect(q.items.map((i) => i.action)).toEqual(['memory_forget', 'dispute']);

    // source 过滤
    const q2 = (await (await fetch(`${base}/api/mirror/audit?source=memory`)).json()) as { items: unknown[]; total: number };
    expect(q2.items.length).toBe(1);
  });

  it('持久化：重启后 mirror 账本保留（home-mirror.json）', async () => {
    await fetch(`${base}/api/mirror/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'feedback', action: 'feedback', request_id: 'req_fb1' }),
    });
    await close(server);
    const server2 = createServer({ port: 0, dataFile });
    base = await listen(server2);
    server = server2;

    const q = (await (await fetch(`${base}/api/mirror/audit?source=feedback`)).json()) as { items: Array<{ request_id?: string }>; total: number };
    expect(q.total).toBe(1);
    expect(q.items[0].request_id).toBe('req_fb1');
  });

  it('缺字段容错：空 body → source/action 落 unknown，不 500', async () => {
    const r = await fetch(`${base}/api/mirror/audit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(200);
    const q = (await (await fetch(`${base}/api/mirror/audit`)).json()) as { items: Array<{ source: string; action: string }> };
    expect(q.items[0].source).toBe('unknown');
    expect(q.items[0].action).toBe('unknown');
  });
});
