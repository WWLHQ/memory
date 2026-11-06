// 批次47 P0-3：存储数据面四条「读写/审计」通道统一走登录会话闸门。
// 此前 putMemory/getMemory/listMemories/queryAudit 匿名可调，渲染层（或任何能发 IPC 的注入代码）
// 可以绕过 home server 直接读全量账本、写覆盖任意记忆。
//
// 这里抽成纯工厂而不是写在 main.ts 里：main 依赖 electron 运行时、无法进单测，
// 抽出来后可用真实 StorageBackend + 真实拒绝语义跑通「无会话被拒 / 有会话可用」的端到端路径。
//
// 批次48 A7：putMemory 追加归属校验（与 home server HTTP 数据面同一判据）。
import { IPC } from './ipcChannels.ts';
import type { StorageBackend } from '../core/memagent/types.ts';
import { checkMemoryWriteOwnership, findExistingMemoryRow, type SessionTenant } from '../shared/memoryOwnership.ts';

export interface StorageIpcDeps {
  storage: Pick<StorageBackend, 'putMemory' | 'getMemory' | 'listMemories' | 'queryAudit'>;
  /**
   * 会话闸门：缺会话/过期必须 throw（调用方按 StorageBackend 约定把 reject 当失败，
   * 页面才能如实显示「需要登录」，而不是把错误对象当成功）。
   */
  requireSession: (sessionId: unknown, channel: string) => void;
  /**
   * 会话真源（同一份 home server 会话）：putMemory 归属校验要按真实租户/角色判定，
   * 不接受渲染层自报身份。缺会话返回 null（此时 requireSession 已先行拒绝）。
   */
  getSessionContext: (sessionId: unknown) => SessionTenant | null;
}

export interface StorageReadWriteHandlers {
  putMemory: (m: unknown, sessionId?: unknown) => ReturnType<StorageBackend['putMemory']>;
  getMemory: (id: unknown, sessionId?: unknown) => ReturnType<StorageBackend['getMemory']>;
  listMemories: (f: unknown, sessionId?: unknown) => ReturnType<StorageBackend['listMemories']>;
  queryAudit: (f: unknown, sessionId?: unknown) => ReturnType<StorageBackend['queryAudit']>;
}

export function createStorageReadWriteHandlers(deps: StorageIpcDeps): StorageReadWriteHandlers {
  const { storage } = deps;
  return {
    // async 包裹：会话校验失败必须变成 Promise reject（而非同步 throw），
    // 否则调用方 await 拿不到错误，页面会把「未登录」当崩溃或直接漏掉。
    putMemory: async (m, sessionId) => {
      deps.requireSession(sessionId, IPC.storagePutMemory);
      const session = deps.getSessionContext(sessionId);
      if (!session) throw new Error('需要登录后操作（会话已过期或未登录）');
      const existing = await findExistingMemoryRow(storage, m);
      const verdict = checkMemoryWriteOwnership({ incoming: m, existing, session });
      if (!verdict.ok) throw new Error(verdict.reason);
      return storage.putMemory(m as Parameters<StorageBackend['putMemory']>[0]);
    },
    getMemory: async (id, sessionId) => {
      deps.requireSession(sessionId, IPC.storageGetMemory);
      return storage.getMemory(id as Parameters<StorageBackend['getMemory']>[0]);
    },
    listMemories: async (f, sessionId) => {
      deps.requireSession(sessionId, IPC.storageListMemories);
      return storage.listMemories(f as Parameters<StorageBackend['listMemories']>[0]);
    },
    queryAudit: async (f, sessionId) => {
      deps.requireSession(sessionId, IPC.storageQueryAudit);
      return storage.queryAudit(f as Parameters<StorageBackend['queryAudit']>[0]);
    },
  };
}
