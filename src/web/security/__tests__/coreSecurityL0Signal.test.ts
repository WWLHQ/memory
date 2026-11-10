// 安全页写密钥解锁/锁定 → 必须广播写锁变化信号，让首页红条与状态栏立刻重读真实状态。
// （不广播时：解锁成功但首页仍显示「写密钥未解锁」—— 2026-11-10 用户反馈的 bug）
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  l0UnlockWrite: vi.fn(),
  l0LockWrite: vi.fn(),
  signal: vi.fn(),
}));

vi.mock('../../kernel.ts', () => ({
  getKernel: () => ({ l0UnlockWrite: h.l0UnlockWrite, l0LockWrite: h.l0LockWrite }),
  getKernelStorage: () => ({}),
}));

vi.mock('../../shared/l0WriteLockSignal.ts', () => ({
  signalL0WriteLockChanged: h.signal,
  L0_WRITE_LOCK_SIGNAL_KEY: 'memdesk.l0.writeLockSignal.v1',
  onL0WriteLockChanged: vi.fn(),
}));

import { coreL0LockWrite, coreL0UnlockWrite } from '../coreSecurity.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('安全页写锁变更信号', () => {
  it('解锁成功 → 广播信号（首页/状态栏据此重读真实锁状态）', async () => {
    h.l0UnlockWrite.mockResolvedValue(undefined);
    await coreL0UnlockWrite('管理密码');
    expect(h.l0UnlockWrite).toHaveBeenCalledWith('管理密码');
    expect(h.signal).toHaveBeenCalledTimes(1);
  });

  it('锁定成功 → 同样广播（状态栏也要立刻显示写锁已锁）', async () => {
    h.l0LockWrite.mockResolvedValue(undefined);
    await coreL0LockWrite();
    expect(h.signal).toHaveBeenCalledTimes(1);
  });

  it('解锁失败（密码错）→ 抛错且不广播（绝不谎报已解锁）', async () => {
    h.l0UnlockWrite.mockRejectedValue(new Error('管理密码错误（§4.4.4）'));
    await expect(coreL0UnlockWrite('错密码')).rejects.toThrow('管理密码错误');
    expect(h.signal).not.toHaveBeenCalled();
  });
});
