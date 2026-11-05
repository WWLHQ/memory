// MCP 管理工具编排（D6-5 / 子方案 §3.3）：create_project / mint_token。
// TCP(8202) 与 HTTP(8204) 共用同一份管理员门禁、参数校验与命名规则，避免两端漂移。
//
// 红线：
// ① 管理员专属：调用前校验 isAdmin(account)，非 admin 一律 -32602 明确拒绝（绝不静默降级）；
// ② 命名规则与 D6-2 三池命名约定对齐——shared 固定 `P-shared`、user 必须 `P-<owner_user_id>`、
//    archive 固定 `P-archive`；general **禁止 `P-` 前缀**（`P-<x>` 会被三池门禁判为 user 池，
//    受管入口若允许即自相矛盾——这是把「注册表 kind」与「命名约定门禁」对齐的必然结论，见 code-map 口径）；
// ③ mint_token 返回一次性明文令牌：只在本结果里出现这一次，库里只存 sha256 哈希；
//    `is_admin=true` 的令牌只能由已持有 admin 的令牌签发（本编排的 admin 门禁天然保证）；
// ④ 未装配令牌库时 mint_token 明确报错（不是静默成功）。
import { isAdmin, type McpAccount } from './mcpAuth.ts';
import { McpToolError } from './mcpRecall.ts';
import type { CreateProjectInput, ProjectKind, ProjectRecord, StorageBackend } from './types.ts';
import type { TokenStorePort } from './tokenStore.ts';

const PROJECT_KINDS: readonly ProjectKind[] = ['shared', 'user', 'archive', 'general'];
/** general 池受管命名：小写字母/数字开头，允许小写字母、数字、连字符、下划线（1–64） */
const GENERAL_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function requiredString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new McpToolError(`${field} 必填且须为非空字符串`);
  return v.trim();
}

function optionalString(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !v.trim()) throw new McpToolError(`${field} 须为非空字符串`);
  return v.trim();
}

export interface CreateProjectToolResult {
  ok: true;
  project: ProjectRecord;
}

/** create_project（管理员专属）：受管创建项目注册表记录 + 三池命名规则校验 + 重名拒绝 */
export async function runCreateProjectTool(
  storage: StorageBackend,
  args: Record<string, unknown>,
  account: McpAccount,
): Promise<CreateProjectToolResult> {
  if (!isAdmin(account)) {
    throw new McpToolError('create_project 仅管理员可用（当前令牌非 admin；D6 管理门禁）');
  }
  const projectId = requiredString(args.project_id, 'create_project.project_id');
  const kind = (args.kind ?? 'general') as ProjectKind;
  if (!PROJECT_KINDS.includes(kind)) {
    throw new McpToolError(`create_project.kind 非法：${String(args.kind)}（允许：${PROJECT_KINDS.join('/')}）`);
  }
  // 命名规则（与 D6-2 三池命名约定对齐；general 禁 P- 前缀见文件头 ②）
  if (kind === 'shared' && projectId !== 'P-shared') {
    throw new McpToolError('create_project：kind=shared 的 project_id 固定为 "P-shared"（三池命名约定）');
  }
  if (kind === 'archive' && projectId !== 'P-archive') {
    throw new McpToolError('create_project：kind=archive 的 project_id 固定为 "P-archive"（三池命名约定）');
  }
  const ownerUserId = kind === 'user'
    ? (optionalString(args.owner_user_id, 'create_project.owner_user_id') ?? account.user_id)
    : optionalString(args.owner_user_id, 'create_project.owner_user_id');
  if (kind === 'user') {
    if (projectId !== `P-${ownerUserId}`) {
      throw new McpToolError(`create_project：kind=user 的 project_id 须为 "P-${ownerUserId}"（owner 私有池命名约定）`);
    }
  } else if (projectId.startsWith('P-')) {
    throw new McpToolError(
      `create_project：project_id 以 "P-" 开头会被三池门禁按用户池判定（owner=${projectId.slice(2)}）；`
      + `kind=${kind} 的受管项目请改用不带 "P-" 前缀的名称（如 "${projectId.slice(2).toLowerCase() || 'my-project'}"）`,
    );
  } else if (kind === 'general' && !GENERAL_SLUG_RE.test(projectId)) {
    throw new McpToolError('create_project：general 项目名须为小写字母/数字开头的 slug（1–64 位，允许小写字母/数字/-/_）');
  }
  // 重名前置拒绝（-32602），不靠底层异常冒泡成 -32000
  const existing = await storage.getProject(projectId);
  if (existing) throw new McpToolError(`项目已存在：${projectId}`);
  const input: CreateProjectInput = {
    project_id: projectId,
    kind,
    ...(ownerUserId !== undefined ? { owner_user_id: ownerUserId } : {}),
    ...(optionalString(args.display_name, 'create_project.display_name') !== undefined
      ? { display_name: optionalString(args.display_name, 'create_project.display_name') } : {}),
    created_by: account.user_id,
  };
  const rec = await storage.createProject(input);
  return { ok: true, project: rec };
}

export interface MintTokenToolResult {
  ok: true;
  /** 一次性明文令牌（mtk_ + 64 hex）：只在本次结果出现，库里只存 sha256 哈希 */
  token: string;
  minted: {
    user_id: string;
    scope_project_ids: string[];
    is_admin: boolean;
    label?: string;
    expires_at?: number;
    created_at: number;
  };
  note: string;
}

const MINT_NOTE =
  '令牌明文只在本次结果出现一次，服务端不保存明文（库里仅存 sha256 哈希）；'
  + '请立即把它安全转交对应客户端（写入其本机配置），此后无法再次查看。'
  + 'scope_project_ids 决定该令牌可见的 general 项目；三池可见性（P-shared 恒可见 / P-<user> 仅 owner / P-archive 仅 admin）按 D6-2 规则在其上生效。';

/** mint_token（管理员专属）：签发受限令牌并一次性回显明文 */
export async function runMintTokenTool(
  store: TokenStorePort | undefined,
  args: Record<string, unknown>,
  account: McpAccount,
): Promise<MintTokenToolResult> {
  if (!isAdmin(account)) {
    throw new McpToolError('mint_token 仅管理员可用（当前令牌非 admin；D6 管理门禁）');
  }
  if (!store) {
    throw new McpToolError('mint_token 不可用：服务端未装配令牌库（tokenStore）');
  }
  const userId = requiredString(args.user_id, 'mint_token.user_id');
  const rawScope = args.scope_project_ids;
  if (!Array.isArray(rawScope) || rawScope.length === 0 || rawScope.some((s) => typeof s !== 'string' || !s.trim())) {
    throw new McpToolError('mint_token.scope_project_ids 必须为至少 1 个非空字符串的数组（"*" 表示全部 general 项目）');
  }
  const scope = (rawScope as unknown[]).map((s) => String(s).trim());
  const mintAdmin = args.is_admin === undefined ? false : args.is_admin;
  if (typeof mintAdmin !== 'boolean') throw new McpToolError('mint_token.is_admin 须为布尔值');
  let expiresAt: number | undefined;
  if (args.expires_at !== undefined) {
    if (typeof args.expires_at !== 'number' || !Number.isFinite(args.expires_at)) {
      throw new McpToolError('mint_token.expires_at 须为毫秒时间戳数字');
    }
    expiresAt = args.expires_at;
  }
  const label = optionalString(args.label, 'mint_token.label');
  const minted = store.mint({
    user_id: userId,
    scope_project_ids: scope,
    is_admin: mintAdmin,
    ...(label !== undefined ? { label } : {}),
    ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
    created_by: account.user_id,
  });
  return {
    ok: true,
    token: minted.token,
    minted: {
      user_id: minted.record.user_id,
      scope_project_ids: [...minted.record.scope_project_ids],
      is_admin: minted.record.is_admin,
      ...(minted.record.label !== undefined ? { label: minted.record.label } : {}),
      ...(minted.record.expires_at !== undefined ? { expires_at: minted.record.expires_at } : {}),
      created_at: minted.record.created_at,
    },
    note: MINT_NOTE,
  };
}
