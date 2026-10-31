// 批次7：管理员账号与角色（auth/loginService）单测。
// 覆盖：内置 admin 播种/升级、角色透传到登录上下文、最后一个管理员保护、
//      团队分配、改密规则、账号视图脱敏与排序、旧快照迁移不提权。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ADMIN_ACCOUNT,
  DEFAULT_ADMIN_PASSWORD,
  seedAdminAccount,
  registerAccount,
  resetAuthStore,
  login,
  listAccounts,
  adminCount,
  setAccountRole,
  assignAccountTeam,
  changePassword,
  importAccountSnapshot,
  exportAccountSnapshot,
} from '../loginService.ts';
import { hashPassword } from '../hash.ts';

const MEMBER = 'member_1';
const MEMBER_PWD = 'member-pass-1';

function seed(): void {
  resetAuthStore();
  registerAccount(MEMBER, hashPassword(MEMBER_PWD), { enterprise_id: 'ent', team_id: 'team_a', perspective: 'team' });
}

function loginAs(account: string, password: string) {
  return login({ account, password, form: 'desktop' });
}

describe('内置管理员播种', () => {
  beforeEach(seed);

  it('无 admin → 创建，默认密码可登录且上下文 role=admin、perspective=enterprise', () => {
    const r = seedAdminAccount();
    expect(r).toEqual({ account: ADMIN_ACCOUNT, created: true, upgraded: false });

    const l = loginAs(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD);
    expect(l.ok).toBe(true);
    if (l.ok) {
      expect(l.context.role).toBe('admin');
      expect(l.context.perspective).toBe('enterprise');
      expect(l.context.user_id).toBe(ADMIN_ACCOUNT);
    }
  });

  it('再次播种不覆盖已修改的管理员密码', () => {
    seedAdminAccount();
    expect(changePassword(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD, 'Changed#2026').ok).toBe(true);

    expect(seedAdminAccount()).toEqual({ account: ADMIN_ACCOUNT, created: false, upgraded: false });
    // 旧默认密码失效，新密码生效
    expect(loginAs(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD).ok).toBe(false);
    expect(loginAs(ADMIN_ACCOUNT, 'Changed#2026').ok).toBe(true);
  });

  it('同名账号已存在但无 admin 角色（旧快照）→ 升级为 admin 且不改密码', () => {
    registerAccount(ADMIN_ACCOUNT, hashPassword('legacy-pw'), { enterprise_id: 'ent', team_id: 't', perspective: 'team' });
    const r = seedAdminAccount();
    expect(r).toEqual({ account: ADMIN_ACCOUNT, created: false, upgraded: true });
    expect(loginAs(ADMIN_ACCOUNT, 'legacy-pw').ok).toBe(true);
    const l = loginAs(ADMIN_ACCOUNT, 'legacy-pw');
    expect(l.ok && l.context.role).toBe('admin');
  });
});

describe('角色与团队管理', () => {
  beforeEach(seed);

  it('普通注册默认 member；登录上下文 role=member', () => {
    const l = loginAs(MEMBER, MEMBER_PWD);
    expect(l.ok && l.context.role).toBe('member');
  });

  it('最后一个管理员不可降级；新增第二个管理员后可降级', () => {
    seedAdminAccount();
    expect(setAccountRole(ADMIN_ACCOUNT, 'member')).toEqual({ ok: false, error: '不能降级最后一个管理员' });

    expect(setAccountRole(MEMBER, 'admin')).toEqual({ ok: true });
    expect(adminCount()).toBe(2);
    expect(setAccountRole(ADMIN_ACCOUNT, 'member')).toEqual({ ok: true });
    expect(adminCount()).toBe(1);
  });

  it('不存在的账号：设置角色/分配团队均返回明确错误', () => {
    expect(setAccountRole('ghost', 'admin')).toEqual({ ok: false, error: '账号不存在' });
    expect(assignAccountTeam('ghost', 't')).toEqual({ ok: false, error: '账号不存在' });
  });

  it('团队只读消费：分配后新登录上下文立即使用新团队；空团队被拒绝', () => {
    expect(assignAccountTeam(MEMBER, ' team_b ')).toEqual({ ok: true });
    const l = loginAs(MEMBER, MEMBER_PWD);
    expect(l.ok && l.context.team_id).toBe('team_b');

    expect(assignAccountTeam(MEMBER, '   ')).toEqual({ ok: false, error: '团队 ID 不能为空' });
  });
});

describe('修改密码（登录后自助）', () => {
  beforeEach(seed);

  it('旧密码错 / 新密码过短 / 与旧相同 → 各自明确原因', () => {
    expect(changePassword(MEMBER, 'wrong', 'NewPass#123')).toEqual({ ok: false, reason: 'wrong' });
    expect(changePassword(MEMBER, MEMBER_PWD, 'short')).toEqual({ ok: false, reason: 'weak' });
    expect(changePassword(MEMBER, MEMBER_PWD, MEMBER_PWD)).toEqual({ ok: false, reason: 'same' });
    expect(changePassword('ghost', 'x', 'NewPass#123')).toEqual({ ok: false, reason: 'no_account' });
  });

  it('成功改密后：旧密码失效、新密码可登录', () => {
    expect(changePassword(MEMBER, MEMBER_PWD, 'NewPass#123')).toEqual({ ok: true });
    expect(loginAs(MEMBER, MEMBER_PWD).ok).toBe(false);
    expect(loginAs(MEMBER, 'NewPass#123').ok).toBe(true);
  });
});

describe('账号视图与会话快照', () => {
  beforeEach(seed);

  it('listAccounts 不含密码哈希；管理员排最前；role 只有 admin/member', () => {
    seedAdminAccount();
    const list = listAccounts();
    expect(list).toHaveLength(2);
    expect(list[0].account).toBe(ADMIN_ACCOUNT);
    expect(list[0].role).toBe('admin');
    expect(list[1].role).toBe('member');
    for (const item of list) {
      expect(Object.keys(item)).not.toContain('passwordHash');
      expect(['admin', 'member']).toContain(item.role);
    }
  });

  it('旧快照缺 role → 迁移为 member（已有用户不被静默提权）；admin 角色保留', () => {
    resetAuthStore();
    importAccountSnapshot([
      { account: 'old_member', passwordHash: hashPassword('pw'), enterprise_id: 'e', team_id: 't', perspective: 'team' },
      { account: 'old_admin', passwordHash: hashPassword('pw2'), enterprise_id: 'e', team_id: 't', perspective: 'enterprise', role: 'admin' },
    ]);
    const list = listAccounts();
    expect(list.find((a) => a.account === 'old_member')?.role).toBe('member');
    expect(list.find((a) => a.account === 'old_admin')?.role).toBe('admin');
  });

  it('导出快照 → 重新导入后角色与密码哈希原样保留', () => {
    seedAdminAccount();
    const snap = exportAccountSnapshot();
    resetAuthStore();
    importAccountSnapshot(snap);
    expect(adminCount()).toBe(1);
    expect(loginAs(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD).ok).toBe(true);
  });
});
