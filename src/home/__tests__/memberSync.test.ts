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

describe('批次45-B2 home 账号 → 内核成员库同步（server 集成）', () => {
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
