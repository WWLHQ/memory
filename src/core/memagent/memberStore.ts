// 成员 / API 密钥内核域模型（批次45-B1，ROADMAP §二 45-B1）：
// §9 欠账「成员/API 密钥表」的真源——成员（admin|member 角色 + 租户三元组 + active|suspended 状态）
// 与成员名下的 API 密钥（只存哈希，明文一次性回显）。
//
// 红线（沿用 D6-4 tokenStore 口径）：
// ① ApiKey 只存 sha256(明文) 哈希（secret_hash），明文只在 mint 返回时一次性回显，绝不落盘、绝不进日志；
// ② 文件权限 0600（Windows 上 chmod 仅能切只读位，尽力而为——诚实注释，不谎称 POSIX 语义）；
// ③ 库文件缺失（ENOENT）→ **构造时即写一份真实空表**（{ members: [], api_keys: [] }）——
//    「成员/API 密钥表」从第一天起就是真实的空表（不展示演示行），不是 UI 假象；
// ④ 库损坏（JSON/形状解析失败）→ 抛错 fail-fast，绝不静默清空既有成员与密钥；
// ⑤ resolveSecret：已吊销 = null（不泄露「曾存在」）；未命中 → null（B3 接 MCP 门时回 unauthorized）。
// 45-B1 只落域模型与存储端口；与 home 账号打通（B2）、接 MCP 门禁（B3）是后续任务。
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type MemberRole = 'admin' | 'member';
export type MemberStatus = 'active' | 'suspended';

export interface MemberRecord {
  member_id: string;
  name: string;
  role: MemberRole;
  /** 租户三元组（45-A1 归一后的规范身份；B2 与 home 账号绑定） */
  user_id: string;
  team_id: string;
  enterprise_id: string;
  status: MemberStatus;
  created_at: number;
  created_by: string;
}

export interface CreateMemberInput {
  /** 显式主键（与 createProject 同口径：重复显式拒绝，不静默覆盖） */
  member_id: string;
  name: string;
  role: MemberRole;
  user_id: string;
  team_id: string;
  enterprise_id: string;
  /** 缺省 active */
  status?: MemberStatus;
  created_by: string;
}

export interface ApiKeyRecord {
  key_id: string;
  /** 密钥所属成员（45-B2 绑定 Member；45-B3 按 member 的租户/角色进 MCP 门） */
  owner_member_id: string;
  /** sha256(明文) hex —— 绝不存明文 */
  secret_hash: string;
  scope_project_ids: string[];
  label?: string;
  created_at: number;
  created_by: string;
  /** 吊销时间（存在即已吊销）；吊销人 */
  revoked_at?: number;
  revoked_by?: string;
}

export interface MintApiKeyInput {
  owner_member_id: string;
  scope_project_ids: string[];
  label?: string;
  created_by: string;
}

export interface MintedApiKey {
  /** 一次性明文密钥（`apk_` + 64 hex）：只在返回值里出现这一次 */
  key: string;
  record: ApiKeyRecord;
}

/** 成员/API 密钥库端口：InMemoryMemberStore 供测试，FileMemberStore 供桌面装配 */
export interface MemberStorePort {
  /** 登记成员（幂等：member_id 已存在显式拒绝）；now 可注入（测试用），缺省真实时钟 */
  createMember(input: CreateMemberInput, now?: number): MemberRecord;
  getMember(member_id: string): MemberRecord | null;
  /** 更新成员（45-B2 home 同步用）：member_id/user_id **不可变**（身份锚点）；未知成员 → null。by 必填（审计留痕） */
  updateMember(
    member_id: string,
    patch: { name?: string; role?: MemberRole; team_id?: string; enterprise_id?: string },
    by: string,
    now?: number,
  ): MemberRecord | null;
  listMembers(filter?: { role?: MemberRole; status?: MemberStatus }): MemberRecord[];
  /** 给 active 成员签发 API 密钥（明文一次性回显） */
  mintApiKey(input: MintApiKeyInput, now?: number): MintedApiKey;
  getApiKey(key_id: string): ApiKeyRecord | null;
  listApiKeys(filter?: { owner_member_id?: string; include_revoked?: boolean }): ApiKeyRecord[];
  /** 吊销密钥（幂等：已吊销返回原记录不重盖时间）；key_id 不存在 → null */
  revokeApiKey(key_id: string, revoked_by: string, now?: number): ApiKeyRecord | null;
  /** 按明文密钥解析记录；未命中 / 已吊销 → null。now 可注入（测试用） */
  resolveSecret(candidate: string | undefined, now?: number): ApiKeyRecord | null;
}

function sha256hex(v: string): string {
  return createHash('sha256').update(v, 'utf8').digest('hex');
}

function constantTimeHexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

const MEMBER_ROLES: readonly MemberRole[] = ['admin', 'member'];
const MEMBER_STATUSES: readonly MemberStatus[] = ['active', 'suspended'];

function assertMemberInput(input: CreateMemberInput): void {
  for (const [field, v] of [
    ['member_id', input.member_id], ['name', input.name], ['user_id', input.user_id],
    ['team_id', input.team_id], ['enterprise_id', input.enterprise_id], ['created_by', input.created_by],
  ] as const) {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`createMember.${field} 必填且须为非空字符串`);
  }
  if (!MEMBER_ROLES.includes(input.role)) throw new Error('createMember.role 必须为 admin | member');
  if (input.status !== undefined && !MEMBER_STATUSES.includes(input.status)) {
    throw new Error('createMember.status 必须为 active | suspended');
  }
}

function assertMintInput(input: MintApiKeyInput): void {
  if (typeof input.owner_member_id !== 'string' || !input.owner_member_id.trim()) {
    throw new Error('mintApiKey.owner_member_id 必填且须为非空字符串');
  }
  if (!Array.isArray(input.scope_project_ids) || input.scope_project_ids.length === 0
    || input.scope_project_ids.some((s) => typeof s !== 'string' || !s.trim())) {
    throw new Error('mintApiKey.scope_project_ids 必须为至少 1 个非空字符串的数组（"*" 亦可）');
  }
  if (typeof input.created_by !== 'string' || !input.created_by.trim()) {
    throw new Error('mintApiKey.created_by 必填且须为非空字符串');
  }
}

function memberMatches(m: MemberRecord, filter?: { role?: MemberRole; status?: MemberStatus }): boolean {
  if (filter?.role !== undefined && m.role !== filter.role) return false;
  if (filter?.status !== undefined && m.status !== filter.status) return false;
  return true;
}

function keyMatches(k: ApiKeyRecord, filter?: { owner_member_id?: string; include_revoked?: boolean }): boolean {
  if (filter?.owner_member_id !== undefined && k.owner_member_id !== filter.owner_member_id) return false;
  if (!filter?.include_revoked && k.revoked_at !== undefined) return false;
  return true;
}

/** 内存成员库（测试 / 无盘环境） */
export class InMemoryMemberStore implements MemberStorePort {
  protected members: MemberRecord[] = [];
  protected apiKeys: ApiKeyRecord[] = [];

  createMember(input: CreateMemberInput, now?: number): MemberRecord {
    assertMemberInput(input);
    if (this.members.some((m) => m.member_id === input.member_id)) {
      throw new Error(`成员已存在：${input.member_id}`);
    }
    const rec: MemberRecord = {
      member_id: input.member_id.trim(),
      name: input.name.trim(),
      role: input.role,
      user_id: input.user_id.trim(),
      team_id: input.team_id.trim(),
      enterprise_id: input.enterprise_id.trim(),
      status: input.status ?? 'active',
      created_at: now ?? Date.now(),
      created_by: input.created_by.trim(),
    };
    this.members.push(rec);
    return rec;
  }

  getMember(member_id: string): MemberRecord | null {
    return this.members.find((m) => m.member_id === member_id) ?? null;
  }

  updateMember(
    member_id: string,
    patch: { name?: string; role?: MemberRole; team_id?: string; enterprise_id?: string },
    by: string,
    now?: number,
  ): MemberRecord | null {
    if (typeof by !== 'string' || !by.trim()) throw new Error('updateMember.by 必填且须为非空字符串');
    const rec = this.members.find((m) => m.member_id === member_id);
    if (!rec) return null;
    // patch 校验：提供的字段必须合法；member_id / user_id 不在 patch 里（身份锚点不可变）
    if (patch.role !== undefined && !MEMBER_ROLES.includes(patch.role)) throw new Error('updateMember.role 必须为 admin | member');
    if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim())) throw new Error('updateMember.name 须为非空字符串');
    if (patch.team_id !== undefined && (typeof patch.team_id !== 'string' || !patch.team_id.trim())) throw new Error('updateMember.team_id 须为非空字符串');
    if (patch.enterprise_id !== undefined && (typeof patch.enterprise_id !== 'string' || !patch.enterprise_id.trim())) throw new Error('updateMember.enterprise_id 须为非空字符串');
    if (patch.name !== undefined) rec.name = patch.name.trim();
    if (patch.role !== undefined) rec.role = patch.role;
    if (patch.team_id !== undefined) rec.team_id = patch.team_id.trim();
    if (patch.enterprise_id !== undefined) rec.enterprise_id = patch.enterprise_id.trim();
    void now; // 成员元数据不带 updated_at 时间戳（与 ProjectRecord 口径一致）；参数保留给未来扩展
    return { ...rec };
  }

  listMembers(filter?: { role?: MemberRole; status?: MemberStatus }): MemberRecord[] {
    return this.members.filter((m) => memberMatches(m, filter)).map((m) => ({ ...m }));
  }

  mintApiKey(input: MintApiKeyInput, now?: number): MintedApiKey {
    assertMintInput(input);
    const owner = this.getMember(input.owner_member_id);
    if (!owner) throw new Error(`mintApiKey.owner_member_id 不存在：${input.owner_member_id}`);
    if (owner.status !== 'active') throw new Error(`mintApiKey：成员 ${owner.member_id} 状态为 ${owner.status}，已停用成员不可签发`);
    const key = `apk_${randomBytes(32).toString('hex')}`;
    const record: ApiKeyRecord = {
      key_id: `key_${randomBytes(12).toString('hex')}`,
      owner_member_id: owner.member_id,
      secret_hash: sha256hex(key),
      scope_project_ids: [...input.scope_project_ids],
      ...(input.label !== undefined ? { label: input.label } : {}),
      created_at: now ?? Date.now(),
      created_by: input.created_by.trim(),
    };
    this.apiKeys.push(record);
    return { key, record };
  }

  getApiKey(key_id: string): ApiKeyRecord | null {
    return this.apiKeys.find((k) => k.key_id === key_id) ?? null;
  }

  listApiKeys(filter?: { owner_member_id?: string; include_revoked?: boolean }): ApiKeyRecord[] {
    return this.apiKeys.filter((k) => keyMatches(k, filter)).map((k) => ({ ...k }));
  }

  revokeApiKey(key_id: string, revoked_by: string, now?: number): ApiKeyRecord | null {
    const rec = this.getApiKey(key_id);
    if (!rec) return null;
    if (rec.revoked_at === undefined) {
      rec.revoked_at = now ?? Date.now();
      rec.revoked_by = revoked_by.trim();
    }
    return { ...rec };
  }

  resolveSecret(candidate: string | undefined, now?: number): ApiKeyRecord | null {
    void now; // B1 密钥无过期语义；参数保留给未来的 expires_at 扩展，防误用由调用方约束
    if (!candidate || !candidate.trim()) return null;
    const hash = sha256hex(candidate);
    for (const rec of this.apiKeys) {
      if (!constantTimeHexEqual(hash, rec.secret_hash)) continue;
      if (rec.revoked_at !== undefined) return null; // 已吊销 = 不存在
      return { ...rec };
    }
    return null;
  }
}

const STORE_FILE_SCHEMA = 'members/1';

interface StoreFile {
  schema: string;
  members: MemberRecord[];
  api_keys: ApiKeyRecord[];
}

function isStoreFile(o: unknown): o is StoreFile {
  if (!o || typeof o !== 'object') return false;
  const obj = o as { schema?: unknown; members?: unknown; api_keys?: unknown };
  return obj.schema === STORE_FILE_SCHEMA && Array.isArray(obj.members) && Array.isArray(obj.api_keys);
}

const EMPTY_STORE: StoreFile = { schema: STORE_FILE_SCHEMA, members: [], api_keys: [] };

/**
 * 文件化成员/API 密钥库（桌面装配）：`userData/members.json`，0600。
 * 与 tokenStore 的差异：**构造时缺文件即写一份真实空表**（§9 欠账要求「成员/API 密钥表」
 * 是真实空表而非 UI 假象）；create/mint/revoke 即写盘（低频写）。
 */
export class FileMemberStore extends InMemoryMemberStore {
  constructor(private readonly filePath: string) {
    super();
    this.load();
  }

  private load(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) {
      // 首启：落一份真实空表（不是「读到才建」——空表本身要可见、可审计）
      this.saveRaw(EMPTY_STORE);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
    } catch (e) {
      throw new Error(`成员库损坏（无法解析 ${this.filePath}）：${String((e as Error)?.message ?? e)}`);
    }
    if (!isStoreFile(parsed)) {
      throw new Error(`成员库损坏（形状不符 ${this.filePath}）：期望 { schema:'${STORE_FILE_SCHEMA}', members:[...], api_keys:[...] }`);
    }
    for (const m of parsed.members) this.members.push(m);
    for (const k of parsed.api_keys) this.apiKeys.push(k);
  }

  private saveRaw(file: StoreFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(this.filePath, 0o600); } catch { /* Windows 尽力而为，不因 chmod 失败而中断 */ }
  }

  private save(): void {
    this.saveRaw({ schema: STORE_FILE_SCHEMA, members: this.members, api_keys: this.apiKeys });
  }

  override createMember(input: CreateMemberInput, now?: number): MemberRecord {
    const rec = super.createMember(input, now);
    this.save();
    return rec;
  }

  override updateMember(
    member_id: string,
    patch: { name?: string; role?: MemberRole; team_id?: string; enterprise_id?: string },
    by: string,
    now?: number,
  ): MemberRecord | null {
    const rec = super.updateMember(member_id, patch, by, now);
    if (rec) this.save();
    return rec;
  }

  override mintApiKey(input: MintApiKeyInput, now?: number): MintedApiKey {
    const minted = super.mintApiKey(input, now);
    this.save();
    return minted;
  }

  override revokeApiKey(key_id: string, revoked_by: string, now?: number): ApiKeyRecord | null {
    const rec = super.revokeApiKey(key_id, revoked_by, now);
    if (rec) this.save();
    return rec;
  }
}
