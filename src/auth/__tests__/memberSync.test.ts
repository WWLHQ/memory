// 批次45-B2 home 账号 ↔ 内核 Member 打通回归：
// 单向 upsert（创建/跟随更新/幂等零写盘）、member_id=user_id 身份锚点不可变、
// 内核侧多余成员不清除、status 绝不被同步覆盖、FileMemberStore 落盘一致。
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryMemberStore, FileMemberStore } from '../../core/memagent/memberStore.ts';
import { syncMembersFromHome } from '../memberSync.ts';
import type { AccountView } from '../loginService.ts';

const NOW = 1_800_000_000_000;

function view(over: Partial<AccountView> = {}): AccountView {
  return { account: 'carol', role: 'member', team_id: 'team_c', enterprise_id: 'local', perspective: 'personal', ...over };
}

let cleanup: string[] = [];
afterEach(() => { for (const d of cleanup) rmSync(d, { recursive: true, force: true }); cleanup = []; });

describe('syncMembersFromHome 单向 upsert', () => {
  it('home 新账号 → 内核登记（member_id=user_id=账号名，created_by=home-sync）', () => {
    const store = new InMemoryMemberStore();
    const r = syncMembersFromHome(store, [view()], NOW);
    expect(r).toMatchObject({ scanned: 1, created: 1, updated: 0, unchanged: 0 });
    const m = store.getMember('carol')!;
    expect(m).toMatchObject({
      member_id: 'carol', user_id: 'carol', role: 'member',
      team_id: 'team_c', enterprise_id: 'local', status: 'active', created_by: 'home-sync',
    });
    expect(r.changes[0]).toEqual({ member_id: 'carol', fields: ['created'] });
  });

  it('角色/团队变更 → updateMember 跟随；幂等：第二次跑 created=updated=0', () => {
    const store = new InMemoryMemberStore();
    syncMembersFromHome(store, [view()], NOW);
    const r2 = syncMembersFromHome(store, [view()], NOW + 1);
    expect(r2).toMatchObject({ scanned: 1, created: 0, updated: 0, unchanged: 1 });
    // 角色变更（member → admin）被跟随
    const r3 = syncMembersFromHome(store, [view({ role: 'admin' })], NOW + 2);
    expect(r3).toMatchObject({ updated: 1, unchanged: 0 });
    expect(store.getMember('carol')!.role).toBe('admin');
    expect(r3.changes[0]?.fields).toEqual(['role']);
    // 团队变更被跟随；user_id/created_at 等身份与审计字段不被重置
    const r4 = syncMembersFromHome(store, [view({ role: 'admin', team_id: 'team_x' })], NOW + 3);
    expect(r4.updated).toBe(1);
    const after = store.getMember('carol')!;
    expect(after.team_id).toBe('team_x');
    expect(after.user_id).toBe('carol');
    expect(after.created_at).toBe(NOW); // 身份锚点与创建审计不被覆盖
  });

  it('status（suspended）绝不被同步覆盖——那是内核侧保留状态（45-B3 门禁用）', () => {
    const store = new InMemoryMemberStore();
    // 内核侧先登记一个已停用成员（模拟 45-B3 门禁动作），home 视图随后到达
    store.createMember({
      member_id: 'carol', name: 'carol', role: 'member',
      user_id: 'carol', team_id: 'team_c', enterprise_id: 'local',
      status: 'suspended', created_by: 'kernel-side',
    }, NOW);
    // 未变更字段 → unchanged，status 保持 suspended
    const r1 = syncMembersFromHome(store, [view()], NOW + 1);
    expect(r1.unchanged).toBe(1);
    expect(store.getMember('carol')!.status).toBe('suspended');
    // 即使角色变更触发更新，status 也不被同步重置为 active
    const r2 = syncMembersFromHome(store, [view({ role: 'admin' })], NOW + 2);
    expect(r2.updated).toBe(1);
    const m = store.getMember('carol')!;
    expect(m.role).toBe('admin');
    expect(m.status).toBe('suspended'); // 同步绝不触碰 status
  });

  it('内核侧多余成员（home 没有）不被删除；混合场景计数正确', () => {
    const store = new InMemoryMemberStore();
    syncMembersFromHome(store, [view(), view({ account: 'dave', team_id: 'team_d' })], NOW);
    // 内核侧手工建一个 home 没有的成员（模拟未来工具入口）
    store.createMember({
      member_id: 'mb_manual', name: 'manual', role: 'member',
      user_id: 'mb_manual', team_id: 't1', enterprise_id: 'e1', created_by: 'future-tool',
    }, NOW);
    const r = syncMembersFromHome(store, [view({ role: 'admin' })], NOW + 1);
    expect(r.scanned).toBe(1);       // 只扫 home 视图
    expect(store.getMember('mb_manual')).not.toBeNull(); // 不被清除
    expect(store.getMember('carol')!.role).toBe('admin');
  });

  it('FileMemberStore 落盘一致：同步后重开新实例成员仍在；文件不含密码材料', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'member-sync-file-'));
    cleanup.push(dir);
    const file = join(dir, 'members.json');
    const s1 = new FileMemberStore(file);
    syncMembersFromHome(s1, [view({ role: 'admin' }), view({ account: 'dave' })], NOW);
    const s2 = new FileMemberStore(file);
    expect(s2.getMember('carol')).toMatchObject({ role: 'admin' });
    expect(s2.getMember('dave')).toMatchObject({ role: 'member' });
    // 同步路径绝不写密码哈希（loginService 的域不进成员库）
    expect(readFileSync(file, 'utf8')).not.toContain('password');
  });
});
