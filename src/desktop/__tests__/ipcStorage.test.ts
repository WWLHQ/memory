// IpcStorageBackend 验收：6 方法纯转发到注入的 StorageIpc，参数/返回值透传无误（§5.3 桌面桥接）。
import { describe, it, expect, vi } from 'vitest';
import { IpcStorageBackend, type StorageIpc } from '../ipcStorage.ts';
import type { AuditRecord, Memory, ProjectRecord } from '../../core/memagent/types.ts';

function fakeIpc(): StorageIpc {
  const mem: Memory = { mem_id: 'm1', project_id: 'P1' } as Memory;
  const audit: AuditRecord = { request_id: 'r1', action: 'write', ts: 1, detail: {} } as AuditRecord;
  const project: ProjectRecord = { project_id: 'P1', kind: 'general', created_at: 1, created_by: 'u' };
  return {
    putMemory: vi.fn(async () => {}),
    getMemory: vi.fn(async () => mem),
    listMemories: vi.fn(async () => [mem]),
    deleteMemory: vi.fn(async () => {}),
    appendAudit: vi.fn(async () => {}),
    queryAudit: vi.fn(async () => [audit]),
    // ── 批次46-D6：项目注册表转发 ──
    createProject: vi.fn(async () => project),
    getProject: vi.fn(async () => null),
    listProjects: vi.fn(async () => [project]),
  };
}

describe('IpcStorageBackend 转发', () => {
  it('putMemory 透传 Memory', async () => {
    const ipc = fakeIpc();
    const b = new IpcStorageBackend(ipc);
    const m = { mem_id: 'x' } as Memory;
    await b.putMemory(m);
    expect(ipc.putMemory).toHaveBeenCalledWith(m);
  });

  it('getMemory 透传 id 并回传结果', async () => {
    const ipc = fakeIpc();
    const b = new IpcStorageBackend(ipc);
    const r = await b.getMemory('m1');
    expect(ipc.getMemory).toHaveBeenCalledWith('m1');
    expect(r?.mem_id).toBe('m1');
  });

  it('listMemories / deleteMemory / appendAudit / queryAudit 均透传', async () => {
    const ipc = fakeIpc();
    const b = new IpcStorageBackend(ipc);
    const f = { project_id: 'P1' };
    await b.listMemories(f);
    expect(ipc.listMemories).toHaveBeenCalledWith(f);
    await b.deleteMemory('m1');
    expect(ipc.deleteMemory).toHaveBeenCalledWith('m1');
    const a = { request_id: 'r1', action: 'write', ts: 1, detail: {} } as AuditRecord;
    await b.appendAudit(a);
    expect(ipc.appendAudit).toHaveBeenCalledWith(a);
    const q = { action: 'write' as const };
    await b.queryAudit(q);
    expect(ipc.queryAudit).toHaveBeenCalledWith(q);
  });

  it('批次46-D6：createProject / getProject / listProjects 均透传', async () => {
    const ipc = fakeIpc();
    const b = new IpcStorageBackend(ipc);
    const input = { project_id: 'P-new', created_by: 'u-admin' } as const;
    const created = await b.createProject(input);
    expect(ipc.createProject).toHaveBeenCalledWith(input);
    expect(created.project_id).toBe('P-new');
    await b.getProject('P-x');
    expect(ipc.getProject).toHaveBeenCalledWith('P-x');
    const filter = { kind: 'shared' as const };
    await b.listProjects(filter);
    expect(ipc.listProjects).toHaveBeenCalledWith(filter);
  });
});
