// 启动即自动发现并接入本机 Agent（2026-11-16 用户要求）。
// 这组用例锁的是「壳层启动就会扫」与四条不该扫/不该重复扫的边界：
//   未登录不扫 · 本窗口只扫一轮 · 该会话已扫过不重扫 · 单轮抛错不能把壳层带崩。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const runAutoOnboard = vi.fn();
const hasAutoScannedSession = vi.fn();
const hostLog = vi.fn();
const getStoredSessionId = vi.fn();

vi.mock('../autoOnboard.ts', () => ({
  runAutoOnboard: (...args: unknown[]) => runAutoOnboard(...args),
  hasAutoScannedSession: (sid: string) => hasAutoScannedSession(sid),
}));
vi.mock('../../../desktop/hostBridge.ts', () => ({
  hostLog: (...args: unknown[]) => hostLog(...args),
}));
vi.mock('../../Home/crossTabAuth.ts', () => ({
  getStoredSessionId: () => getStoredSessionId(),
}));

import { resetStartupAutoOnboardForTest, runStartupAutoOnboard } from '../startupAutoOnboard.ts';

beforeEach(() => {
  runAutoOnboard.mockReset();
  hasAutoScannedSession.mockReset().mockReturnValue(false);
  hostLog.mockReset();
  getStoredSessionId.mockReset().mockReturnValue('sid_x');
  resetStartupAutoOnboardForTest();
});

describe('启动自动接入（不等切页）', () => {
  it('正常启动：立刻起一轮三路真扫，trigger=auto，带上真实会话与角色', async () => {
    runAutoOnboard.mockResolvedValue({
      ok: true, scan: {}, discovered: [{ name: 'Claude Code' }], installed: [], installedProbes: {},
      backendOk: true, ms: 42, mcp: { endpoint: '', wired: ['Claude Code'], changed: [], manual: [], failed: [] },
    });

    const out = await runStartupAutoOnboard({ sid: 'sid_x', role: 'admin', delayMs: 0, form: 'desktop' });

    expect(runAutoOnboard).toHaveBeenCalledTimes(1);
    expect(runAutoOnboard.mock.calls[0][0]).toMatchObject({
      sid: 'sid_x', role: 'admin', form: 'desktop', trigger: 'auto',
    });
    expect(out?.ok).toBe(true);
    // 结果要落动作日志：出问题时能在 actions.log 里查到「启动扫到了什么」
    const done = hostLog.mock.calls.find((c) => c[1] === 'startup-auto-onboard:done');
    expect(done).toBeTruthy();
    expect(done?.[2]).toMatchObject({ ok: true, discovered: 1 });
  });

  it('未登录不扫：写 skipped=no-session，不碰三路真扫（写了也只会记一堆无会话）', async () => {
    const out = await runStartupAutoOnboard({ sid: null, delayMs: 0 });

    expect(out).toBeNull();
    expect(runAutoOnboard).not.toHaveBeenCalled();
    expect(hostLog).toHaveBeenCalledWith('onboarding', 'startup-auto-onboard', { skipped: 'no-session' });
  });

  it('该会话已扫过（登录链路扫过）→ 不重复扫', async () => {
    hasAutoScannedSession.mockReturnValue(true);
    const out = await runStartupAutoOnboard({ sid: 'sid_x', delayMs: 0 });

    expect(out).toBeNull();
    expect(runAutoOnboard).not.toHaveBeenCalled();
    expect(hasAutoScannedSession).toHaveBeenCalledWith('sid_x');
  });

  it('同一窗口重复调用（StrictMode 双挂载 / 多个 effect）只扫一轮', async () => {
    runAutoOnboard.mockResolvedValue({
      ok: true, scan: {}, discovered: [], installed: [], installedProbes: {}, backendOk: true, ms: 1,
    });

    await Promise.all([
      runStartupAutoOnboard({ sid: 'sid_x', delayMs: 0 }),
      runStartupAutoOnboard({ sid: 'sid_x', delayMs: 0 }),
    ]);
    await runStartupAutoOnboard({ sid: 'sid_x', delayMs: 0 });

    expect(runAutoOnboard).toHaveBeenCalledTimes(1);
  });

  it('force=true 可强制再跑（测试/重接场景），不受单次闸影响', async () => {
    runAutoOnboard.mockResolvedValue({
      ok: true, scan: {}, discovered: [], installed: [], installedProbes: {}, backendOk: true, ms: 1,
    });

    await runStartupAutoOnboard({ sid: 'sid_x', delayMs: 0 });
    await runStartupAutoOnboard({ sid: 'sid_x', delayMs: 0, force: true });

    expect(runAutoOnboard).toHaveBeenCalledTimes(2);
  });

  it('扫描抛错：返回 null 且写 error 日志，绝不把异常抛给壳层', async () => {
    runAutoOnboard.mockRejectedValue(new Error('宿主扫描炸了'));

    await expect(runStartupAutoOnboard({ sid: 'sid_x', delayMs: 0 })).resolves.toBeNull();

    const err = hostLog.mock.calls.find((c) => c[1] === 'startup-auto-onboard:error');
    expect(err?.[2]).toMatchObject({ error: '宿主扫描炸了' });
    expect(err?.[3]).toEqual({ level: 'error' });
  });

  it('延迟到期前不扫（先让壳层画出来，不跟首屏抢主进程）', async () => {
    vi.useFakeTimers();
    try {
      runAutoOnboard.mockResolvedValue({
        ok: true, scan: {}, discovered: [], installed: [], installedProbes: {}, backendOk: true, ms: 1,
      });
      const p = runStartupAutoOnboard({ sid: 'sid_x', delayMs: 1200 });
      await vi.advanceTimersByTimeAsync(1100);
      expect(runAutoOnboard).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      await p;
      expect(runAutoOnboard).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
