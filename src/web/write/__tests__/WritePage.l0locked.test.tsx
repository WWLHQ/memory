// 批次41-W：写入页「L0 写密钥锁定」端到端——提交被挡 → 原地出解锁卡 → 管理员解锁后自动重放 → 出回执。
// 用真内核（真 L0Vault 封存），只 mock 会话为管理员（解锁卡需要管理员分支才出按钮）。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => null,
  fetchSessionContext: async () => null,
  useSessionContext: () => ({ sid: null, context: { role: 'admin' }, role: 'admin' as const, loading: false }),
}));

import { WritePage } from '../WritePage.tsx';
import { resetKernelForTests, setKernelL0ForTests } from '../../kernel.ts';
import { createTestVault, TEST_ADMIN_PW, TEST_ADMIN_ID } from '../../../core/memagent/__tests__/l0Kit.ts';

describe('WritePage · 批次41-W L0 写密钥锁定', () => {
  async function unlockedVault() {
    resetKernelForTests();
    const { vault } = await createTestVault();
    setKernelL0ForTests({ l0: vault, l0Admin: vault });
    return vault;
  }

  it('锁定的写密钥 → 提交被挡并原地出解锁卡（不出回执、提示自动重放）', async () => {
    const vault = await unlockedVault();
    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    render(<WritePage />);
    fireEvent.change(screen.getByTestId('f-content'), { target: { value: '部署流水线构建失败：Node 版本需统一为 22 LTS' } });
    fireEvent.click(screen.getByTestId('submit'));
    await waitFor(() => expect(screen.getByTestId('l0-write-unlock')).toBeInTheDocument());
    expect(screen.getByTestId('l0-write-unlock').textContent).toContain('L0 写密钥未解锁');
    expect(screen.getByTestId('l0-unlock-password')).toBeInTheDocument();
    expect(screen.queryByTestId('receipt')).toBeNull(); // 没写进去就别出回执
    expect(screen.getByTestId('toast').textContent).toContain('L0 写密钥未解锁');
  });

  it('解锁成功后自动重放被挡的那条 → 出回执（用户不必再点一次「写入」）', async () => {
    const vault = await unlockedVault();
    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    render(<WritePage />);
    fireEvent.change(screen.getByTestId('f-content'), { target: { value: '部署流水线构建失败：Node 版本需统一为 22 LTS' } });
    fireEvent.click(screen.getByTestId('submit'));
    await waitFor(() => expect(screen.getByTestId('l0-unlock-password')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-unlock-password'), { target: { value: TEST_ADMIN_PW } });
    fireEvent.click(screen.getByTestId('l0-unlock-submit'));
    await waitFor(() => expect(screen.getByTestId('receipt')).toBeInTheDocument());
    expect(screen.getByTestId('receipt-id')).toHaveTextContent(/^mem_/);
    expect(screen.queryByTestId('l0-write-unlock')).toBeNull(); // 解锁成功后卡消失
  });

  it('解锁失败（密码错）→ 原地报错、密码被清、不谎称解锁', async () => {
    const vault = await unlockedVault();
    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    render(<WritePage />);
    fireEvent.change(screen.getByTestId('f-content'), { target: { value: '部署流水线构建失败：Node 版本需统一为 22 LTS' } });
    fireEvent.click(screen.getByTestId('submit'));
    await waitFor(() => expect(screen.getByTestId('l0-unlock-password')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-unlock-password'), { target: { value: 'wrong-pass' } });
    fireEvent.click(screen.getByTestId('l0-unlock-submit'));
    await waitFor(() => expect(screen.getByTestId('l0-unlock-error')).toBeInTheDocument());
    expect((screen.getByTestId('l0-unlock-password') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('receipt')).toBeNull();
  });
});
