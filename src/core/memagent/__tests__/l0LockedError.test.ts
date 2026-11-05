// 批次41-W：E_L0_LOCKED 的唯一判据（采集器 / 端壳 / 首页异常派生共用，不允许各处再写正则）。
import { describe, expect, it } from 'vitest';
import { MemAgentError, isL0LockedError, isL0LockedText } from '../errors.ts';

describe('isL0LockedError / isL0LockedText（批次41-W 单一判据）', () => {
  it('认 code（MemAgentError 直接带 E_L0_LOCKED）', () => {
    expect(isL0LockedError(new MemAgentError('E_L0_LOCKED', '写密钥未解锁'))).toBe(true);
  });

  it('认 message（跨 IPC 后只剩字符串的常见形态，非 MemAgentError 走文本判据）', () => {
    expect(isL0LockedError(new Error('[E_L0_LOCKED] L0 写密钥未解锁'))).toBe(true);
  });

  it('MemAgentError 以 code 为准：code 不是 E_L0_LOCKED 就不判成锁定（即使 message 里有该串）', () => {
    expect(isL0LockedError(new MemAgentError('E_AUTH_L0', '管理密码错误'))).toBe(false);
    expect(isL0LockedError(new MemAgentError('E_CRYPTO', '[E_L0_LOCKED] 串号了'))).toBe(false);
  });

  it('普通写失败不冒充锁定', () => {
    expect(isL0LockedError(new Error('boom'))).toBe(false);
    expect(isL0LockedError(new MemAgentError('E_VECTOR', '账本被另一进程持锁'))).toBe(false);
  });

  it('null / undefined / 非错误对象不误判', () => {
    expect(isL0LockedError(null)).toBe(false);
    expect(isL0LockedError(undefined)).toBe(false);
    expect(isL0LockedError({ message: 'E_L0_LOCKED' })).toBe(true); // 只有 message 也认
  });

  it('纯文本判据：命中即真，不命中即假（首页异常从审计 detail.error 复用它）', () => {
    expect(isL0LockedText('[E_L0_LOCKED] 写密钥未解锁')).toBe(true);
    expect(isL0LockedText('boom')).toBe(false);
    expect(isL0LockedText('')).toBe(false);
  });
});
