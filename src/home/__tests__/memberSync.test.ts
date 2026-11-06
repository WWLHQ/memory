// 批次45-B2 home server ↔ 内核成员库集成测试：
// memberStore 注入后——启动首帧对账登记存量账号、注册新账号即时同步、角色/团队变更跟随、
// 角色变更审计经 /api/accounts/update（admin 专属）后内核 Member.role 跟随。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createServer } from '../server.ts';
import { registerAccount, resetAuthStore, ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD } from '../../auth/loginService.ts';
import { hashPassword } from '../../auth/hash.ts';
import { InMemoryMemberStore } from '../../core/memagent/memberStore.ts';

let server: Server;
let base: string;
let tmp: string;
let dataFile: string;
let store: InMemoryMemberStore;

async function listen(s: Server): Promise<string> {
  await new Promise<void>((r) => s.listen(0, () => r()));
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}

async function login(account: string, password: string): Promise<{ status: number; sessionId?: string }> {
  const r = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password, form: 'desktop' }),
  });
  const body = (await r.json()) as { sessionId?: string };
  return { status: r.status, ...body };
}

// 共享钩子必须是**文件级**（曾经误放在第一个 describe 内部，导致 B3 用例缺少重置、
// 前一个用例的 carol=admin 状态跨 describe 泄漏——vitest 的 describe 级钩子只作用于本 describe）。
beforeEach(() => {
  resetAuthStore();
  tmp = mkdtempSync(join(tmpdir(), 'home-membersync-'));
  dataFile = join(tmp, 'audit.json');
  store = new InMemoryMemberStore();
  registerAccount('carol', hashPassword('carol-pw'), { enterprise_id: 'local', team_id: 'team_c', perspective: 'personal' });
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  resetAuthStore();
  rmSync(tmp, { recursive: true, force: true });
});

describe('批次45-B2 home 账号 → 内核成员库同步（server 集成）', () => {
  it('启动首帧对账：存量账号登记进内核成员库；注册新账号即时同步', async () => {
    server = createServer({
      port: 0, dataFile, seedAdmin: true, memberStore: store,
      onLog: () => {},
    });
    base = await listen(server);
    // 启动对账：admin（播种）+ carol（存量）都在
    expect(store.getMember(ADMIN_ACCOUNT)).toMatchObject({ role: 'admin', user_id: ADMIN_ACCOUNT });
    expect(store.getMember('carol')).toMatchObject({ role: 'member', team_id: 'team_c' });
    // 注册新账号 → persistAccounts 汇聚点触发同步（注册要求手机号/邮箱格式 + 验证码）
    const cap = (await (await fetch(`${base}/api/captcha`)).json()) as { id: string; code: string };
    const reg = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: '13800000001', password: 'dave-pw-123', confirmPassword: 'dave-pw-123',
        captchaCode: cap.code, captchaId: cap.id, form: 'desktop',
      }),
    });
    expect(reg.status).toBe(200);
    expect(store.getMember('13800000001')).toMatchObject({ role: 'member', team_id: 'personal-13800000001' });
  });

  it('角色变更（/api/accounts/update，admin）→ 内核 Member.role 跟随；不注入 memberStore 时内核域不受影响', async () => {
    server = createServer({ port: 0, dataFile, seedAdmin: true, memberStore: store, onLog: () => {} });
    base = await listen(server);
    const sid = (await login(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD)).sessionId!;
    expect(sid).toBeTruthy();
    const upd = await fetch(`${base}/api/accounts/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ account: 'carol', role: 'admin' }),
    });
    expect(upd.status).toBe(200);
    expect(store.getMember('carol')!.role).toBe('admin'); // 内核域跟随 home 真源
  });
});

describe('批次45-B3 /api/keys 管理端点（admin 专属）', () => {
  beforeEach(() => {
    server = createServer({ port: 0, dataFile, seedAdmin: true, memberStore: store, onLog: () => {} });
  });

  async function start(): Promise<void> { base = await listen(server); }
  async function adminLogin(): Promise<string> {
    const r = await login(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD);
    expect(r.status).toBe(200);
    return r.sessionId!;
  }

  it('mint → 明文一次性回显、库中仅哈希；list 只见元数据；revoke 后密钥失效', async () => {
    await start();
    const sid = await adminLogin();
    // mint：member 角色（carol，启动对账已同步）+ '*' → 库层拒签（400 带 45-A3 文案）
    const bad = await fetch(`${base}/api/keys/mint`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ owner_member_id: 'carol', scope_project_ids: ['*'] }),
    });
    console.log('DEBUG bad body:', JSON.stringify(await bad.json()), 'store carol:', JSON.stringify(store.getMember('carol')));
    expect(bad.status).toBe(400);
    // admin 角色成员 + 显式 scope → 200
    const mint = await fetch(`${base}/api/keys/mint`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ owner_member_id: ADMIN_ACCOUNT, scope_project_ids: ['P1'], label: 'cli' }),
    });
    expect(mint.status).toBe(200);
    const mintBody = (await mint.json()) as { key: string; record: { key_id: string; secret_hash?: string } };
    expect(mintBody.key).toMatch(/^apk_[0-9a-f]{64}$/);
    expect(mintBody.record.secret_hash).toBeUndefined(); // 响应不带哈希
    // 明文不在成员库文件/记录里（list 视图无 hash 无明文）
    const list = await fetch(`${base}/api/keys`, { headers: { 'x-session-id': sid } });
    const listBody = (await list.json()) as { items: Array<{ key_id: string; secret_hash?: string }> };
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0].key_id).toBe(mintBody.record.key_id);
    expect(listBody.items[0].secret_hash).toBeUndefined();
    // revoke → 密钥失效
    const revoke = await fetch(`${base}/api/keys/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ key_id: mintBody.record.key_id }),
    });
    expect(revoke.status).toBe(200);
    expect(store.resolveSecret(mintBody.key)).toBeNull();
    // revoke 不存在的 key → 404
    const again = await fetch(`${base}/api/keys/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ key_id: 'key_nobody' }),
    });
    expect(again.status).toBe(404);
  });

  it('非 admin 会话 → 403；无会话 → 401；owner 不存在 → 400', async () => {
    await start();
    // 无会话
    const noSid = await fetch(`${base}/api/keys`);
    expect(noSid.status).toBe(401);
    // member 会话（注册 + 登录）
    const cap = (await (await fetch(`${base}/api/captcha`)).json()) as { id: string; code: string };
    await fetch(`${base}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: '13800000002', password: 'member-pw-9', confirmPassword: 'member-pw-9',
        captchaCode: cap.code, captchaId: cap.id, form: 'desktop',
      }),
    });
    const mem = await login('13800000002', 'member-pw-9');
    expect(mem.sessionId).toBeTruthy();
    const forbidden = await fetch(`${base}/api/keys`, { headers: { 'x-session-id': mem.sessionId! } });
    expect(forbidden.status).toBe(403);
    const forbiddenMint = await fetch(`${base}/api/keys/mint`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': mem.sessionId! },
      body: JSON.stringify({ owner_member_id: ADMIN_ACCOUNT, scope_project_ids: ['P1'] }),
    });
    expect(forbiddenMint.status).toBe(403);
    // admin mint 到不存在的 owner → 400（store 校验冒泡为文案）
    const sid = await adminLogin();
    const noOwner = await fetch(`${base}/api/keys/mint`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ owner_member_id: 'nobody', scope_project_ids: ['P1'] }),
    });
    expect(noOwner.status).toBe(400);
  });
});
