// 个人记忆独立存储（第一轮本机闭环 + 第二轮跨端同步）。
//
// 边界（用户定稿）：
// - 独立于 Memory 主表与 memories.db.json —— 个人条目不是项目记忆，绝不扩 Memory 结构；
// - 每条只属于一个 owner（内核账号；见 resolvePersonalOwner），跨 owner 不可见；
// - 墓碑（deleted=true）保留账本记录，删除才写墓碑，「不是我的 / 已剔除」只改状态；
// - L0 原始内容不进个人收件箱：这里只有投递/快速记录时已有的可读内容，layer 固定 L1；
// - 第二轮同步：内容指纹统一 sha256（与 sync.ts 同算法）；每次写动作推 vclock；
//   默认 sync_state='local'（仅本机+本人），上行团队必须显式授权（team_shared=true），
//   个人确认（confirm）绝不自动置 team_shared / 不自动上行。
import { sha256hex } from './sync.ts';
import type { Layer } from './types.ts';

export type PersonalState = 'pending' | 'confirmed' | 'rejected';
export type PersonalSource = 'agent' | 'quick_note';
/** 同步状态：local=仅本机本人 / pending_sync=已授权待上行 / synced=已落团队中枢 / failed=上行失败 */
export type PersonalSyncState = 'local' | 'pending_sync' | 'synced' | 'failed';
/** 上行阶段（失败时如实上报，页面不得把 failed 说成「已同步」） */
export type PersonalSyncStage = 'authorize' | 'build' | 'hub_init' | 'hub_push' | 'hub_result';

export interface PersonalSyncError {
  stage: PersonalSyncStage;
  /** 错误码（E_SYNC_* 或中枢/异常原码） */
  code: string;
  message: string;
  at: number;
}

export interface PersonalEntry {
  id: string;
  owner: string;
  content: string;
  /** agent = 由 agent 投递；quick_note = 本机快速记一条 */
  source: PersonalSource;
  /** source=agent 时的来源 agent 名（如 客服工作台）；quick_note 为 null */
  source_agent: string | null;
  /** 来源账本记忆 id（仅从 agent 记忆归入个人时记录，用于去重，避免重复归入）；本机快速记 / agent 投递为 null */
  origin_ref_id?: string | null;
  /** 投递/记录时间（毫秒） */
  delivered_at: number;
  /** 确认为「我的」的时间；未确认为 null */
  confirmed_at: number | null;
  state: PersonalState;
  /** 被剔除（不是我的）的时间；未剔除为 null */
  rejected_at: number | null;
  /** 可读层：个人条目固定 L1（L0 原文不进收件箱） */
  layer: Layer;
  /** 正文指纹（第一轮本机去重口径，保留兼容；同步幂等一律用 sha256） */
  content_hash: string;
  /** SHA-256 内容指纹（与 sync.ts 同算法；团队上行幂等/去重真源） */
  sha256: string;
  /** 向量时钟 {端: 版本}：每次写动作/上行在 form 上 +1（跨端因果判序） */
  vclock: Record<string, number>;
  /** 同步状态（默认 local：仅本机+本人，绝不因 confirm 自动变化） */
  sync_state: PersonalSyncState;
  /** 最近一次上行失败的真实阶段 + 错误码；成功/未上行为 null */
  sync_error: PersonalSyncError | null;
  /** 最近一次上行结果（applied/dedup/lww）；未成功上行为 null */
  sync_result: string | null;
  /** 团队上行显式授权标记：只有 pushToTeam(explicit=true) 能置 true */
  team_shared: boolean;
  /** 显式授权/上行目标团队；未授权为 null */
  team_id: string | null;
  /** 每次状态变更 +1（乐观并发/审计对账用） */
  version: number;
  /** 墓碑：删除后置 true，记录保留 |
   */
  deleted: boolean;
  deleted_at: number | null;
}

/** 独立存储端口：只按 owner 读写，没有「全局列表」入口 */
export interface PersonalMemoryStore {
  list(owner: string, opts?: { includeDeleted?: boolean }): Promise<PersonalEntry[]>;
  get(owner: string, id: string): Promise<PersonalEntry | null>;
  put(entry: PersonalEntry): Promise<void>;
}

/** 本机去重指纹（FNV-1a 32 位 ×2，稳定、同步、不依赖 node:crypto；第二轮起同步幂等一律用 sha256） */
export function personalContentHash(content: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = (Math.imul(h2, 31) + c) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** 旧文件条目兼容补齐（第一轮条目没有 sha256/vclock/同步字段）：只补元数据，不改正文与状态 */
export function normalizePersonalEntry(raw: PersonalEntry): PersonalEntry {
  const version = typeof raw.version === 'number' && raw.version > 0 ? raw.version : 1;
  const syncState: PersonalSyncState = raw.sync_state === 'pending_sync' || raw.sync_state === 'synced'
    || raw.sync_state === 'failed' ? raw.sync_state : 'local';
  return {
    ...raw,
    sha256: typeof raw.sha256 === 'string' && raw.sha256.length === 64 ? raw.sha256 : sha256hex(raw.content),
    vclock: raw.vclock && typeof raw.vclock === 'object' && !Array.isArray(raw.vclock)
      ? raw.vclock
      : { desktop: version },
    origin_ref_id: typeof raw.origin_ref_id === 'string' ? raw.origin_ref_id : null,
    sync_state: syncState,
    sync_error: raw.sync_error && typeof raw.sync_error === 'object' ? raw.sync_error : null,
    sync_result: typeof raw.sync_result === 'string' ? raw.sync_result : null,
    team_shared: raw.team_shared === true,
    team_id: typeof raw.team_id === 'string' ? raw.team_id : null,
  };
}

// ─── owner 口径（第二轮定稿）───────────────────────────────────────────────
// 召回侧 owner 取内核 account.user_id；桌面登录账号与内核账号不同名时按显式绑定解析。
// - 同名 → 直通；
// - 有显式绑定（登录账号 → 内核 user_id）→ 条目按内核 user_id 存储，agent 召回可命中；
// - 未绑定 → 条目仍按登录账号本机可用（个人页面照常），但绝不静默并入内核账号：
//   召回侧（内核 user_id）不命中，页面如实标注「未绑定，agent 不可召回」。
export interface PersonalOwnerBinding {
  /** 桌面登录账号（会话 user_id） */
  account: string;
  /** 内核 account.user_id（tenant.json 真源） */
  kernel_user_id: string;
}

export interface PersonalOwnerResolution {
  /** 存储/召回 owner：已绑定 = 内核 user_id；未绑定 = 登录账号（仅本机） */
  owner: string;
  login_account: string;
  kernel_user_id: string;
  /** true = 召回侧（内核账号）能命中；false = 仅本机本人可见 */
  bound: boolean;
  via: 'same_name' | 'binding' | 'unbound' | 'no_kernel';
}

export function resolvePersonalOwner(
  loginAccount: string,
  kernelUserId?: string,
  bindings: PersonalOwnerBinding[] = [],
): PersonalOwnerResolution {
  const login = (loginAccount ?? '').trim();
  const kernel = (kernelUserId ?? '').trim();
  if (!kernel) {
    return { owner: login, login_account: login, kernel_user_id: login, bound: true, via: 'no_kernel' };
  }
  if (login === kernel) {
    return { owner: login, login_account: login, kernel_user_id: kernel, bound: true, via: 'same_name' };
  }
  const hit = bindings.find((b) => b.account === login && b.kernel_user_id === kernel);
  if (hit) {
    return { owner: kernel, login_account: login, kernel_user_id: kernel, bound: true, via: 'binding' };
  }
  return { owner: login, login_account: login, kernel_user_id: kernel, bound: false, via: 'unbound' };
}

/** 解析 env `MAM_PERSONAL_OWNER_BINDINGS`（JSON 数组）；坏数据如实抛错，绝不静默忽略绑定 */
export function parsePersonalOwnerBindings(raw: string | undefined): PersonalOwnerBinding[] {
  const text = (raw ?? '').trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('MAM_PERSONAL_OWNER_BINDINGS 不是合法 JSON：请写成 [{"account":"...","kernel_user_id":"..."}]');
  }
  if (!Array.isArray(parsed)) throw new Error('MAM_PERSONAL_OWNER_BINDINGS 必须是数组');
  const out: PersonalOwnerBinding[] = [];
  for (const item of parsed) {
    const it = item as Partial<PersonalOwnerBinding> | null;
    const account = typeof it?.account === 'string' ? it.account.trim() : '';
    const kernel = typeof it?.kernel_user_id === 'string' ? it.kernel_user_id.trim() : '';
    if (!account || !kernel) throw new Error('MAM_PERSONAL_OWNER_BINDINGS 每项必须含 account 与 kernel_user_id');
    out.push({ account, kernel_user_id: kernel });
  }
  return out;
}

/** 进程内实现（E2E / 页面测试 / 未落盘场景；进程退出即清空） */
export class InMemoryPersonalStore implements PersonalMemoryStore {
  private entries = new Map<string, PersonalEntry>();

  private key(owner: string, id: string): string {
    return `${owner}\u0000${id}`;
  }

  async list(owner: string, opts: { includeDeleted?: boolean } = {}): Promise<PersonalEntry[]> {
    const out: PersonalEntry[] = [];
    for (const e of this.entries.values()) {
      if (e.owner !== owner) continue;
      if (e.deleted && !opts.includeDeleted) continue;
      out.push({ ...e });
    }
    return out.sort((a, b) => (b.delivered_at - a.delivered_at) || b.id.localeCompare(a.id));
  }

  async get(owner: string, id: string): Promise<PersonalEntry | null> {
    const e = this.entries.get(this.key(owner, id));
    if (!e || e.deleted) return null;
    return { ...e };
  }

  async put(entry: PersonalEntry): Promise<void> {
    this.entries.set(this.key(entry.owner, entry.id), normalizePersonalEntry({ ...entry }));
  }

  /** 测试辅助：清空（用例间隔离） */
  clearForTests(): void {
    this.entries.clear();
  }
}
