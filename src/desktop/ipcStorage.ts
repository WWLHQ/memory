// 桌面端存储桥接（Electron 渲染进程侧）：把内核 StorageBackend 接口经 preload 暴露的
// window.api.storage 转发到主进程真正的 SqliteStorage（§5.3 桌面 P0 主源）。
// 本文件只依赖类型，无任何 node 引入，可安全打进浏览器包（浏览器实际不会走到 IpcStorageBackend）。
import type {
  AuditAction,
  AuditRecord,
  Filter,
  Memory,
  StorageBackend,
} from '../core/memagent/types.ts';
import type { HostScanResult } from './hostScan.ts';

/** 主进程经 contextBridge 暴露的存储 IPC 面（与 StorageBackend 同构，6 方法） */
export interface StorageIpc {
  putMemory(m: Memory): Promise<void>;
  getMemory(mem_id: string): Promise<Memory | null>;
  listMemories(filter: Filter): Promise<Memory[]>;
  deleteMemory(mem_id: string): Promise<void>;
  appendAudit(a: AuditRecord): Promise<void>;
  queryAudit(filter: { request_id?: string; action?: AuditAction; since?: number }): Promise<AuditRecord[]>;
  /** 账本位置（真实路径），供渲染层展示「记忆存储在哪」；桌面专属，浏览器无此能力 */
  location?: () => Promise<{ path: string; source: string }>;
  /** 打开单条记忆文件：导出为 .json 并在默认查看器中打开；桌面专属 */
  openMemoryFile?: (memId: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
}

/** 渲染侧 StorageBackend 实现：纯转发，无本地状态 */
export class IpcStorageBackend implements StorageBackend {
  constructor(private readonly ipc: StorageIpc) {}

  putMemory(m: Memory): Promise<void> {
    return this.ipc.putMemory(m);
  }

  getMemory(mem_id: string): Promise<Memory | null> {
    return this.ipc.getMemory(mem_id);
  }

  listMemories(filter: Filter): Promise<Memory[]> {
    return this.ipc.listMemories(filter);
  }

  deleteMemory(mem_id: string): Promise<void> {
    return this.ipc.deleteMemory(mem_id);
  }

  appendAudit(a: AuditRecord): Promise<void> {
    return this.ipc.appendAudit(a);
  }

  queryAudit(filter: { request_id?: string; action?: AuditAction; since?: number }): Promise<AuditRecord[]> {
    return this.ipc.queryAudit(filter);
  }

  /** 批量写入模式：渲染侧转发（主进程 FileStorage 才真正延迟写盘；渲染无本地状态，no-op 兜底）。 */
  beginBatch(): void { /* 渲染侧无本地状态，no-op */ }
  commitBatch(): void { /* no-op */ }
}

/** 渲染进程全局契约（preload 注入），供 storage.ts 注入点判定 */
declare global {
  interface Window {
    /** preload 置 true，标识运行在 Electron 渲染进程 */
    __ELECTRON__?: boolean;
    /** preload 经 contextBridge 暴露的桥接面 */
    api?: {
      storage?: StorageIpc;
      /** 宿主真扫（discover 真实化）：主进程读真实进程表/MCP */
      hostScan?: { run: () => Promise<HostScanResult> };
      /** 租户身份（批次26-B P1-3）：主进程按会话下发三元组 */
      tenant?: { get: (sessionId?: string | null) => Promise<{ ok: boolean; tenant?: { user_id: string; team_id: string; enterprise_id: string }; error?: string }> };
      /** 悬浮覆盖层：检测 Claude 窗口位置 + 移动/启动/关闭悬浮窗 */
      floatAttribution?: {
        detectClaude: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
        setPosition: (x: number, y: number) => void;
        open: () => Promise<{ ok: boolean; error?: string }>;
        close: () => Promise<{ ok: boolean; error?: string }>;
        /** 渲染层日志回写主进程 float.log（离线排查用） */
        log?: (msg: string) => void;
      };
      /** 动作日志桥（批次7）：一行一条写入 <数据根>/actions.log */
      log?: {
        write: (
          scope: string,
          action: string,
          detail?: unknown,
          opts?: { level?: 'info' | 'warn' | 'error'; requestId?: string },
        ) => void;
      };
    };
  }
}
