// MCP 鉴权：MCP 端口只对持有本机令牌的 Agent 开放。
// 背景：8202/8204 原先无任何鉴权，本机任意进程都能读写整个记忆库；现要求令牌（Bearer / x-mcp-token / TCP params.token）。
import { timingSafeEqual } from 'node:crypto';

export const MCP_TOKEN_HEADER = 'x-mcp-token';

/** MCP 会话租户：工具调用不得越过该身份（客户端传入的 user_id 必须一致） */
export interface McpAccount {
  user_id: string;
  team_id: string;
  enterprise_id: string;
  /** 批次26-B P1-10：令牌项目作用域。'*' = 全账本（本机单用户默认）；否则只能命中显式列出的项目 */
  scope_project_ids: string[];
}

export const DEFAULT_MCP_ACCOUNT: McpAccount = Object.freeze({
  user_id: 'u1',
  team_id: 't1',
  enterprise_id: 'e1',
  scope_project_ids: ['*'],
});

/** 三池分类（D6-2）：按 project_id 命名约定判定所属池，无需查注册表即可门禁。
 *  - shared：P-shared（全体可见，恒放行）
 *  - archive：P-archive（仅 admin 可见）
 *  - user：P-<user>（每用户私有，仅 owner 或 admin 可见；owner = 去掉 'P-' 前缀）
 *  - general：其余（按令牌 scope_project_ids 列表判定） */
export type ProjectPool = 'shared' | 'user' | 'archive' | 'general';

export function classifyProject(projectId: string): ProjectPool {
  if (projectId === 'P-shared') return 'shared';
  if (projectId === 'P-archive') return 'archive';
  // P-<user>：以 'P-' 开头且后面还有内容（排除裸 'P-'）
  if (projectId.startsWith('P-') && projectId.length > 2) return 'user';
  return 'general';
}

/** 门禁账户视图：门禁只需 identity + admin 标记 + 令牌项目作用域；McpAccount 结构兼容（is_admin 在 D6-3 才真正置位，此处可选） */
export interface ScopeAccount {
  user_id: string;
  is_admin?: boolean;
  scope_project_ids: string[];
}

/** 项目可见性/作用域校验（D6-2 三池模型）：
 *  shared → 全体恒可见；archive → 仅 admin；user → 仅 owner 或 admin；general → 按 scope 列表（'*' 全放行）。
 *  统一口径下沉到 recall/list/get/write/manage/gc 各门禁点（批次26-B P1-10 的 scope 列表仅作用于 general 池）。 */
export function projectInScope(account: ScopeAccount, projectId: string): boolean {
  const pool = classifyProject(projectId);
  const isAdmin = account.is_admin === true;
  switch (pool) {
    case 'shared':
      return true;
    case 'archive':
      return isAdmin;
    case 'user': {
      const owner = projectId.slice(2);
      return account.user_id === owner || isAdmin;
    }
    case 'general': {
      const list = account.scope_project_ids && account.scope_project_ids.length > 0
        ? account.scope_project_ids : ['*'];
      if (list.includes('*')) return true;
      return list.includes(projectId);
    }
  }
}

/** 常数时间比较；长度不同直接不匹配（不泄露逐字节信息） */
export function tokenEquals(candidate: string | null | undefined, expected: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 从 HTTP 头提取令牌：Authorization: Bearer <t> 优先，其次 x-mcp-token */
export function tokenFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  const auth = headers['authorization'];
  const authVal = Array.isArray(auth) ? auth[0] : auth;
  if (authVal && /^Bearer\s+/i.test(authVal)) return authVal.replace(/^Bearer\s+/i, '').trim() || undefined;
  const raw = headers[MCP_TOKEN_HEADER];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** 启动前校验令牌强度：未配置或过短（<32 字符）拒绝启动，避免空令牌变相无鉴权 */
export function assertMcpToken(token: string | undefined): string {
  if (!token || token.trim().length < 32) {
    throw new Error('MCP token 未配置或过短（至少 32 字符）');
  }
  return token.trim();
}
