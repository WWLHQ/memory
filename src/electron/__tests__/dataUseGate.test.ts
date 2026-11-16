// T1 数据使用门禁单测（管理员与成员权限设计 §2 / AC-2/3/4）：
// 纯函数真调，断言 admin/member/无会话/过期会话四态，admin 必须打审计标、member 不打。
import { describe, it, expect, vi } from 'vitest';
import { checkDataUse, type DataUseGateDeps } from '../dataUseGate.ts';
import type { TenantContext } from '../../types/home.ts';

const MEMBER: TenantContext = {
  enterprise_id: 'e1', team_id: 't1', user_id: 'u1', perspective: 'team',
  session_id: 's_member', role: 'member',
};
const ADMIN: TenantContext = {
  enterprise_id: 'local', team_id: 'admin-team', user_id: 'admin', perspective: 'team',
  session_id: 's_admin', role: 'admin',
};
const LEGACY: TenantContext = { ...MEMBER, role: undefined };

function deps(ctx: TenantContext | null): DataUseGateDeps & { audit: ReturnType<typeof vi.fn> } {
  const audit = vi.fn();
  return {
    getSessionContext: (sid) => (sid === 's_ok' ? ctx : null),
    auditAdminUse: audit,
    audit,
  };
}

describe('数据使用门禁（T1）', () => {
  it('member 有效会话放行，且不打 admin 审计标', () => {
    const d = deps(MEMBER);
    const r = checkDataUse('s_ok', 'collector:triggerNow', d);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.audit).toBeNull();
    expect(d.audit).not.toHaveBeenCalled();
  });

  it('admin 有效会话放行，但强制打 actor_role=admin 审计标（不可关闭）', () => {
    const d = deps(ADMIN);
    const r = checkDataUse('s_ok', 'collector:status', d);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.audit).toEqual({ actor_role: 'admin', via: 'admin_override' });
      expect(r.ctx.user_id).toBe('admin');
    }
    expect(d.audit).toHaveBeenCalledWith('collector:status', 'admin');
  });

  it('无会话 / 空串 / 过期会话一律拒绝 E_AUTH_SESSION 且不打审计', () => {
    const d = deps(ADMIN);
    for (const sid of [undefined, '', '   ', 'expired', 123]) {
      const r = checkDataUse(sid, 'hostAgentDetect:config', d);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E_AUTH_SESSION');
    }
    expect(d.audit).not.toHaveBeenCalled();
  });

  it('旧会话缺 role 字段按 member 处理（放行但不打审计，兼容迁移）', () => {
    const d = deps(LEGACY);
    const r = checkDataUse('s_ok', 'collector:status', d);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.audit).toBeNull();
    expect(d.audit).not.toHaveBeenCalled();
  });

  it('变异防线：注入的会话查询不可用时拒绝，绝不冒充放行', () => {
    const d = deps(null);
    expect(checkDataUse('s_ok', 'x', d).ok).toBe(false);
  });
});
