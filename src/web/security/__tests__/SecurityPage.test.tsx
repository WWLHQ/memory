import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SecurityPage } from '../SecurityPage.tsx';
import { coreLoadSecurityAudit } from '../coreSecurity.ts';
import { resetKernelForTests, setKernelL0ForTests, setKernelStorageForTests } from '../../kernel.ts';
import { InMemoryStorage } from '../../../core/memagent/storage.ts';
import { createTestVault } from '../../../core/memagent/__tests__/l0Kit.ts';

// 批次7：页面按登录角色做门禁。单测不连后端，直接注入会话角色（真实校验在 home server / IPC）。
const session = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member' | null }));
vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => (session.role ? 's_test' : null),
  useSessionContext: () => ({
    sid: session.role ? 's_test' : null,
    context: session.role ? { user_id: 'u_test', role: session.role } : null,
    role: session.role,
    loading: false,
  }),
}));

describe('SecurityPage (P12-T4 编排)', () => {
  beforeEach(() => {
    resetKernelForTests(); // 账本从真空态起算（无种子）
    // 批次28-A：mock 会话会让账本走 HTTP 数据面，单测仍用内存账本
    setKernelStorageForTests(new InMemoryStorage());
    session.role = 'admin';
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('挂载渲染五区块', () => {
    render(<SecurityPage />);
    expect(screen.getByTestId('security-page')).toBeInTheDocument();
    expect(screen.getByTestId('pwd-policy')).toBeInTheDocument();
    expect(screen.getByTestId('encrypt-card')).toHaveTextContent('TLS');
    expect(screen.getByTestId('role-matrix')).toBeInTheDocument();
    expect(screen.getByTestId('member-table')).toBeInTheDocument();
    expect(screen.getByTestId('key-table')).toBeInTheDocument();
    // 批次24：遗留账本清理卡挂在安全页（浏览器环境如实不可用）
    expect(screen.getByTestId('legacy-card')).toBeInTheDocument();
    expect(screen.getByTestId('legacy-unavailable')).toBeInTheDocument();
  });

  it('成员/密钥无内核域模型 → 真实空态（无演示行）', () => {
    render(<SecurityPage />);
    expect(screen.getByTestId('member-table').querySelectorAll('tbody tr')).toHaveLength(0);
    expect(screen.getByTestId('key-table').querySelectorAll('tbody tr')).toHaveLength(0);
  });

  it('示例密码实时校验：禁用词拦截 + 合规通过', () => {
    render(<SecurityPage />);
    fireEvent.change(screen.getByTestId('pwd-sample'), { target: { value: 'MyPassword1!' } });
    expect(screen.getByTestId('pwd-err')).toHaveTextContent('含禁用词');
    fireEvent.change(screen.getByTestId('pwd-sample'), { target: { value: 'Abc' } });
    expect(screen.getByTestId('pwd-err')).toHaveTextContent(/长度/);
    fireEvent.change(screen.getByTestId('pwd-sample'), { target: { value: 'N3w^Secret9' } });
    expect(screen.getByTestId('pwd-ok')).toHaveTextContent('通过');
  });

  it('策略变更真写内核审计账本（security_change）+ toast 带真实 request_id', async () => {
    render(<SecurityPage />);
    fireEvent.click(screen.getByTestId('pwd-special'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/req_/));
    const log = await coreLoadSecurityAudit();
    expect(log).toHaveLength(1);
    expect(log[0].op).toBe('security_change');
  });

  it('多次安全操作逐条落账（append-only，不复写）', async () => {
    render(<SecurityPage />);
    fireEvent.click(screen.getByTestId('pwd-upper'));
    fireEvent.click(screen.getByTestId('pwd-digit'));
    await waitFor(async () => {
      const log = await coreLoadSecurityAudit();
      expect(log).toHaveLength(2);
    });
  });

  it('普通成员/未登录：策略只读（控件禁用）且不落账', async () => {
    session.role = 'member';
    render(<SecurityPage />);
    expect(screen.getByTestId('pwd-policy-admin-required')).toBeInTheDocument();
    expect(screen.getByTestId('pwd-policy-controls')).toBeDisabled();

    fireEvent.click(screen.getByTestId('pwd-special'));
    expect(await coreLoadSecurityAudit()).toHaveLength(0);
  });

  it('L0 管理（管理员）：首次设置管理密码 → 写密钥解锁 → 发放一次性授权', async () => {
    const { vault } = await createTestVault({ setup: false });
    setKernelL0ForTests({ l0: vault, l0Admin: vault });
    render(<SecurityPage />);

    await waitFor(() => expect(screen.getByTestId('l0-setup')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-setup-pw'), { target: { value: 'adminpass-9' } });
    fireEvent.change(screen.getByTestId('l0-setup-pw2'), { target: { value: 'adminpass-9' } });
    fireEvent.click(screen.getByTestId('l0-setup-submit'));
    await waitFor(() => expect(screen.getByTestId('l0-status-has')).toHaveTextContent('已设置'));
    expect(screen.getByTestId('l0-status-write')).toHaveTextContent('已解锁');

    fireEvent.change(screen.getByTestId('l0-grantee'), { target: { value: 'u_reader' } });
    fireEvent.change(screen.getByTestId('l0-scope'), { target: { value: 'P1, P2' } });
    fireEvent.click(screen.getByTestId('l0-grant-submit'));
    await waitFor(() => expect(screen.getByTestId('l0-issued')).toBeInTheDocument());
    expect(screen.getByTestId('l0-issued-pw').textContent).toMatch(/[0-9a-f]{16,}/);
    expect(screen.getByTestId('l0-grant-table').querySelectorAll('tbody tr')).toHaveLength(1);
    expect(screen.getByTestId('l0-status-grants')).toHaveTextContent('有效授权 1');
  });

  it('L0 管理（非管理员）：仅只读提示，不展示管理表单', () => {
    session.role = 'member';
    render(<SecurityPage />);
    expect(screen.getByTestId('l0-admin-required')).toBeInTheDocument();
    expect(screen.queryByTestId('l0-setup')).toBeNull();
    expect(screen.queryByTestId('l0-write')).toBeNull();
  });
});
