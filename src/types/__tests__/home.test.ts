// T1 验收（提前规划的测试）：全局租户上下文 + 首页领域类型
// 对应 specs/tasks/HOME-LOGIN.md T1 「验收（提前规划的测试）」
import { describe, it, expect } from 'vitest';
import type { Gain } from '../agentOnboard.ts';
import {
  type TenantContext,
  type SyncState,
  type LoginResult,
  type HomeDashboard,
  PERSPECTIVES,
  SYNC_ROLES,
  LOGIN_FAIL_REASONS,
} from '../home.ts';

const ctx: TenantContext = {
  enterprise_id: 'ent_001',
  team_id: 'team_001',
  user_id: 'user_001',
  perspective: 'team',
  session_id: 'sess_abc',
};

describe('TenantContext（§0.1 全局租户上下文）', () => {
  it('必含 enterprise_id/team_id/user_id/session_id/perspective 五字段', () => {
    expect(ctx.enterprise_id).toBe('ent_001');
    expect(ctx.team_id).toBe('team_001');
    expect(ctx.user_id).toBe('user_001');
    expect(ctx.session_id).toBe('sess_abc');
    expect(ctx.perspective).toBe('team');
  });

  it('perspective 仅 personal/team/enterprise 三值', () => {
    expect(PERSPECTIVES).toEqual(['personal', 'team', 'enterprise']);
    // 类型层：非法值会在 tsc 报错；运行期校验集合覆盖完整
    expect(PERSPECTIVES).not.toContain('org');
  });
});

describe('SyncState（§0.2 当前端 & 同步状态）', () => {
  it('role 三态 primary/mirror/offline', () => {
    expect(SYNC_ROLES).toEqual(['primary', 'mirror', 'offline']);
  });

  it('offline 时 pendingSync >= 0', () => {
    const offline: SyncState = { form: 'mobile', role: 'offline', lastReconcileAt: Date.now(), pendingSync: 3 };
    expect(offline.role).toBe('offline');
    expect(offline.pendingSync).toBeGreaterThanOrEqual(0);
    const primary: SyncState = { form: 'desktop', role: 'primary', lastReconcileAt: Date.now(), pendingSync: 0 };
    expect(primary.role).toBe('primary');
  });
});

describe('LoginResult（§0.3 登录结果两分支）', () => {
  it('ok:true 分支带 context', () => {
    const ok: LoginResult = { ok: true, context: ctx, audit: { action: 'login', form: 'desktop', account: 'user_001', at: Date.now() } };
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.context.user_id).toBe('user_001');
  });

  it('ok:false 分支带 reason 枚举，locked 带 lockedUntil', () => {
    const fail: LoginResult = { ok: false, reason: 'wrong', audit: { action: 'login_fail', form: 'desktop', account: 'user_001', at: Date.now() } };
    expect(fail.ok).toBe(false);
    if (!fail.ok) expect(fail.reason).toBe('wrong');
    const locked: LoginResult = { ok: false, reason: 'locked', lockedUntil: Date.now() + 15 * 60 * 1000, audit: { action: 'login_fail', form: 'desktop', account: 'user_001', at: Date.now() } };
    if (!locked.ok) expect(locked.reason).toBe('locked');
    expect(LOGIN_FAIL_REASONS).toEqual(['empty', 'no_account', 'wrong', 'locked']);
  });
});

describe('HomeDashboard（§0.2 四区块 + Gain 复用）', () => {
  const gain: Gain = { icon: '🪙', title: 'Token 节省', big: '-58%', desc: 'payload 780/1500', src: 'mech' };
  const dash: HomeDashboard = {
    gains: [gain, gain, gain, gain],
    anomalies: [{ title: 'Codex 熔断 OPEN', detail: 'desktop/Codex 连续失败≥5', level: 'error', request_id: 'req_x1', jump: 'P10' }],
    activeMemories: [{ title: '为什么上次重构失败', hits: 3, decayClass: 'hot', request_id: 'req_001' }],
    todos: [{ label: '⚖️ 待裁决 3 条', detail: '9.7 冲突队列', request_id: 'req_003', kind: 'dispute' }],
  };

  it('四区块字段齐全', () => {
    expect(dash.gains).toHaveLength(4);
    expect(dash.anomalies[0].level).toBe('error');
    expect(dash.activeMemories[0].decayClass).toBe('hot');
    expect(dash.todos[0].kind).toBe('dispute');
  });

  it('Gain 形状与 REQ-003 Gains 一致（icon/title/big/desc/src）', () => {
    expect(Object.keys(gain).sort()).toEqual(['big', 'desc', 'icon', 'src', 'title']);
  });

  it('异常/记忆/待办均可溯源 request_id（非空）', () => {
    expect(dash.anomalies.every((a) => a.request_id)).toBe(true);
    expect(dash.activeMemories.every((m) => m.request_id)).toBe(true);
    expect(dash.todos.every((t) => t.request_id)).toBe(true);
  });
});
