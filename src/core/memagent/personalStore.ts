// 个人记忆独立存储（第一轮本机闭环）。
//
// 边界（用户定稿）：
// - 独立于 Memory 主表与 memories.db.json —— 个人条目不是项目记忆，绝不扩 Memory 结构；
// - 每条只属于一个 owner（登录用户/内核账号），跨 owner 不可见；
// - 墓碑（deleted=true）保留账本记录，删除才写墓碑，「不是我的 / 已剔除」只改状态；
// - L0 原始内容不进个人收件箱：这里只有投递/快速记录时已有的可读内容，layer 固定 L1。
import type { Layer } from './types.ts';

export type PersonalState = 'pending' | 'confirmed' | 'rejected';
export type PersonalSource = 'agent' | 'quick_note';

export interface PersonalEntry {
  id: string;
  owner: string;
  content: string;
  /** agent = 由 agent 投递；quick_note = 本机快速记一条 */
  source: PersonalSource;
  /** source=agent 时的来源 agent 名（如 客服工作台）；quick_note 为 null */
  source_agent: string | null;
  /** 投递/记录时间（毫秒） */
  delivered_at: number;
  /** 确认为「我的」的时间；未确认为 null */
  confirmed_at: number | null;
  state: PersonalState;
  /** 被剔除（不是我的）的时间；未剔除为 null */
  rejected_at: number | null;
  /** 可读层：个人条目固定 L1（L0 原文不进收件箱） */
  layer: Layer;
  /** 正文指纹，用于本机去重；第二轮换 sha256 幂等 */
  content_hash: string;
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

/** 本机去重指纹（FNV-1a 32 位 ×2，稳定、同步、不依赖 node:crypto）；第二轮换 sha256 */
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
    this.entries.set(this.key(entry.owner, entry.id), { ...entry });
  }

  /** 测试辅助：清空（用例间隔离） */
  clearForTests(): void {
    this.entries.clear();
  }
}
