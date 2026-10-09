// REQ-005 T3：登录业务逻辑 + 锁定策略（规格 §0.3 / §4.2 / §4.3）
// 职责：账号密码校验、连续失败锁定、成功注入全局租户上下文、产出审计事件。
// 零依赖（仅 Node crypto）。内存用户表 + 内存锁定表，作为纯逻辑内核，审计通过返回值上抛，
// 由 T10 后端落盘（本任务不直连 DB，满足「审计通过注入后端，只产出 action 描述」边界）。
// 团队 team_id 由管理员在账号页（P12）分配，登录时只读消费账户记录，绝不来自用户输入（§0.1/18.2-A）。
import { randomUUID } from 'node:crypto';
import { verifyPassword } from './hash.ts';
import type { LoginForm, LoginAudit, LoginResult, TenantContext, Perspective } from '../types/home.ts';

/** 连续失败达到该次数后，下一次登录被锁定（§4.2：错 5 次锁 15min → 第 6 次 locked） */
export const LOCK_THRESHOLD = 5;
/** 锁定时长：15 分钟（§4.2） */
export const LOCK_WINDOW_MS = 15 * 60 * 1000;

/** 内存用户记录：team_id / enterprise_id / perspective 均为管理员分配，用户只读 */
interface AccountRecord {
  account: string;
  passwordHash: string;
  enterprise_id: string;
  team_id: string;
  perspective: Perspective;
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
  opts: { enterprise_id: string; team_id: string; perspective?: Perspective },
): void {
  accounts.set(account, {
    account,
    passwordHash,
    enterprise_id: opts.enterprise_id,
    team_id: opts.team_id,
    perspective: opts.perspective ?? 'team',
  });
}

/** 清空全部账户与锁定态（测试隔离用，生产不调用） */
export function resetAuthStore(): void {
  accounts.clear();
  locks.clear();
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
    };
    return { ok: true, context, audit: audit('login', input.form, account) };
  }

  // 密码错：累加失败计数；达到阈值则同时置 lockedUntil（下次即锁）
  state.failCount += 1;
  if (state.failCount >= LOCK_THRESHOLD) {
    state.lockedUntil = now + LOCK_WINDOW_MS;
  }
  return { ok: false, reason: 'wrong', audit: audit('login_fail', input.form, account) };
}
