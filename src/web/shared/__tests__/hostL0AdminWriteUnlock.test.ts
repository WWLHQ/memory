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

  it('status：member_wrap_ids 原样透出（页面靠它显示「发给了谁」），缺字段兜底空数组', async () => {
    vi.mocked(hostCall).mockResolvedValue({
      ok: true, has_admin_wrap: true, write_unlocked: true, active_sessions: 0, active_grants: 0,
      member_write_wraps: 2, member_wrap_ids: ['13838528400', 'mem_2'],
    });
    const st = await admin.status();
    expect(st.member_wrap_ids).toEqual(['13838528400', 'mem_2']);
    expect(st.member_write_wraps).toBe(2);

    // 老版本主进程没有该字段 → 空数组（页面出空态，不崩）
    vi.mocked(hostCall).mockResolvedValue({
      ok: true, has_admin_wrap: true, write_unlocked: true, active_sessions: 0, active_grants: 0, member_write_wraps: 1,
    });
    expect((await admin.status()).member_wrap_ids).toEqual([]);
  });

  it('myWriteWrap：只带 sessionId 走 l0:myWriteWrap，回「有没有钥匙 + 是否已解锁」两个布尔', async () => {
    vi.mocked(hostCall).mockResolvedValue({ ok: true, has_wrap: true, write_unlocked: false, member_id: 'u-member' });
    const r = await admin.myWriteWrap('u-member');
    expect(r).toEqual({ has_wrap: true, write_unlocked: false });
    // 主进程按会话取账号 → 页面不得把自己的 member_id 传上去（越权面为零）
    expect(hostCall).toHaveBeenCalledWith('l0:myWriteWrap', ['sid_member']);
    // 老主进程缺 write_unlocked → 保守按未解锁（页面会出输入框，不误报可写）
    vi.mocked(hostCall).mockResolvedValue({ ok: true, has_wrap: true });
    expect(await admin.myWriteWrap('u-member')).toEqual({ has_wrap: true, write_unlocked: false });
  });
});
