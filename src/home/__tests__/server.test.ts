// T10 验收（提前规划的测试）：登录后端 HTTP 服务（零依赖，§4.1/§4.3）
// 对应 specs/tasks/HOME-LOGIN.md T10 「验收（提前规划的测试）」
// 真起 node:http 服务，覆盖 /api/login /api/logout /api/me + 锁定/审计/持久化。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../server.ts';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { registerAccount, resetAuthStore } from '../server.ts';
import { ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD } from '../../auth/loginService.ts';
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

/** 每次注册都取一次性验证码（服务端 GET /api/captcha 直出本机码） */
async function postRegister(url: string, account: string, password: string, confirmPassword = password) {
  const cap = (await (await fetch(`${url}/api/captcha`)).json()) as { id: string; code: string };
  return fetch(`${url}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password, confirmPassword, captchaCode: cap.code, captchaId: cap.id }),
  });
}

function readAccounts(tmpDir: string): Array<{ account: string; passwordHash: string }> {
  return JSON.parse(readFileSync(join(tmpDir, 'home-accounts.json'), 'utf8')) as Array<{ account: string; passwordHash: string }>;
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

// 批次2：信任边界（登出会话失效 / 验证码过期 / 请求体上限）
describe('批次2 信任边界（home server）', () => {
  beforeEach(async () => {
    resetAuthStore();
    tmp = mkdtempSync(join(tmpdir(), 'home-srv-'));
    dataFile = join(tmp, 'audit.json');
    registerAccount(ACCOUNT, hashPassword('pw'), { enterprise_id: 'ent_001', team_id: TEAM, perspective: 'team' });
    server = createServer({ port: 0, dataFile, captchaTtlMs: 5, maxBodyBytes: 1024 });
    base = await listen(server);
  });
  afterEach(async () => {
    await close(server);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('旧版 X-Auth-Session 头也可登出，且会话立即失效（/api/me → 401）', async () => {
    const loginRes = await postLogin(base, ACCOUNT, 'pw');
    const { sessionId } = (await loginRes.json()) as { sessionId: string };

    const r = await fetch(`${base}/api/logout`, {
      method: 'POST',
      headers: { 'x-auth-session': sessionId },
    });
    expect(r.status).toBe(200);

    const me = await fetch(`${base}/api/me`, { headers: { 'x-session-id': sessionId } });
    expect(me.status).toBe(401);
  });

  it('验证码过期 → 注册 400 invalid_captcha（不能复用过期码）', async () => {
    const cap = (await (await fetch(`${base}/api/captcha`)).json()) as { id: string; code: string };
    await new Promise((r) => setTimeout(r, 20));
    const r = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: 'late@example.com', password: 'secret123', confirmPassword: 'secret123',
        captchaCode: cap.code, captchaId: cap.id,
      }),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { reason: string }).reason).toBe('invalid_captcha');
  });

  it('请求体超过上限 → 413（不再无限累积内存）', async () => {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: ACCOUNT, password: 'x'.repeat(2000), form: 'desktop' }),
    });
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: string }).error).toBe('payload_too_large');
  });
});

// A1：注册接口不得成为账号接管 / 锁死 / 审计污染的入口
describe('A1 注册接口：不接管、不锁死、不污染登录审计', () => {
  beforeEach(async () => {
    resetAuthStore();
    tmp = mkdtempSync(join(tmpdir(), 'home-srv-'));
    dataFile = join(tmp, 'audit.json');
    server = createServer({ port: 0, dataFile });
    base = await listen(server);
  });
  afterEach(async () => {
    await close(server);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('新账号注册 → 200 + personal team_id；随后可用新密码登录；审计记 team_assign 而非 login', async () => {
    const r = await postRegister(base, 'newbie@example.com', 'secret123');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; team_id: string };
    expect(body.ok).toBe(true);
    expect(body.team_id).toBe('personal-newbie@example.com');

    expect((await postLogin(base, 'newbie@example.com', 'secret123')).status).toBe(200);

    const audit = JSON.parse(readFileSync(dataFile, 'utf8')) as Array<{ action: string; account: string }>;
    expect(audit.some((a) => a.action === 'team_assign' && a.account === 'newbie@example.com')).toBe(true);
    // 注册动作不得伪装成 login：该账号只有 1 条真实登录记录
    expect(audit.filter((a) => a.account === 'newbie@example.com' && a.action === 'login').length).toBe(1);
  });

  it('已存在账号重复注册 → 409，passwordHash 不被覆盖，新密码不能登录', async () => {
    expect((await postRegister(base, 'dup@example.com', 'oldpass1')).status).toBe(200);
    const hashBefore = readAccounts(tmp).find((a) => a.account === 'dup@example.com')!.passwordHash;

    const again = await postRegister(base, 'dup@example.com', 'newpass2');
    expect(again.status).toBe(409);
    expect(((await again.json()) as { reason: string }).reason).toBe('exists');

    expect(readAccounts(tmp).find((a) => a.account === 'dup@example.com')!.passwordHash).toBe(hashBefore);
    expect((await postLogin(base, 'dup@example.com', 'newpass2')).status).toBe(401);
    expect((await postLogin(base, 'dup@example.com', 'oldpass1')).status).toBe(200);
  });

  it('注册探测不计失败：连续 5 次重复注册后仍可正常登录（不被锁）', async () => {
    expect((await postRegister(base, 'probe@example.com', 'rightpass')).status).toBe(200);
    for (let i = 0; i < 5; i++) {
      expect((await postRegister(base, 'probe@example.com', `wrongpass${i}`)).status).toBe(409);
    }
    expect((await postLogin(base, 'probe@example.com', 'rightpass')).status).toBe(200);
  });

  it('锁定账号注册试探 → 409，且不重置锁定（正确密码仍 423）', async () => {
    expect((await postRegister(base, 'locked@example.com', 'goodpass')).status).toBe(200);
    for (let i = 0; i < 5; i++) {
      expect((await postLogin(base, 'locked@example.com', 'bad')).status).toBe(401);
    }
    expect((await postRegister(base, 'locked@example.com', 'hijack1')).status).toBe(409);
    // 注册没走 login()，锁定态与密码均未被改动
    expect((await postLogin(base, 'locked@example.com', 'goodpass')).status).toBe(423);
  });
});

// A5：本机服务跨源闸门（禁止 *，只放行白名单 Origin）
describe('A5 跨源闸门（home server）', () => {
  const ALLOWED = 'http://localhost:8124';
  const EVIL = 'http://evil.example';

  beforeEach(async () => {
    resetAuthStore();
    tmp = mkdtempSync(join(tmpdir(), 'home-srv-'));
    dataFile = join(tmp, 'audit.json');
    server = createServer({ port: 0, dataFile, allowedOrigins: [ALLOWED] });
    base = await listen(server);
  });
  afterEach(async () => {
    await close(server);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('非白名单 Origin → 403，且 mirror 账本不被写入', async () => {
    const r = await fetch(`${base}/api/mirror/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: EVIL },
      body: JSON.stringify({ source: 'memory', action: 'memory_forget' }),
    });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe('origin_not_allowed');
    expect(r.headers.get('access-control-allow-origin')).toBeNull();

    const q = (await (await fetch(`${base}/api/mirror/audit`)).json()) as { total: number };
    expect(q.total).toBe(0);
  });

  it('白名单 Origin：回显 ACAO + Vary，且请求正常放行', async () => {
    const r = await fetch(`${base}/api/mirror/audit`, { headers: { Origin: ALLOWED } });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(r.headers.get('vary')).toContain('Origin');
    // 绝不返回通配符
    expect(r.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('Origin: null 与非白名单 OPTIONS 一律 403；白名单 OPTIONS 204', async () => {
    const nullOrigin = await fetch(`${base}/api/login`, { method: 'OPTIONS', headers: { Origin: 'null' } });
    expect(nullOrigin.status).toBe(403);

    const evilOptions = await fetch(`${base}/api/login`, { method: 'OPTIONS', headers: { Origin: EVIL } });
    expect(evilOptions.status).toBe(403);

    const okOptions = await fetch(`${base}/api/login`, { method: 'OPTIONS', headers: { Origin: ALLOWED } });
    expect(okOptions.status).toBe(204);
    expect(okOptions.headers.get('access-control-allow-origin')).toBe(ALLOWED);
  });

  it('批次22：/api/health 在线可探测，被拒来源写入 origin_rejected 日志', async () => {
    const logs: Array<{ scope: string; action: string; detail?: Record<string, unknown> }> = [];
    const s2 = createServer({
      port: 0, dataFile, allowedOrigins: [ALLOWED],
      onLog: (scope, action, detail) => logs.push({ scope, action, detail }),
    });
    await new Promise<void>((r) => s2.listen(0, () => r()));
    const addr = s2.address() as { port: number };
    const b2 = `http://127.0.0.1:${addr.port}`;
    try {
      const ok = await fetch(`${b2}/api/health`, { headers: { Origin: ALLOWED } });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { ok: boolean; service: string };
      expect(body.ok).toBe(true);
      expect(body.service).toBe('home');

      const bad = await fetch(`${b2}/api/health`, { headers: { Origin: EVIL } });
      expect(bad.status).toBe(403);
      expect(logs.some((l) => l.action === 'origin_rejected' && l.detail?.origin === EVIL)).toBe(true);
    } finally {
      await close(s2);
    }
  });
});

// ── 批次26-B P2-14/P2-16/P2-17：Host 绑定 / 内存限速 / 防枚举 / 默认口令告警 ──

/** 原生 http 请求（可覆盖 Host 头；undici fetch 不适合做 Host 绑定测试） */
function rawGet(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = httpRequest(url, { headers }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    r.on('error', reject);
    r.end();
  });
}

describe('批次26-B P2-14/16/17（Host 绑定 / 限速 / 防枚举 / 默认口令告警）', () => {
  let server: Server;
  let base: string;
  let tmp: string;
  let logs: Array<{ scope: string; action: string; detail?: Record<string, unknown> }>;

  beforeEach(async () => {
    resetAuthStore();
    tmp = mkdtempSync(join(tmpdir(), 'home-srv-p2-'));
    registerAccount(ACCOUNT, hashPassword('pw'), { enterprise_id: 'ent_001', team_id: TEAM, perspective: 'team' });
    logs = [];
    server = createServer({
      port: 0, dataFile: join(tmp, 'audit.json'), seedAdmin: true,
      onLog: (scope, action, detail) => logs.push({ scope, action, detail }),
    });
    base = await listen(server);
  });
  afterEach(async () => {
    await close(server);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('P2-16 Host 头绑定：恶意域名 Host → 403 host_not_allowed；回环 Host 正常放行', async () => {
    const evil = await rawGet(`${base}/api/health`, { host: 'evil.example' });
    expect(evil.status).toBe(403);
    expect(JSON.parse(evil.body)).toEqual({ ok: false, error: 'host_not_allowed' });
    expect(logs.some((l) => l.action === 'host_rejected' && l.detail?.host === 'evil.example')).toBe(true);

    const port = (server.address() as { port: number }).port;
    const ok = await rawGet(`${base}/api/health`, { host: `127.0.0.1:${port}` });
    expect(ok.status).toBe(200);
    expect(logs.some((l) => l.action === 'host_rejected' && l.detail?.host === `127.0.0.1:${port}`)).toBe(false);
  });

  it('P2-14 登录内存限速：连续尝试同一账号 → 超出 10 次/分钟 → 429（锁定文件删了也限速）', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await postLogin(base, ACCOUNT, 'wrong')).status);
    }
    // 前 5 次 401（密码错），第 6 次起账号锁定 423，第 11 次被内存限速 429
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[10]).toBe(429);
    expect(logs.some((l) => l.action === 'login_rate_limited' && l.detail?.account === ACCOUNT)).toBe(true);
  });

  it('P2-17 注册限速：11 次注册 → 第 11 次 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await postRegister(base, `bulk${i}@example.com`, 'secret123')).status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
    expect(logs.some((l) => l.action === 'register_rate_limited')).toBe(true);
  });

  it('P2-17 防用户名枚举：账号不存在与密码错误返回同一响应（401 reason=wrong）', async () => {
    const ghost = await postLogin(base, 'ghost@example.com', 'whatever1');
    expect(ghost.status).toBe(401);
    expect(((await ghost.json()) as { reason: string }).reason).toBe('wrong');
    const wrongPwd = await postLogin(base, ACCOUNT, 'definitely-wrong');
    expect(wrongPwd.status).toBe(401);
    expect(((await wrongPwd.json()) as { reason: string }).reason).toBe('wrong');
  });

  it('P2-14 内置管理员仍用初始口令 → 登录成功但记录 default_password_active 告警', async () => {
    const r = await postLogin(base, ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD);
    expect(r.status).toBe(200);
    expect(logs.some((l) => l.action === 'default_password_active' && l.detail?.account === ADMIN_ACCOUNT)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(DEFAULT_ADMIN_PASSWORD); // 口令零落日志
  });
});
