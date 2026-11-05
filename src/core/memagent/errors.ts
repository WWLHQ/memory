// memagent-core 错误码（§6，各端统一处理）
import type { ErrorCode } from './types.ts';

export class MemAgentError extends Error {
  readonly code: ErrorCode;
  readonly detail: Record<string, unknown>;

  constructor(code: ErrorCode, msg: string, detail: Record<string, unknown> = {}) {
    super(`[${code}] ${msg}`);
    this.name = 'MemAgentError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * 批次41-W：这条错误是不是「L0 写密钥没解锁」？
 * 必须同时认 code 与文本——内核在主进程/渲染进程两侧抛出，跨 IPC 与审计后只剩
 * `[E_L0_LOCKED] …` 这句消息字符串（采集器就是把 message 写进审计 detail.error），
 * 只看 code 会把这类失败误判成普通写失败。
 * 这是唯一判据，采集器 / 端壳 / 首页异常派生都调它，不允许各处再各写一份正则。
 */
export function isL0LockedError(e: unknown): boolean {
  if (e instanceof MemAgentError) return e.code === 'E_L0_LOCKED';
  return isL0LockedText(`${String((e as Error | null)?.message ?? '')} ${String((e as { code?: unknown } | null)?.code ?? '')}`);
}

/** 批次41-W：已经只剩字符串时（审计 detail.error、日志行）的同一条判据 */
export function isL0LockedText(text: string): boolean {
  return text.includes('E_L0_LOCKED');
}
