// T3 验收（提前规划的测试）：登录业务逻辑 + 锁定策略（§0.3 / §4.2 / §4.3）
// 对应 specs/tasks/HOME-LOGIN.md T3 「验收（提前规划的测试）」
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hashPassword } from '../hash.ts';
import {
  login,
  registerAccount,
  resetAuthStore,
  lockoutState,
  LOCK_THRESHOLD,
  LOCK_WINDOW_MS,
} from '../loginService.ts';
import type { LoginForm } from '../../types/home.ts';

const ACCOUNT = 'alice';
const TEAM = 'team_readonly_007';
const ENT = 'ent_acme';
// 团队只读值：来自账户记录，绝不来自用户输入
const RIGHT_PWD = 's3cret-pass';

function seed(): void {
  resetAuthStore();
  registerAccount(ACCOUNT, hashPassword(RIGHT_PWD), { enterprise_id: ENT, team_id: TEAM, perspective: 'team' });
}

function formOf(pwd: string, account = ACCOUNT): LoginForm {
  return { account, password: pwd, form: 'desktop' };
}

describe('T3 登录业务逻辑 + 锁定策略', () => {
  beforeEach(() => {
    seed();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    resetAuthStore();
  });

  it('正确账号密码 → ok:true 且 context.user_id=输入账号、team_id=管理员分配只读值', () => {
    const r = login(formOf(RIGHT_PWD));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.context.user_id).toBe(ACCOUNT);
      expect(r.context.team_id).toBe(TEAM); // 只读，非来自输入
      expect(r.context.enterprise_id).toBe(ENT);
      expect(r.context.perspective).toBe('team');
      expect(r.context.session_id).toBeTruthy();
    }
  });

  it('账号空 → reason:empty', () => {
    const r = login(formOf(RIGHT_PWD, ''));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('empty');
  });

  it('账号不存在 → reason:no_account', () => {
    const r = login(formOf(RIGHT_PWD, 'ghost'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_account');
  });

  it('密码错 → reason:wrong', () => {
    const r = login(formOf('wrong-pwd'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong');
  });

  it('连续错 5 次 → 第 6 次 reason:locked 且 lockedUntil 在未来；锁定期内任何尝试均 locked', () => {
    for (let i = 1; i <= LOCK_THRESHOLD; i++) {
      const r = login(formOf('bad'));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('wrong');
    }
    // 第 6 次
    const locked = login(formOf('bad'));
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.reason).toBe('locked');
      expect(locked.lockedUntil).toBeGreaterThan(Date.now());
    }
    // 锁定期内（提前 1s）任何尝试均 locked
    vi.advanceTimersByTime(LOCK_WINDOW_MS - 1000);
    const during = login(formOf(RIGHT_PWD));
    expect(during.ok).toBe(false);
    if (!during.ok) expect(during.reason).toBe('locked');
  });

  it('锁定到期后可重试（正确密码此次成功）', () => {
    for (let i = 1; i <= LOCK_THRESHOLD; i++) login(formOf('bad'));
    expect(lockoutState(ACCOUNT).locked).toBe(true);
    // 推进超过锁定时长
    vi.advanceTimersByTime(LOCK_WINDOW_MS + 1000);
    const retry = login(formOf(RIGHT_PWD));
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.context.user_id).toBe(ACCOUNT);
  });

  it('LoginForm 运行时不含 team_id 字段（团队只读，不来自用户输入）', () => {
    const f = formOf(RIGHT_PWD);
    expect(Object.prototype.hasOwnProperty.call(f, 'team_id')).toBe(false);
  });

  it('成功路径产出审计：action=login 且带 form', () => {
    const r = login(formOf(RIGHT_PWD));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.audit.action).toBe('login');
      expect(r.audit.form).toBe('desktop');
      expect(r.audit.account).toBe(ACCOUNT);
      expect(typeof r.audit.at).toBe('number');
    }
  });

  it('失败路径审计：action=login_fail', () => {
    const r = login(formOf('bad'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.audit.action).toBe('login_fail');
  });
});
