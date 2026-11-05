// StorageBackend 接口实现（§5.3）：InMemoryStorage 用于测试/演示；
// FileStorage（fileStorage.ts，桌面/CLI 本地库 = P0 主源）/ ServerStorage / SystemStorage 为各端实现（接口同构）。
import type { AuditAction, AuditRecord, CreateProjectInput, Filter, ListProjectsFilter, Memory, ProjectRecord, StorageBackend } from './types.ts';
import { IpcStorageBackend } from '../../desktop/ipcStorage.ts';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';

/** 经宿主桥（原生 preload 或 iframe 消息桥）转发到主进程的存储后端 */
class HostBridgeStorage implements StorageBackend {
  putMemory(m: Memory): Promise<void> { return hostCall<void>('storage:putMemory', [m]); }
  getMemory(mem_id: string): Promise<Memory | null> { return hostCall<Memory | null>('storage:getMemory', [mem_id]); }
  listMemories(filter: Filter): Promise<Memory[]> { return hostCall<Memory[]>('storage:listMemories', [filter]); }
  deleteMemory(mem_id: string): Promise<void> { return hostCall<void>('storage:deleteMemory', [mem_id]); }
  appendAudit(a: AuditRecord): Promise<void> { return hostCall<void>('storage:appendAudit', [a]); }
  queryAudit(filter: { request_id?: string; action?: AuditAction; since?: number }): Promise<AuditRecord[]> {
    return hostCall<AuditRecord[]>('storage:queryAudit', [filter]);
  }
  // ── 批次46-D6：项目注册表（渲染→主进程转发）──
  createProject(input: CreateProjectInput): Promise<ProjectRecord> { return hostCall<ProjectRecord>('storage:createProject', [input]); }
  getProject(project_id: string): Promise<ProjectRecord | null> { return hostCall<ProjectRecord | null>('storage:getProject', [project_id]); }
  listProjects(filter?: ListProjectsFilter): Promise<ProjectRecord[]> { return hostCall<ProjectRecord[]>('storage:listProjects', [filter]); }
}

export class InMemoryStorage implements StorageBackend {
  private mems = new Map<string, Memory>();
  private audits: AuditRecord[] = [];
  private projects = new Map<string, ProjectRecord>();

  /** 批量写入模式：内存后端本就零 IO，no-op（接口对齐，FileStorage 才真正延迟写盘）。 */
  beginBatch(): void { /* no-op */ }
  commitBatch(): void { /* no-op */ }

  // 桌面注入点（§5.3）：Electron 渲染进程下，本构造返回转发到主进程 FileStorage 的桥接后端，
  // 页面 createMemAgent({ storage: new InMemoryStorage() }) 无感知；浏览器/测试仍走原生内存实现。
  // 桥接覆盖两种形态：顶层窗口走原生 preload IPC；概览页 iframe 内走宿主消息桥
  // （Electron preload 只在主 frame 执行，iframe 内无 window.api —— 见 desktop/hostBridge.ts）。
  constructor() {
    if (typeof window !== 'undefined') {
      if (window.__ELECTRON__ === true && window.api?.storage) {
        return new IpcStorageBackend(window.api.storage) as unknown as InMemoryStorage;
      }
      // 仅父窗口确有原生 preload 时才走桥；纯浏览器通览页的 iframe 无桥可依，
      // 直接落进程内内存账本（诚实空态），避免每次读都等 3s 桥超时。
      if (window.parent !== window && hostCapability() === 'bridge') {
        return new HostBridgeStorage() as unknown as InMemoryStorage;
      }
    }
  }

  async putMemory(m: Memory): Promise<void> {
    this.mems.set(m.mem_id, { ...m });
  }

  async getMemory(mem_id: string): Promise<Memory | null> {
    const m = this.mems.get(mem_id);
    return m && !m.deleted ? m : null; // 墓碑对常规读取不可见
  }

  async listMemories(filter: Filter): Promise<Memory[]> {
    return [...this.mems.values()].filter((m) => {
      if (m.deleted && !filter.include_deleted) return false; // 墓碑默认隐藏（D2）
      if (filter.project_id && m.project_id !== filter.project_id) return false;
      if (filter.layer && m.layer !== filter.layer) return false;
      if (filter.decay_class && m.decay_class !== filter.decay_class) return false;
      return true;
    });
  }

  async deleteMemory(mem_id: string): Promise<void> {
    this.mems.delete(mem_id);
  }

  // ── 批次46-D6：项目注册表（内存实现）──
  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const project_id = input.project_id.trim();
    if (!project_id) throw new Error('createProject.project_id 不能为空');
    if (this.projects.has(project_id)) throw new Error(`项目已存在：${project_id}`);
    const rec: ProjectRecord = {
      project_id,
      kind: input.kind ?? 'general',
      owner_user_id: input.owner_user_id,
      display_name: input.display_name,
      created_at: Date.now(),
      created_by: input.created_by,
    };
    this.projects.set(project_id, rec);
    return rec;
  }

  async getProject(project_id: string): Promise<ProjectRecord | null> {
    return this.projects.get(project_id) ?? null;
  }

  async listProjects(filter?: ListProjectsFilter): Promise<ProjectRecord[]> {
    let recs = [...this.projects.values()];
    if (filter?.kind) recs = recs.filter((p) => p.kind === filter.kind);
    if (filter?.owner_user_id) recs = recs.filter((p) => p.owner_user_id === filter.owner_user_id);
    return recs;
  }

  async appendAudit(a: AuditRecord): Promise<void> {
    this.audits.push({ ...a }); // append-only（4.3）
  }

  async queryAudit(filter: { request_id?: string; action?: AuditAction; since?: number }): Promise<AuditRecord[]> {
    return this.audits.filter((a) => {
      if (filter.request_id && a.request_id !== filter.request_id) return false;
      if (filter.action && a.action !== filter.action) return false;
      if (filter.since && a.ts < filter.since) return false;
      return true;
    });
  }

  /** 测试辅助 */
  get size(): number {
    return this.mems.size;
  }

  /** 测试辅助：清空内存账本（记忆 + 审计），用例间隔离 */
  clearForTests(): void {
    this.mems.clear();
    this.audits = [];
  }
}
