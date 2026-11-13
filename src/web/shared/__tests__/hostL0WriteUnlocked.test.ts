// 写锁读取通道自测（批次60 修复轮4）：HostL0Port.isWriteUnlocked 必须走「无鉴权只读布尔」通道 l0:writeUnlocked，
// 且**不得**带 currentSessionId。根因：写锁是进程级事实（DEK 在不在内存），
// 而 index.html 等文档拿不到会话 —— 若这里也要求会话，就只能退到管理员 status() 得到 false，
// 表现为「写入页已解锁、首页仍提示写密钥未解锁」。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hostCall } from '../../../desktop/hostBridge.ts';
import { HostL0Port } from '../l0Port.ts';

vi.mock('../../../desktop/hostBridge.ts', () => ({
  hostCapability: vi.fn(() => 'bridge' as const),
  hostCall: vi.fn(),
  installHostBridge: vi.fn(),
  isEmbedded: vi.fn(() => false),
  hostLog: vi.fn(),
}));
// 故意给一个会话：用来证明「即使有会话也不该往这个通道里塞」
vi.mock('../session.ts', () => ({ currentSessionId: () => 'sid_member' }));

describe('写锁读取通道：l0:writeUnlocked 无鉴权只读布尔', () => {
  const port = new HostL0Port();

  beforeEach(() => {
    vi.mocked(hostCall).mockReset();
  });

  it('走 l0:writeUnlocked 且参数为空数组（绝不带 sessionId）', async () => {
    vi.mocked(hostCall).mockResolvedValue({ ok: true, write_unlocked: true });
    await port.isWriteUnlocked();
    expect(hostCall).toHaveBeenCalledTimes(1);
    expect(hostCall).toHaveBeenCalledWith('l0:writeUnlocked', []);
  });

  it('不落到需要会话/管理员的通道（myWriteWrap / status）', async () => {
    vi.mocked(hostCall).mockResolvedValue({ ok: true, write_unlocked: true });
    await port.isWriteUnlocked();
    const channels = vi.mocked(hostCall).mock.calls.map((c) => c[0]);
    expect(channels).not.toContain('l0:myWriteWrap');
    expect(channels).not.toContain('l0:status');
  });

  it('write_unlocked=true → true；false / 缺字段 → false（保守按锁定）', async () => {
    vi.mocked(hostCall).mockResolvedValue({ ok: true, write_unlocked: true });
    expect(await port.isWriteUnlocked()).toBe(true);

    vi.mocked(hostCall).mockResolvedValue({ ok: true, write_unlocked: false });
    expect(await port.isWriteUnlocked()).toBe(false);

    // 老主进程没这个字段 → 保守判定，不误报可写
    vi.mocked(hostCall).mockResolvedValue({ ok: true });
    expect(await port.isWriteUnlocked()).toBe(false);
  });

  it('通道失败要抛，不吞成 false —— 内核还能继续退到管理员 status()', async () => {
    vi.mocked(hostCall).mockResolvedValue({ ok: false, code: 'E_AUTH_L0', error: '通道不可用' });
    await expect(port.isWriteUnlocked()).rejects.toThrow(/通道不可用/);
  });
});
