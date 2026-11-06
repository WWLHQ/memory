// 令牌代理（D6-4，方案 A1 / 子方案 §3.2）：文件化令牌库 mcp-tokens.json（0600）
// + mint 受限令牌（scope / is_admin / 过期）+ 按库解析 McpAccount + 引导令牌兼容。
//
// 红线：
// ① 库里只存 sha256(明文) 哈希（token_hash），明文只在 mint 返回时一次性回显，绝不落盘、绝不进日志；
// ② 文件权限 0600（Windows 上 chmod 仅能切只读位，尽力而为——诚实注释，不谎称 POSIX 语义）；
// ③ 解析：过期令牌等同不存在（不泄露「曾存在」）；未命中 → null（传输层回 -32001 unauthorized）；
// ④ 库文件缺失（ENOENT）→ 空库，引导令牌兜底为 admin；库损坏（JSON/形状解析失败）→ 抛错 fail-fast，
//    绝不静默清空既有授权（半损坏的令牌库静默归零等于吊销所有已签发凭据且无人知晓）；
// ⑤ TokenRecord 补 `user_id`（子方案 §3.2 字段清单之外）：受限令牌代表某租户身份，
//    McpAccount 解析与三池 P-<user> owner 判定都必需它——口径差异在 code-map 注明。
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tokenEquals, DEFAULT_MCP_ACCOUNT, scopeHasWildcard, type McpAccount } from './mcpAuth.ts';
import { resolveApiKeyAccount, type MemberStorePort } from './memberStore.ts';

/** 令牌库记录：token_hash = sha256(明文) hex —— 绝不存明文 */
export interface TokenRecord {
  token_hash: string;
  /** 受限令牌代表的租户身份（McpAccount 解析必需；三池 P-<user> owner 判定依据） */
  user_id: string;
  scope_project_ids: string[];
  is_admin: boolean;
  label?: string;
  /** 绝对毫秒时间戳；缺省永不过期 */
  expires_at?: number;
  created_at: number;
  created_by: string;
}

export interface MintTokenInput {
  user_id: string;
  scope_project_ids: string[];
  is_admin?: boolean;
  label?: string;
  /** 必须晚于当前时间（过期即失效，签发一个立即过期的令牌毫无意义——明确拒绝） */
  expires_at?: number;
  created_by: string;
}

export interface MintedToken {
  /** 一次性明文令牌（`mtk_` + 64 hex）：只在返回值里出现这一次 */
  token: string;
  record: TokenRecord;
}

/** 令牌库端口：InMemoryTokenStore 供测试，FileTokenStore 供桌面装配 */
export interface TokenStorePort {
  /** 按明文令牌解析账户；未命中 / 过期 → null。now 可注入（测试用），缺省真实时钟 */
  resolve(token: string | undefined, now?: number): McpAccount | null;
  /** 管理员 mint（is_admin=true 的调用者由 D6-5 编排层把守，库本身不重复鉴权） */
  mint(input: MintTokenInput): MintedToken;
  /** 全量记录（管理/测试用；只有哈希） */
  list(): TokenRecord[];
}

function hashToken(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

function constantTimeHexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function assertMintInput(input: MintTokenInput, now: number): void {
  if (typeof input.user_id !== 'string' || !input.user_id.trim()) {
    throw new Error('mint.user_id 必填且须为非空字符串');
  }
  if (!Array.isArray(input.scope_project_ids) || input.scope_project_ids.length === 0
    || input.scope_project_ids.some((s) => typeof s !== 'string' || !s.trim())) {
    throw new Error('mint.scope_project_ids 必须为至少 1 个非空字符串的数组（"*" 亦可）');
  }
  // 批次45-A3：'*' 全放行仅属本机属主引导账户——非 admin 令牌在库层也拒签（与 mint_token 编排层双保险）
  if (!input.is_admin && scopeHasWildcard(input.scope_project_ids)) {
    throw new Error("mint：scope_project_ids 含 '*' 仅限 is_admin=true 的令牌（45-A3：'*' 全放行属本机属主引导账户，非 admin 请显式列出项目）");
  }
  if (input.expires_at !== undefined && (!Number.isFinite(input.expires_at) || input.expires_at <= now)) {
    throw new Error('mint.expires_at 必须晚于当前时间（签发立即过期的令牌无意义）');
  }
  if (typeof input.created_by !== 'string' || !input.created_by.trim()) {
    throw new Error('mint.created_by 必填且须为非空字符串');
  }
}

function recordToAccount(rec: TokenRecord): McpAccount {
  // 本机单一信任域：team/enterprise 沿用默认（与 DEFAULT_MCP_ACCOUNT 同域）
  return {
    user_id: rec.user_id,
    team_id: 't1',
    enterprise_id: 'e1',
    scope_project_ids: [...rec.scope_project_ids],
    is_admin: rec.is_admin === true,
  };
}

function mintRecord(input: MintTokenInput, now: number): MintedToken {
  assertMintInput(input, now);
  const token = `mtk_${randomBytes(32).toString('hex')}`;
  const record: TokenRecord = {
    token_hash: hashToken(token),
    user_id: input.user_id.trim(),
    scope_project_ids: [...input.scope_project_ids],
    is_admin: input.is_admin === true,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.expires_at !== undefined ? { expires_at: input.expires_at } : {}),
    created_at: now,
    created_by: input.created_by.trim(),
  };
  return { token, record };
}

function resolveRecord(records: TokenRecord[], candidate: string | undefined, now: number): McpAccount | null {
  if (!candidate || !candidate.trim()) return null;
  const hash = hashToken(candidate);
  for (const rec of records) {
    if (!constantTimeHexEqual(hash, rec.token_hash)) continue;
    // 批次45-A3 防御纵深：存量/被篡改的「非 admin 持 '*'」记录一律 fail-closed（等同不存在，不泄露曾存在）
    if (!rec.is_admin && scopeHasWildcard(rec.scope_project_ids)) return null;
    if (rec.expires_at !== undefined && rec.expires_at <= now) return null; // 过期 = 不存在
    return recordToAccount(rec);
  }
  return null;
}

/** 内存令牌库（测试 / 无盘环境） */
export class InMemoryTokenStore implements TokenStorePort {
  private records: TokenRecord[] = [];

  resolve(token: string | undefined, now?: number): McpAccount | null {
    return resolveRecord(this.records, token, now ?? Date.now());
  }

  mint(input: MintTokenInput): MintedToken {
    const minted = mintRecord(input, Date.now());
    this.records.push(minted.record);
    return minted;
  }

  list(): TokenRecord[] {
    return [...this.records];
  }
}

const STORE_FILE_SCHEMA = 'mcp-tokens/1';

interface StoreFile {
  schema: string;
  tokens: TokenRecord[];
}

function isStoreFile(o: unknown): o is StoreFile {
  if (!o || typeof o !== 'object') return false;
  const obj = o as { schema?: unknown; tokens?: unknown };
  return obj.schema === STORE_FILE_SCHEMA && Array.isArray(obj.tokens);
}

/** 文件化令牌库（桌面装配）：`userData/mcp-tokens.json`，0600；mint 即写盘（令牌库低频写） */
export class FileTokenStore implements TokenStorePort {
  private records: TokenRecord[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return; // 库缺失 → 空库（引导令牌兜底为 admin）
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
    } catch (e) {
      throw new Error(`令牌库损坏（无法解析 ${this.filePath}）：${String((e as Error)?.message ?? e)}`);
    }
    if (!isStoreFile(parsed)) {
      throw new Error(`令牌库损坏（形状不符 ${this.filePath}）：期望 { schema:'${STORE_FILE_SCHEMA}', tokens:[...] }`);
    }
    this.records = parsed.tokens;
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const json = JSON.stringify({ schema: STORE_FILE_SCHEMA, tokens: this.records }, null, 2);
    writeFileSync(this.filePath, json, { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(this.filePath, 0o600); } catch { /* Windows 尽力而为，不因 chmod 失败而中断 */ }
  }

  resolve(token: string | undefined, now?: number): McpAccount | null {
    return resolveRecord(this.records, token, now ?? Date.now());
  }

  mint(input: MintTokenInput): MintedToken {
    const minted = mintRecord(input, Date.now());
    this.records.push(minted.record);
    this.save();
    return minted;
  }

  list(): TokenRecord[] {
    return [...this.records];
  }
}

/**
 * 鉴权编排（D6-4 → 45-B3 三环）：
 * ① 与引导令牌（serverToken）常数时间相等 → 引导账户（默认 admin，McpOptions.account 可覆盖）；
 * ② 查受限令牌库（mtk_）→ 命中返回库账户；
 * ③ 查成员 API 密钥（apk_，45-B3）→ 按 owner 成员解析账户（role=admin 映射 is_admin；吊销/停用 fail-closed）；
 * ④ 未配置任何库或全部未命中 → null（传输层回 unauthorized；仅引导令牌可用 = 现状行为不变）。
 */
export function resolveAccountFor(
  candidate: string | undefined,
  opts: { serverToken: string; store?: TokenStorePort; bootstrap?: McpAccount; memberStore?: MemberStorePort },
): McpAccount | null {
  if (tokenEquals(candidate, opts.serverToken)) {
    return opts.bootstrap ?? DEFAULT_MCP_ACCOUNT;
  }
  if (opts.store) {
    const viaToken = opts.store.resolve(candidate);
    if (viaToken) return viaToken;
  }
  if (opts.memberStore) {
    const viaKey = resolveApiKeyAccount(opts.memberStore, candidate);
    if (viaKey) return viaKey;
  }
  return null;
}
