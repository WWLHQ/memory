// L0 写锁状态信号（§4.4.4 两把锁）：
// 解锁写密钥走主进程 IPC，不写 localStorage → 首页/状态栏原本不会自动重读，
// 导致「写密钥未解锁」红条在解锁后常驻不消失（2026-11-10 用户反馈的 bug）。
// 本模块提供同源信号：写锁变化时广播「请重读真实锁状态」，真值永远来自内核 l0Status()。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  L0_WRITE_LOCK_SIGNAL_KEY, onL0WriteLockChanged, signalL0WriteLockChanged,
} from '../l0WriteLockSignal.ts';

beforeEach(() => {
  localStorage.clear();
});

describe('L0 写锁状态信号', () => {
  it('广播后写入带时间戳的信号键（供其它同源页面识别「该重读了」）', () => {
    signalL0WriteLockChanged();
    const raw = localStorage.getItem(L0_WRITE_LOCK_SIGNAL_KEY);
    expect(raw).toBeTruthy();
    expect(Number(raw)).toBeGreaterThan(0);
  });

  it('订阅者在 storage 事件到达时被触发，且能取消订阅', () => {
    const handler = vi.fn();
    const off = onL0WriteLockChanged(handler);
    window.dispatchEvent(new StorageEvent('storage', { key: L0_WRITE_LOCK_SIGNAL_KEY }));
    expect(handler).toHaveBeenCalledTimes(1);

    // 其它键不触发
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme' }));
    expect(handler).toHaveBeenCalledTimes(1);

    off();
    window.dispatchEvent(new StorageEvent('storage', { key: L0_WRITE_LOCK_SIGNAL_KEY }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('信号只带时间戳、不携带锁状态（绝不冒充已解锁，真值由内核 l0Status 提供）', () => {
    signalL0WriteLockChanged();
    const raw = localStorage.getItem(L0_WRITE_LOCK_SIGNAL_KEY)!;
    expect(raw).not.toContain('unlocked');
    expect(raw).not.toContain('locked');
    expect(raw).not.toContain('true');
    expect(raw).not.toContain('false');
  });
});
