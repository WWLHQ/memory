// T10 验收（提前规划的测试）：登录后端 HTTP 服务（零依赖，§4.1/§4.3）
// 对应 specs/tasks/HOME-LOGIN.md T10 「验收（提前规划的测试）」
// 真起 node:http 服务，覆盖 /api/login /api/logout /api/me + 锁定/审计/持久化。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../server.ts';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { registerAccount, resetAuthStore } from '../server.ts';
import { ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD, listAccounts } from '../../auth/loginService.ts';
import { hashPassword } from '../../auth/hash.ts';
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENESIS_HASH } from '../mirrorLedger.ts';

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

/** 取一个真实登录会话（mirror 等端点自批次47 起要求会话） */
async function loginAs(url: string, account: string, password: string): Promise<string> {
  const r = await postLogin(url, account, password);
  expect(r.status).toBe(200);
  return ((await r.json()) as { sessionId: string }).sessionId;
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

  it('mirror 账本绑定会话：匿名 POST/GET 401；登录后写入并可按来源回填', async () => {
    const anonPost = await fetch(`${base}/api/mirror/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'audit', action: 'security_change' }),
    });
    expect(anonPost.status).toBe(401);
    expect((await fetch(`${base}/api/mirror/audit`)).status).toBe(401);

    const sid = ((await (await postLogin(base, ACCOUNT, 'pw')).json()) as { sessionId: string }).sessionId;
    const okPost = await fetch(`${base}/api/mirror/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ source: 'audit', action: 'security_change', request_id: 'req_1' }),
    });
    expect(okPost.status).toBe(200);

    const q = await fetch(`${base}/api/mirror/audit?source=audit`, { headers: { 'x-session-id': sid } });
    expect(q.status).toBe(200);
    const body = (await q.json()) as { items: Array<{ source: string }>; total: number };
    expect(body.items.map((i) => i.source)).toEqual(['audit']);
    expect(body.total).toBe(1);
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
    const sid = await loginAs(base, ACCOUNT, 'pw');
    const r1 = await fetch(`${base}/api/mirror/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ source: 'memory', action: 'memory_forget', payload: { mem_id: 'mem_002', op: 'forget' } }),
    });
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { seq: number }).seq).toBe(1);

    const r2 = await fetch(`${base}/api/mirror/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ source: 'dispute', action: 'dispute', request_id: 'req_d1', payload: { old_id: 'a', new_id: 'b', verdict: 'auto_override' } }),
    });
    expect(((await r2.json()) as { seq: number }).seq).toBe(2);

    const q = (await (await fetch(`${base}/api/mirror/audit`, { headers: { 'x-session-id': sid } })).json()) as { items: Array<{ source: string; action: string }>; total: number };
    expect(q.total).toBe(2);
    expect(q.items.map((i) => i.action)).toEqual(['memory_forget', 'dispute']);

    // source 过滤
    const q2 = (await (await fetch(`${base}/api/mirror/audit?source=memory`, { headers: { 'x-session-id': sid } })).json()) as { items: unknown[]; total: number };
    expect(q2.items.length).toBe(1);
  });

  it('持久化：重启后 mirror 账本保留（home-mirror.json）', async () => {
    const sid = await loginAs(base, ACCOUNT, 'pw');
    await fetch(`${base}/api/mirror/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ source: 'feedback', action: 'feedback', request_id: 'req_fb1' }),
    });
    await close(server);
    const server2 = createServer({ port: 0, dataFile });
    base = await listen(server2);
    server = server2;

    // 会话随进程重启失效：重新登录后再查询（证明账本持久化，而不是复用旧会话）
    const sid2 = await loginAs(base, ACCOUNT, 'pw');
    const q = (await (await fetch(`${base}/api/mirror/audit?source=feedback`, { headers: { 'x-session-id': sid2 } })).json()) as { items: Array<{ request_id?: string }>; total: number };
    expect(q.total).toBe(1);
    expect(q.items[0].request_id).toBe('req_fb1');
  });

  it('A8 签名链：条目带 hash/sig/prev_hash 并落盘，GET integrity.ok=true', async () => {
    const sid = await loginAs(base, ACCOUNT, 'pw');
    await fetch(`${base}/api/mirror/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ source: 'memory', action: 'memory_forget', request_id: 'r1', payload: { mem_id: 'm1' } }),
    });
    await fetch(`${base}/api/mirror/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ source: 'dispute', action: 'dispute', request_id: 'r2', payload: { old_id: 'a', new_id: 'b' } }),
    });
    const q = (await (await fetch(`${base}/api/mirror/audit`, { headers: { 'x-session-id': sid } })).json()) as {
      items: Array<{ prev_hash?: string; hash?: string; sig?: string }>;
      integrity: { ok: boolean; sealed: number; legacy_unsealed: number; algorithm: string; note: string };
    };
    expect(q.integrity).toMatchObject({ ok: true, sealed: 2, legacy_unsealed: 0, algorithm: 'HMAC-SHA256(chain)' });
    expect(q.integrity.note).toContain('不抵御本机管理员'); // 不夸大成防篡改
    expect(q.items[0].prev_hash).toBe(GENESIS_HASH);
    expect(q.items[1].prev_hash).toBe(q.items[0].hash);
    expect(q.items[1].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(q.items[1].sig).toMatch(/^[0-9a-f]{64}$/);

    // 落盘内容同样带签名（重启后仍能校验）
    const persisted = JSON.parse(readFileSync(join(tmp, 'home-mirror.json'), 'utf8')) as Array<{ hash?: string }>;
    expect(persisted[1].hash).toBe(q.items[1].hash);
  });

  it('A8 篡改检出：账本条目被改写 → integrity.ok=false 且点名 seq', async () => {
    const sid = await loginAs(base, ACCOUNT, 'pw');
    for (const source of ['memory', 'dispute']) {
      await fetch(`${base}/api/mirror/audit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
        body: JSON.stringify({ source, action: 'act', payload: { v: 1 } }),
      });
    }
    await close(server);
    const file = join(tmp, 'home-mirror.json');
    const entries = JSON.parse(readFileSync(file, 'utf8')) as Array<{ payload?: unknown }>;
    entries[0].payload = { v: 999 }; // 保留原 hash/sig，只改内容
    writeFileSync(file, JSON.stringify(entries));
    server = createServer({ port: 0, dataFile });
    base = await listen(server);

    const sid2 = await loginAs(base, ACCOUNT, 'pw');
    const q = (await (await fetch(`${base}/api/mirror/audit`, { headers: { 'x-session-id': sid2 } })).json()) as {
      integrity: { ok: boolean; broken_at_seq?: number; reason?: string };
    };
    expect(q.integrity).toMatchObject({ ok: false, broken_at_seq: 1, reason: '条目内容与 hash 不符（被改写）' });
  });

  it('A8 账本不可读：POST 503 拒收（fail-closed），GET 如实报告 ledger_unreadable', async () => {
    await loginAs(base, ACCOUNT, 'pw');
    await close(server);
    writeFileSync(join(tmp, 'home-mirror.json'), '{"broken":');
    server = createServer({ port: 0, dataFile });
    base = await listen(server);

    const sid = await loginAs(base, ACCOUNT, 'pw');
    const post = await fetch(`${base}/api/mirror/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ source: 'audit', action: 'audit_query' }),
    });
    expect(post.status).toBe(503);
    expect((await post.json()) as { reason: string }).toMatchObject({ reason: 'mirror_ledger_unreadable' });

    const q = (await (await fetch(`${base}/api/mirror/audit`, { headers: { 'x-session-id': sid } })).json()) as {
      integrity: { ok: boolean; reason?: string; load_error?: string };
    };
    expect(q.integrity.ok).toBe(false);
    expect(q.integrity.reason).toBe('ledger_unreadable');
  });

  it('A8 旧无签名条目：链首如实计数，新条目从链首锚点续链', async () => {
    await close(server);
    const legacy = [
      { seq: 1, source: 'audit', action: 'audit_query', ts: 1 },
      { seq: 2, source: 'audit', action: 'audit_query', ts: 2 },
    ];
    writeFileSync(join(tmp, 'home-mirror.json'), JSON.stringify(legacy));
    server = createServer({ port: 0, dataFile });
    base = await listen(server);

    const sid = await loginAs(base, ACCOUNT, 'pw');
    await fetch(`${base}/api/mirror/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ source: 'memory', action: 'memory_forget' }),
    });
    const q = (await (await fetch(`${base}/api/mirror/audit`, { headers: { 'x-session-id': sid } })).json()) as {
      items: Array<{ prev_hash?: string }>;
      integrity: { ok: boolean; sealed: number; legacy_unsealed: number };
    };
    expect(q.integrity).toMatchObject({ ok: true, sealed: 1, legacy_unsealed: 2 });
    expect(q.items[2].prev_hash).toBe(GENESIS_HASH);
  });

  it('A9 账号文件损坏：不播种默认管理员，登录/注册 503，原件保留并留 .corrupt 备份', async () => {
    await close(server);
    resetAuthStore(); // 清掉本文件 beforeEach 里已播种的 admin，模拟「损坏文件 + 冷启动」
    const raw = '{"accounts": ['; // 截断的非法 JSON（真实故障形态）
    writeFileSync(join(tmp, 'home-accounts.json'), raw);
    const logs: Array<{ action: string; detail?: Record<string, unknown> }> = [];
    server = createServer({ port: 0, dataFile, onLog: (_s, action, detail) => logs.push({ action, detail }) });
    base = await listen(server);

    // 健康探测明示账号域损坏（而不是只报「在线」）
    const health = (await (await fetch(`${base}/api/health`)).json()) as { accounts?: string };
    expect(health.accounts).toBe('unreadable');

    // 默认口令管理员绝不能被播种顶替：账号表里必须仍然没有 admin
    expect(listAccounts().some((a) => a.account === ADMIN_ACCOUNT)).toBe(false);
    // 登录被明示拒绝，而不是 401/成功
    const login = await postLogin(base, ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD);
    expect(login.status).toBe(503);
    expect((await login.json()) as { reason: string }).toMatchObject({ reason: 'accounts_unreadable' });

    // 注册同样拒绝（不能把损坏当空白环境覆盖写）
    const reg = await fetch(`${base}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'new_user', password: 'pw', confirmPassword: 'pw' }),
    });
    expect(reg.status).toBe(503);

    // 原件原样保留（本进程不覆盖写）；损坏副本已备份
    expect(readFileSync(join(tmp, 'home-accounts.json'), 'utf8')).toBe(raw);
    const backups = readdirSync(tmp).filter((f) => f.includes('.corrupt-'));
    expect(backups.length).toBe(1);
    expect(readFileSync(join(tmp, backups[0]), 'utf8')).toBe(raw);
    expect(logs.some((l) => l.action === 'accounts_unreadable')).toBe(true);
  });

  it('A9 账号文件结构非法（能解析但记录缺字段）：同样 fail-closed，不播种默认管理员', async () => {
    await close(server);
    resetAuthStore();
    const raw = JSON.stringify([{ account: 'user_001' }]); // 缺 passwordHash/租户字段
    writeFileSync(join(tmp, 'home-accounts.json'), raw);
    server = createServer({ port: 0, dataFile });
    base = await listen(server);

    expect(listAccounts()).toEqual([]); // 损坏时不播种任何账号
    const login = await postLogin(base, ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD);
    expect(login.status).toBe(503);
    expect(readFileSync(join(tmp, 'home-accounts.json'), 'utf8')).toBe(raw);
  });

  it('A9 空账号文件 [] 仍按正常首次启动播种管理员（不误伤合法空态）', async () => {
    await close(server);
    resetAuthStore();
    writeFileSync(join(tmp, 'home-accounts.json'), '[]');
    server = createServer({ port: 0, dataFile });
    base = await listen(server);

    const login = await postLogin(base, ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD);
    expect(login.status).toBe(200);
  });

  it('缺字段容错：空 body → source/action 落 unknown，不 500', async () => {
    const sid = await loginAs(base, ACCOUNT, 'pw');
    const r = await fetch(`${base}/api/mirror/audit`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid }, body: '{}' });
    expect(r.status).toBe(200);
    const q = (await (await fetch(`${base}/api/mirror/audit`, { headers: { 'x-session-id': sid } })).json()) as { items: Array<{ source: string; action: string }> };
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
    const r = await postRegister(base, 'newbie@example.com', 'Secret#123');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; team_id: string };
    expect(body.ok).toBe(true);
    expect(body.team_id).toBe('personal-newbie@example.com');

    expect((await postLogin(base, 'newbie@example.com', 'Secret#123')).status).toBe(200);

    const audit = JSON.parse(readFileSync(dataFile, 'utf8')) as Array<{ action: string; account: string }>;
    expect(audit.some((a) => a.action === 'team_assign' && a.account === 'newbie@example.com')).toBe(true);
    // 注册动作不得伪装成 login：该账号只有 1 条真实登录记录
    expect(audit.filter((a) => a.account === 'newbie@example.com' && a.action === 'login').length).toBe(1);
  });

  it('已存在账号重复注册 → 409，passwordHash 不被覆盖，新密码不能登录', async () => {
    expect((await postRegister(base, 'dup@example.com', 'OldPass#1')).status).toBe(200);
    const hashBefore = readAccounts(tmp).find((a) => a.account === 'dup@example.com')!.passwordHash;

    const again = await postRegister(base, 'dup@example.com', 'NewPass#2');
    expect(again.status).toBe(409);
    expect(((await again.json()) as { reason: string }).reason).toBe('exists');

    expect(readAccounts(tmp).find((a) => a.account === 'dup@example.com')!.passwordHash).toBe(hashBefore);
    expect((await postLogin(base, 'dup@example.com', 'NewPass#2')).status).toBe(401);
    expect((await postLogin(base, 'dup@example.com', 'OldPass#1')).status).toBe(200);
  });

  it('注册探测不计失败：连续 5 次重复注册后仍可正常登录（不被锁）', async () => {
    expect((await postRegister(base, 'probe@example.com', 'RightPass#1')).status).toBe(200);
    for (let i = 0; i < 5; i++) {
      expect((await postRegister(base, 'probe@example.com', `wrongpass${i}`)).status).toBe(409);
    }
    expect((await postLogin(base, 'probe@example.com', 'RightPass#1')).status).toBe(200);
  });

  it('锁定账号注册试探 → 409，且不重置锁定（正确密码仍 423）', async () => {
    expect((await postRegister(base, 'locked@example.com', 'GoodPass#1')).status).toBe(200);
    for (let i = 0; i < 5; i++) {
      expect((await postLogin(base, 'locked@example.com', 'bad')).status).toBe(401);
    }
    expect((await postRegister(base, 'locked@example.com', 'hijack1')).status).toBe(409);
    // 注册没走 login()，锁定态与密码均未被改动
    expect((await postLogin(base, 'locked@example.com', 'GoodPass#1')).status).toBe(423);
  });

  it('A10 策略持久化：admin 保存落盘，重启后仍生效；member 保存 403；无会话 401', async () => {
    const admin = await adminLoginSid(base);
    const g0 = (await (await fetch(`${base}/api/policy`, { headers: { 'x-session-id': admin } })).json()) as {
      policy: { min_len: number };
    };
    expect(g0.policy.min_len).toBe(8); // 内置默认

    const saved = await fetch(`${base}/api/policy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': admin },
      body: JSON.stringify({ min_len: 12, max_len: 64, upper: true, lower: true, digit: true, special: false, history_count: 5 }),
    });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { policy: { min_len: number; special: boolean } }).policy).toMatchObject({ min_len: 12, special: false });

    // 真实落盘
    const persisted = JSON.parse(readFileSync(join(tmp, 'home-policy.json'), 'utf8')) as { min_len: number };
    expect(persisted.min_len).toBe(12);

    // 权限：member 403；无会话 401（本 describe 无预置账号，先注册一个真实成员）
    expect((await postRegister(base, 'member@example.com', 'LongMember#2026')).status).toBe(200);
    const member = await loginAs(base, 'member@example.com', 'LongMember#2026');
    const denied = await fetch(`${base}/api/policy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': member },
      body: JSON.stringify({ min_len: 6 }),
    });
    expect(denied.status).toBe(403);
    expect((await fetch(`${base}/api/policy`)).status).toBe(401);

    // 重启后仍是保存值（会话失效需重新登录）
    await close(server);
    server = createServer({ port: 0, dataFile });
    base = await listen(server);
    const admin2 = await adminLoginSid(base);
    const g2 = (await (await fetch(`${base}/api/policy`, { headers: { 'x-session-id': admin2 } })).json()) as {
      policy: { min_len: number; special: boolean };
    };
    expect(g2.policy).toMatchObject({ min_len: 12, special: false });
  });

  it('A10 策略真实生效：注册与修改密码都按后端策略校验（不是只展示）', async () => {
    // 默认策略：≥8 位 + 大小写/数字/特殊
    const weakReg = await postRegister(base, 'weak@example.com', 'weakpass1');
    expect(weakReg.status).toBe(400);
    expect((await weakReg.json()) as { reason: string; message: string }).toMatchObject({ reason: 'weak_password' });
    expect((await postRegister(base, 'strong@example.com', 'Strong#123')).status).toBe(200);

    expect((await postRegister(base, 'member@example.com', 'OldPass#1')).status).toBe(200);
    const sid = await loginAs(base, 'member@example.com', 'OldPass#1');
    const weakChg = await fetch(`${base}/api/password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ oldPassword: 'OldPass#1', newPassword: 'abcdefgh' }),
    });
    expect(weakChg.status).toBe(400);
    const body = (await weakChg.json()) as { reason: string; error: string };
    expect(body.reason).toBe('weak');
    expect(body.error).toContain('大写字母');

    const okChg = await fetch(`${base}/api/password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ oldPassword: 'OldPass#1', newPassword: 'NewStr0ng#1' }),
    });
    expect(okChg.status).toBe(200);
    expect((await postLogin(base, 'member@example.com', 'NewStr0ng#1')).status).toBe(200);
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

    const sid = await loginAs(base, ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD);
    const q = (await (await fetch(`${base}/api/mirror/audit`, { headers: { 'x-session-id': sid } })).json()) as { total: number };
    expect(q.total).toBe(0);
  });

  it('白名单 Origin：回显 ACAO + Vary，且请求正常放行', async () => {
    const sid = await loginAs(base, ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD);
    const r = await fetch(`${base}/api/mirror/audit`, { headers: { Origin: ALLOWED, 'x-session-id': sid } });
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
      statuses.push((await postRegister(base, `bulk${i}@example.com`, 'Secret#123')).status);
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

// ── 批次28-A：内核数据面（浏览器凭登录会话直连记忆账本）────────────────────

async function loginSid(url: string): Promise<string> {
  const r = await postLogin(url, ACCOUNT, 'pw');
  expect(r.status).toBe(200);
  return ((await r.json()) as { sessionId: string }).sessionId;
}

/** 内置管理员会话（admin 才能调破坏性/账本方法） */
async function adminLoginSid(url: string): Promise<string> {
  const r = await postLogin(url, ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD);
  expect(r.status).toBe(200);
  return ((await r.json()) as { sessionId: string }).sessionId;
}

function invoke(url: string, sid: string, body: unknown) {
  return fetch(`${url}/api/kernel/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
    body: JSON.stringify(body),
  });
}

describe('批次28-A 内核数据面端点', () => {
  beforeEach(async () => {
    resetAuthStore();
    tmp = mkdtempSync(join(tmpdir(), 'home-srv-kernel-'));
    dataFile = join(tmp, 'audit.json');
    registerAccount(ACCOUNT, hashPassword('pw'), { enterprise_id: 'ent_001', team_id: TEAM, perspective: 'team' });
    server = createServer({ port: 0, dataFile });
    base = await listen(server);
  });
  afterEach(async () => {
    await close(server);
    rmSync(tmp, { recursive: true, force: true });
  });

  // 归属字段与会话真源对齐（ACCOUNT/ent_001/TEAM）：批次48 A7 起 putMemory 校验归属
  const MEM = {
    mem_id: 'mem_k1', project_id: 'P1', enterprise_id: 'ent_001', team_id: TEAM, user_id: ACCOUNT,
    category: 'fact', layer: 'L1', content: '内核数据面直连测试记忆内容',
    decay_class: 'hot', pinned: false, locked: false, version: 1,
    created_at: 1_800_000_000_000,
  } as const;

  it('未挂 kernelStorage → /api/kernel/* 501 kernel_unavailable（诚实报错）', async () => {
    const sid = await loginSid(base);
    const inv = await invoke(base, sid, { method: 'listMemories', args: [{}] });
    expect(inv.status).toBe(501);
    expect(((await inv.json()) as { reason: string }).reason).toBe('kernel_unavailable');
    const info = await fetch(`${base}/api/kernel/info`, { headers: { 'x-session-id': sid } });
    expect(info.status).toBe(501);
  });

  it('无会话 → 401；未知方法 → 400；合法调用走通 putMemory/listMemories', async () => {
    const { InMemoryStorage } = await import('../../core/memagent/storage.ts');
    await close(server);
    server = createServer({ port: 0, dataFile, kernelStorage: new InMemoryStorage() });
    base = await listen(server);

    const anon = await invoke(base, 'nope', { method: 'listMemories', args: [{}] });
    expect(anon.status).toBe(401);

    const sid = await loginSid(base);
    const bad = await invoke(base, sid, { method: 'dropTable', args: [] });
    expect(bad.status).toBe(400);

    const put = await invoke(base, sid, { method: 'putMemory', args: [MEM] });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { ok: boolean }).ok).toBe(true);

    const list = await invoke(base, sid, { method: 'listMemories', args: [{}] });
    const body = (await list.json()) as { ok: boolean; result: Array<{ mem_id: string }> };
    expect(body.ok).toBe(true);
    expect(body.result.map((m) => m.mem_id)).toEqual(['mem_k1']);
  });

  it('角色闸门：member 可读写但不可删记忆/写账本；admin 可删可写（拒绝留痕）', async () => {
    const { InMemoryStorage } = await import('../../core/memagent/storage.ts');
    const logs: Array<{ action: string }> = [];
    await close(server);
    server = createServer({
      port: 0, dataFile,
      kernelStorage: new InMemoryStorage(),
      onLog: (_scope, action) => logs.push({ action }),
    });
    base = await listen(server);

    const member = await loginSid(base);
    const admin = await adminLoginSid(base);

    // member 常规读写放行
    expect((await invoke(base, member, { method: 'putMemory', args: [MEM] })).status).toBe(200);
    expect((await invoke(base, member, { method: 'listMemories', args: [{}] })).status).toBe(200);

    // member 破坏性/账本方法 → 403 forbidden
    const del = await invoke(base, member, { method: 'deleteMemory', args: ['mem_k1'] });
    expect(del.status).toBe(403);
    expect(((await del.json()) as { reason: string }).reason).toBe('forbidden');

    const aud = await invoke(base, member, { method: 'appendAudit', args: [{ request_id: 'req_m_1', action: 'memory_op', ts: Date.now() }] });
    expect(aud.status).toBe(403);

    // admin 放行
    const audOk = await invoke(base, admin, { method: 'appendAudit', args: [{ request_id: 'req_a_1', action: 'memory_op', ts: Date.now() }] });
    expect(audOk.status).toBe(200);
    expect((await invoke(base, admin, { method: 'deleteMemory', args: ['mem_k1'] })).status).toBe(200);

    expect(logs.some((l) => l.action === 'kernel_invoke_forbidden')).toBe(true);
  });

  it('归属校验（A7）：member 不能跨租户新建/覆盖他人记忆；admin 不受限', async () => {
    const { InMemoryStorage } = await import('../../core/memagent/storage.ts');
    const storage = new InMemoryStorage();
    const logs: Array<{ action: string }> = [];
    await close(server);
    server = createServer({
      port: 0, dataFile, kernelStorage: storage,
      onLog: (_scope, action) => logs.push({ action }),
    });
    base = await listen(server);

    const member = await loginSid(base);

    // 1) 新建到别的租户 → 403，且不落盘
    const foreign = { ...MEM, mem_id: 'mem_foreign', enterprise_id: 'ent_other', team_id: 'team_other' };
    const r1 = await invoke(base, member, { method: 'putMemory', args: [foreign] });
    expect(r1.status).toBe(403);
    expect((await r1.json()) as { reason: string }).toMatchObject({ reason: 'forbidden' });
    expect(await storage.getMemory('mem_foreign')).toBeNull();

    // 2) 同租户内覆盖他人记忆 → 403，原文不变
    await storage.putMemory({ ...MEM, mem_id: 'mem_other', user_id: 'other_user' });
    const r2 = await invoke(base, member, { method: 'putMemory', args: [{ ...MEM, mem_id: 'mem_other', content: '被篡改' }] });
    expect(r2.status).toBe(403);
    expect((await storage.getMemory('mem_other'))?.content).toBe('内核数据面直连测试记忆内容');

    // 3) 覆盖他租户已有行（即使写入行伪装成本会话租户）→ 403
    await storage.putMemory({ ...MEM, mem_id: 'mem_x', enterprise_id: 'ent_x', team_id: 'team_x', user_id: 'other_user' });
    const r3 = await invoke(base, member, { method: 'putMemory', args: [{ ...MEM, mem_id: 'mem_x', content: '被篡改' }] });
    expect(r3.status).toBe(403);

    // 4) 覆盖他租户的删除墓碑（防借覆盖复活别人的记忆）→ 403
    await storage.putMemory({ ...MEM, mem_id: 'mem_tomb', deleted: true, enterprise_id: 'ent_x', team_id: 'team_x', user_id: 'other_user' });
    const r4 = await invoke(base, member, { method: 'putMemory', args: [{ ...MEM, mem_id: 'mem_tomb' }] });
    expect(r4.status).toBe(403);

    // 5) 自己的记忆仍可正常写入
    const ok = await invoke(base, member, { method: 'putMemory', args: [MEM] });
    expect(ok.status).toBe(200);
    expect((await ok.json()) as { ok: boolean }).toMatchObject({ ok: true });

    // 6) admin 不受归属限制（跨租户维护能力保留）
    const admin = await adminLoginSid(base);
    const adminPut = await invoke(base, admin, { method: 'putMemory', args: [foreign] });
    expect(adminPut.status).toBe(200);

    expect(logs.filter((l) => l.action === 'kernel_put_ownership_denied').length).toBe(4);
  });

  it('appendAudit 形状校验：非法审计行 400（伪造/畸形在服务端就拒收）', async () => {
    const { InMemoryStorage } = await import('../../core/memagent/storage.ts');
    await close(server);
    server = createServer({ port: 0, dataFile, kernelStorage: new InMemoryStorage() });
    base = await listen(server);
    const sid = await adminLoginSid(base);

    const bad = await invoke(base, sid, { method: 'appendAudit', args: [{ request_id: 'req_x;DROP', action: 'memory_op', ts: 'not-a-number' }] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { ok: boolean }).ok).toBe(false);

    const good = await invoke(base, sid, { method: 'appendAudit', args: [{ request_id: 'req_ok_1', action: 'memory_op', ts: Date.now(), project_id: 'P1', detail: { op: 'test' } }] });
    expect(good.status).toBe(200);
    expect(((await good.json()) as { ok: boolean }).ok).toBe(true);
  });

  it('只读 FileStorage 镜像：info 返回 readonly=true，putMemory 得到诚实的锁定错误文案', async () => {
    const { FileStorage } = await import('../../core/memagent/fileStorage.ts');
    const db = join(tmp, 'readonly-kernel.json');
    const writer = new FileStorage(db);
    await writer.putMemory({ ...MEM });
    writer.close();

    await close(server);
    server = createServer({
      port: 0, dataFile,
      kernelStorage: new FileStorage(db, { readonly: true, reloadOnMtime: true }),
      kernelInfo: { readonly: true, db_path: db },
    });
    base = await listen(server);
    const sid = await loginSid(base);

    const info = (await (await fetch(`${base}/api/kernel/info`, { headers: { 'x-session-id': sid } })).json()) as { available: boolean; readonly: boolean; db_path: string };
    expect(info.available).toBe(true);
    expect(info.readonly).toBe(true);
    expect(info.db_path).toBe(db);

    const put = await invoke(base, sid, { method: 'putMemory', args: [{ ...MEM, mem_id: 'mem_k2' }] });
    const body = (await put.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('只读');

    const list = await invoke(base, sid, { method: 'listMemories', args: [{}] });
    const okBody = (await list.json()) as { ok: boolean; result: Array<{ mem_id: string }> };
    expect(okBody.ok).toBe(true);
    expect(okBody.result.map((m) => m.mem_id)).toEqual(['mem_k1']);
  });
});
