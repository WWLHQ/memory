// 个人记忆数据面端口（第一轮本机闭环）：桌面壳 → 主进程 IPC；纯浏览器 → 登录后端 HTTP。
//
// 与 StorageBackend 数据面同构，但独立通道（personal:invoke / /api/personal/invoke）：
// - owner 一律由主进程/后端按会话解析，页面不得自报归属；
// - 无桌面壳且未登录时如实报「没有可用数据面」，绝不在页面里伪造一份本地账本；
// - 返回快照/回执均为内核 personal.ts 的真实结构（PersonalSnapshot / PersonalReceipt）。
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { homeBaseUrl } from '../backend.ts';
import { currentSessionId } from './session.ts';
import type { PersonalImportInput, PersonalReceipt, PersonalSnapshot, PersonalSyncReceipt } from '../../core/memagent/personal.ts';

export type PersonalOpName =
  | 'list' | 'quick_add' | 'confirm' | 'reject' | 'revoke' | 'delete'
  // 从 agent 记忆归入个人（读取会话拉取 / agent 主动投递 / 手动拉取兜底）
  | 'import_from_agent'
  // 把 agent 记忆判定为「不是我的 / 进共享」：落 rejected 个人条目，共享账本记忆原样保留
  | 'reject_from_agent'
  // 第二轮：显式授权团队上行 / 失败重试（真实 PgSyncHub 通道）
  | 'push_team' | 'retry_sync';

export interface PersonalPort {
  /** 实际走哪条数据面（页面可如实展示「桌面壳 / 登录后端」） */
  readonly channel: 'host' | 'http';
  invoke<T>(op: PersonalOpName, payload?: Record<string, unknown>): Promise<T>;
}

interface Envelope<T> { ok?: boolean; data?: T; result?: T; error?: string; code?: string; reason?: string }

function unwrap<T>(body: Envelope<T> | null, status: number): T {
  if (!body) throw new Error(`个人记忆数据面响应异常（HTTP ${status}）`);
  if (body.ok === true) return (body.data ?? body.result) as T;
  // 错误码随消息一起回传（权限/状态/中枢失败都要如实说明，不能只说「失败」）
  const msg = body.error ?? `个人记忆数据面调用失败（${body.reason ?? `HTTP ${status}`}）`;
  throw new Error(body.code ? `${msg}（${body.code}）` : msg);
}

export function createHostPersonalPort(): PersonalPort {
  return {
    channel: 'host',
    invoke: async <T>(op: PersonalOpName, payload: Record<string, unknown> = {}) => {
      const body = await hostCall<Envelope<T>>('personal:invoke', [op, payload, currentSessionId()]);
      return unwrap<T>(body, 200);
    },
  };
}

export function createHttpPersonalPort(baseUrl = homeBaseUrl()): PersonalPort {
  return {
    channel: 'http',
    invoke: async <T>(op: PersonalOpName, payload: Record<string, unknown> = {}) => {
      const sid = currentSessionId();
      if (!sid) throw new Error('尚未登录：个人记忆需要登录会话（登录后自动可写）');
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/api/personal/invoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
          body: JSON.stringify({ op, payload }),
        });
      } catch (e) {
        throw new Error(`登录后端不可达（${(e as Error)?.message ?? e}）`);
      }
      if (res.status === 401) throw new Error('登录会话已失效：请重新登录后再操作个人记忆');
      if (res.status === 501) throw new Error('该后端未挂载个人记忆独立存储（personal_unavailable）');
      const body = (await res.json().catch(() => null)) as Envelope<T> | null;
      return unwrap<T>(body, res.status);
    },
  };
}

/** 按当前运行环境选唯一数据面；都没有 → 抛错（诚实不可用，不降级成假数据） */
export function getPersonalPort(): PersonalPort {
  if (hostCapability() !== 'none') return createHostPersonalPort();
  if (currentSessionId()) return createHttpPersonalPort();
  const unavailable: PersonalPort = {
    channel: 'http',
    invoke: async () => {
      throw new Error('个人记忆需要桌面壳或登录会话；本端没有可用数据面（未在本机伪造账本）');
    },
  };
  return unavailable;
}

/** 页面首次加载：读真实快照 */
export function loadPersonalSnapshot(port: PersonalPort = getPersonalPort()): Promise<PersonalSnapshot> {
  return port.invoke<PersonalSnapshot>('list');
}

/** 快速记一条 */
export function quickAddPersonal(content: string, port: PersonalPort = getPersonalPort()): Promise<PersonalReceipt> {
  return port.invoke<PersonalReceipt>('quick_add', { content });
}

/** 收件箱条目判定「是我的」：pending → confirmed（进入私人池、参与召回） */
export function confirmPersonal(id: string, port: PersonalPort = getPersonalPort()): Promise<PersonalReceipt> {
  return port.invoke<PersonalReceipt>('confirm', { id });
}

/** 收件箱条目判定「不是我的」：pending → rejected（移出私人池，只写个人侧状态，不删账本） */
export function rejectPersonal(id: string, port: PersonalPort = getPersonalPort()): Promise<PersonalReceipt> {
  return port.invoke<PersonalReceipt>('reject', { id });
}

/** 撤销判定：confirmed / rejected → pending（回到待判定重新分派） */
export function revokePersonal(id: string, port: PersonalPort = getPersonalPort()): Promise<PersonalReceipt> {
  return port.invoke<PersonalReceipt>('revoke', { id });
}

/** 删除个人条目（二次确认由调用方保证；只写墓碑，账本记录保留） */
export function removePersonal(id: string, port: PersonalPort = getPersonalPort()): Promise<PersonalReceipt> {
  return port.invoke<PersonalReceipt>('delete', { id, confirm: true });
}

/** 从 agent 记忆归入个人（source=agent / source_agent / origin_ref_id；delivered_at 取原始创建时间） */
export function importPersonalFromAgent(
  input: PersonalImportInput,
  port: PersonalPort = getPersonalPort(),
): Promise<PersonalReceipt> {
  return port.invoke<PersonalReceipt>('import_from_agent', {
    content: input.content,
    source_agent: input.sourceAgent,
    source_ref_id: input.sourceRefId,
    origin_ts: input.originTs,
  });
}

/** 把 agent 记忆判定为「不是我的 / 进共享」：记录 rejected 个人条目（origin_ref_id），共享账本记忆不动 */
export function rejectPersonalFromAgent(
  input: PersonalImportInput,
  port: PersonalPort = getPersonalPort(),
): Promise<PersonalReceipt> {
  return port.invoke<PersonalReceipt>('reject_from_agent', {
    content: input.content,
    source_agent: input.sourceAgent,
    source_ref_id: input.sourceRefId,
    origin_ts: input.originTs,
  });
}

/** 显式授权上行到团队中枢（explicit=true 是页面上二次确认后的真实授权，不能缺省） */
export function pushPersonalToTeam(
  id: string,
  port: PersonalPort = getPersonalPort(),
): Promise<PersonalSyncReceipt> {
  return port.invoke<PersonalSyncReceipt>('push_team', { id, explicit: true });
}

/** 重试上行（仅已授权且待上行/失败条目） */
export function retryPersonalSync(id: string, port: PersonalPort = getPersonalPort()): Promise<PersonalSyncReceipt> {
  return port.invoke<PersonalSyncReceipt>('retry_sync', { id });
}
