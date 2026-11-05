// 批次41-W：写密钥未解锁的「就地解锁卡」单测。
// 三条口径必须钉住：① 管理员能当场解锁且成功后回调（写入页据此重放被挡住的那条）；
// ② 非管理员/未登录不给一个点了必然失败的按钮，只如实说明谁该去哪儿解；
// ③ 密码只进这一次调用——成功与失败都把输入框清空，且绝不出现在 DOM 文本里。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const l0UnlockWrite = vi.fn();
vi.mock('../../kernel.ts', () => ({ getKernel: () => ({ l0UnlockWrite: (...a: unknown[]) => l0UnlockWrite(...a) }) }));

const session = { role: 'admin' as 'admin' | 'member' | null };
vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => (session.role === null ? null : 's_test'),
  fetchSessionContext: async () => null,
  useSessionContext: () => ({
    sid: session.role === null ? null : 's_test',
    context: session.role === null ? null : { role: session.role },
    role: session.role,
    loading: false,
  }),
}));

import { L0WriteUnlock } from '../L0WriteUnlock.tsx';

const SECRET = 'Adm1n@L0-pass';

beforeEach(() => {
  l0UnlockWrite.mockReset();
  session.role = 'admin';
});

function unlockWith(password: string) {
  fireEvent.change(screen.getByTestId('l0-unlock-password'), { target: { value: password } });
  fireEvent.click(screen.getByTestId('l0-unlock-submit'));
}

describe('L0WriteUnlock（批次41-W）', () => {
  it('管理员解锁成功：密码原样交给内核、输入框清空、回调解锁后动作', async () => {
    l0UnlockWrite.mockResolvedValue(undefined);
    const onUnlocked = vi.fn();
    render(<L0WriteUnlock scene="这条手动写入" onUnlocked={onUnlocked} />);
    unlockWith(SECRET);
    await waitFor(() => expect(screen.getByTestId('l0-unlock-done')).toBeTruthy());
    expect(l0UnlockWrite).toHaveBeenCalledWith(SECRET);
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

  it('空密码不给调用内核：先如实提示要输什么', () => {
    render(<L0WriteUnlock scene="后台采集" />);
    fireEvent.click(screen.getByTestId('l0-unlock-submit'));
    expect(l0UnlockWrite).not.toHaveBeenCalled();
    expect(screen.getByTestId('l0-unlock-error').textContent).toContain('请输入管理密码');
  });

  it('普通成员：没有密码框与按钮，只说明需管理员在哪儿解锁', () => {
    session.role = 'member';
    render(<L0WriteUnlock scene="这条手动写入" />);
    expect(screen.getByTestId('l0-unlock-need-admin').textContent).toContain('不是管理员');
    expect(screen.queryByTestId('l0-unlock-password')).toBeNull();
    expect(screen.queryByTestId('l0-unlock-submit')).toBeNull();
  });

  it('未登录：同样不给按钮，文案指向「先登录再由管理员解锁」', () => {
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
