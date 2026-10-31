// 批次7：管理员账号管理 HTTP 端点（home/server）集成测试。
// 覆盖：/api/accounts、/api/accounts/update、/api/password 的鉴权矩阵（无会话 401 / 非管理员 403）、
//      角色与团队变更、最后一个管理员保护、改密规则、审计与动作日志、重启存活。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createServer } from '../server.ts';
import { registerAccount, resetAuthStore, ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD } from '../../auth/loginService.ts';
import { hashPassword } from '../../auth/hash.ts';
import type { TenantContext } from '../../types/home.ts';

const MEMBER = 'member_1';
const MEMBER_PWD = 'member-pw-1';

let server: Server;
let base: string;
let tmp: string;
let dataFile: string;
let logs: Array<{ scope: string; action: string; detail?: Record<string, unknown> }>;

async function listen(s: Server): Promise<string> {
  await new Promise<void>((r) => s.listen(0, () => r()));
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}

async function start(opts: { seedAdmin?: boolean; adminPassword?: string } = {}): Promise<void> {
  server = createServer({
    port: 0,
    dataFile,
    seedAdmin: opts.seedAdmin,
    adminPassword: opts.adminPassword,
    onLog: (scope, action, detail) => logs.push({ scope, action, detail }),
  });
  base = await listen(server);
}

async function login(account: string, password: string): Promise<{ status: number; sessionId?: string; context?: TenantContext }> {
  const r = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password, form: 'desktop' }),
  });
  const body = (await r.json()) as { sessionId?: string; context?: TenantContext };
  return { status: r.status, ...body };
}

function authed(sid: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { 'Content-Type': 'application/json', 'x-session-id': sid, ...init.headers } };
}

async function adminSid(): Promise<string> {
  const r = await login(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD);
  expect(r.status).toBe(200);
  expect(r.context?.role).toBe('admin');
  return r.sessionId!;
}

async function memberSid(): Promise<string> {
  const r = await login(MEMBER, MEMBER_PWD);
  expect(r.status).toBe(200);
  expect(r.context?.role).toBe('member');
  return r.sessionId!;
}

describe('批次7 管理员账号管理（home server）', () => {
  beforeEach(() => {
    resetAuthStore();
    tmp = mkdtempSync(join(tmpdir(), 'home-admin-'));
    dataFile = join(tmp, 'audit.json');
    logs = [];
    registerAccount(MEMBER, hashPassword(MEMBER_PWD), { enterprise_id: 'ent', team_id: 'team_a', perspective: 'team' });
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    resetAuthStore();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('播种管理员可登录（默认密码），/api/accounts 返回脱敏列表且管理员排最前', async () => {
    await start();
    const sid = await adminSid();
    const r = await fetch(`${base}/api/accounts`, authed(sid));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; items: Array<Record<string, unknown>> };
    expect(body.ok).toBe(true);
    expect(body.items.map((i) => i.account)).toEqual([ADMIN_ACCOUNT, MEMBER]);
    expect(body.items[0].role).toBe('admin');
    expect(body.items[1].role).toBe('member');
    expect(JSON.stringify(body.items)).not.toContain('passwordHash');
  });

  it('未登录 401；普通成员 403（列表与变更都拒绝），并记录 forbidden 日志', async () => {
    await start();
    await adminSid();
    expect((await fetch(`${base}/api/accounts`)).status).toBe(401);

    const sid = await memberSid();
    expect((await fetch(`${base}/api/accounts`, authed(sid))).status).toBe(403);

    const upd = await fetch(`${base}/api/accounts/update`, authed(sid, {
      method: 'POST', body: JSON.stringify({ account: MEMBER, role: 'admin' }),
    }));
    expect(upd.status).toBe(403);

    await new Promise((r) => setTimeout(r, 0));
    expect(logs.some((l) => l.action === 'accounts_forbidden')).toBe(true);
    expect(logs.some((l) => l.action === 'accounts_update_forbidden')).toBe(true);
  });

  it('管理员提升成员为 admin → 审计 role_change 落盘，新会话 role=admin', async () => {
    await start();
    const sid = await adminSid();
    const r = await fetch(`${base}/api/accounts/update`, authed(sid, {
      method: 'POST', body: JSON.stringify({ account: MEMBER, role: 'admin' }),
    }));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { items: Array<{ account: string; role: string }> };
    expect(body.items.find((i) => i.account === MEMBER)?.role).toBe('admin');

    const audit = JSON.parse(readFileSync(dataFile, 'utf8')) as Array<{ action: string; account: string }>;
    expect(audit.some((a) => a.action === 'role_change' && a.account === MEMBER)).toBe(true);

    expect((await login(MEMBER, MEMBER_PWD)).context?.role).toBe('admin');
  });

  it('不能降级最后一个管理员（400 + 明确错误）', async () => {
    await start();
    const sid = await adminSid();
    const r = await fetch(`${base}/api/accounts/update`, authed(sid, {
      method: 'POST', body: JSON.stringify({ account: ADMIN_ACCOUNT, role: 'member' }),
    }));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain('最后一个管理员');
  });

  it('管理员分配团队 → 审计 team_assign，成员重新登录即用新团队', async () => {
    await start();
    const sid = await adminSid();
    const r = await fetch(`${base}/api/accounts/update`, authed(sid, {
      method: 'POST', body: JSON.stringify({ account: MEMBER, team_id: 'team_b' }),
    }));
    expect(r.status).toBe(200);
    expect((await login(MEMBER, MEMBER_PWD)).context?.team_id).toBe('team_b');

    const audit = JSON.parse(readFileSync(dataFile, 'utf8')) as Array<{ action: string; account: string }>;
    expect(audit.some((a) => a.action === 'team_assign' && a.account === MEMBER)).toBe(true);
  });

  it('目标不存在 404；role/team_id 都没给 400；空团队 400', async () => {
    await start();
    const sid = await adminSid();
    expect((await fetch(`${base}/api/accounts/update`, authed(sid, {
      method: 'POST', body: JSON.stringify({ account: 'ghost', role: 'admin' }),
    }))).status).toBe(404);

    expect((await fetch(`${base}/api/accounts/update`, authed(sid, {
      method: 'POST', body: JSON.stringify({ account: MEMBER }),
    }))).status).toBe(400);

    expect((await fetch(`${base}/api/accounts/update`, authed(sid, {
      method: 'POST', body: JSON.stringify({ account: MEMBER, team_id: '  ' }),
    }))).status).toBe(400);
  });

  it('改密：无会话 401 / 旧密码错 401 / 过短 400 / 同旧 400 / 成功 200 → 新密码可登录', async () => {
    await start();
    const sid = await memberSid();

    expect((await fetch(`${base}/api/password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: MEMBER_PWD, newPassword: 'NewPass#123' }),
    })).status).toBe(401);

    const change = (oldPassword: string, newPassword: string) =>
      fetch(`${base}/api/password`, authed(sid, { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }));

    expect((await change('wrong', 'NewPass#123')).status).toBe(401);
    expect((await change(MEMBER_PWD, 'short')).status).toBe(400);
    expect((await change(MEMBER_PWD, MEMBER_PWD)).status).toBe(400);

    expect((await change(MEMBER_PWD, 'NewPass#123')).status).toBe(200);
    expect((await login(MEMBER, MEMBER_PWD)).status).toBe(401);
    expect((await login(MEMBER, 'NewPass#123')).status).toBe(200);

    const audit = JSON.parse(readFileSync(dataFile, 'utf8')) as Array<{ action: string }>;
    expect(audit.some((a) => a.action === 'password_change')).toBe(true);
    expect(logs.some((l) => l.action === 'password_change')).toBe(true);
  });

  it('seedAdmin:false 不播种（成员访问管理员接口 403）', async () => {
    await start({ seedAdmin: false });
    const sid = await memberSid();
    expect((await fetch(`${base}/api/accounts`, authed(sid))).status).toBe(403);
  });

  it('重启后账号与角色保留（home-accounts.json），且不覆盖已有管理员密码', async () => {
    await start();
    const admin = await adminSid();
    await fetch(`${base}/api/accounts/update`, authed(admin, {
      method: 'POST', body: JSON.stringify({ account: MEMBER, team_id: 'team_persist' }),
    }));
    await new Promise<void>((r) => server.close(() => r()));

    // 模拟进程重启；admin 已存在 → 传入的新口令不生效（绝不覆盖）
    resetAuthStore();
    await start({ seedAdmin: true, adminPassword: 'Boot#2026' });
    expect((await login(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD)).context?.role).toBe('admin');
    expect((await login(ADMIN_ACCOUNT, 'Boot#2026')).status).toBe(401);
    const restored = await login(MEMBER, MEMBER_PWD);
    expect(restored.context?.role).toBe('member');
    expect(restored.context?.team_id).toBe('team_persist');
  });

  it('每个 HTTP 请求都产出 home:http 动作日志（method/path/status 可检索）', async () => {
    await start();
    const sid = await adminSid();
    await fetch(`${base}/api/accounts`, authed(sid));
    await new Promise((r) => setTimeout(r, 10));
    const httpLogs = logs.filter((l) => l.scope === 'home' && l.action === 'http');
    expect(httpLogs.length).toBeGreaterThanOrEqual(2); // login + accounts
    expect(httpLogs.some((l) => l.detail?.path === '/api/accounts' && l.detail?.status === 200)).toBe(true);
    expect(httpLogs.every((l) => typeof l.detail?.ms === 'number')).toBe(true);
  });
});

// 批次26-B P1-9：角色/团队/密码变更必须吊销目标账号全部会话（旧会话最长可活 12h，撤权不能留窗口）
describe('批次26-B P1-9 变更吊销会话（home server）', () => {
  beforeEach(() => {
    resetAuthStore();
    tmp = mkdtempSync(join(tmpdir(), 'home-revoke-'));
    dataFile = join(tmp, 'audit.json');
    logs = [];
    registerAccount(MEMBER, hashPassword(MEMBER_PWD), { enterprise_id: 'ent', team_id: 'team_a', perspective: 'team' });
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    resetAuthStore();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('角色变更后目标账号旧会话立即 401，重新登录拿到新角色', async () => {
    await start();
    await adminSid();
    const oldMemberSid = await memberSid();

    const r = await fetch(`${base}/api/accounts/update`, authed((await login(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD)).sessionId!, {
      method: 'POST', body: JSON.stringify({ account: MEMBER, role: 'admin' }),
    }));
    expect(r.status).toBe(200);

    // 旧会话立即失效
    expect((await fetch(`${base}/api/me`, { headers: { 'x-session-id': oldMemberSid } })).status).toBe(401);
    // 重新登录拿到新角色
    expect((await login(MEMBER, MEMBER_PWD)).context?.role).toBe('admin');
    expect(logs.some((l) => l.action === 'sessions_revoked' && l.detail?.user === MEMBER)).toBe(true);
  });

  it('团队变更后目标账号旧会话立即 401', async () => {
    await start();
    await adminSid();
    const oldMemberSid = await memberSid();

    const r = await fetch(`${base}/api/accounts/update`, authed((await login(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD)).sessionId!, {
      method: 'POST', body: JSON.stringify({ account: MEMBER, team_id: 'team_b' }),
    }));
    expect(r.status).toBe(200);

    expect((await fetch(`${base}/api/me`, { headers: { 'x-session-id': oldMemberSid } })).status).toBe(401);
    expect((await login(MEMBER, MEMBER_PWD)).context?.team_id).toBe('team_b');
  });

  it('改密后该账号全部会话（含当前）失效，须用新密码重新登录', async () => {
    await start();
    const sid = await memberSid();

    const r = await fetch(`${base}/api/password`, authed(sid, {
      method: 'POST', body: JSON.stringify({ oldPassword: MEMBER_PWD, newPassword: 'NewPass#123' }),
    }));
    expect(r.status).toBe(200);

    // 当前会话也已吊销
    expect((await fetch(`${base}/api/me`, { headers: { 'x-session-id': sid } })).status).toBe(401);
    expect((await login(MEMBER, 'NewPass#123')).status).toBe(200);
    expect(logs.some((l) => l.action === 'sessions_revoked' && l.detail?.user === MEMBER)).toBe(true);
  });
});
