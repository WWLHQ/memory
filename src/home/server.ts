// REQ-005 T10：登录后端 HTTP 服务（零依赖，可选镜像，§4.1/§4.3）
// 风格对齐 REQ-003 server.ts：node:http + JSON 持久化 + CORS。
// 端点：POST /api/login（校验账号密码，调 T3 login，返回 TenantContext + 写审计 action=login）
//       POST /api/logout（写审计 action=logout）  GET /api/me（登录态返回 context，未登录 401）
//       POST /api/mirror/audit（REQ-006 端壳 mirror 上抛：G6 全动作审计持久账本）
//       GET  /api/mirror/audit?source=&limit=（上抛回填查询）
// 锁定表持久化：每次登录后把 T3 锁定态快照写入 .data/home-locks.json，启动时 importLockSnapshot 恢复。
// 审计写入统一 audit 表（4.3.1 枚举 login/logout/login_fail/team_assign）。
import { createServer as httpCreateServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  login, hasAccount, exportLockSnapshot, importLockSnapshot, exportAccountSnapshot, importAccountSnapshot,
  registerAccount, resetAuthStore, seedAdminAccount, listAccounts, changePassword, setAccountRole, assignAccountTeam,
  readLockState, writeLockState, clearLockState, isDefaultAdminPasswordInUse,
} from '../auth/loginService.ts';
import { hashPassword } from '../auth/hash.ts';
import { syncMembersFromHomeNow, type MemberSyncReport } from '../auth/memberSync.ts';
import type { MemberStorePort } from '../core/memagent/memberStore.ts';
import { createOriginPolicy, rejectUntrustedOrigin, rejectUntrustedHost, applyCorsHeaders } from '../shared/localOrigin.ts';
import { validateAuditRecord } from '../shared/auditShape.ts';
import { checkMemoryWriteOwnership, findExistingMemoryRow } from '../shared/memoryOwnership.ts';
import {
  DEFAULT_PWD_POLICY, normalizePwdPolicy, validatePasswordAgainstPolicy, type PwdPolicy,
} from '../shared/passwordPolicy.ts';
import type { Form } from '../types/agentOnboard.ts';
import type { TenantContext, LoginAudit, AccountRole } from '../types/home.ts';
import type { StorageBackend } from '../core/memagent/types.ts';
import type { PersonalMemoryStore, PersonalOwnerBinding } from '../core/memagent/personalStore.ts';
import type { AnySyncHub } from '../core/memagent/sync.ts';
import { createPersonalApi } from '../core/memagent/personal.ts';

// 端壳 mirror 上抛条目（G6）类型与链式签名实现统一放在 mirrorLedger.ts（批次48 A8）
import {
  GENESIS_HASH, MIRROR_INTEGRITY_NOTE, loadOrCreateMirrorKey, sealMirrorEntry, verifyMirrorChain,
  type MirrorIntegrity,
} from './mirrorLedger.ts';
export type { MirrorAuditEntry } from './mirrorLedger.ts';
import type { MirrorAuditEntry } from './mirrorLedger.ts';

export interface ServerOptions {
  /** 监听端口；测试用 0（随机端口） */
  port?: number;
  /** 审计 JSON 持久化文件路径（.data/）；同目录写入 home-locks.json */
  dataFile: string;
  /** 额外放行的浏览器来源（Electron 静态服务端口、E2E 静态服务端口） */
  allowedOrigins?: string[];
  /** 是否额外放行 Vite dev server 源（仅本地开发入口开启；生产默认 false） */
  allowDevOrigins?: boolean;
  /** 请求体上限（字节），缺省 1 MiB；超限返回 413 */
  maxBodyBytes?: number;
  /** 验证码有效期（毫秒），缺省 5 分钟 */
  captchaTtlMs?: number;
  /** 是否播种内置管理员（缺省 true；测试可关） */
  seedAdmin?: boolean;
  /** 内置管理员初始密码（缺省 Admin@123456，仅首次播种使用；可由环境变量 ADMIN_SEED_PASSWORD 覆盖） */
  adminPassword?: string;
  /** 动作日志回调（批次7）：主进程写入 actions.log；缺省静默 */
  onLog?: (scope: string, action: string, detail?: Record<string, unknown>) => void;
  /**
   * 批次45-B2：内核成员库（MemberStorePort）——home 账号域单向同步进内核 Member
   * （注册/角色/团队变更经 persistAccounts 汇聚点触发 + 启动首帧对账）。
   * 缺省未装配 → 内核成员表保持空表（诚实空态），同步不发生。
   */
  memberStore?: MemberStorePort;
  /**
   * 批次28-A：内核数据面 —— 把进程内的记忆账本（StorageBackend）挂到 HTTP 端点，
   * 浏览器页面凭登录会话直读/直写真实账本，而不是进程内空账本。
   * 缺省未接线 → /api/kernel/* 返回 501 kernel_unavailable（诚实报错，不伪造数据）。
   */
  kernelStorage?: StorageBackend;
  /** /api/kernel/info 用的静态描述（只读状态与账本路径）；未提供则不外泄 */
  kernelInfo?: { readonly: boolean; db_path: string };
  /**
   * 第一轮个人记忆本机闭环：独立存储端口（与 kernelStorage 分开）。
   * 缺省 / 或审计账本不可用 → /api/personal/invoke 返回 501 personal_unavailable（诚实报错）。
   */
  personalStore?: PersonalMemoryStore;
  /**
   * 第二轮 owner 口径：内核 account.user_id（召回真源，与桌面登录账号可能不同名）。
   * 缺省 = 会话 user_id（同名口径，旧行为零变化）；不同名时必须由 personalOwnerBindings 显式绑定，
   * 未绑定条目只在本机可见、agent 不召回（fail-closed，绝不静默并号）。
   */
  personalKernelUserId?: string;
  /** 登录账号 → 内核账号显式绑定表（不同名时的唯一合法映射） */
  personalOwnerBindings?: PersonalOwnerBinding[];
  /**
   * 第二轮真实同步通道：个人条目上行复用同一 PgSyncHub（与 sync:* 同一账本/审计）。
   * 缺省未接线 → 上行如实返回 stage=hub_init / code=E_SYNC_HUB_UNAVAILABLE，不写「已同步」。
   */
  personalSyncHub?: AnySyncHub;
}

/** home server 句柄：在 Server 上附加会话查询（主进程做管理员 IPC 校验用） */
export type HomeServer = Server & {
  /** 按 session id 取登录上下文（过期/不存在返回 null） */
  getSessionContext(sid: string | undefined): TenantContext | null;
  /** L0 密码失败锁定（§4.4.8：home-locks.json 的 l0:<user_id> 项，与登录锁定同文件不同 key） */
  getLockState(key: string): { failCount: number; lockedUntil?: number } | null;
  setLockState(key: string, state: { failCount: number; lockedUntil?: number }): void;
  clearLockState(key: string): void;
};

interface Session {
  context: TenantContext;
  form: Form;
  /** 登录时间（会话 TTL 判定） */
  at: number;
}

/** 会话有效期（12 小时；过期后 /api/me 返回 401，前端重新登录） */
const SESSION_TTL_MS = 12 * 3600 * 1000;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** 批次28-A：内核数据面白名单（只放存储方法；与 preload 数据面同一套边界；批次46-D6 增补项目注册表三方法） */
const KERNEL_METHODS = [
  'putMemory', 'getMemory', 'listMemories', 'deleteMemory', 'appendAudit', 'queryAudit',
  'createProject', 'getProject', 'listProjects',
] as const;

/**
 * 破坏性/账本色方法：仅 admin 会话可调用。
 * putMemory 等常规读写允许任意已登录成员（页面正常读写要用），
 * 但批次48 A7 起写入必须落在会话自己的租户/用户名下（shared/memoryOwnership.ts）。
 */
const ADMIN_ONLY_KERNEL_METHODS = new Set<string>(['deleteMemory', 'appendAudit']);

class BodyTooLargeError extends Error {}

function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer | string) => {
      if (tooLarge) return;
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        reject(new BodyTooLargeError('payload_too_large'));
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (tooLarge) return;
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

export function createServer(opts: ServerOptions): HomeServer {
  const auditFile = opts.dataFile;
  const lockFile = join(dirname(auditFile), 'home-locks.json');
  const accountsFile = join(dirname(auditFile), 'home-accounts.json');
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const captchaTtlMs = opts.captchaTtlMs ?? 5 * 60 * 1000;
  const log = opts.onLog ?? (() => {});
  mkdirSync(dirname(auditFile), { recursive: true });

  // 启动时恢复审计 + 锁定表 + 真实注册账号（确保重启后可登录）
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
  // 批次48 A9：账号文件损坏必须 fail-closed —— 不再把「文件存在但读不了/结构非法」当成首次启动，
  // 否则会播种默认口令管理员（admin/Admin@123456），等于把损坏当成全新环境静默开箱。
  // 处理：原件原样保留 + 复制一份 .corrupt-<ts> 备份 + 拒绝登录/注册（503 accounts_unreadable），
  // 由运维修复或移走损坏文件后重启恢复；本进程绝不覆盖写该文件。
  let accountsBroken: string | null = null;
  try {
    const raw = readFileSync(accountsFile, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error('账号文件格式不是数组');
    for (const item of parsed) {
      const a = item as Record<string, unknown> | null;
      if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('账号记录不是对象');
      if (typeof a.account !== 'string' || !a.account.trim()) throw new Error('账号记录缺少 account');
      if (typeof a.passwordHash !== 'string' || !a.passwordHash) throw new Error(`账号记录缺少 passwordHash（${String(a.account)}）`);
      if (typeof a.enterprise_id !== 'string' || typeof a.team_id !== 'string') {
        throw new Error(`账号记录缺少 enterprise_id/team_id（${String(a.account)}）`);
      }
    }
    importAccountSnapshot(parsed as Parameters<typeof importAccountSnapshot>[0]);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      /* 首次启动：无账号文件，等待真实注册/播种 */
    } else {
      accountsBroken = String((e as Error)?.message ?? e);
      let backup: string | null = null;
      try {
        backup = `${accountsFile}.corrupt-${Date.now()}`;
        copyFileSync(accountsFile, backup);
      } catch {
        backup = null;
      }
      log('home', 'accounts_unreadable', { error: accountsBroken, backup });
    }
  }

  // 批次48 A10：密码策略持久化（home-policy.json）。策略是配置不是凭据：文件坏了 → 回落默认并留日志，
  // 不阻塞登录；但保存后对「注册 / 修改密码」都真实生效（不再是前端 useState 假配置）。
  const policyFile = join(dirname(auditFile), 'home-policy.json');
  let pwdPolicy: PwdPolicy = DEFAULT_PWD_POLICY;
  try {
    pwdPolicy = normalizePwdPolicy(JSON.parse(readFileSync(policyFile, 'utf8')));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log('home', 'policy_unreadable', { error: String((e as Error)?.message ?? e) });
  }
  function persistPolicy(): void {
    writeFileSync(policyFile, JSON.stringify(pwdPolicy, null, 2));
  }

  // 批次7：内置管理员。无 admin 则播种（默认密码仅首次使用，登录后可改）；旧快照缺角色则升级。
  // 批次48 A9：账号文件损坏时不播种（accountsBroken 优先于任何回调）。
  if (opts.seedAdmin !== false && !accountsBroken) {
    const seeded = seedAdminAccount(opts.adminPassword);
    if (seeded.created || seeded.upgraded) {
      persistAccounts();
      appendAudit({ action: 'admin_seed', form: 'desktop', account: seeded.account, at: Date.now() });
      log('home', seeded.created ? 'admin_created' : 'admin_upgraded', { account: seeded.account });
    }
  }
  // 批次45-B2：启动首帧对账——快照导入的存量账号也登记进内核成员库
  //（播种路径经 persistAccounts 已同步，此处幂等兜底；created/updated=0 时零日志零写盘）
  if (opts.memberStore) {
    const r0: MemberSyncReport = syncMembersFromHomeNow(opts.memberStore);
    if (r0.created > 0 || r0.updated > 0) log('home', 'member_sync', { created: r0.created, updated: r0.updated, scanned: r0.scanned });
  }
  // mirror 上抛账本持久化（REQ-006 端壳 G6）
  // 批次48 A8：条目链式签名；读文件失败/密钥不可用 → 标记 fail-closed（拒收新条目，查询如实报告），
  // 不再把「解析失败」静默当成空账本继续覆盖写。
  const mirrorFile = join(dirname(auditFile), 'home-mirror.json');
  let mirrorAudit: MirrorAuditEntry[] = [];
  let mirrorLoadError: string | null = null;
  try {
    const raw = readFileSync(mirrorFile, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error('mirror 账本格式不是数组');
    mirrorAudit = parsed as MirrorAuditEntry[];
  } catch (e) {
    mirrorAudit = [];
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      mirrorLoadError = String((e as Error)?.message ?? e);
      log('home', 'mirror_ledger_unreadable', { error: mirrorLoadError });
    }
  }
  let mirrorKey: Buffer | null = null;
  let mirrorKeyError: string | null = null;
  try {
    mirrorKey = loadOrCreateMirrorKey(dirname(auditFile));
  } catch (e) {
    mirrorKeyError = String((e as Error)?.message ?? e);
    log('home', 'mirror_key_unavailable', { error: mirrorKeyError });
  }

  const sessions = new Map<string, Session>();

  // 验证码存储（简单实现，生产环境应存入 Redis/DB）
  const captchaStore = new Map<string, { code: string; expiresAt: number }>();

  // ── 批次26-B P2-14/P2-17：内存滑动窗口限速 ─────────────────────────────────
  // 锁定表落盘（home-locks.json）可被本机进程删除复位，这里的计数只在内存、删文件无效；
  // 同时限制了 scrypt 校验与验证码生成的触发频率。进程重启即清零 —— 只作爆破减速，不是隔离边界。
  const MAX_LOGIN_PER_MIN = 10;      // 每账号每分钟登录尝试（含失败；5 次错误即触发账号锁定，正常使用远达不到 10）
  const MAX_REGISTER_PER_MIN = 10;   // 注册接口全局限速（本机单用户服务）
  const MAX_CAPTCHA_PER_MIN = 30;    // 验证码签发全局限速
  const MAX_CAPTCHA_ENTRIES = 256;   // 验证码存量上限（防无限增长；超出淘汰最早签发）
  const rateWindows = new Map<string, number[]>();
  function rateLimited(bucket: string, max: number, windowMs = 60_000): boolean {
    const now = Date.now();
    const arr = (rateWindows.get(bucket) ?? []).filter((t) => now - t < windowMs);
    const limited = arr.length >= max;
    if (!limited) arr.push(now);
    rateWindows.set(bucket, arr);
    return limited;
  }

  function persistAudit(): void {
    writeFileSync(auditFile, JSON.stringify(audit, null, 2));
  }
  function persistLock(): void {
    writeFileSync(lockFile, JSON.stringify(exportLockSnapshot()));
  }
  function persistAccounts(): void {
    writeFileSync(accountsFile, JSON.stringify(exportAccountSnapshot(), null, 2));
    // 批次45-B2：账号域任何变更（注册/角色/团队/密码落盘）都汇聚到这里——
    // 顺路把 home 账号单向同步进内核成员库（幂等 upsert；缺 memberStore = 内核域未装配，跳过不报错）
    if (opts.memberStore) {
      const r = syncMembersFromHomeNow(opts.memberStore);
      if (r.created > 0 || r.updated > 0) log('home', 'member_sync', { created: r.created, updated: r.updated, scanned: r.scanned });
    }
  }
  function appendAudit(a: LoginAudit): void {
    audit.push(a);
    persistAudit();
  }
  function persistMirror(): void {
    writeFileSync(mirrorFile, JSON.stringify(mirrorAudit, null, 2));
  }
  function send(res: ServerResponse, code: number, body: unknown): void {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }
  function sessionIdOf(req: IncomingMessage): string | undefined {
    // 前端历史上用过 X-Auth-Session；两者都接受（x-session-id 优先）
    const raw = req.headers['x-session-id'] ?? req.headers['x-auth-session'];
    const h = Array.isArray(raw) ? raw[0] : raw;
    const sid = typeof h === 'string' ? h.trim() : '';
    return sid || undefined;
  }
  /** 取有效会话；过期即清理并返回 null */
  function getSession(sid: string | undefined): Session | null {
    if (!sid) return null;
    const s = sessions.get(sid);
    if (!s) return null;
    if (Date.now() - s.at > SESSION_TTL_MS) {
      sessions.delete(sid);
      return null;
    }
    return s;
  }

  /**
   * 批次26-B P1-9：按用户吊销全部会话。
   * 角色/团队/密码变更后旧会话立即失效 —— 会话里快照的 role/team 最长可活 12h，
   * 撤权/改密必须同步清会话，否则旧权限窗口仍在。返回吊销数量（0 = 该用户本无会话）。
   */
  function revokeSessionsOfUser(userId: string): number {
    let n = 0;
    for (const [sid, s] of sessions) {
      if (s.context.user_id === userId) {
        sessions.delete(sid);
        n += 1;
      }
    }
    if (n > 0) log('home', 'sessions_revoked', { user: userId, count: n });
    return n;
  }

  const originPolicy = createOriginPolicy(opts.allowedOrigins, { allowDev: opts.allowDevOrigins });

  const server = httpCreateServer((req, res) => {
    const startedAt = Date.now();
    // 批次7：每个 HTTP 动作留痕（方法/路径/状态/耗时；绝不记录密码或请求体）
    res.on('finish', () => {
      log('home', 'http', {
        method: req.method ?? '?',
        path: (req.url ?? '/').split('?')[0],
        status: res.statusCode,
        ms: Date.now() - startedAt,
      });
    });
    applyCorsHeaders(req, res, originPolicy);
    // 浏览器跨源闸门：非白名单来源（含 Origin: null）一律 403，防任意网页驱动本机服务
    if (rejectUntrustedOrigin(req, res, originPolicy)) {
      // 批次22：记录被拒来源与方法/路径，便于排查「登录后端未启动」实为来源白名单拦截
      log('home', 'origin_rejected', {
        origin: req.headers.origin ?? 'null',
        method: req.method ?? '?',
        path: (req.url ?? '/').split('?')[0],
      });
      return;
    }
    // 批次26-B P2-16：Host 头绑定 —— Host 必须是本机回环地址 + 本服务实际端口（防 DNS rebinding）
    const addr = server.address();
    const hostPort = addr && typeof addr === 'object' ? addr.port : (opts.port ?? 0);
    if (rejectUntrustedHost(req, res, [hostPort])) {
      log('home', 'host_rejected', {
        host: req.headers.host ?? 'none',
        method: req.method ?? '?',
        path: (req.url ?? '/').split('?')[0],
      });
      return;
    }
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
        // 批次22：健康探测（前端用 no-cors 探针区分「后端未启动」与「来源被拒」）
        if (req.method === 'GET' && path === '/api/health') {
          // ok/service 保持原探测语义（前端据 service==='home' 判定后端在线）；
          // accounts 字段明示账号域状态，损坏时前端/运维能看见而不是只看到「在线」。
          send(res, 200, { ok: true, service: 'home', ts: Date.now(), accounts: accountsBroken ? 'unreadable' : 'ok' });
          return;
        }

        if (req.method === 'POST' && path === '/api/register') {
          // 批次48 A9：账号文件损坏时拒绝注册（否则把损坏状态当空白环境写新文件，旧账号被静默丢弃）
          if (accountsBroken) { send(res, 503, { ok: false, reason: 'accounts_unreadable' }); return; }
          // 批次26-B P2-17：注册全局限速（防本机脚本批量刷号；正常使用一次注册 2 个请求，远达不到 10/min）
          if (rateLimited('register', MAX_REGISTER_PER_MIN)) {
            log('home', 'register_rate_limited', {});
            send(res, 429, { reason: 'rate_limited', message: '注册过于频繁，请稍后再试' });
            return;
          }
          const body = await readJsonBody(req, maxBodyBytes);
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

          // 验证码校验（一次性 + 过期即失效）
          const storedCaptcha = captchaStore.get(captchaId);
          const expired = !storedCaptcha || storedCaptcha.expiresAt < Date.now();
          if (expired || storedCaptcha.code !== captchaCode) {
            if (storedCaptcha) captchaStore.delete(captchaId);
            send(res, 400, { reason: 'invalid_captcha', message: '验证码错误或已过期' });
            return;
          }
          captchaStore.delete(captchaId); // 一次性使用

          // 只查账号是否存在，绝不用错误密码调用 login()：
          // 旧实现会把已存在账号的 failCount 累加（5 次注册即可锁死账号），
          // 且对锁定账号会落库覆盖 passwordHash（账号接管）。
          if (hasAccount(account)) {
            send(res, 409, { reason: 'exists', message: '账号已存在' });
            return;
          }

          // 批次48 A10：注册密码按已持久化策略校验（与安全页展示同一份策略）。
          // 放在 hasAccount 之后：重复注册仍回 409（防枚举/防接管优先），不对密码强度做额外区分。
          const policyErr = validatePasswordAgainstPolicy(password, pwdPolicy);
          if (policyErr) {
            send(res, 400, { reason: 'weak_password', message: policyErr });
            return;
          }

          // 新用户注册
          const teamId = `personal-${account}`;
          registerAccount(account, hashPassword(password), { enterprise_id: 'local', team_id: teamId, perspective: 'personal' });
          persistAccounts();
          // 注册即分配个人团队 = team_assign；不得伪装成 login 审计（会污染登录统计）
          appendAudit({ action: 'team_assign', form: 'desktop', account, at: Date.now() });
          log('home', 'register', { account, team: teamId });
          send(res, 200, { ok: true, team_id: teamId, message: '注册成功' });
          return;
        }

        if (req.method === 'GET' && path === '/api/captcha') {
          // 本地应用没有短信/邮件通道：验证码直出给本机用户（一次性消费，TTL 可配）
          // 批次26-B P2-17：签发限速 + 存量上限（Map 不再无限增长）
          if (rateLimited('captcha', MAX_CAPTCHA_PER_MIN)) {
            log('home', 'captcha_rate_limited', {});
            send(res, 429, { reason: 'rate_limited', message: '验证码请求过于频繁，请稍后再试' });
            return;
          }
          const now = Date.now();
          for (const [k, v] of captchaStore) if (v.expiresAt < now) captchaStore.delete(k);
          while (captchaStore.size >= MAX_CAPTCHA_ENTRIES) {
            const oldest = captchaStore.keys().next().value;
            if (oldest === undefined) break;
            captchaStore.delete(oldest);
          }
          const id = randomUUID();
          const code = String(Math.floor(100000 + Math.random() * 900000));
          captchaStore.set(id, { code, expiresAt: now + captchaTtlMs });
          send(res, 200, { id, code });
          return;
        }

        if (req.method === 'POST' && path === '/api/login') {
          // 批次48 A9：账号文件损坏 → 明示拒绝（不伪装成「密码错」，也不让默认管理员顶替）
          if (accountsBroken) { send(res, 503, { ok: false, reason: 'accounts_unreadable' }); return; }
          const body = await readJsonBody(req, maxBodyBytes);
          const account = typeof body.account === 'string' ? body.account : '';
          const password = typeof body.password === 'string' ? body.password : '';
          const form = (typeof body.form === 'string' ? body.form : 'desktop') as Form;
          // 批次26-B P2-14：内存滑动窗口限速 —— 锁定文件可被删除复位，这里删不掉；
          // 同时约束了 scrypt 校验触发频率（P2-17）。失败尝试也计入。
          if (rateLimited(`login:${account}`, MAX_LOGIN_PER_MIN)) {
            log('home', 'login_rate_limited', { account });
            send(res, 429, { reason: 'rate_limited' });
            return;
          }
          const result = login({ account, password, form });
          persistLock(); // 每次登录后落盘锁定态（★ 持久化要点）

          if (result.ok) {
            const sid = result.context.session_id;
            sessions.set(sid, { context: result.context, form, at: Date.now() });
            appendAudit(result.audit);
            log('home', 'login_ok', { account, role: result.context.role ?? 'member', form });
            // 批次26-B P2-14：内置管理员仍在用初始口令 → 每次登录告警（提示尽快在安全页修改；不记录口令）
            if (result.context.role === 'admin' && isDefaultAdminPasswordInUse()) {
              log('home', 'default_password_active', { account: result.context.user_id });
            }
            send(res, 200, { context: result.context, sessionId: sid, audit: result.audit });
            return;
          }
          appendAudit(result.audit);
          log('home', 'login_fail', { account, reason: result.reason, form });
          if (result.reason === 'locked') send(res, 423, { reason: 'locked', lockedUntil: result.lockedUntil });
          else if (result.reason === 'empty') send(res, 400, { reason: 'empty' });
          // 批次26-B P2-17 防用户名枚举：账号不存在与密码错误返回同一响应（真实原因只在服务端日志/审计）
          // wrong 时携带 remaining/failCount 供前端预警剩余次数；no_account 走此分支但不带该字段（不泄露账号存在性）
          else send(res, 401, { reason: 'wrong', remaining: result.remaining, failCount: result.failCount });
          return;
        }

        if (req.method === 'POST' && path === '/api/logout') {
          const sid = sessionIdOf(req);
          const s = getSession(sid);
          if (sid && s) {
            sessions.delete(sid);
            appendAudit({ action: 'logout', form: s.form, account: s.context.user_id, at: Date.now() });
            log('home', 'logout', { account: s.context.user_id });
            send(res, 200, { ok: true });
          } else {
            send(res, 401, { ok: false, reason: 'no_session' });
          }
          return;
        }

        if (req.method === 'GET' && path === '/api/me') {
          const s = getSession(sessionIdOf(req));
          if (s) {
            send(res, 200, { context: s.context });
          } else {
            send(res, 401, { ok: false });
          }
          return;
        }

        // ── 批次28-A：内核数据面（浏览器凭登录会话直连记忆账本）──────────────
        // appendAudit 走与 preload 数据面（批次26-B P1-2）同一形状校验，拒绝伪造/畸形审计行。
        // 每次请求的来源/状态/耗时已由上方 home:http 日志统一留痕，这里不再逐调用刷日志。
        if (req.method === 'GET' && path === '/api/kernel/info') {
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          if (!opts.kernelStorage) { send(res, 501, { ok: false, reason: 'kernel_unavailable' }); return; }
          send(res, 200, {
            ok: true,
            available: true,
            readonly: opts.kernelInfo?.readonly ?? false,
            db_path: opts.kernelInfo?.db_path ?? null,
          });
          return;
        }

        if (req.method === 'POST' && path === '/api/kernel/invoke') {
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          if (!opts.kernelStorage) { send(res, 501, { ok: false, reason: 'kernel_unavailable' }); return; }
          const body = await readJsonBody(req, maxBodyBytes);
          const method = typeof body.method === 'string' ? body.method : '';
          if (!(KERNEL_METHODS as readonly string[]).includes(method)) {
            send(res, 400, { ok: false, error: `不支持的方法：${method || '(空)'}` });
            return;
          }
          // 批次47 P0-2：方法级角色闸门。此前只校验会话存在 → member 可删记忆、可写账本审计。
          if (ADMIN_ONLY_KERNEL_METHODS.has(method) && s.context.role !== 'admin') {
            log('home', 'kernel_invoke_forbidden', {
              method,
              user_id: s.context.user_id,
              role: s.context.role,
            });
            send(res, 403, { ok: false, reason: 'forbidden', error: '该操作需管理员账号' });
            return;
          }
          const args = Array.isArray(body.args) ? body.args : [];
          if (method === 'appendAudit') {
            try {
              validateAuditRecord(args[0]);
            } catch (e) {
              send(res, 400, { ok: false, error: e instanceof Error ? e.message : 'invalid audit record' });
              return;
            }
          }
          try {
            const member = opts.kernelStorage[method as keyof StorageBackend] as ((...a: unknown[]) => Promise<unknown>) | undefined;
            if (typeof member !== 'function') {
              send(res, 400, { ok: false, error: `不支持的方法：${method || '(空)'}` });
              return;
            }
            // 批次48 A7：putMemory 归属校验 —— 非管理员只能写自己租户/自己用户名下，
            // 且不得覆盖他人/他租户已有行（含墓碑）。管理员不受限（调用方在此留痕）。
            if (method === 'putMemory') {
              const existing = await findExistingMemoryRow(opts.kernelStorage, args[0]);
              const verdict = checkMemoryWriteOwnership({ incoming: args[0], existing, session: s.context });
              if (!verdict.ok) {
                log('home', 'kernel_put_ownership_denied', {
                  user_id: s.context.user_id,
                  role: s.context.role,
                  reason: verdict.reason,
                });
                send(res, 403, { ok: false, reason: 'forbidden', error: verdict.reason });
                return;
              }
            }
            // .call 以接收者调用（fn(...args) 会丢 this，内存后端字段全挂在实例上）
            const result = await member.call(opts.kernelStorage, ...args);
            send(res, 200, { ok: true, result });
          } catch (e) {
            // 只读镜像的写入拒绝（E_STORAGE_LOCKED 等）原样回传文案，前端如实提示
            send(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) });
          }
          return;
        }

        // ── 第一轮个人记忆本机闭环：独立存储数据面（与 kernelStorage 分开）──────────────
        // owner 一律取登录会话 user_id，请求体不得自报归属；每个写动作经内核落 personal_memory 审计。
        if (req.method === 'POST' && path === '/api/personal/invoke') {
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          if (!opts.personalStore || !opts.kernelStorage) {
            send(res, 501, { ok: false, reason: 'personal_unavailable' });
            return;
          }
          const body = await readJsonBody(req, maxBodyBytes);
          const op = typeof body.op === 'string' ? body.op : '';
          const payload = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>;
          const id = typeof payload.id === 'string' ? payload.id : '';
          const api = createPersonalApi({
            store: opts.personalStore,
            owner: s.context.user_id,
            kernelUserId: opts.personalKernelUserId,
            ownerBindings: opts.personalOwnerBindings,
            form: 'web',
            team_id: s.context.team_id,
            enterprise_id: s.context.enterprise_id,
            // 真实 PgSyncHub：与 sync:* 同一中枢账本；未接线时上行如实失败（不伪造已同步）
            sync: opts.personalSyncHub ? { push: (m, f) => opts.personalSyncHub!.push(m, f) } : undefined,
            appendAudit: (a) => opts.kernelStorage!.appendAudit(a),
          });
          try {
            switch (op) {
              case 'list': send(res, 200, { ok: true, result: await api.list() }); return;
              case 'quick_add': send(res, 200, { ok: true, result: await api.quickAdd(String(payload.content ?? '')) }); return;
              case 'import_from_agent': send(res, 200, {
                ok: true,
                result: await api.importFromAgent({
                  content: String(payload.content ?? ''),
                  sourceAgent: String(payload.source_agent ?? ''),
                  sourceRefId: String(payload.source_ref_id ?? ''),
                  originTs: typeof payload.origin_ts === 'number' ? payload.origin_ts : undefined,
                }),
              }); return;
              case 'reject_from_agent': send(res, 200, {
                ok: true,
                result: await api.rejectFromAgent({
                  content: String(payload.content ?? ''),
                  sourceAgent: String(payload.source_agent ?? ''),
                  sourceRefId: String(payload.source_ref_id ?? ''),
                  originTs: typeof payload.origin_ts === 'number' ? payload.origin_ts : undefined,
                }),
              }); return;
              case 'confirm': send(res, 200, { ok: true, result: await api.confirm(id) }); return;
              case 'reject': send(res, 200, { ok: true, result: await api.reject(id) }); return;
              case 'revoke': send(res, 200, { ok: true, result: await api.revoke(id) }); return;
              case 'delete': send(res, 200, { ok: true, result: await api.remove(id, payload.confirm === true) }); return;
              case 'push_team': send(res, 200, {
                ok: true,
                result: await api.pushToTeam(id, {
                  explicit: payload.explicit === true,
                  team_id: typeof payload.team_id === 'string' ? payload.team_id : undefined,
                }),
              }); return;
              case 'retry_sync': send(res, 200, { ok: true, result: await api.retrySync(id) }); return;
              default:
                send(res, 400, { ok: false, error: `不支持的个人记忆动作：${op || '(空)'}` });
                return;
            }
          } catch (e) {
            // 状态机拒绝 / 未注入等如实回传（带错误码），不伪造成功
            const code = (e as { code?: unknown })?.code;
            send(res, 200, {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
              ...(typeof code === 'string' ? { code } : {}),
            });
          }
          return;
        }

        // ── 批次7：管理员账号管理（仅 admin 会话可调用）──────────────────────
        if (req.method === 'GET' && path === '/api/accounts') {
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          if (s.context.role !== 'admin') {
            log('home', 'accounts_forbidden', { account: s.context.user_id });
            send(res, 403, { ok: false, reason: 'forbidden' });
            return;
          }
          send(res, 200, { ok: true, items: listAccounts() });
          return;
        }

        if (req.method === 'POST' && path === '/api/accounts/update') {
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          if (s.context.role !== 'admin') {
            log('home', 'accounts_update_forbidden', { account: s.context.user_id });
            send(res, 403, { ok: false, reason: 'forbidden' });
            return;
          }
          const body = await readJsonBody(req, maxBodyBytes);
          const target = typeof body.account === 'string' ? body.account.trim() : '';
          if (!target || !hasAccount(target)) { send(res, 404, { ok: false, error: '账号不存在' }); return; }
          let changed = false;
          if (body.role === 'admin' || body.role === 'member') {
            const r = setAccountRole(target, body.role as AccountRole);
            if (!r.ok) { send(res, 400, { ok: false, error: r.error }); return; }
            appendAudit({ action: 'role_change', form: 'desktop', account: target, at: Date.now() });
            revokeSessionsOfUser(target); // P1-9：角色已变，目标账号全部旧会话立即失效
            log('home', 'role_change', { by: s.context.user_id, account: target, role: body.role });
            changed = true;
          }
          if (typeof body.team_id === 'string') {
            const r = assignAccountTeam(target, body.team_id);
            if (!r.ok) { send(res, 400, { ok: false, error: r.error }); return; }
            appendAudit({ action: 'team_assign', form: 'desktop', account: target, at: Date.now() });
            revokeSessionsOfUser(target); // P1-9：会话快照的 team_id 同样会过期，一并吊销
            log('home', 'team_assign', { by: s.context.user_id, account: target, team: body.team_id });
            changed = true;
          }
          if (!changed) { send(res, 400, { ok: false, error: '未提供 role/team_id' }); return; }
          persistAccounts();
          send(res, 200, { ok: true, items: listAccounts() });
          return;
        }

        // ── 批次45-B3：成员 API 密钥管理（仅 admin 会话；明文只在 mint 响应出现一次）─────────
        if (req.method === 'GET' && path === '/api/keys') {
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          if (s.context.role !== 'admin') {
            log('home', 'keys_forbidden', { account: s.context.user_id });
            send(res, 403, { ok: false, reason: 'forbidden' });
            return;
          }
          if (!opts.memberStore) { send(res, 501, { ok: false, error: '内核成员库未装配（memberStore）' }); return; }
          // 视图只含元数据：secret_hash 是 sha256，仍不外泄（无用且无必要）
          const items = opts.memberStore.listApiKeys({ include_revoked: true }).map((k) => ({
            key_id: k.key_id, owner_member_id: k.owner_member_id, scope_project_ids: k.scope_project_ids,
            label: k.label, created_at: k.created_at, created_by: k.created_by,
            revoked_at: k.revoked_at, revoked_by: k.revoked_by,
          }));
          send(res, 200, { ok: true, items });
          return;
        }

        if (req.method === 'POST' && path === '/api/keys/mint') {
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          if (s.context.role !== 'admin') {
            log('home', 'keys_mint_forbidden', { account: s.context.user_id });
            send(res, 403, { ok: false, reason: 'forbidden' });
            return;
          }
          if (!opts.memberStore) { send(res, 501, { ok: false, error: '内核成员库未装配（memberStore）' }); return; }
          const body = await readJsonBody(req, maxBodyBytes);
          const owner = typeof body.owner_member_id === 'string' ? body.owner_member_id.trim() : '';
          const scope = Array.isArray(body.scope_project_ids) ? body.scope_project_ids : [];
          const label = typeof body.label === 'string' ? body.label.trim() : undefined;
          if (!owner || scope.length === 0 || scope.some((x) => typeof x !== 'string' || !x.trim())) {
            send(res, 400, { ok: false, error: 'owner_member_id 与 scope_project_ids（非空字符串数组）必填' });
            return;
          }
          try {
            const minted = opts.memberStore.mintApiKey({
              owner_member_id: owner,
              scope_project_ids: scope.map((x) => String(x).trim()),
              ...(label ? { label } : {}),
              created_by: s.context.user_id,
            });
            // 审计不含明文（key_id 是可追溯句柄；明文只在本次响应出现一次）
            appendAudit({ action: 'key_mint', form: 'desktop', account: s.context.user_id, at: Date.now() });
            log('home', 'key_mint', { by: s.context.user_id, owner, key_id: minted.record.key_id, scope: minted.record.scope_project_ids });
            send(res, 200, { ok: true, key: minted.key, record: { ...minted.record, secret_hash: undefined } });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            log('home', 'key_mint_rejected', { by: s.context.user_id, owner, error: msg });
            send(res, 400, { ok: false, error: msg });
          }
          return;
        }

        if (req.method === 'POST' && path === '/api/keys/revoke') {
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          if (s.context.role !== 'admin') {
            log('home', 'keys_revoke_forbidden', { account: s.context.user_id });
            send(res, 403, { ok: false, reason: 'forbidden' });
            return;
          }
          if (!opts.memberStore) { send(res, 501, { ok: false, error: '内核成员库未装配（memberStore）' }); return; }
          const body = await readJsonBody(req, maxBodyBytes);
          const keyId = typeof body.key_id === 'string' ? body.key_id.trim() : '';
          if (!keyId) { send(res, 400, { ok: false, error: 'key_id 必填' }); return; }
          const rec = opts.memberStore.revokeApiKey(keyId, s.context.user_id);
          if (!rec) { send(res, 404, { ok: false, error: '密钥不存在' }); return; }
          appendAudit({ action: 'key_revoke', form: 'desktop', account: s.context.user_id, at: Date.now() });
          log('home', 'key_revoke', { by: s.context.user_id, key_id: keyId, owner: rec.owner_member_id });
          send(res, 200, { ok: true, record: { ...rec, secret_hash: undefined } });
          return;
        }

        if (req.method === 'POST' && path === '/api/password') {
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          const body = await readJsonBody(req, maxBodyBytes);
          const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
          const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
          // 批次48 A10：改密按已持久化策略校验（先于账号存在性/旧密码，避免策略形同虚设）
          const policyErr = validatePasswordAgainstPolicy(newPassword, pwdPolicy);
          if (policyErr) {
            log('home', 'password_change_fail', { account: s.context.user_id, reason: 'policy' });
            send(res, 400, { ok: false, reason: 'weak', error: policyErr });
            return;
          }
          const r = changePassword(s.context.user_id, oldPassword, newPassword);
          if (!r.ok) {
            log('home', 'password_change_fail', { account: s.context.user_id, reason: r.reason });
            const code = r.reason === 'no_account' ? 404 : r.reason === 'wrong' ? 401 : 400;
            send(res, code, { ok: false, reason: r.reason });
            return;
          }
          appendAudit({ action: 'password_change', form: 'desktop', account: s.context.user_id, at: Date.now() });
          revokeSessionsOfUser(s.context.user_id); // P1-9：改密后该账号全部会话（含当前）失效，须重新登录
          persistAccounts();
          log('home', 'password_change', { account: s.context.user_id });
          send(res, 200, { ok: true });
          return;
        }

        // 批次48 A10：密码策略读写（GET 任意登录会话；POST 仅 admin，真实落盘 .data/home-policy.json）
        if (req.method === 'GET' && path === '/api/policy') {
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          send(res, 200, { ok: true, policy: pwdPolicy });
          return;
        }
        if (req.method === 'POST' && path === '/api/policy') {
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          if (s.context.role !== 'admin') {
            log('home', 'policy_update_denied', { account: s.context.user_id });
            send(res, 403, { ok: false, reason: 'forbidden' });
            return;
          }
          const body = await readJsonBody(req, maxBodyBytes);
          pwdPolicy = normalizePwdPolicy(body.policy ?? body);
          persistPolicy();
          log('home', 'policy_update', { account: s.context.user_id, policy: pwdPolicy });
          send(res, 200, { ok: true, policy: pwdPolicy });
          return;
        }

        // REQ-006 端壳 mirror 上抛（G6 全动作审计持久账本）
        // 批次47 P0-1：此账本是审计页 G6 的展示数据源，必须绑定登录会话。
        // 此前匿名可写 → 任意本机进程都能伪造"安全操作已审计"的假证据。
        if (req.method === 'POST' && path === '/api/mirror/audit') {
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          // 批次48 A8：账本读不了 / 密钥不可用 → 拒收（fail-closed），绝不在未知状态上追加
          if (mirrorLoadError) { send(res, 503, { ok: false, reason: 'mirror_ledger_unreadable' }); return; }
          if (!mirrorKey) { send(res, 503, { ok: false, reason: 'mirror_key_unavailable' }); return; }
          const body = await readJsonBody(req, maxBodyBytes);
          const prevHash = mirrorAudit.length > 0 && mirrorAudit[mirrorAudit.length - 1].hash
            ? mirrorAudit[mirrorAudit.length - 1].hash!
            : GENESIS_HASH;
          const entry = sealMirrorEntry({
            seq: mirrorAudit.length + 1,
            source: typeof body.source === 'string' ? body.source : 'unknown',
            action: typeof body.action === 'string' ? body.action : 'unknown',
            request_id: typeof body.request_id === 'string' ? body.request_id : undefined,
            payload: body.payload ?? null,
            ts: Date.now(),
          }, prevHash, mirrorKey);
          mirrorAudit.push(entry);
          persistMirror();
          send(res, 200, { ok: true, seq: entry.seq, hash: entry.hash });
          return;
        }

        if (req.method === 'GET' && path === '/api/mirror/audit') {
          // 批次47 P0-1：查询侧同样要求真实会话（防止匿名读取全量端动作账本）
          const s = getSession(sessionIdOf(req));
          if (!s) { send(res, 401, { ok: false, reason: 'no_session' }); return; }
          const q = new URL(url, 'http://localhost').searchParams;
          const source = q.get('source');
          const limit = Math.max(1, Math.min(500, Number(q.get('limit') ?? 50) || 50));
          const items = mirrorAudit.filter((e) => !source || e.source === source).slice(-limit);
          // 批次48 A8：整条链的完整校验结果随查询返回；旧的无签名条目如实计为 legacy_unsealed
          let integrity: MirrorIntegrity & { algorithm: string; note: string; load_error?: string };
          if (mirrorLoadError) {
            integrity = { ok: false, sealed: 0, legacy_unsealed: 0, reason: 'ledger_unreadable', algorithm: 'HMAC-SHA256(chain)', note: MIRROR_INTEGRITY_NOTE, load_error: mirrorLoadError };
          } else if (!mirrorKey) {
            integrity = { ok: false, sealed: 0, legacy_unsealed: 0, reason: 'key_unavailable', algorithm: 'HMAC-SHA256(chain)', note: MIRROR_INTEGRITY_NOTE };
          } else {
            integrity = { ...verifyMirrorChain(mirrorAudit, mirrorKey), algorithm: 'HMAC-SHA256(chain)', note: MIRROR_INTEGRITY_NOTE };
          }
          send(res, 200, { items, total: mirrorAudit.length, integrity });
          return;
        }

        send(res, 404, { error: 'not found' });
      })
      .catch((e) => {
        if (res.headersSent) return;
        if (e instanceof BodyTooLargeError) {
          send(res, 413, { ok: false, error: 'payload_too_large' });
          return;
        }
        if (e instanceof Error && e.message === 'invalid json') {
          send(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        send(res, 500, { error: 'server error' });
      });
  });

  const homeServer = server as HomeServer;
  homeServer.getSessionContext = (sid) => getSession(sid)?.context ?? null;
  homeServer.getLockState = (key) => readLockState(key);
  homeServer.setLockState = (key, state) => { writeLockState(key, state); persistLock(); };
  homeServer.clearLockState = (key) => { clearLockState(key); persistLock(); };
  return homeServer;
}

// 便于测试：暴露重置钩子（仅测试用，不影响服务端逻辑）
export { registerAccount, resetAuthStore };
