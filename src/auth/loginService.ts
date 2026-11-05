// REQ-005 T3：登录业务逻辑 + 锁定策略（规格 §0.3 / §4.2 / §4.3）
// 职责：账号密码校验、连续失败锁定、成功注入全局租户上下文、产出审计事件。
// 零依赖（仅 Node crypto）。内存用户表 + 内存锁定表，作为纯逻辑内核，审计通过返回值上抛，
// 由 T10 后端落盘（本任务不直连 DB，满足「审计通过注入后端，只产出 action 描述」边界）。
// 团队 team_id 由管理员在账号页（P12）分配，登录时只读消费账户记录，绝不来自用户输入（§0.1/18.2-A）。
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from './hash.ts';
import type { LoginForm, LoginAudit, LoginResult, TenantContext, Perspective, AccountRole } from '../types/home.ts';

/** 连续失败达到该次数后，下一次登录被锁定（§4.2：错 5 次锁 15min → 第 6 次 locked） */
export const LOCK_THRESHOLD = 5;
/** 锁定时长：15 分钟（§4.2） */
export const LOCK_WINDOW_MS = 15 * 60 * 1000;

/** 内置管理员（批次7）：固定账号名；初始密码仅在首次播种时使用，登录后可在安全页修改 */
export const ADMIN_ACCOUNT = 'admin';
/** 内置管理员初始密码（阶段1 安全前置）：环境变量 ADMIN_SEED_PASSWORD 优先，缺省回退出厂默认值（仅首次播种使用）。生产部署应覆盖 */
export const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD || 'Admin@123456';

/** 内存用户记录：team_id / enterprise_id / perspective / role 均为管理员分配，用户只读 */
interface AccountRecord {
  account: string;
  passwordHash: string;
  enterprise_id: string;
  team_id: string;
  perspective: Perspective;
  /** 批次7：admin = 系统最高权限；旧快照缺省按 member 迁移 */
  role?: AccountRole;
  createdAt?: string;
}

/** 对外账号视图（不含密码哈希） */
export interface AccountView {
  account: string;
  role: AccountRole;
  team_id: string;
  enterprise_id: string;
  perspective: Perspective;
  createdAt?: string;
}

/** 内存锁定态（§4.2 连续失败计数 + 锁定到期时间戳） */
interface LockState {
  failCount: number;
  lockedUntil?: number;
}

const accounts = new Map<string, AccountRecord>();
const locks = new Map<string, LockState>();

/**
 * 注册账户（供种子/T10 后端装载，测试用）。生产环境应由管理员在 P12 分配 team_id 后写入。
 */
export function registerAccount(
  account: string,
  passwordHash: string,
  opts: { enterprise_id: string; team_id: string; perspective?: Perspective; role?: AccountRole; createdAt?: string },
): void {
  accounts.set(account, {
    account,
    passwordHash,
    enterprise_id: opts.enterprise_id,
    team_id: opts.team_id,
    perspective: opts.perspective ?? 'team',
    role: opts.role ?? 'member',
    createdAt: opts.createdAt ?? new Date().toISOString(),
  });
}

/** 账号是否已注册（只读判定，不触发密码校验/失败计数） */
export function hasAccount(account: string): boolean {
  return accounts.has(account);
}

/** 清空全部账户与锁定态（测试隔离用，生产不调用） */
export function resetAuthStore(): void {
  accounts.clear();
  locks.clear();
}

/** 导出账户快照（供后端落盘，保证真实注册的账号重启后仍可登录） */
export function exportAccountSnapshot(): AccountRecord[] {
  return [...accounts.values()].map((a) => ({ ...a }));
}

/** 从快照恢复账户（仅内存装载；密码仍是哈希，不含明文） */
export function importAccountSnapshot(list: AccountRecord[]): void {
  for (const a of list) {
    if (!a || typeof a.account !== 'string' || typeof a.passwordHash !== 'string') continue;
    // 旧快照无 role/createdAt：按 member 迁移，避免已有用户被静默提权
    accounts.set(a.account, {
      ...a,
      role: a.role === 'admin' ? 'admin' : 'member',
      createdAt: typeof a.createdAt === 'string' ? a.createdAt : undefined,
    });
  }
}

/** 账号视图列表（不含密码哈希；按 createdAt 升序，管理员排在最前） */
export function listAccounts(): AccountView[] {
  return [...accounts.values()]
    .map((a): AccountView => ({
      account: a.account,
      role: a.role === 'admin' ? 'admin' : 'member',
      team_id: a.team_id,
      enterprise_id: a.enterprise_id,
      perspective: a.perspective,
      createdAt: a.createdAt,
    }))
    .sort((x, y) => (x.role === y.role ? (x.createdAt ?? '').localeCompare(y.createdAt ?? '') : x.role === 'admin' ? -1 : 1));
}

/** 当前管理员数量（用于「最后一个管理员不可降级」保护） */
export function adminCount(): number {
  return [...accounts.values()].filter((a) => a.role === 'admin').length;
}

/** 批次26-B P2-14：内置管理员是否仍在用初始口令（只读判定，供登录/启动告警；绝不返回口令本身） */
export function isDefaultAdminPasswordInUse(): boolean {
  const rec = accounts.get(ADMIN_ACCOUNT);
  if (!rec) return false;
  return verifyPassword(DEFAULT_ADMIN_PASSWORD, rec.passwordHash);
}

/**
 * 内置管理员播种（批次7）：无 admin 账号则创建；已有 admin 但角色缺失（旧快照）则升级为 admin。
 * 绝不覆盖已有 admin 的密码；返回 created/upgraded 便于审计与日志。
 */
export function seedAdminAccount(password: string = DEFAULT_ADMIN_PASSWORD): { account: string; created: boolean; upgraded: boolean } {
  const existing = accounts.get(ADMIN_ACCOUNT);
  if (existing) {
    if (existing.role === 'admin') return { account: ADMIN_ACCOUNT, created: false, upgraded: false };
    existing.role = 'admin';
    existing.perspective = 'enterprise';
    return { account: ADMIN_ACCOUNT, created: false, upgraded: true };
  }
  accounts.set(ADMIN_ACCOUNT, {
    account: ADMIN_ACCOUNT,
    passwordHash: hashPassword(password),
    enterprise_id: 'local',
    team_id: 'admin-team',
    perspective: 'enterprise',
    role: 'admin',
    createdAt: new Date().toISOString(),
  });
  return { account: ADMIN_ACCOUNT, created: true, upgraded: false };
}

/**
 * 修改密码（仅登录态调用；旧密码必须匹配）。
 * 规则：新密码 ≥8 位且不得与旧密码相同（4.2 的完整策略由前端实时校验提示）。
 */
export function changePassword(
  account: string,
  oldPassword: string,
  newPassword: string,
): { ok: true } | { ok: false; reason: 'no_account' | 'wrong' | 'weak' | 'same' } {
  const rec = accounts.get(account);
  if (!rec) return { ok: false, reason: 'no_account' };
  if (!verifyPassword(oldPassword, rec.passwordHash)) return { ok: false, reason: 'wrong' };
  if (newPassword.length < 8) return { ok: false, reason: 'weak' };
  if (newPassword === oldPassword) return { ok: false, reason: 'same' };
  rec.passwordHash = hashPassword(newPassword);
  return { ok: true };
}

/** 设置角色（管理员接口调用；最后一个管理员不可降级） */
export function setAccountRole(target: string, role: AccountRole): { ok: true } | { ok: false; error: string } {
  const rec = accounts.get(target);
  if (!rec) return { ok: false, error: '账号不存在' };
  if (role === 'member' && rec.role === 'admin' && adminCount() <= 1) {
    return { ok: false, error: '不能降级最后一个管理员' };
  }
  rec.role = role;
  return { ok: true };
}

/** 分配团队（管理员接口调用；团队只读给用户，管理员可改） */
export function assignAccountTeam(target: string, teamId: string): { ok: true } | { ok: false; error: string } {
  const rec = accounts.get(target);
  if (!rec) return { ok: false, error: '账号不存在' };
  const team = teamId.trim();
  if (!team) return { ok: false, error: '团队 ID 不能为空' };
  rec.team_id = team;
  return { ok: true };
}

function getLock(account: string): LockState {
  let s = locks.get(account);
  if (!s) {
    s = { failCount: 0 };
    locks.set(account, s);
  }
  return s;
}

/** 查询某账号的锁定态（供 UI 预提示「已锁定，请 N 分钟后重试」） */
export function lockoutState(account: string): { locked: boolean; failCount: number; lockedUntil?: number } {
  const s = getLock(account);
  const now = Date.now();
  const locked = s.lockedUntil !== undefined && now < s.lockedUntil;
  return { locked, failCount: s.failCount, lockedUntil: s.lockedUntil };
}

/**
 * 导出锁定态快照（供 T10 后端持久化，进程重启后恢复锁定表）。
 * 纯读取，不改变任何状态（对 T3 既有逻辑/测试无副作用）。
 */
export function exportLockSnapshot(): Record<string, LockState> {
  const out: Record<string, LockState> = {};
  for (const [k, v] of locks) {
    out[k] = v.lockedUntil !== undefined ? { failCount: v.failCount, lockedUntil: v.lockedUntil } : { failCount: v.failCount };
  }
  return out;
}

/** 读取任意锁定 key（§4.4.8：L0 复用同一张表的 `l0:<user_id>` 项） */
export function readLockState(key: string): LockState | null {
  const s = locks.get(key);
  return s ? { failCount: s.failCount, lockedUntil: s.lockedUntil } : null;
}

/** 写入任意锁定 key（L0 密码失败计数；调用方负责持久化与审计） */
export function writeLockState(key: string, state: LockState): void {
  locks.set(key, { failCount: state.failCount, lockedUntil: state.lockedUntil });
}

/** 清除任意锁定 key（L0 解锁成功/锁定期满） */
export function clearLockState(key: string): void {
  locks.delete(key);
}

/**
 * 从快照恢复锁定态（T10 后端启动时调用，保证重启后锁定表保留）。
 * 仅覆盖失败计数与到期时间戳；不触碰账号记录。
 */
export function importLockSnapshot(snap: Record<string, LockState>): void {
  locks.clear();
  for (const [k, v] of Object.entries(snap)) {
    if (typeof v.failCount === 'number') {
      locks.set(k, { failCount: v.failCount, lockedUntil: v.lockedUntil });
    }
  }
}

function audit(action: 'login' | 'login_fail', form: LoginForm['form'], account: string): LoginAudit {
  return { action, form, account, at: Date.now() };
}

/**
 * 登录核心（§0.3 / §4.2 / §4.3）。
 * 流程：空账号→empty；账号不存在→no_account；锁定期内→locked；
 * 密码错→wrong 并累加失败计数（达阈值置 lockedUntil）；成功→注入 TenantContext + 审计 action=login。
 */
export function login(input: LoginForm): LoginResult {
  const now = Date.now();
  const account = input.account;

  // 账号空：客户端校验前置，不计入锁定
  if (!account) {
    return { ok: false, reason: 'empty', audit: audit('login_fail', input.form, account) };
  }

  const rec = accounts.get(account);
  if (!rec) {
    return { ok: false, reason: 'no_account', audit: audit('login_fail', input.form, account) };
  }

  const state = getLock(account);

  // 锁定已到期：放行并清零失败计数，允许重试（满足「锁定到期后可重试」）
  if (state.lockedUntil !== undefined) {
    if (now < state.lockedUntil) {
      return { ok: false, reason: 'locked', lockedUntil: state.lockedUntil, audit: audit('login_fail', input.form, account) };
    }
    state.failCount = 0;
    state.lockedUntil = undefined;
  }

  if (verifyPassword(input.password, rec.passwordHash)) {
    // 成功：清零锁定态
    state.failCount = 0;
    state.lockedUntil = undefined;
    const context: TenantContext = {
      enterprise_id: rec.enterprise_id,
      team_id: rec.team_id, // 管理员分配只读，非来自用户输入
      user_id: account,
      perspective: rec.perspective,
      session_id: randomUUID(),
      role: rec.role === 'admin' ? 'admin' : 'member',
    };
    return { ok: true, context, audit: audit('login', input.form, account) };
  }

  // 密码错：累加失败计数；达到阈值则同时置 lockedUntil（下次即锁）
  state.failCount += 1;
  if (state.failCount >= LOCK_THRESHOLD) {
    state.lockedUntil = now + LOCK_WINDOW_MS;
  }
  // 暴露剩余可尝试次数（前端据此预警，避免用户无感撞锁）；防枚举下 no_account 不携带此字段
  const remaining = Math.max(0, LOCK_THRESHOLD - state.failCount);
  return { ok: false, reason: 'wrong', failCount: state.failCount, remaining, audit: audit('login_fail', input.form, account) };
}
