// 批次37-G：安全页「L0 恢复卡」单测。
// 口径：只有真实 IPC（l0:recoveryStatus / recoveryIssue / recover / recoveryExport），浏览器环境诚实不可用，
// 非管理员不给入口；码明文只在发码那一次渲染，未导出必须一直挂着红字警告；
// 导出被取消不算成功也不报错；恢复表单在码不够长或新密码不够位时不给提交；
// 主进程拒绝/抛错原样展示，绝不显示「已找回」。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 's_test',
  useSessionContext: () => ({ sid: 's_test', context: { role: 'admin' }, role: 'admin' as const, loading: false }),
  fetchSessionContext: async () => null,
}));

import { L0RecoveryCard } from '../L0RecoveryCard.tsx';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

const CODE = 'abcdefghij0123456789_-ABCDEFGHabcdefghijk';
/** 与主进程 formatRecoveryCode 同口径：每 4 字符一段 */
const GROUPED = (CODE.match(/.{1,4}/g) ?? []).join(' ');
const STATUS_HAS = { ok: true, has_recovery: true, created_at: 1_800_000_000_000, revoked_at: 0, fingerprint: 'ab12cd34', has_pending_card: false };
const STATUS_NONE = { ok: true, has_recovery: false, created_at: 0, revoked_at: 0, fingerprint: '', has_pending_card: false };
const ISSUED = { ok: true, recovery_code: CODE, recovery_code_grouped: GROUPED, fingerprint: 'ff00ff00', created_at: 1_800_000_600_000 };

/** 装上桌面壳：window.api.l0.{recoveryStatus,recoveryIssue,recover,recoveryExport} */
function mockHost(opts: { status?: unknown; issue?: unknown; recover?: unknown; export?: unknown } = {}) {
  w.__ELECTRON__ = true;
  const recoveryStatus = vi.fn(() => Promise.resolve(opts.status ?? STATUS_HAS));
  const recoveryIssue = vi.fn(() => Promise.resolve(opts.issue ?? ISSUED));
  const recover = vi.fn((..._a: unknown[]) => Promise.resolve(opts.recover ?? ISSUED));
  const recoveryExport = vi.fn(() => Promise.resolve(opts.export ?? { ok: true, file_name: 'L0恢复卡-ff00ff00.txt', inside_data_root: false }));
  w.api = { l0: { recoveryStatus, recoveryIssue, recover, recoveryExport } };
  return { recoveryStatus, recoveryIssue, recover, recoveryExport };
}

beforeEach(() => {
  delete w.__ELECTRON__;
  delete w.api;
});

afterEach(() => {
  delete w.__ELECTRON__;
  delete w.api;
  vi.restoreAllMocks();
});

describe('L0RecoveryCard（批次37-G 恢复码找回）', () => {
  it('浏览器环境（无桌面壳）：如实说明不可用，不给任何入口', () => {
    render(<L0RecoveryCard enabled />);
    expect(screen.getByTestId('l0-recovery-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('l0-recovery-issue')).toBeNull();
    expect(screen.queryByTestId('l0-recovery-submit')).toBeNull();
  });

  it('非管理员：只给「需管理员」说明，连状态都不查', () => {
    const { recoveryStatus } = mockHost();
    render(<L0RecoveryCard enabled={false} />);
    expect(screen.getByTestId('l0-recovery-need-admin')).toBeInTheDocument();
    expect(recoveryStatus).not.toHaveBeenCalled();
  });

  it('已有恢复卡：指纹与生成时间（UTC+08:00）按主进程真值展示', async () => {
    mockHost();
    render(<L0RecoveryCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-recovery-fingerprint')).toHaveTextContent('ab12cd34'));
    // 1_800_000_000_000 = 2027-01-15 08:00:00 UTC = 16:00:00 UTC+08:00
    expect(screen.getByTestId('l0-recovery-status').textContent).toContain('2027-01-15 16:00:00');
  });

  it('从未生成恢复码：如实说「将无法找回」，并提示先解锁写密钥再生成', async () => {
    mockHost({ status: STATUS_NONE });
    render(<L0RecoveryCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-recovery-no-card')).toBeInTheDocument());
    expect(screen.getByTestId('l0-recovery-issue')).toHaveTextContent('需先解锁 L0 写密钥');
  });

  it('换发恢复码：码只显示这一次，且带分组展示；未导出必须挂着红字警告', async () => {
    const { recoveryIssue } = mockHost({ status: STATUS_NONE });
    render(<L0RecoveryCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-recovery-no-card')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('l0-recovery-issue'));
    await waitFor(() => expect(recoveryIssue).toHaveBeenCalledWith('s_test'));
    expect(screen.getByTestId('l0-recovery-code')).toHaveTextContent(GROUPED);
    expect(screen.getByTestId('l0-recovery-not-exported')).toBeInTheDocument();
  });

  it('导出成功：回执文件名，红字警告消失', async () => {
    mockHost({ status: STATUS_NONE });
    render(<L0RecoveryCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-recovery-no-card')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('l0-recovery-issue'));
    await waitFor(() => expect(screen.getByTestId('l0-recovery-export')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('l0-recovery-export'));
    await waitFor(() => expect(screen.getByTestId('l0-recovery-export-result')).toHaveTextContent('L0恢复卡-ff00ff00.txt'));
    expect(screen.queryByTestId('l0-recovery-not-exported')).toBeNull();
  });

  it('导出落在数据目录里：不拦用户，但如实警告「同一次事故会一起没了」', async () => {
    mockHost({ status: STATUS_NONE, export: { ok: true, file_name: 'card.txt', inside_data_root: true } });
    render(<L0RecoveryCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-recovery-no-card')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('l0-recovery-issue'));
    await waitFor(() => expect(screen.getByTestId('l0-recovery-export')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('l0-recovery-export'));
    await waitFor(() => expect(screen.getByTestId('l0-recovery-export-result'))
      .toHaveTextContent('就在数据目录里'));
  });

  it('导出被取消：不算成功也不算错误，警告仍在，可再点一次', async () => {
    mockHost({ status: STATUS_NONE, export: { ok: false, canceled: true, error: '未导出' } });
    render(<L0RecoveryCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-recovery-no-card')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('l0-recovery-issue'));
    await waitFor(() => expect(screen.getByTestId('l0-recovery-export')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('l0-recovery-export'));
    await waitFor(() => expect(screen.getByTestId('l0-recovery-export-result')).toHaveTextContent('本次取消了保存'));
    expect(screen.getByTestId('l0-recovery-not-exported')).toBeInTheDocument();
    expect(screen.queryByTestId('l0-recovery-error')).toBeNull();
  });

  it('找回表单：码不够 32 位或新密码不足 8 位都不给提交', async () => {
    const { recover } = mockHost();
    render(<L0RecoveryCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-recovery-fingerprint')).toBeInTheDocument());
    const submit = screen.getByTestId('l0-recovery-submit');
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('l0-recovery-code-input'), { target: { value: 'short' } });
    fireEvent.change(screen.getByTestId('l0-recovery-newpw-input'), { target: { value: 'adminpass-1' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('l0-recovery-code-input'), { target: { value: CODE } });
    fireEvent.change(screen.getByTestId('l0-recovery-newpw-input'), { target: { value: '1234567' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('l0-recovery-newpw-input'), { target: { value: 'adminpass-2' } });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(recover).toHaveBeenCalledWith({ code: CODE, newPassword: 'adminpass-2' }, 's_test'));
  });

  it('带空格的恢复码原样交给主进程归一（手抄分段不该导致恢复失败）', async () => {
    const { recover } = mockHost();
    render(<L0RecoveryCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-recovery-fingerprint')).toBeInTheDocument());
    const spaced = `${CODE.slice(0, 10)} ${CODE.slice(10, 22)} ${CODE.slice(22)}`;
    fireEvent.change(screen.getByTestId('l0-recovery-code-input'), { target: { value: spaced } });
    fireEvent.change(screen.getByTestId('l0-recovery-newpw-input'), { target: { value: 'adminpass-2' } });
    // 输入框里的空格不算长度：归一后仍 ≥32 才放开提交
    expect(screen.getByTestId('l0-recovery-submit')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('l0-recovery-submit'));
    await waitFor(() => expect(recover).toHaveBeenCalled());
    // 页面不做归一，交出去的是用户敲的原样串，去空白在主进程
    expect(recover.mock.calls[0][0]).toMatchObject({ code: spaced });
  });

  it('找回成功：输入框清空并展示**新**码（旧码已作废）', async () => {
    mockHost();
    render(<L0RecoveryCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-recovery-fingerprint')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-recovery-code-input'), { target: { value: CODE } });
    fireEvent.change(screen.getByTestId('l0-recovery-newpw-input'), { target: { value: 'adminpass-2' } });
    fireEvent.click(screen.getByTestId('l0-recovery-submit'));
    await waitFor(() => expect(screen.getByTestId('l0-recovery-code')).toHaveTextContent(GROUPED));
    expect(screen.getByTestId('l0-recovery-code-input')).toHaveValue('');
    expect(screen.getByTestId('l0-recovery-newpw-input')).toHaveValue('');
    expect(screen.getByTestId('l0-recovery-not-exported')).toBeInTheDocument();
  });

  it('主进程拒绝（未解锁写密钥 / 码无效）：原样显示原因，不出码', async () => {
    mockHost({ issue: { ok: false, code: 'E_L0_LOCKED', error: '[E_L0_LOCKED] L0 写密钥未解锁' } });
    render(<L0RecoveryCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-recovery-fingerprint')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('l0-recovery-issue'));
    await waitFor(() => expect(screen.getByTestId('l0-recovery-error')).toHaveTextContent('L0 写密钥未解锁'));
    expect(screen.queryByTestId('l0-recovery-card-body')).toBeNull();
  });

  it('IPC 抛错（主进程没注册通道）：错误如实展示，不假装成功', async () => {
    mockHost({ status: Promise.reject(new Error('主进程未注册 l0:recoveryStatus')) });
    render(<L0RecoveryCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-recovery-error')).toHaveTextContent('主进程未注册 l0:recoveryStatus'));
  });
});
