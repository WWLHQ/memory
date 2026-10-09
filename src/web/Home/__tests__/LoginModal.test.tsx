// T8 验收（提前规划的测试）：登录卡片组件（§0.3 弹出子视图）
// 对应 specs/tasks/HOME-LOGIN.md T8 「验收（提前规划的测试）」
// 交互点对齐 design/ui/登录与首页_原型.html：.login-modal/.login-box/#acc/#pwd/#btnLogin/#btnScan/#btnKey/#loginErr/#btnCloseLogin/.toast
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { TenantProvider } from '../tenantContext.tsx';
import { LoginModal } from '../LoginModal.tsx';
import type { TenantContext, LoginResult } from '../../../types/home.ts';

const ctxSample: TenantContext = {
  enterprise_id: 'ent_001',
  team_id: 'team_001',
  user_id: 'user_001',
  perspective: 'team',
  session_id: 'sess_001',
};
const okRes: LoginResult = { ok: true, context: ctxSample, audit: { action: 'login', form: 'desktop', account: 'user_001', at: Date.now() } };
const wrongRes: LoginResult = { ok: false, reason: 'wrong', audit: { action: 'login_fail', form: 'desktop', account: 'user_001', at: Date.now() } };
const lockedRes: LoginResult = {
  ok: false,
  reason: 'locked',
  lockedUntil: Date.now() + 15 * 60 * 1000,
  audit: { action: 'login_fail', form: 'desktop', account: 'user_001', at: Date.now() },
};

interface HarnessProps {
  initialOpen?: boolean;
  loginFn?: () => LoginResult;
  onSuccess?: (c: TenantContext) => void;
  onScan?: () => void;
  onKey?: () => void;
}
function Harness({ initialOpen = true, loginFn = () => okRes, onSuccess = () => {}, onScan, onKey }: HarnessProps) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <TenantProvider loginFn={loginFn}>
      <LoginModal
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={onSuccess}
        onScan={onScan}
        onKey={onKey}
        form="desktop"
      />
    </TenantProvider>
  );
}

function typeInto(container: HTMLElement, id: string, value: string) {
  fireEvent.change(container.querySelector(`#${id}`)!, { target: { value } });
}

describe('T8 登录卡片组件', () => {
  it('默认隐藏；触发打开 → 显示 .login-modal.show', () => {
    const closed = render(<Harness initialOpen={false} />);
    expect(closed.container.querySelector('.login-modal.show')).toBeNull();
    const open = render(
      <TenantProvider loginFn={() => okRes}>
        <LoginModal open onClose={() => {}} onSuccess={() => {}} form="desktop" />
      </TenantProvider>,
    );
    expect(open.container.querySelector('.login-modal.show')).not.toBeNull();
  });

  it('账号空 → 点登录显示「账号不能为空」且不调用 login', async () => {
    const loginFn = vi.fn(() => okRes);
    const { container } = render(<Harness loginFn={loginFn} />);
    typeInto(container, 'acc', '   ');
    typeInto(container, 'pwd', 'pw');
    await act(async () => {
      fireEvent.click(container.querySelector('#btnLogin')!);
    });
    expect(container.querySelector('#loginErr')?.textContent).toContain('账号不能为空');
    expect(loginFn).not.toHaveBeenCalled();
  });

  it('密码错 → 显示「密码错误，已记审计」+ login 被调用 + 锁定提示', async () => {
    const loginFn = vi.fn(() => wrongRes);
    const { container } = render(<Harness loginFn={loginFn} />);
    typeInto(container, 'acc', 'user_001');
    typeInto(container, 'pwd', 'bad');
    await act(async () => {
      fireEvent.click(container.querySelector('#btnLogin')!);
    });
    expect(container.querySelector('#loginErr')?.textContent).toContain('密码错误');
    expect(loginFn).toHaveBeenCalledTimes(1);
  });

  it('正确 → 触发 onSuccess(context)', async () => {
    const onSuccess = vi.fn();
    const { container } = render(<Harness onSuccess={onSuccess} />);
    typeInto(container, 'acc', 'user_001');
    typeInto(container, 'pwd', 'pw');
    await act(async () => {
      fireEvent.click(container.querySelector('#btnLogin')!);
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(ctxSample);
  });

  it('端形态只读（自动识别，无输入控件）', () => {
    const { container } = render(<Harness />);
    const row = container.querySelector('#rowForm')!;
    expect(row.querySelector('input, select, button')).toBeNull();
    expect(row.textContent).toContain('自动识别 = 桌面端');
  });

  it('团队只读（无编辑控件）', () => {
    const { container } = render(<Harness />);
    const row = container.querySelector('#rowTeam')!;
    expect(row.querySelector('input, select, button')).toBeNull();
    expect(row.textContent).toContain('只读');
  });

  it('扫码按钮 → onScan 回调 + toast', () => {
    const onScan = vi.fn();
    const { container } = render(<Harness onScan={onScan} />);
    fireEvent.click(container.querySelector('#btnScan')!);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#toast')?.textContent).toContain('扫码');
  });

  it('系统密钥按钮 → onKey 回调', () => {
    const onKey = vi.fn();
    const { container } = render(<Harness onKey={onKey} />);
    fireEvent.click(container.querySelector('#btnKey')!);
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('关闭 × → 隐藏', () => {
    const { container } = render(<Harness initialOpen />);
    expect(container.querySelector('.login-modal.show')).not.toBeNull();
    fireEvent.click(container.querySelector('#btnCloseLogin')!);
    expect(container.querySelector('.login-modal.show')).toBeNull();
  });

  it('锁定结果 → 显示锁定提示（错 5 次锁 15min）', async () => {
    const loginFn = vi.fn(() => lockedRes);
    const { container } = render(<Harness loginFn={loginFn} />);
    typeInto(container, 'acc', 'user_001');
    typeInto(container, 'pwd', 'bad');
    await act(async () => {
      fireEvent.click(container.querySelector('#btnLogin')!);
    });
    expect(container.querySelector('#loginErr')?.textContent).toContain('锁定');
  });
});
