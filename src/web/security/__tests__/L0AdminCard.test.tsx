// §4.4.4-B：L0AdminCard 的「成员写密钥」发放/撤销/已发放列表 + 成员端只读状态测试。
// 只验证 UI 把参数正确交给 coreL0* 封装、以及「发给了谁」有地方可看（真实内核由真实 vault 用例覆盖）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// 被 vi.mock 工厂引用的函数必须 hoisted，否则会被 hoist 提前而「使用前未初始化」
const m = vi.hoisted(() => ({
  coreL0Status: vi.fn(),
  coreL0ListRequests: vi.fn(),
  coreL0ListGrants: vi.fn(),
  coreL0AddMemberWriteWrap: vi.fn(),
  coreL0RemoveMemberWriteWrap: vi.fn(),
  coreL0MyWriteWrap: vi.fn(),
}));

vi.mock('../coreSecurity.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../coreSecurity.ts')>();
  return {
    ...actual,
    coreL0Status: m.coreL0Status,
    coreL0ListRequests: m.coreL0ListRequests,
    coreL0ListGrants: m.coreL0ListGrants,
    coreL0AddMemberWriteWrap: m.coreL0AddMemberWriteWrap,
    coreL0RemoveMemberWriteWrap: m.coreL0RemoveMemberWriteWrap,
    coreL0MyWriteWrap: m.coreL0MyWriteWrap,
  };
});

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 's',
  fetchSessionContext: async () => null,
  useSessionContext: () => ({ sid: 's', context: { role: 'admin', user_id: 'admin' }, role: 'admin' as const, loading: false }),
}));

import type { L0VaultStatus } from '../../../core/memagent/types.ts';
import { L0AdminCard } from '../L0AdminCard.tsx';

const status = (patch: Partial<L0VaultStatus> = {}): L0VaultStatus => ({
  has_admin_wrap: true, write_unlocked: true, active_sessions: 0, active_grants: 0,
  member_write_wraps: 0, member_wrap_ids: [], ...patch,
});

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.coreL0Status.mockResolvedValue(status());
  m.coreL0ListRequests.mockResolvedValue([]);
  m.coreL0ListGrants.mockResolvedValue([]);
  m.coreL0AddMemberWriteWrap.mockResolvedValue(undefined);
  m.coreL0RemoveMemberWriteWrap.mockResolvedValue(undefined);
  m.coreL0MyWriteWrap.mockResolvedValue({ has_wrap: false });
});

describe('L0AdminCard · §4.4.4-B 成员写密钥（管理员发放侧）', () => {
  it('渲染成员写密钥区与计数', async () => {
    render(<L0AdminCard enabled={true} />);
    await waitFor(() => expect(screen.getByTestId('l0-member-wrap-form')).toBeInTheDocument());
    expect(screen.getByTestId('l0-status-member-wraps').textContent).toContain('成员写密钥 0');
  });

  it('发放：账号+口令 → 调 coreL0AddMemberWriteWrap(member_id, passphrase)', async () => {
    render(<L0AdminCard enabled={true} />);
    await waitFor(() => expect(screen.getByTestId('l0-member-id')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-member-id'), { target: { value: 'mem_1' } });
    fireEvent.change(screen.getByTestId('l0-member-pw'), { target: { value: 'MemKeypass-1' } });
    fireEvent.click(screen.getByTestId('l0-member-issue'));
    await waitFor(() => expect(m.coreL0AddMemberWriteWrap).toHaveBeenCalledWith('mem_1', 'MemKeypass-1'));
  });

  it('撤销：账号 → 调 coreL0RemoveMemberWriteWrap(member_id)', async () => {
    render(<L0AdminCard enabled={true} />);
    await waitFor(() => expect(screen.getByTestId('l0-member-id')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-member-id'), { target: { value: 'mem_2' } });
    fireEvent.click(screen.getByTestId('l0-member-revoke'));
    await waitFor(() => expect(m.coreL0RemoveMemberWriteWrap).toHaveBeenCalledWith('mem_2'));
  });

  it('口令过短不给发放：内核不被调用', async () => {
    render(<L0AdminCard enabled={true} />);
    await waitFor(() => expect(screen.getByTestId('l0-member-id')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-member-id'), { target: { value: 'mem_3' } });
    fireEvent.change(screen.getByTestId('l0-member-pw'), { target: { value: 'short' } });
    fireEvent.click(screen.getByTestId('l0-member-issue'));
    expect(m.coreL0AddMemberWriteWrap).not.toHaveBeenCalled();
  });

  it('账号为空不给发放：内核不被调用', async () => {
    render(<L0AdminCard enabled={true} />);
    await waitFor(() => expect(screen.getByTestId('l0-member-id')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-member-pw'), { target: { value: 'MemKeypass-1' } });
    fireEvent.click(screen.getByTestId('l0-member-issue'));
    expect(m.coreL0AddMemberWriteWrap).not.toHaveBeenCalled();
  });

  it('已发放列表：status.member_wrap_ids 逐个成行（发给了谁看得见），行内可撤销', async () => {
    m.coreL0Status.mockResolvedValue(status({
      member_write_wraps: 2, member_wrap_ids: ['13838528400', 'mem_2'],
    }));
    render(<L0AdminCard enabled={true} />);
    await waitFor(() => expect(screen.getByTestId('l0-member-wrap-13838528400')).toBeInTheDocument());
    expect(screen.getByTestId('l0-member-wrap-mem_2')).toBeInTheDocument();
    expect(screen.queryByTestId('l0-member-wrap-empty')).toBeNull();
    // 行内撤销直接带该行 member_id，不用管理员再手打账号
    fireEvent.click(screen.getByTestId('l0-member-wrap-revoke-mem_2'));
    await waitFor(() => expect(m.coreL0RemoveMemberWriteWrap).toHaveBeenCalledWith('mem_2'));
  });

  it('未发放任何成员 → 列表空态如实说明', async () => {
    render(<L0AdminCard enabled={true} />);
    await waitFor(() => expect(screen.getByTestId('l0-member-wrap-empty')).toBeInTheDocument());
    expect(screen.getByTestId('l0-member-wrap-empty').textContent).toContain('尚未为任何成员发放');
  });

  it('口径澄清：写解锁口令不出现在查阅授权列表，两处各有说明', async () => {
    render(<L0AdminCard enabled={true} />);
    await waitFor(() => expect(screen.getByTestId('l0-member-wrap-scope-note')).toBeInTheDocument());
    expect(screen.getByTestId('l0-member-wrap-scope-note').textContent).toContain('不会出现在下方「查阅授权列表」');
    expect(screen.getByTestId('l0-grant-empty').textContent).toContain('写解锁口令在上方「已发放写密钥」表里');
  });
});

describe('L0AdminCard · 成员/未登录分支（enabled=false）', () => {
  it('只出管理员门禁说明，不给任何管理控件，也不在本卡显示账号状态', async () => {
    render(<L0AdminCard enabled={false} />);
    expect(screen.getByTestId('l0-admin-required').textContent).toContain('仅管理员可操作');
    // 指向真正该看的地方，避免成员在「危险操作卡」里找自己状态
    expect(screen.getByTestId('l0-admin-required').textContent).toContain('「账号与密钥」页签');
    expect(screen.queryByTestId('l0-member-wrap-form')).toBeNull();
    expect(screen.queryByTestId('l0-grant-table')).toBeNull();
    // 本账号写密钥状态已迁到 MyWriteWrapCard，不在本卡
    expect(screen.queryByTestId('my-wrap-state')).toBeNull();
    expect(m.coreL0MyWriteWrap).not.toHaveBeenCalled();
  });
});
