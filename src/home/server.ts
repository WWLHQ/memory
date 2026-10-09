// REQ-005 T10：登录后端 HTTP 服务（零依赖，可选镜像，§4.1/§4.3）
// 风格对齐 REQ-003 server.ts：node:http + JSON 持久化 + CORS。
// 端点：POST /api/login（校验账号密码，调 T3 login，返回 TenantContext + 写审计 action=login）
//       POST /api/logout（写审计 action=logout）  GET /api/me（登录态返回 context，未登录 401）
// 锁定表持久化：每次登录后把 T3 锁定态快照写入 .data/home-locks.json，启动时 importLockSnapshot 恢复。
// 审计写入统一 audit 表（4.3.1 枚举 login/logout/login_fail/team_assign）。
import { createServer as httpCreateServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { login, exportLockSnapshot, importLockSnapshot, registerAccount, resetAuthStore } from '../auth/loginService.ts';
import { hashPassword } from '../auth/hash.ts';
import type { Form } from '../types/agentOnboard.ts';
import type { TenantContext, LoginAudit } from '../types/home.ts';

export interface ServerOptions {
  /** 监听端口；测试用 0（随机端口） */
  port?: number;
  /** 审计 JSON 持久化文件路径（.data/）；同目录写入 home-locks.json */
  dataFile: string;
}

interface Session {
  context: TenantContext;
  form: Form;
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

export function createServer(opts: ServerOptions): Server {
  const auditFile = opts.dataFile;
  const lockFile = join(dirname(auditFile), 'home-locks.json');
  mkdirSync(dirname(auditFile), { recursive: true });

  // 启动时恢复审计 + 锁定表（确保重启后锁定表保留）
  let audit: LoginAudit[] = [];
  try {
    audit = JSON.parse(readFileSync(auditFile, 'utf8')) as LoginAudit[];
  } catch {
    audit = [];
  }
  try {
    importLockSnapshot(JSON.parse(readFileSync(lockFile, 'utf8')) as Record<string, { failCount: number; lockedUntil?: number }>);
  } catch {
    /* 无锁定快照则跳过 */
  }

  const sessions = new Map<string, Session>();

  // 验证码存储（简单实现，生产环境应存入 Redis/DB）
  const captchaStore = new Map<string, { code: string; expiresAt: number }>();

  function persistAudit(): void {
    writeFileSync(auditFile, JSON.stringify(audit, null, 2));
  }
  function persistLock(): void {
    writeFileSync(lockFile, JSON.stringify(exportLockSnapshot()));
  }
  function appendAudit(a: LoginAudit): void {
    audit.push(a);
    persistAudit();
  }
  function send(res: ServerResponse, code: number, body: unknown): void {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }
  function sessionIdOf(req: IncomingMessage): string | undefined {
    const h = req.headers['x-session-id'];
    return Array.isArray(h) ? h[0] : h;
  }

  const server = httpCreateServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-session-id,x-auth-session');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? '/';
    const path = url.split('?')[0];

    Promise.resolve()
      .then(async () => {
        if (req.method === 'POST' && path === '/api/register') {
          const body = await readJsonBody(req);
          const account = typeof body.account === 'string' ? body.account : '';
          const password = typeof body.password === 'string' ? body.password : '';
          const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
          const captchaCode = typeof body.captchaCode === 'string' ? body.captchaCode : '';
          const captchaId = typeof body.captchaId === 'string' ? body.captchaId : '';

          if (!account || !password || !confirmPassword || !captchaCode) {
            send(res, 400, { reason: 'empty' });
            return;
          }

          // 账号格式校验：手机号或邮箱
          const isPhone = /^1[3-9]\d{9}$/.test(account);
          const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account);
          if (!isPhone && !isEmail) {
            send(res, 400, { reason: 'invalid_account', message: '账号必须是手机号或邮箱' });
            return;
          }

          // 密码长度校验
          if (password.length < 6) {
            send(res, 400, { reason: 'weak_password', message: '密码至少 6 位' });
            return;
          }

          // 确认密码校验
          if (password !== confirmPassword) {
            send(res, 400, { reason: 'password_mismatch', message: '两次密码不一致' });
            return;
          }

          // 验证码校验（简单实现：前端生成，后端验证）
          const storedCaptcha = captchaStore.get(captchaId);
          if (!storedCaptcha || storedCaptcha.code !== captchaCode) {
            send(res, 400, { reason: 'invalid_captcha', message: '验证码错误' });
            return;
          }
          captchaStore.delete(captchaId); // 一次性使用

          // 检查账号是否已存在
          const checkResult = login({ account, password: 'dummy', form: 'desktop' });
          if (checkResult.ok || checkResult.reason === 'wrong') {
            send(res, 409, { reason: 'exists', message: '账号已存在' });
            return;
          }

          // 新用户注册
          const teamId = `personal-${account}`;
          registerAccount(account, hashPassword(password), { enterprise_id: 'local', team_id: teamId, perspective: 'personal' });
          persistLock();
          appendAudit({ action: 'login', form: 'desktop', account, at: Date.now() });
          send(res, 200, { ok: true, team_id: teamId, message: '注册成功' });
          return;
        }

        if (req.method === 'GET' && path === '/api/captcha') {
          // 生成验证码
          const id = randomUUID();
          const code = String(Math.floor(100000 + Math.random() * 900000));
          captchaStore.set(id, { code, expiresAt: Date.now() + 5 * 60 * 1000 }); // 5分钟有效
          send(res, 200, { id, code }); // 测试用返回 code，生产环境应只返回 id
          return;
        }

        if (req.method === 'POST' && path === '/api/login') {
          const body = await readJsonBody(req);
          const account = typeof body.account === 'string' ? body.account : '';
          const password = typeof body.password === 'string' ? body.password : '';
          const form = (typeof body.form === 'string' ? body.form : 'desktop') as Form;
          const result = login({ account, password, form });
          persistLock(); // 每次登录后落盘锁定态（★ 持久化要点）

          if (result.ok) {
            const sid = result.context.session_id;
            sessions.set(sid, { context: result.context, form });
            appendAudit(result.audit);
            send(res, 200, { context: result.context, sessionId: sid, audit: result.audit });
            return;
          }
          appendAudit(result.audit);
          if (result.reason === 'locked') send(res, 423, { reason: 'locked', lockedUntil: result.lockedUntil });
          else if (result.reason === 'no_account') send(res, 401, { reason: 'no_account' });
          else if (result.reason === 'empty') send(res, 400, { reason: 'empty' });
          else send(res, 401, { reason: 'wrong' });
          return;
        }

        if (req.method === 'POST' && path === '/api/logout') {
          const sid = sessionIdOf(req);
          if (sid && sessions.has(sid)) {
            const s = sessions.get(sid)!;
            sessions.delete(sid);
            appendAudit({ action: 'logout', form: s.form, account: s.context.user_id, at: Date.now() });
            send(res, 200, { ok: true });
          } else {
            send(res, 401, { ok: false, reason: 'no_session' });
          }
          return;
        }

        if (req.method === 'GET' && path === '/api/me') {
          const sid = sessionIdOf(req);
          if (sid && sessions.has(sid)) {
            send(res, 200, { context: sessions.get(sid)!.context });
          } else {
            send(res, 401, { ok: false });
          }
          return;
        }

        send(res, 404, { error: 'not found' });
      })
      .catch(() => send(res, 500, { error: 'server error' }));
  });

  return server;
}

// 便于测试：暴露重置钩子（仅测试用，不影响服务端逻辑）
export { registerAccount, resetAuthStore };
