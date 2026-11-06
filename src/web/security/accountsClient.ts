// 账号管理 API client（批次7）：走 home server 的管理员接口，权限由后端强制。
// 前端只负责如实展示结果；未登录/非管理员一律返回明确错误，绝不本地伪造成功。
import { homeBaseUrl } from '../backend.ts';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';
import type { AccountRole, TenantContext } from '../../types/home.ts';
import type { PwdPolicy } from '../../shared/passwordPolicy.ts';

export interface AccountView {
  account: string;
  role: AccountRole;
  team_id: string;
  enterprise_id: string;
  perspective: 'personal' | 'team' | 'enterprise';
  createdAt?: string;
}

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string };

function sessionHeaders(): Record<string, string> | null {
  const sid = getStoredSessionId();
  if (!sid) return null;
  return { 'Content-Type': 'application/json', 'x-session-id': sid };
}

function failReason(res: Response, body: { error?: string }): string {
  if (res.status === 401) return '会话已过期，请重新登录';
  if (res.status === 403) return '需要管理员权限';
  return body.error ?? `请求失败（${res.status}）`;
}

/** 当前登录上下文（含 role）；未登录/后端不可达 → null */
export async function fetchMyContext(): Promise<TenantContext | null> {
  const headers = sessionHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${homeBaseUrl()}/api/me`, { headers });
    if (!res.ok) return null;
    const body = (await res.json()) as { context?: TenantContext };
    return body.context ?? null;
  } catch {
    return null;
  }
}

/** 账号列表（仅管理员） */
export async function fetchAccounts(): Promise<ApiResult<{ items: AccountView[] }>> {
  const headers = sessionHeaders();
  if (!headers) return { ok: false, error: '未登录' };
  try {
    const res = await fetch(`${homeBaseUrl()}/api/accounts`, { headers });
    const body = (await res.json().catch(() => ({}))) as { items?: AccountView[]; error?: string };
    if (!res.ok) return { ok: false, error: failReason(res, body) };
    return { ok: true, items: body.items ?? [] };
  } catch {
    return { ok: false, error: '登录后端不可达' };
  }
}

/** 改角色/团队（仅管理员） */
export async function updateAccount(patch: {
  account: string;
  role?: AccountRole;
  team_id?: string;
}): Promise<ApiResult<{ items: AccountView[] }>> {
  const headers = sessionHeaders();
  if (!headers) return { ok: false, error: '未登录' };
  try {
    const res = await fetch(`${homeBaseUrl()}/api/accounts/update`, {
      method: 'POST',
      headers,
      body: JSON.stringify(patch),
    });
    const body = (await res.json().catch(() => ({}))) as { items?: AccountView[]; error?: string };
    if (!res.ok) return { ok: false, error: failReason(res, body) };
    return { ok: true, items: body.items ?? [] };
  } catch {
    return { ok: false, error: '登录后端不可达' };
  }
}

/** 内核成员库的 API 密钥元数据（服务端 /api/keys 的真实返回，不含 secret_hash） */
export interface ApiKeyRecord {
  key_id: string;
  owner_member_id: string;
  scope_project_ids: string[];
  label?: string;
  /** 服务端 ApiKeyRecord.created_at 为毫秒时间戳（不是 ISO 字符串）；展示前由页面转换 */
  created_at: number;
  created_by?: string;
  /** 毫秒时间戳；存在即已吊销 */
  revoked_at?: number;
  revoked_by?: string;
}

/** 密钥列表（仅管理员；内核成员库未装配时服务端如实 501） */
export async function fetchApiKeys(): Promise<ApiResult<{ items: ApiKeyRecord[] }>> {
  const headers = sessionHeaders();
  if (!headers) return { ok: false, error: '未登录' };
  try {
    const res = await fetch(`${homeBaseUrl()}/api/keys`, { headers });
    const body = (await res.json().catch(() => ({}))) as { items?: ApiKeyRecord[]; error?: string; reason?: string };
    if (!res.ok) {
      if (res.status === 501) return { ok: false, error: '内核成员库未装配（memberStore），密钥域不可用' };
      return { ok: false, error: failReason(res, body) };
    }
    return { ok: true, items: body.items ?? [] };
  } catch {
    return { ok: false, error: '登录后端不可达' };
  }
}

/** 新建密钥（仅管理员）：明文只在本次响应返回一次，绝不缓存 */
export async function mintApiKey(input: {
  owner_member_id: string;
  scope_project_ids: string[];
  label?: string;
}): Promise<ApiResult<{ key: string; record: ApiKeyRecord }>> {
  const headers = sessionHeaders();
  if (!headers) return { ok: false, error: '未登录' };
  try {
    const res = await fetch(`${homeBaseUrl()}/api/keys/mint`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as {
      key?: string; record?: ApiKeyRecord; error?: string; reason?: string;
    };
    if (!res.ok) {
      if (res.status === 501) return { ok: false, error: '内核成员库未装配（memberStore），密钥域不可用' };
      return { ok: false, error: failReason(res, body) };
    }
    if (!body.key || !body.record) return { ok: false, error: '服务端返回缺少密钥或记录' };
    return { ok: true, key: body.key, record: body.record };
  } catch {
    return { ok: false, error: '登录后端不可达' };
  }
}

/** 吊销密钥（仅管理员） */
export async function revokeApiKey(keyId: string): Promise<ApiResult<{ record: ApiKeyRecord }>> {
  const headers = sessionHeaders();
  if (!headers) return { ok: false, error: '未登录' };
  try {
    const res = await fetch(`${homeBaseUrl()}/api/keys/revoke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ key_id: keyId }),
    });
    const body = (await res.json().catch(() => ({}))) as { record?: ApiKeyRecord; error?: string; reason?: string };
    if (!res.ok) {
      if (res.status === 501) return { ok: false, error: '内核成员库未装配（memberStore），密钥域不可用' };
      return { ok: false, error: failReason(res, body) };
    }
    if (!body.record) return { ok: false, error: '服务端返回缺少记录' };
    return { ok: true, record: body.record };
  } catch {
    return { ok: false, error: '登录后端不可达' };
  }
}

/** 读取已持久化的密码策略（任意登录会话；后端 home-policy.json） */
export async function fetchPwdPolicy(): Promise<ApiResult<{ policy: PwdPolicy }>> {
  const headers = sessionHeaders();
  if (!headers) return { ok: false, error: '未登录' };
  try {
    const res = await fetch(`${homeBaseUrl()}/api/policy`, { headers });
    const body = (await res.json().catch(() => ({}))) as { policy?: PwdPolicy; error?: string };
    if (!res.ok) return { ok: false, error: failReason(res, body) };
    if (!body.policy) return { ok: false, error: '服务端返回缺少策略' };
    return { ok: true, policy: body.policy };
  } catch {
    return { ok: false, error: '登录后端不可达' };
  }
}

/** 保存密码策略（仅管理员；真实落盘 .data/home-policy.json，服务端会规范化） */
export async function savePwdPolicy(policy: PwdPolicy): Promise<ApiResult<{ policy: PwdPolicy }>> {
  const headers = sessionHeaders();
  if (!headers) return { ok: false, error: '未登录' };
  try {
    const res = await fetch(`${homeBaseUrl()}/api/policy`, {
      method: 'POST',
      headers,
      body: JSON.stringify(policy),
    });
    const body = (await res.json().catch(() => ({}))) as { policy?: PwdPolicy; error?: string };
    if (!res.ok) return { ok: false, error: failReason(res, body) };
    if (!body.policy) return { ok: false, error: '服务端返回缺少策略' };
    return { ok: true, policy: body.policy };
  } catch {
    return { ok: false, error: '登录后端不可达' };
  }
}

/** 修改自己的密码（任意登录账号；旧密码必须匹配） */
export async function changeOwnPassword(oldPassword: string, newPassword: string): Promise<ApiResult<{ message: string }>> {
  const headers = sessionHeaders();
  if (!headers) return { ok: false, error: '未登录' };
  try {
    const res = await fetch(`${homeBaseUrl()}/api/password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    const body = (await res.json().catch(() => ({}))) as { reason?: string; error?: string };
    if (!res.ok) {
      if (res.status === 401) return { ok: false, error: '旧密码错误或会话已过期' };
      if (body.reason === 'weak') return { ok: false, error: body.error ?? '新密码不符合密码策略' };
      if (body.reason === 'same') return { ok: false, error: '新密码不能与旧密码相同' };
      return { ok: false, error: body.error ?? '修改失败' };
    }
    return { ok: true, message: '密码已修改，下次登录请使用新密码' };
  } catch {
    return { ok: false, error: '登录后端不可达' };
  }
}
