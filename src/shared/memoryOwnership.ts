// 批次48 A7：putMemory 归属校验（浏览器 HTTP 数据面 + Electron IPC 数据面共用同一判据）。
// 缺口：此前 putMemory 只要求「已登录」，任意成员可提交一条 enterprise_id/team_id/user_id 任意的
// Memory —— 新建可冒名，覆盖可改他人/他租户已有行（含删除墓碑，借覆盖复活）。
//
// 判据（非管理员）：
//   1) 写入行的 enterprise_id/team_id 必须等于会话租户；
//   2) 写入行的 user_id（若给出）必须等于会话用户；P_SYSTEM 共享配置行的保留用户 system 除外
//      （coreParams/coreSecurity 既有约定，不属跨租户）；
//   3) 覆盖已存在行（含墓碑）时，被覆盖行也必须属于本会话租户/用户 —— 防止「租户内 mem_id 撞名」
//      改写别人的行，或把别人的墓碑改成自己的活记忆。
// 管理员（home 最高权限）不受归属限制；调用方负责留痕（本模块不写日志，保持纯函数可单测）。
import type { Memory, StorageBackend } from '../core/memagent/types.ts';

/** 会话租户三元组 + 角色（与 TenantContext 兼容，测试可用同形对象） */
export interface SessionTenant {
  enterprise_id: string;
  team_id: string;
  user_id: string;
  role?: string;
}

export type OwnershipVerdict = { ok: true } | { ok: false; reason: string };

/** P_SYSTEM 共享配置行（参数/安全页）的保留用户名，见 src/web/params/coreParams.ts */
const SYSTEM_USER = 'system';
const SYSTEM_PROJECT = 'P_SYSTEM';

function sameTenant(row: Record<string, unknown>, session: SessionTenant): boolean {
  return row.enterprise_id === session.enterprise_id && row.team_id === session.team_id;
}

function isSystemRow(row: Record<string, unknown>): boolean {
  return row.project_id === SYSTEM_PROJECT && row.user_id === SYSTEM_USER;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * 判断一次 putMemory 是否允许（纯函数，不读存储）。
 * existing = 同 mem_id 的已存行（**含删除墓碑**；无则 null）。
 */
export function checkMemoryWriteOwnership(input: {
  incoming: unknown;
  existing: unknown;
  session: SessionTenant;
}): OwnershipVerdict {
  const { incoming, existing, session } = input;
  const m = asRecord(incoming);
  if (!m) return { ok: false, reason: '记忆记录必须是对象' };
  if (typeof m.mem_id !== 'string' || !m.mem_id.trim()) {
    return { ok: false, reason: '记忆记录缺少 mem_id' };
  }
  if (session.role === 'admin') return { ok: true };

  if (!sameTenant(m, session)) {
    return { ok: false, reason: '禁止跨租户写入：记忆的 enterprise_id/team_id 与会话租户不一致' };
  }
  if (typeof m.user_id === 'string' && m.user_id !== session.user_id && !isSystemRow(m)) {
    return { ok: false, reason: `禁止跨用户写入：记忆 user_id（${m.user_id}）与会话用户不一致` };
  }

  const e = asRecord(existing);
  if (e) {
    if (!sameTenant(e, session)) {
      return { ok: false, reason: '禁止跨租户覆盖：同 mem_id 的已有记忆属于其它租户' };
    }
    if (typeof e.user_id === 'string' && e.user_id !== session.user_id && !isSystemRow(e)) {
      return { ok: false, reason: `禁止覆盖他人记忆：同 mem_id 的已有记忆属于用户 ${e.user_id}` };
    }
  }
  return { ok: true };
}

/**
 * 取同 mem_id 的已存行（含删除墓碑；无则 null）。
 * 必须全量扫描而不是按调用方自报的 project_id 过滤 —— 否则伪造 project_id 就能绕过 existing 校验。
 */
export async function findExistingMemoryRow(
  storage: Pick<StorageBackend, 'listMemories'>,
  incoming: unknown,
): Promise<Memory | null> {
  const m = asRecord(incoming);
  const memId = typeof m?.mem_id === 'string' ? m.mem_id : '';
  if (!memId) return null;
  const rows = await storage.listMemories({ include_deleted: true });
  return rows.find((r) => r.mem_id === memId) ?? null;
}
