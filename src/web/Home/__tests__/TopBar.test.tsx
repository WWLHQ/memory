// T6 验收（提前规划的测试）：首页顶栏组件（登录态自适应，§0.2）
// 对应 specs/tasks/HOME-LOGIN.md T6 「验收（提前规划的测试）」
// 交互点对齐 design/ui/登录与首页_原型.html：#hiUnauth/#btnOpenLogin/#hiAuth/#syncPill/#btnLogout
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TenantProvider, useLogin, useLogout } from '../tenantContext.tsx';
import { TopBar } from '../TopBar.tsx';
import { login as localLogin, registerAccount, resetAuthStore } from '../../../auth/loginService.ts';
import { hashPassword } from '../../../auth/hash.ts';
import type { SyncState } from '../../../types/home.ts';

const ACCOUNT = 'user_001';
const TEAM = 'team_001';
const sync: SyncState = { form: 'desktop', role: 'primary', lastReconcileAt: Date.now(), pendingSync: 0 };

/** 屏幕：用真实 T5 login/logout 接线 onLogin/onLogout，便于验证整条登录态切换 */
function Screen({ onLoginSpy, onLogoutSpy, syncProp = sync }: { onLoginSpy?: () => void; onLogoutSpy?: () => void; syncProp?: SyncState }) {
  const login = useLogin();
  const logout = useLogout();
  return (
    <TopBar
      onLogin={() => {
        onLoginSpy?.();
        login({ account: ACCOUNT, password: 'pw', form: 'desktop' });
      }}
      onLogout={() => {
        onLogoutSpy?.();
        logout();
      }}
      sync={syncProp}
    />
  );
}

function renderTopBar(opts: { onLoginSpy?: () => void; onLogoutSpy?: () => void; syncProp?: SyncState } = {}) {
  return render(
    <TenantProvider loginFn={localLogin}>
      <Screen {...opts} />
    </TenantProvider>,
  );
}

describe('T6 首页顶栏组件', () => {
  beforeEach(() => {
    resetAuthStore();
    registerAccount(ACCOUNT, hashPassword('pw'), { enterprise_id: 'ent_001', team_id: TEAM, perspective: 'team' });
  });
  afterEach(() => resetAuthStore());

  it('未登录：渲染「欢迎使用…未登录」+ ▶ 登录；hiAuth/syncPill/登出 隐藏', () => {
    const { container } = renderTopBar();
    expect(screen.getByText(/欢迎使用记忆助手/)).toBeTruthy();
    expect(container.querySelector('#hiUnauth')).not.toBeNull();
    expect(container.querySelector('#btnOpenLogin')).not.toBeNull();
    // 已登录专属元素不在 DOM（隐藏）
    expect(container.querySelector('#hiAuth')).toBeNull();
    expect(container.querySelector('#syncPill')).toBeNull();
    expect(container.querySelector('#btnLogout')).toBeNull();
  });

  it('已登录：渲染 hiAuth(user_001/team_001) + syncPill + 登出；▶ 登录 隐藏', () => {
    const { container } = renderTopBar();
    fireEvent.click(container.querySelector('#btnOpenLogin')!);
    const hiAuth = container.querySelector('#hiAuth')!;
    expect(hiAuth).not.toBeNull();
    expect(hiAuth.textContent).toContain('user_001');
    expect(hiAuth.textContent).toContain('team_001');
    expect(container.querySelector('#syncPill')).not.toBeNull();
    expect(container.querySelector('#btnLogout')).not.toBeNull();
    // 未登录专属元素隐藏
    expect(container.querySelector('#hiUnauth')).toBeNull();
    expect(container.querySelector('#btnOpenLogin')).toBeNull();
  });

  it('点击 ▶ 登录 → 触发 onLogin 回调', () => {
    const onLoginSpy = vi.fn();
    const { container } = renderTopBar({ onLoginSpy });
    fireEvent.click(container.querySelector('#btnOpenLogin')!);
    expect(onLoginSpy).toHaveBeenCalledTimes(1);
  });

  it('点击 登出 → 触发 onLogout 回调并回到未登录态', () => {
    const onLogoutSpy = vi.fn();
    const { container } = renderTopBar({ onLogoutSpy });
    fireEvent.click(container.querySelector('#btnOpenLogin')!);
    expect(container.querySelector('#hiAuth')).not.toBeNull();
    fireEvent.click(container.querySelector('#btnLogout')!);
    expect(onLogoutSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#hiAuth')).toBeNull();
    expect(container.querySelector('#hiUnauth')).not.toBeNull();
  });

  it('团队文案只读：hiAuth 含「只读」且无编辑控件', () => {
    const { container } = renderTopBar();
    fireEvent.click(container.querySelector('#btnOpenLogin')!);
    const hiAuth = container.querySelector('#hiAuth')!;
    expect(hiAuth.textContent).toContain('只读');
    // 团队区域无任何可编辑控件（input/button/select/contenteditable）
    expect(hiAuth.querySelector('input, button, select, [contenteditable="true"]')).toBeNull();
  });
});
