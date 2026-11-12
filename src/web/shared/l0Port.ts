// 渲染层 L0 端口（§4.4）：把内核 L0Port / L0AdminPort 调用转发到主进程 L0Vault。
// 纯浏览器或宿主桥不可用 → l0HostAvailable() = false，内核不注入端口并如实报 E_L0_LOCKED / E_NOT_IMPLEMENTED。
// user_id 一律由主进程从 home 会话派生，这里只带当前登录 sessionId。
import type {
  ErrorCode, L0AccessRequest, L0AccessRequestResult, L0AdminPort, L0GrantReq, L0GrantResult,
  L0GrantView, L0HeartbeatResult, L0MigrationReport, L0MigrationResult, L0Port, L0RequestView,
  L0UnlockReq, L0UnlockResult, L0VaultStatus,
} from '../../core/memagent/types.ts';
import { MemAgentError } from '../../core/memagent/errors.ts';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from './session.ts';

type IpcOk<T> = { ok: true } & T;
type IpcFail = { ok: false; code?: string; error: string };
type IpcResult<T> = IpcOk<T> | IpcFail;

interface SessionInfoView {
  grant_id?: string;
  user_id: string;
  scope_project_ids: string[];
  expires_at: number;
}

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

function unwrap<T extends object>(res: IpcResult<T> | undefined, fallback: ErrorCode): T {
  if (!res || res.ok !== true) {
    throw new MemAgentError((res?.code as ErrorCode) ?? fallback, res?.error ?? 'L0 通道不可用（宿主桥未就绪）');
  }
  return res;
}

function unwrapVoid(res: IpcResult<Record<string, never>> | undefined, fallback: ErrorCode): void {
  unwrap(res, fallback);
}

const asError = (e: unknown, fallback: ErrorCode): MemAgentError =>
  e instanceof MemAgentError ? e : new MemAgentError(fallback, errText(e));

/** 宿主是否提供 L0 能力（桌面顶层原生 / iframe 消息桥）；纯浏览器为 false */
export function l0HostAvailable(): boolean {
  return typeof window !== 'undefined' && hostCapability() !== 'none';
}

/** 写入加密端口：不含任何密钥；主进程未解锁写密钥时抛 E_L0_LOCKED */
export class HostL0Port implements L0Port {
  async seal(plain: string): Promise<string> {
    try {
      const res = await hostCall<IpcResult<{ sealed: string }>>('l0:seal', [plain, currentSessionId()]);
      return unwrap(res, 'E_L0_LOCKED').sealed;
    } catch (e) {
      throw asError(e, 'E_L0_LOCKED');
    }
  }

  async decrypt(req: { l0_session_id: string; project_id: string; mem_id: string; envelope: string }): Promise<string> {
    try {
      const res = await hostCall<IpcResult<{ content: string }>>('l0:decrypt', [req, currentSessionId()]);
      return unwrap(res, 'E_AUTH_L0').content;
    } catch (e) {
      throw asError(e, 'E_AUTH_L0');
    }
  }

  async sessionInfo(l0_session_id: string): Promise<SessionInfoView> {
    try {
      const res = await hostCall<IpcResult<{ info: SessionInfoView }>>('l0:sessionInfo', [l0_session_id, currentSessionId()]);
      return unwrap(res, 'E_AUTH_L0').info;
    } catch (e) {
      throw asError(e, 'E_AUTH_L0');
    }
  }
}

/** 授权与会话管理端口：管理动作由主进程 requireAdmin 二次校验（角色不由渲染层自报） */
export class HostL0Admin implements L0AdminPort {
  async requestAccess(req: L0AccessRequest & { user_id: string }): Promise<L0AccessRequestResult> {
    const res = await hostCall<IpcResult<L0AccessRequestResult>>('l0:requestAccess', [req.project_ids, req.reason, currentSessionId()]);
    const r = unwrap(res, 'E_AUTH_L0');
    return { request_id: r.request_id, status: r.status };
  }

  async listRequests(): Promise<L0RequestView[]> {
    const res = await hostCall<IpcResult<{ requests: L0RequestView[] }>>('l0:listRequests', [currentSessionId()]);
    return unwrap(res, 'E_AUTH_L0').requests;
  }

  async listGrants(): Promise<L0GrantView[]> {
    const res = await hostCall<IpcResult<{ grants: L0GrantView[] }>>('l0:listGrants', [currentSessionId()]);
    return unwrap(res, 'E_AUTH_L0').grants;
  }

  async grantAccess(req: L0GrantReq & { admin_user_id: string }): Promise<L0GrantResult> {
    const res = await hostCall<IpcResult<{ grant: L0GrantResult }>>('l0:grant', [{
      request_id: req.request_id,
      grantee_user_id: req.grantee_user_id,
      scope_project_ids: req.scope_project_ids,
      password: req.password,
    }, currentSessionId()]);
    return unwrap(res, 'E_AUTH_L0').grant;
  }

  async denyRequest(req: { request_id: string; admin_user_id: string; reason?: string }): Promise<void> {
    const res = await hostCall<IpcResult<Record<string, never>>>('l0:deny', [req.request_id, req.reason, currentSessionId()]);
    unwrapVoid(res, 'E_AUTH_L0');
  }

  async revokeGrant(req: { grant_id: string; admin_user_id: string; reason?: string }): Promise<void> {
    const res = await hostCall<IpcResult<Record<string, never>>>('l0:revoke', [req.grant_id, req.reason, currentSessionId()]);
    unwrapVoid(res, 'E_AUTH_L0');
  }

  async unlock(req: L0UnlockReq & { user_id: string }): Promise<L0UnlockResult> {
    const res = await hostCall<IpcResult<L0UnlockResult>>('l0:unlock', [{
      grant_id: req.grant_id,
      password: req.password,
    }, currentSessionId()]);
    const r = unwrap(res, 'E_AUTH_L0');
    return {
      l0_session_id: r.l0_session_id,
      grant_id: r.grant_id,
      expires_at: r.expires_at,
      idle_timeout_ms: r.idle_timeout_ms,
    };
  }

  async heartbeat(l0_session_id: string): Promise<L0HeartbeatResult> {
    const res = await hostCall<IpcResult<L0HeartbeatResult>>('l0:heartbeat', [l0_session_id, currentSessionId()]);
    const r = unwrap(res, 'E_L0_EXPIRED');
    return { expires_at: r.expires_at, idle_timeout_ms: r.idle_timeout_ms };
  }

  async lock(l0_session_id: string): Promise<void> {
    const res = await hostCall<IpcResult<Record<string, never>>>('l0:lock', [l0_session_id, currentSessionId()]);
    unwrapVoid(res, 'E_AUTH_L0');
  }

  async unlockWrite(req: { password: string; admin_user_id: string; member_id?: string }): Promise<void> {
    const res = await hostCall<IpcResult<Record<string, never>>>('l0:writeUnlock', [req.password, req.member_id ?? null, currentSessionId()]);
    unwrapVoid(res, 'E_L0_LOCKED');
  }

  async lockWrite(_req: { admin_user_id: string }): Promise<void> {
    const res = await hostCall<IpcResult<Record<string, never>>>('l0:writeLock', [currentSessionId()]);
    unwrapVoid(res, 'E_AUTH_L0');
  }

  /** §4.4.4-B：管理员为成员发放写解锁口令（主进程再校验管理员；需先解锁写密钥） */
  async addMemberWriteWrap(req: { member_id: string; passphrase: string; admin_user_id: string }): Promise<void> {
    const res = await hostCall<IpcResult<Record<string, never>>>(
      'l0:addMemberWriteWrap', [req.member_id, req.passphrase, currentSessionId()],
    );
    unwrapVoid(res, 'E_L0_LOCKED');
  }

  /** §4.4.4-B：撤销某成员的写解锁口令（主进程再校验管理员） */
  async removeMemberWriteWrap(req: { member_id: string; admin_user_id: string }): Promise<void> {
    const res = await hostCall<IpcResult<Record<string, never>>>(
      'l0:removeMemberWriteWrap', [req.member_id, currentSessionId()],
    );
    unwrapVoid(res, 'E_AUTH_L0');
  }

  /**
   * §4.4.4-B：本账号有没有写解锁口令。
   * member_id 只作签名占位 —— 主进程一律用会话账号，页面无从自报他人（越权面为零）。
   */
  async myWriteWrap(_member_id: string): Promise<{ has_wrap: boolean; write_unlocked: boolean }> {
    const res = await hostCall<IpcResult<{ has_wrap: boolean; write_unlocked?: boolean; member_id?: string }>>(
      'l0:myWriteWrap', [currentSessionId()],
    );
    const r = unwrap(res, 'E_AUTH_L0');
    return { has_wrap: r.has_wrap === true, write_unlocked: r.write_unlocked === true };
  }

  async status(): Promise<L0VaultStatus> {
    const res = await hostCall<IpcResult<L0VaultStatus>>('l0:status', [currentSessionId()]);
    const r = unwrap(res, 'E_AUTH_L0');
    return {
      has_admin_wrap: r.has_admin_wrap,
      write_unlocked: r.write_unlocked,
      active_sessions: r.active_sessions,
      active_grants: r.active_grants,
      member_write_wraps: r.member_write_wraps ?? 0,
      member_wrap_ids: Array.isArray(r.member_wrap_ids) ? r.member_wrap_ids : [],
    };
  }

  /** 管理密码设置/轮换与迁移只由安全页调用（主进程再校验管理员） */
  async setupAdminPassword(password: string): Promise<void> {
    const res = await hostCall<IpcResult<Record<string, never>>>('l0:setup', [password, currentSessionId()]);
    unwrapVoid(res, 'E_AUTH_L0');
  }

  async changeAdminPassword(oldPassword: string, newPassword: string): Promise<void> {
    const res = await hostCall<IpcResult<Record<string, never>>>('l0:changePassword', [oldPassword, newPassword, currentSessionId()]);
    unwrapVoid(res, 'E_AUTH_L0');
  }

  async migrate(req: { admin_user_id: string; oldPassword?: string }): Promise<L0MigrationResult> {
    const res = await hostCall<IpcResult<{ report: L0MigrationReport; backup_dir?: string }>>(
      'l0:migrate', [{ oldPassword: req.oldPassword }, currentSessionId()],
    );
    const r = unwrap(res, 'E_L0_LOCKED');
    return { report: r.report, backup_dir: r.backup_dir };
  }
}
