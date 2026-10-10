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
