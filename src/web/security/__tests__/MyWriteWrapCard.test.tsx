// 成员端「本账号写密钥」卡：两个状态（有没有钥匙 / 现在是否已解锁）必须分开显示，且能就地解锁。
// 用户实测反馈「到底是已解锁还是没解锁、没解锁在哪输入」→ 这两点由本套件钉住。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  coreL0MyWriteWrap: vi.fn(),
  coreL0UnlockWriteForMember: vi.fn(),
  session: { context: { user_id: '13838528400', role: 'member' } as { user_id: string; role: string } | null },
}));

vi.mock('../coreSecurity.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../coreSecurity.ts')>();
  return {
    ...actual,
    coreL0MyWriteWrap: m.coreL0MyWriteWrap,
    coreL0UnlockWriteForMember: m.coreL0UnlockWriteForMember,
  };
});

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 'sid_member',
  fetchSessionContext: async () => m.session.context,
  useSessionContext: () => ({ sid: 'sid_member', context: m.session.context, role: 'member' as const, loading: false }),
}));

import { MyWriteWrapCard } from '../MyWriteWrapCard.tsx';

beforeEach(() => {
  m.coreL0MyWriteWrap.mockReset();
  m.coreL0UnlockWriteForMember.mockReset();
  m.session.context = { user_id: '13838528400', role: 'member' };
  m.coreL0MyWriteWrap.mockResolvedValue({ has_wrap: true, write_unlocked: false });
  m.coreL0UnlockWriteForMember.mockResolvedValue(undefined);
});

describe('MyWriteWrapCard · 两个状态必须分开', () => {
  it('已发放但未解锁：分两行显示，且出现解锁输入框（不再笼统写「可以写入 L0」）', async () => {
    render(<MyWriteWrapCard />);
    await waitFor(() => expect(screen.getByTestId('my-wrap-grant-state')).toBeInTheDocument());
    expect(screen.getByTestId('my-wrap-grant-state').textContent).toBe('已发放');
    expect(screen.getByTestId('my-wrap-unlocked-state').textContent).toContain('未解锁');
    expect(screen.getByTestId('my-wrap-unlocked-state').textContent).toContain('写入会被挡下');
    // 未解锁 → 本卡直接给输入入口（用户问的「在哪里输入」）
    expect(screen.getByTestId('my-wrap-unlock-form')).toBeInTheDocument();
    expect(screen.getByTestId('my-wrap-unlock-pw')).toBeInTheDocument();
    expect(screen.queryByTestId('my-wrap-ready-note')).toBeNull();
  });

  it('已发放且已解锁：显示「已解锁 · 现在可以写入 L0」，输入框收起并说明进程级语义', async () => {
    m.coreL0MyWriteWrap.mockResolvedValue({ has_wrap: true, write_unlocked: true });
    render(<MyWriteWrapCard />);
    await waitFor(() => expect(screen.getByTestId('my-wrap-unlocked-state').textContent).toContain('已解锁'));
    expect(screen.queryByTestId('my-wrap-unlock-form')).toBeNull();
    expect(screen.getByTestId('my-wrap-ready-note').textContent).toContain('进程级');
  });

  it('未发放：显示「未发放 / 未解锁」，不给输入框（输也解不开），指向管理员发放位置', async () => {
    m.coreL0MyWriteWrap.mockResolvedValue({ has_wrap: false, write_unlocked: false });
    render(<MyWriteWrapCard />);
    await waitFor(() => expect(screen.getByTestId('my-wrap-grant-state').textContent).toBe('未发放'));
    expect(screen.queryByTestId('my-wrap-unlock-form')).toBeNull();
    expect(screen.getByTestId('my-wrap-no-grant-note').textContent).toContain('请联系管理员');
  });

  it('未登录/会话过期 → 需要会话，不冒充已发/未发、不显示输入框', async () => {
    m.session.context = null;
    m.coreL0MyWriteWrap.mockRejectedValue(new Error('E_AUTH_SESSION: 需要登录后操作'));
    render(<MyWriteWrapCard />);
    await waitFor(() => expect(screen.getByTestId('my-wrap-error')).toBeInTheDocument());
    expect(screen.getByTestId('my-wrap-error').textContent).toContain('需要会话');
    expect(screen.queryByTestId('my-wrap-unlock-form')).toBeNull();
  });

  it('输入口令解锁：调 coreL0UnlockWriteForMember(会话账号, 口令) → 清空口令 → 刷新后变已解锁', async () => {
    render(<MyWriteWrapCard />);
    await waitFor(() => expect(screen.getByTestId('my-wrap-unlock-pw')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('my-wrap-unlock-pw'), { target: { value: 'memberkeypass-1' } });
    // 解锁成功后服务端回到已解锁
    m.coreL0MyWriteWrap.mockResolvedValue({ has_wrap: true, write_unlocked: true });
    fireEvent.click(screen.getByTestId('my-wrap-unlock-submit'));
    await waitFor(() => expect(m.coreL0UnlockWriteForMember).toHaveBeenCalledWith('13838528400', 'memberkeypass-1'));
    await waitFor(() => expect(screen.getByTestId('my-wrap-unlocked-state').textContent).toContain('已解锁'));
    expect(screen.getByTestId('my-wrap-msg').textContent).toContain('写密钥已解锁');
    // 口令不留在 DOM
    expect((screen.queryByTestId('my-wrap-unlock-pw') as HTMLInputElement | null)?.value ?? '').toBe('');
  });

  it('口令错误：就地报错并清空口令，不冒充成功', async () => {
    m.coreL0UnlockWriteForMember.mockRejectedValue(new Error('E_AUTH_L0: 口令不正确'));
    render(<MyWriteWrapCard />);
    await waitFor(() => expect(screen.getByTestId('my-wrap-unlock-pw')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('my-wrap-unlock-pw'), { target: { value: 'wrong-pass-1' } });
    fireEvent.click(screen.getByTestId('my-wrap-unlock-submit'));
    await waitFor(() => expect(screen.getByTestId('my-wrap-unlock-error')).toBeInTheDocument());
    expect(screen.getByTestId('my-wrap-unlock-error').textContent).toContain('解锁失败');
    expect(screen.queryByTestId('my-wrap-msg')).toBeNull();
    expect((screen.getByTestId('my-wrap-unlock-pw') as HTMLInputElement).value).toBe('');
  });

  it('口令过短不发起解锁（只在前端拦，不打扰内核）', async () => {
    render(<MyWriteWrapCard />);
    await waitFor(() => expect(screen.getByTestId('my-wrap-unlock-pw')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('my-wrap-unlock-pw'), { target: { value: 'short' } });
    fireEvent.click(screen.getByTestId('my-wrap-unlock-submit'));
    expect(m.coreL0UnlockWriteForMember).not.toHaveBeenCalled();
    expect(screen.getByTestId('my-wrap-unlock-error').textContent).toContain('至少 8 位');
  });

  it('另有一处输入点（写入被挡时就地弹框）也在卡面写明，避免「找不到地方」', async () => {
    render(<MyWriteWrapCard />);
    await waitFor(() => expect(screen.getByTestId('my-wrap-where')).toBeInTheDocument());
    expect(screen.getByTestId('my-wrap-where').textContent).toContain('写入页提交后若提示');
  });
});
