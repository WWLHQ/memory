// 渲染层同步中枢代理（批次42-B）：把内核 AnySyncHub 接口转发到主进程 PgSyncHub。
// 桌面壳内经 IPC；纯浏览器或宿主桥不可用 → kernel 不注入 hub，sync() 如实报 E_NOT_IMPLEMENTED。
// 方法签名与 PgSyncHub 结构同构（引擎 syncUp/syncDown/reconcile 双兼容），IB 语义在中枢侧（§2）。
import type { ErrorCode, Form, Memory } from '../../core/memagent/types.ts';
import type { PushOutcome, SyncAudit, SyncConflict } from '../../core/memagent/sync.ts';
import { MemAgentError } from '../../core/memagent/errors.ts';
import { hostCall } from '../../desktop/hostBridge.ts';

type IpcOk<T> = { ok: true } & T;
type IpcFail = { ok: false; code?: string; error: string };
type IpcResult<T> = IpcOk<T> | IpcFail;

function unwrap<T extends object>(res: IpcResult<T> | undefined, fallback: ErrorCode): T {
  if (!res || res.ok !== true) {
    throw new MemAgentError((res?.code as ErrorCode) ?? fallback, res?.error ?? '同步中枢通道不可用（宿主桥未就绪）');
  }
  return res;
}

/** 上行结果与引擎 PushOutcome 同构（pgSyncHub 的私有 PushResult 同名值集） */
type HostPushResult = PushOutcome;

/**
 * 中枢端口（桌面壳）：全部转发主进程 PgSyncHub（dataDir = 数据根 sync-hub/）。
 * 权限在中枢侧强制：上行/下行/对账/审计需会话（sessionId 由主进程 handler 校验），
 * 人工裁决 resolve 需管理员（主进程 requireAdmin）。
 */
export class HostSyncHub {
  async push(mem: Memory, form: Form): Promise<HostPushResult> {
    const res = await hostCall<IpcResult<{ result: HostPushResult }>>('sync:push', [mem, form]);
    return unwrap(res, 'E_NOT_IMPLEMENTED').result;
  }

  async pull(scope: { team_id: string; user_id?: string }, since: number, form: Form = 'desktop'): Promise<{ items: Memory[]; cursor: number }> {
    const res = unwrap(await hostCall<IpcResult<{ items: Memory[]; cursor: number }>>('sync:pull', [scope, since, form]), 'E_NOT_IMPLEMENTED');
    return { items: res.items, cursor: res.cursor }; // 剔除 IPC 信封字段，返回形状与 PgSyncHub 严格一致
  }

  async reconcile(scope: { team_id: string }): Promise<{ items: Memory[]; losers: Memory[]; missing_local: string[] }> {
    const res = unwrap(await hostCall<IpcResult<{ items: Memory[]; losers: Memory[]; missing_local: string[] }>>('sync:reconcile', [scope]), 'E_NOT_IMPLEMENTED');
    return { items: res.items, losers: res.losers, missing_local: res.missing_local };
  }

  async listConflicts(team_id?: string): Promise<SyncConflict[]> {
    const res = await hostCall<IpcResult<{ conflicts: SyncConflict[] }>>('sync:conflicts', [team_id]);
    return unwrap(res, 'E_NOT_IMPLEMENTED').conflicts;
  }

  async resolve(conflict_id: string, winner: 'local' | 'remote'): Promise<void> {
    const res = await hostCall<IpcResult<Record<string, never>>>('sync:resolve', [conflict_id, winner]);
    unwrap(res, 'E_NOT_IMPLEMENTED');
  }

  async getCursor(): Promise<number> {
    const res = await hostCall<IpcResult<{ cursor: number }>>('sync:cursor', []);
    return unwrap(res, 'E_NOT_IMPLEMENTED').cursor;
  }

  async auditCount(): Promise<number> {
    const res = await hostCall<IpcResult<{ count: number }>>('sync:auditCount', []);
    return unwrap(res, 'E_NOT_IMPLEMENTED').count;
  }

  async auditsFrom(start: number, team_id?: string): Promise<SyncAudit[]> {
    const res = await hostCall<IpcResult<{ audits: SyncAudit[] }>>('sync:auditsFrom', [start, team_id]);
    return unwrap(res, 'E_NOT_IMPLEMENTED').audits;
  }
}
