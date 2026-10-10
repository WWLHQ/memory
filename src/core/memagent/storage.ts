// StorageBackend 接口实现（§5.3）：InMemoryStorage 用于测试/演示；
// SqliteStorage（sqliteStorage.ts，桌面/CLI 本地库 = P0 主源）/ ServerStorage / SystemStorage 为各端实现（接口同构）。
import type { AuditAction, AuditRecord, Filter, Memory, StorageBackend } from './types.ts';

export class InMemoryStorage implements StorageBackend {
  private mems = new Map<string, Memory>();
  private audits: AuditRecord[] = [];

  async putMemory(m: Memory): Promise<void> {
    this.mems.set(m.mem_id, { ...m });
  }

  async getMemory(mem_id: string): Promise<Memory | null> {
    return this.mems.get(mem_id) ?? null;
  }

  async listMemories(filter: Filter): Promise<Memory[]> {
    return [...this.mems.values()].filter((m) => {
      if (filter.project_id && m.project_id !== filter.project_id) return false;
      if (filter.layer && m.layer !== filter.layer) return false;
      if (filter.decay_class && m.decay_class !== filter.decay_class) return false;
      return true;
    });
  }

  async deleteMemory(mem_id: string): Promise<void> {
    this.mems.delete(mem_id);
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
}
