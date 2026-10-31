// 账号与安全页（REQ-006 / P12）接真内核：安全操作真写 storage 审计账本
// （action='security_change'）；成员/密钥实体内核暂无域模型，页面以空列表为真实初始态。
// L0 管理（§4.4）：管理密码/写密钥/申请审批/一次性授权/撤销/迁移全部委托内核 L0AdminPort。
import type {
  L0GrantReq, L0GrantResult, L0GrantView, L0MigrationResult, L0RequestView, L0VaultStatus, MemAgent,
} from '../../core/memagent/types.ts';
import type { InMemoryStorage } from '../../core/memagent/storage.ts';
import { getKernel, getKernelStorage } from '../kernel.ts';

interface SecurityCtx {
  ma: MemAgent;
  storage: InMemoryStorage;
}

function getCtx(): SecurityCtx {
  return { ma: getKernel(), storage: getKernelStorage() };
}

/** 安全操作真写内核审计账本（策略变更/成员调整/密钥吊销），返回回执 */
export async function coreSecurityAudit(
  action: string, requestId: string, detail: Record<string, unknown> = {},
): Promise<{ request_id: string; total: number }> {
  const { storage } = await getCtx();
  await storage.appendAudit({
    request_id: requestId, action: 'security_change', form: 'web',
    project_id: 'P_SYSTEM', user_id: 'system', ts: Date.now(), detail: { op: action, ...detail },
  });
  const total = (await storage.queryAudit({ action: 'security_change' })).length;
  return { request_id: requestId, total };
}

/** 审计回放（验证/展示用） */
export async function coreLoadSecurityAudit(): Promise<{ request_id: string; op: string; ts: number }[]> {
  const { storage } = await getCtx();
  return (await storage.queryAudit({ action: 'security_change' })).map((a) => ({
    request_id: a.request_id, op: String((a.detail as { op?: string }).op ?? ''), ts: a.ts,
  }));
}

// ─── L0 密钥环管理（§4.4；主进程 IPC 再做管理员校验，页面只做只读展示与禁用） ───

export async function coreL0Status(): Promise<L0VaultStatus> {
  return getKernel().l0Status();
}

export async function coreL0SetupAdminPassword(password: string): Promise<void> {
  await getKernel().l0SetupAdminPassword(password);
}

export async function coreL0ChangeAdminPassword(oldPassword: string, newPassword: string): Promise<void> {
  await getKernel().l0ChangeAdminPassword(oldPassword, newPassword);
}

export async function coreL0ListRequests(): Promise<L0RequestView[]> {
  return getKernel().l0ListRequests();
}

export async function coreL0ListGrants(): Promise<L0GrantView[]> {
  return getKernel().l0ListGrants();
}

export async function coreL0Grant(req: L0GrantReq): Promise<L0GrantResult> {
  return getKernel().l0GrantAccess(req);
}

export async function coreL0Deny(requestId: string, reason?: string): Promise<void> {
  await getKernel().l0DenyRequest(requestId, reason);
}

export async function coreL0Revoke(grantId: string, reason?: string): Promise<void> {
  await getKernel().l0RevokeGrant(grantId, reason);
}

export async function coreL0UnlockWrite(password: string): Promise<void> {
  await getKernel().l0UnlockWrite(password);
}

export async function coreL0LockWrite(): Promise<void> {
  await getKernel().l0LockWrite();
}

export async function coreL0Migrate(oldPassword?: string): Promise<L0MigrationResult> {
  return getKernel().l0Migrate(oldPassword);
}
