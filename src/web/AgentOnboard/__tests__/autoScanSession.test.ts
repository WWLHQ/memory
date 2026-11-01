// 批次33-A：「本次登录会话是否已自动扫过」标记（用户反馈：首次登录扫一次即可，切页面不该再扫）
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ONBOARD_AUTOSCAN_KEY, ONBOARD_FAILURE_KEY, clearAutoScannedSession,
  hasAutoScannedSession, markAutoScannedSession, readOnboardFailure, resetAutoOnboardState,
} from '../autoOnboard.ts';
import { readOnboardState, writeOnboardState } from '../onboardState.ts';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('自动接入扫描标记（批次33-A）', () => {
  it('标记落在 sessionStorage：同一窗口内切页共享，关掉窗口即清空', () => {
    markAutoScannedSession('sid_1');
    expect(sessionStorage.getItem(ONBOARD_AUTOSCAN_KEY)).toBe('sid_1');
    expect(localStorage.getItem(ONBOARD_AUTOSCAN_KEY)).toBeNull(); // 不用 localStorage → 重启后仍补扫一轮
    expect(hasAutoScannedSession('sid_1')).toBe(true);
  });

  it('按会话判定：换账号登录（sid 变了）仍需扫一轮', () => {
    markAutoScannedSession('sid_1');
    expect(hasAutoScannedSession('sid_2')).toBe(false);
    expect(hasAutoScannedSession('')).toBe(false);
  });

  it('清除标记后回到「未扫过」', () => {
    expect(hasAutoScannedSession('sid_1')).toBe(false);
    markAutoScannedSession('sid_1');
    clearAutoScannedSession();
    expect(hasAutoScannedSession('sid_1')).toBe(false);
  });

  it('撤销重接（resetAutoOnboardState）同时清掉接入状态、失败快照与扫描标记 → 允许再扫一轮', () => {
    writeOnboardState({ lastOnboardAt: Date.now(), agentNames: ['Claude Code'], source: 'host' });
    localStorage.setItem(
      ONBOARD_FAILURE_KEY,
      JSON.stringify({ failed: true, reason: '测试失败', at: Date.now() }),
    );
    markAutoScannedSession('sid_1');

    resetAutoOnboardState();

    expect(readOnboardState()).toBeNull();
    expect(readOnboardFailure()).toBeNull();
    expect(hasAutoScannedSession('sid_1')).toBe(false);
  });
});
