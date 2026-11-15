// T4 回归加固 · requestEnableMcpSwitch 薄封装（web → 主进程 mcp:clientEnable）。
// 只验证封装层：通道名正确、ok/error 透传、异常转可读原因；不在此重复主进程侧的备份/幂等逻辑
// （那些由 electron/mcpClients.test.ts 的 T2 组锁住）。
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { hostCall } from '../../../desktop/hostBridge.ts';
import { requestEnableMcpSwitch } from '../mcpSwitch.ts';

vi.mock('../../../desktop/hostBridge.ts', () => ({
  hostCall: vi.fn(),
  hostCapability: () => 'full',
}));

const call = hostCall as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => { call.mockReset(); });

describe('T4 回归加固 · requestEnableMcpSwitch 封装', () => {
  it('主进程返回 ok:true → 封装层 ok:true，且只把 id + sessionId 发给主进程（不带令牌）', async () => {
    call.mockResolvedValueOnce({ ok: true });
    const r = await requestEnableMcpSwitch('workbuddy');
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
    expect(call).toHaveBeenCalledOnce();
    const [channel, args] = call.mock.calls[0] as [string, unknown[]];
    expect(channel).toBe('mcp:clientEnable');
    expect(args[0]).toBe('workbuddy');
    expect(JSON.stringify(args)).not.toContain('Bearer');
  });

  it('主进程返回 ok:false + 原因 → 封装层 ok:false 透传，不谎称成功', async () => {
    call.mockResolvedValueOnce({ ok: false, error: '需要管理员权限' });
    const r = await requestEnableMcpSwitch('workbuddy');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('需要管理员权限');
  });

  it('hostCall 抛错（桥断开）→ ok:false 且把异常转成可读原因', async () => {
    call.mockRejectedValueOnce(new Error('bridge 断开'));
    const r = await requestEnableMcpSwitch('workbuddy');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('bridge 断开');
  });
});
