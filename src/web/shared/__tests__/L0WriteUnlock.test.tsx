// 批次41-W：写密钥未解锁的「就地解锁卡」单测。
// 三条口径必须钉住：① 管理员能当场解锁且成功后回调（写入页据此重放被挡住的那条）；
// ② 非管理员/未登录不给一个点了必然失败的按钮，只如实说明谁该去哪儿解；
// ③ 密码只进这一次调用——成功与失败都把输入框清空，且绝不出现在 DOM 文本里。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const l0UnlockWrite = vi.fn();
const l0UnlockWriteForMember = vi.fn();
vi.mock('../../kernel.ts', () => ({
  getKernel: () => ({
    l0UnlockWrite: (...a: unknown[]) => l0UnlockWrite(...a),
    l0UnlockWriteForMember: (...a: unknown[]) => l0UnlockWriteForMember(...a),
  }),
}));

const session = { role: 'admin' as 'admin' | 'member' | null };
vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => (session.role === null ? null : 's_test'),
  fetchSessionContext: async () => null,
  useSessionContext: () => ({
    sid: session.role === null ? null : 's_test',
    context: session.role === null ? null : { role: session.role, user_id: session.role === 'member' ? 'mem_test' : 'admin_test' },
    role: session.role,
    loading: false,
  }),
}));

import { L0WriteUnlock } from '../L0WriteUnlock.tsx';

const SECRET = 'Adm1n@L0-pass';

beforeEach(() => {
  l0UnlockWrite.mockReset();
  l0UnlockWriteForMember.mockReset();
  session.role = 'admin';
});

function unlockWith(password: string) {
  fireEvent.change(screen.getByTestId('l0-unlock-password'), { target: { value: password } });
  fireEvent.click(screen.getByTestId('l0-unlock-submit'));
}

describe('L0WriteUnlock（批次41-W + §4.4.4-B 成员自解锁）', () => {
  it('管理员解锁成功：密码原样交给内核、输入框清空、回调解锁后动作', async () => {
    l0UnlockWrite.mockResolvedValue(undefined);
    const onUnlocked = vi.fn();
    render(<L0WriteUnlock scene="这条手动写入" onUnlocked={onUnlocked} />);
    unlockWith(SECRET);
    await waitFor(() => expect(screen.getByTestId('l0-unlock-done')).toBeTruthy());
    expect(l0UnlockWrite).toHaveBeenCalledWith(SECRET);
    expect(l0UnlockWriteForMember).not.toHaveBeenCalled();
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('解锁失败：内核原因原样显示、密码不留任何痕迹、不谎称已解锁', async () => {
    l0UnlockWrite.mockRejectedValue(new Error('[E_L0_BAD_PASSWORD] 管理密码不正确'));
    const onUnlocked = vi.fn();
    render(<L0WriteUnlock scene="这条手动写入" onUnlocked={onUnlocked} />);
    unlockWith(SECRET);
    await waitFor(() => expect(screen.getByTestId('l0-unlock-error')).toBeTruthy());
    expect(screen.getByTestId('l0-unlock-error').textContent).toContain('管理密码不正确');
    expect(screen.queryByTestId('l0-unlock-done')).toBeNull();
    expect(onUnlocked).not.toHaveBeenCalled();
    expect((screen.getByTestId('l0-unlock-password') as HTMLInputElement).value).toBe('');
  });

  it('空密码不给调用内核：管理员场景先如实提示要输什么', () => {
    render(<L0WriteUnlock scene="后台采集" />);
    fireEvent.click(screen.getByTestId('l0-unlock-submit'));
    expect(l0UnlockWrite).not.toHaveBeenCalled();
    expect(screen.getByTestId('l0-unlock-error').textContent).toContain('请输入管理密码');
  });

  it('普通成员：可用自己的写解锁口令就地自解锁，调用 l0UnlockWriteForMember 并带 member_id', async () => {
    session.role = 'member';
    l0UnlockWriteForMember.mockResolvedValue(undefined);
    const onUnlocked = vi.fn();
    render(<L0WriteUnlock scene="这条手动写入" onUnlocked={onUnlocked} />);
    // 成员有密码框与按钮（不再只显示「请管理员解锁」）
    expect(screen.getByTestId('l0-unlock-password')).toBeInTheDocument();
    expect(screen.getByTestId('l0-unlock-submit')).toBeInTheDocument();
    expect(screen.queryByTestId('l0-unlock-need-admin')).toBeNull();
    unlockWith(SECRET);
    await waitFor(() => expect(screen.getByTestId('l0-unlock-done')).toBeTruthy());
    expect(l0UnlockWriteForMember).toHaveBeenCalledWith({ password: SECRET, member_id: 'mem_test' });
    expect(l0UnlockWrite).not.toHaveBeenCalled();
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('成员自解锁失败（如未发放/口令错）：原样报错、密码清空、不谎称解锁', async () => {
    session.role = 'member';
    l0UnlockWriteForMember.mockRejectedValue(new Error('[E_L0_NO_GRANT] 尚未发放写解锁口令'));
    render(<L0WriteUnlock scene="这条手动写入" />);
    unlockWith(SECRET);
    await waitFor(() => expect(screen.getByTestId('l0-unlock-error')).toBeTruthy());
    expect(screen.getByTestId('l0-unlock-error').textContent).toContain('尚未发放写解锁口令');
    expect(screen.queryByTestId('l0-unlock-done')).toBeNull();
    expect((screen.getByTestId('l0-unlock-password') as HTMLInputElement).value).toBe('');
  });

  it('未登录：不给按钮，文案指向「先登录」', () => {
    session.role = null;
    render(<L0WriteUnlock scene="这条手动写入" />);
    expect(screen.getByTestId('l0-unlock-need-admin').textContent).toContain('未登录');
    expect(screen.queryByTestId('l0-unlock-submit')).toBeNull();
  });

  it('场景名进提示：用户知道被挡住的是哪条通道', () => {
    render(<L0WriteUnlock scene="后台采集" />);
    expect(screen.getByTestId('l0-write-unlock').textContent).toContain('后台采集');
  });
});
