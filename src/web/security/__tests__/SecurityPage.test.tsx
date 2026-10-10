import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SecurityPage } from '../SecurityPage.tsx';
import { coreLoadSecurityAudit } from '../coreSecurity.ts';

describe('SecurityPage (P12-T4 编排)', () => {
  beforeEach(() => {
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
  });

  it('示例密码实时校验：禁用词/历史重复/通过', () => {
    render(<SecurityPage />);
    fireEvent.change(screen.getByTestId('pwd-sample'), { target: { value: 'MyPassword1!' } });
    expect(screen.getByTestId('pwd-err')).toHaveTextContent('含禁用词');
    fireEvent.change(screen.getByTestId('pwd-sample'), { target: { value: 'Abcdef1!' } });
    expect(screen.getByTestId('pwd-err')).toHaveTextContent('与历史重复');
    fireEvent.change(screen.getByTestId('pwd-sample'), { target: { value: 'N3w^Secret9' } });
    expect(screen.getByTestId('pwd-ok')).toHaveTextContent('通过');
  });

  it('未共享成员删除按钮禁用（跨团队约束）', () => {
    render(<SecurityPage />);
    expect(screen.getByTestId('remove-user_002')).toBeDisabled();
    expect(screen.getByTestId('remove-user_001')).toBeEnabled();
  });

  it('轮换/吊销出 toast + request_id；吊销后状态更新；操作真写内核审计账本', async () => {
    render(<SecurityPage />);
    fireEvent.click(screen.getByTestId('rotate-key_001'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/req_s\d/));
    fireEvent.click(screen.getByTestId('revoke-key_001'));
    expect(screen.getByTestId('key-key_001')).toHaveTextContent('已吊销');
    // 内核账本可查（rotate/revoke 均落 security_change 审计）
    await waitFor(async () => {
      const log = await coreLoadSecurityAudit();
      expect(log.filter((e) => e.op === 'security_change').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('超 90 天密钥显示警示', () => {
    render(<SecurityPage />);
    expect(screen.getByTestId('key-warn-1')).toHaveTextContent(/未轮换/);
  });
});
