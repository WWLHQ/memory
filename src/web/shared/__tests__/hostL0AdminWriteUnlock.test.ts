// §4.4.4-B 渲染层端口透传自测：HostL0Admin 必须把 member_id 透传给主进程 l0:writeUnlock，
// 否则成员即使有写解锁口令也走不通 IPC（BUG 链路层）。覆盖：成员路径透传 / 管理员路径向后兼容 / 发放·撤销通道。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hostCall } from '../../../desktop/hostBridge.ts';
import { HostL0Admin } from '../l0Port.ts';

vi.mock('../../../desktop/hostBridge.ts', () => ({
  hostCapability: vi.fn(() => 'bridge' as const),
  hostCall: vi.fn(),
  installHostBridge: vi.fn(),
  isEmbedded: vi.fn(() => false),
  hostLog: vi.fn(),
}));
vi.mock('../session.ts', () => ({ currentSessionId: () => 'sid_member' }));

describe('§4.4.4-B HostL0Admin 写解锁 / 成员写密钥端口透传', () => {
  const admin = new HostL0Admin();

  beforeEach(() => {
    vi.mocked(hostCall).mockReset();
  });

  it('unlockWrite 带 member_id → 透传为 l0:writeUnlock 第 2 个位置参数（绝不丢弃）', async () => {
    vi.mocked(hostCall).mockResolvedValue({ ok: true });
    await admin.unlockWrite({ password: 'pw', admin_user_id: 'admin', member_id: 'u-member' });
    expect(hostCall).toHaveBeenCalledWith('l0:writeUnlock', ['pw', 'u-member', 'sid_member']);
  });

  it('unlockWrite 不带 member_id（管理员路径）→ 第 2 参数为 null，向后兼容', async () => {
    vi.mocked(hostCall).mockResolvedValue({ ok: true });
    await admin.unlockWrite({ password: 'pw', admin_user_id: 'admin' });
    expect(hostCall).toHaveBeenCalledWith('l0:writeUnlock', ['pw', null, 'sid_member']);
  });

  it('addMemberWriteWrap / removeMemberWriteWrap 走各自通道并透传 member_id', async () => {
    vi.mocked(hostCall).mockResolvedValue({ ok: true });
    await admin.addMemberWriteWrap({ member_id: 'u-member', passphrase: 'memberpass-1', admin_user_id: 'admin' });
    expect(hostCall).toHaveBeenCalledWith('l0:addMemberWriteWrap', ['u-member', 'memberpass-1', 'sid_member']);
    await admin.removeMemberWriteWrap({ member_id: 'u-member', admin_user_id: 'admin' });
    expect(hostCall).toHaveBeenCalledWith('l0:removeMemberWriteWrap', ['u-member', 'sid_member']);
  });
});
