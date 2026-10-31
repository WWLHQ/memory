// 批次28-A：浏览器内核数据面 —— StorageBackend 的 HTTP 透传实现。
// 纯浏览器模式（npm run dev，无 Electron 主进程）下，内核存储不再用进程内空账本，
// 而是凭登录会话（x-session-id）经本机登录后端的 /api/kernel/invoke 直读真实账本。
// 服务端只放行六条存储方法且会话鉴权；写入被只读镜像拒绝时原样抛 E_STORAGE_LOCKED 文案。
import type { AuditAction, AuditRecord, Filter, Memory, StorageBackend } from '../core/memagent/types.ts';
import { currentSessionId } from './shared/session.ts';

const KERNEL_METHODS = [
  'putMemory', 'getMemory', 'listMemories', 'deleteMemory', 'appendAudit', 'queryAudit',
] as const;
type KernelMethod = (typeof KERNEL_METHODS)[number];

export interface HttpStorageOptions {
  /** 登录后端基址（homeBaseUrl() 的返回值，端口单一真源在 backend.ts） */
  baseUrl: string;
  /** 会话 id 缺省取当前登录会话；测试可显式注入 */
  sessionId?: () => string | null;
  /** fetch 注入点（缺省全局 fetch；测试用 mock） */
  fetchImpl?: typeof fetch;
}

export class KernelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelUnavailableError';
  }
}

export class HttpStorageBackend implements StorageBackend {
  constructor(private readonly opts: HttpStorageOptions) {
    this.doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
    this.sessionOf = opts.sessionId ?? currentSessionId;
  }

  private readonly doFetch: typeof fetch;
  private readonly sessionOf: () => string | null;

  private async invoke<T>(method: KernelMethod, ...args: unknown[]): Promise<T> {
    const sid = this.sessionOf();
    if (!sid) throw new KernelUnavailableError('尚未登录：内核数据面需要登录会话（登录后自动重试）');
    let res: Response;
    try {
      res = await this.doFetch(`${this.opts.baseUrl}/api/kernel/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
        body: JSON.stringify({ method, args }),
      });
    } catch (e) {
      throw new KernelUnavailableError(`登录后端不可达（${(e as Error)?.message ?? e}）`);
    }
    if (res.status === 401) throw new KernelUnavailableError('登录会话已失效：请重新登录后再操作记忆库');
    if (res.status === 501) throw new KernelUnavailableError('该后端未挂载记忆账本（kernel_unavailable）');
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; error?: string } | null;
    if (!body) throw new Error(`内核数据面响应异常（HTTP ${res.status}）`);
    if (!body.ok) throw new Error(body.error ?? '内核数据面调用失败');
    return body.result as T;
  }

  putMemory(m: Memory): Promise<void> {
    return this.invoke('putMemory', m).then(() => undefined);
  }

  getMemory(mem_id: string): Promise<Memory | null> {
    return this.invoke<Memory | null>('getMemory', mem_id);
  }

  listMemories(filter: Filter): Promise<Memory[]> {
    return this.invoke<Memory[]>('listMemories', filter);
  }

  deleteMemory(mem_id: string): Promise<void> {
    return this.invoke('deleteMemory', mem_id).then(() => undefined);
  }

  appendAudit(a: AuditRecord): Promise<void> {
    return this.invoke('appendAudit', a).then(() => undefined);
  }

  queryAudit(filter: { request_id?: string; action?: AuditAction; since?: number }): Promise<AuditRecord[]> {
    return this.invoke<AuditRecord[]>('queryAudit', filter);
  }
}

/** /api/kernel/info 的回执（readonly / db_path 供页面如实展示数据面状态） */
export interface KernelInfo {
  available: boolean;
  readonly: boolean;
  db_path: string | null;
}

export async function fetchKernelInfo(baseUrl: string, fetchImpl: typeof fetch = fetch.bind(globalThis), sessionId: string | null = currentSessionId()): Promise<KernelInfo | null> {
  if (!sessionId) return null;
  try {
    const res = await fetchImpl(`${baseUrl}/api/kernel/info`, { headers: { 'x-session-id': sessionId } });
    if (!res.ok) return null;
    const body = (await res.json()) as KernelInfo;
    return body.available === true ? body : null;
  } catch {
    return null;
  }
}
