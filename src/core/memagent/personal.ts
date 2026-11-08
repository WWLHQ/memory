// 个人记忆内核 API（第一轮本机闭环）：quick_add / confirm / reject / revoke / delete + list。
//
// 口径：
// - 每个动作都写真实审计（action='personal_memory'）并回执 request_id；审计只记状态与指纹，不复制正文；
// - 状态机：pending → confirmed（confirm）/ rejected（reject）；confirmed / rejected → pending（revoke）；
// - delete 必须显式二次确认（confirm=true），只写墓碑，不物理删除账本记录；
// - 「不是我的」只把条目移出本机收件箱（state=rejected），不删账本 —— 撤销走 revoke；
// - confidence 与 coreFeedback 同口径：confirm +0.1 / reject −0.05，个人条目本身不带 confidence 分，
//   只把该 delta 记进审计，供口径对齐与后续同步使用。
import { MemAgentError } from './errors.ts';
import { ulid } from './ulid.ts';
import type { AuditRecord, Form } from './types.ts';
import { personalContentHash, type PersonalEntry, type PersonalMemoryStore, type PersonalState } from './personalStore.ts';

/** 与 coreFeedback（17.4）同一口径 */
export const PERSONAL_CONFIDENCE_DELTA = { confirm: 0.1, reject: -0.05 } as const;

export type PersonalOp = 'quick_add' | 'confirm' | 'reject' | 'revoke' | 'delete';

export interface PersonalReceipt {
  ok: true;
  request_id: string;
  action: PersonalOp;
  /** 本次动作后的条目；delete 后为墓碑副本 */
  entry: PersonalEntry;
}

export interface PersonalSnapshot {
  owner: string;
  /** 已确认（左窗），按确认时间倒序 */
  confirmed: PersonalEntry[];
  /** 收件箱待确认（右窗），按投递时间倒序；含 quick_note 与 agent 来源 */
  pending: PersonalEntry[];
  /** 已剔除（右窗可撤销），按剔除时间倒序 */
  rejected: PersonalEntry[];
  counts: {
    confirmed: number;
    pending: number;
    /** 待确认中来自 agent 的条数（导航/页签徽标用真实待确认口径） */
    pending_agent: number;
    /** 待确认中本机快速记录的条数（本机待上行） */
    pending_quick: number;
    rejected: number;
  };
}

export interface PersonalApi {
  /** 存储端口是否注入（未注入时写操作如实 E_NOT_IMPLEMENTED，读操作同样报错） */
  readonly available: boolean;
  readonly owner: string;
  quickAdd(content: string): Promise<PersonalReceipt>;
  list(): Promise<PersonalSnapshot>;
  confirm(id: string): Promise<PersonalReceipt>;
  reject(id: string): Promise<PersonalReceipt>;
  revoke(id: string): Promise<PersonalReceipt>;
  remove(id: string, confirm: boolean): Promise<PersonalReceipt>;
}

export interface PersonalApiContext {
  store: PersonalMemoryStore | undefined;
  owner: string;
  form: Form;
  appendAudit: (a: AuditRecord) => Promise<void>;
  now?: () => number;
}

function requireStore(store: PersonalMemoryStore | undefined): PersonalMemoryStore {
  if (!store) {
    throw new MemAgentError('E_NOT_IMPLEMENTED', '个人记忆存储未注入：本端没有可用的个人记忆账本（第一轮仅本机闭环）');
  }
  return store;
}

function newRequestId(): string {
  return `pm_${ulid()}`;
}

function assertId(id: unknown): string {
  const v = typeof id === 'string' ? id.trim() : '';
  if (!v) throw new Error('缺少个人记忆 id');
  return v;
}

async function writeAudit(
  ctx: PersonalApiContext,
  request_id: string,
  op: PersonalOp,
  entry: PersonalEntry,
  from: PersonalState | 'none',
  extra: Record<string, unknown> = {},
): Promise<void> {
  await ctx.appendAudit({
    request_id,
    action: 'personal_memory',
    form: ctx.form,
    user_id: ctx.owner,
    ts: (ctx.now ?? Date.now)(),
    detail: {
      op,
      id: entry.id,
      owner: entry.owner,
      from_state: from,
      to_state: entry.state,
      source: entry.source,
      source_agent: entry.source_agent,
      content_hash: entry.content_hash,
      version: entry.version,
      deleted: entry.deleted,
      ...extra,
    },
  });
}

/** 读快照（只读，不写审计：页面轮询不制造噪音；写动作各自有审计） */
export async function personalList(store: PersonalMemoryStore | undefined, owner: string): Promise<PersonalSnapshot> {
  const s = requireStore(store);
  const all = await s.list(owner);
  const confirmed = all.filter((e) => e.state === 'confirmed')
    .sort((a, b) => ((b.confirmed_at ?? 0) - (a.confirmed_at ?? 0)) || b.id.localeCompare(a.id));
  const pending = all.filter((e) => e.state === 'pending')
    .sort((a, b) => (b.delivered_at - a.delivered_at) || b.id.localeCompare(a.id));
  const rejected = all.filter((e) => e.state === 'rejected')
    .sort((a, b) => ((b.rejected_at ?? 0) - (a.rejected_at ?? 0)) || b.id.localeCompare(a.id));
  return {
    owner,
    confirmed,
    pending,
    rejected,
    counts: {
      confirmed: confirmed.length,
      pending: pending.length,
      pending_agent: pending.filter((e) => e.source === 'agent').length,
      pending_quick: pending.filter((e) => e.source === 'quick_note').length,
      rejected: rejected.length,
    },
  };
}

/**
 * 快速记一条（source=quick_note，state=pending，layer=L1）。
 * 不写项目记忆表；确认后才进入已确认视图，是否上行团队留第二轮。
 */
export async function personalQuickAdd(
  ctx: PersonalApiContext,
  content: string,
): Promise<PersonalReceipt> {
  const s = requireStore(ctx.store);
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) throw new Error('内容为空：未提交（不会把空条目写进个人记忆）');
  if (text.length > 4000) throw new Error('单条内容超过 4000 字：请拆分后再记');
  const now = (ctx.now ?? Date.now)();
  const request_id = newRequestId();
  const entry: PersonalEntry = {
    id: `pm_${ulid(now)}`,
    owner: ctx.owner,
    content: text,
    source: 'quick_note',
    source_agent: null,
    delivered_at: now,
    confirmed_at: null,
    state: 'pending',
    rejected_at: null,
    layer: 'L1',
    content_hash: personalContentHash(text),
    version: 1,
    deleted: false,
    deleted_at: null,
  };
  await s.put(entry);
  await writeAudit(ctx, request_id, 'quick_add', entry, 'none', { confidence_delta: 0 });
  return { ok: true, request_id, action: 'quick_add', entry };
}

async function transition(
  ctx: PersonalApiContext,
  id: string,
  op: 'confirm' | 'reject' | 'revoke' | 'delete',
  pick: (e: PersonalEntry) => boolean,
  apply: (e: PersonalEntry, now: number) => PersonalEntry,
  extra: (e: PersonalEntry) => Record<string, unknown>,
): Promise<PersonalReceipt> {
  const s = requireStore(ctx.store);
  const entryId = assertId(id);
  const cur = await s.get(ctx.owner, entryId);
  if (!cur) throw new Error(`个人记忆不存在或已删除：${entryId}`);
  if (!pick(cur)) {
    throw new Error(`动作与当前状态不匹配：${entryId} 当前为 ${cur.state}${cur.deleted ? '（墓碑）' : ''}`);
  }
  const now = (ctx.now ?? Date.now)();
  const request_id = newRequestId();
  const next: PersonalEntry = { ...apply(cur, now), version: cur.version + 1 };
  await s.put(next);
  await writeAudit(ctx, request_id, op, next, cur.state, extra(next));
  return { ok: true, request_id, action: op, entry: next };
}

/** 确认「是我的」：pending → confirmed（confidence +0.1 口径） */
export async function personalConfirm(ctx: PersonalApiContext, id: string): Promise<PersonalReceipt> {
  return transition(ctx, id, 'confirm', (e) => e.state === 'pending', (e, now) => ({
    ...e, state: 'confirmed', confirmed_at: now, rejected_at: null,
  }), () => ({ confidence_delta: PERSONAL_CONFIDENCE_DELTA.confirm }));
}

/** 剔除「不是我的」：pending → rejected（只移出视图，不删账本；confidence −0.05 口径） */
export async function personalReject(ctx: PersonalApiContext, id: string): Promise<PersonalReceipt> {
  return transition(ctx, id, 'reject', (e) => e.state === 'pending', (e, now) => ({
    ...e, state: 'rejected', rejected_at: now,
  }), () => ({ confidence_delta: PERSONAL_CONFIDENCE_DELTA.reject, ledger_kept: true }));
}

/** 撤销：confirmed → pending（取消确认）/ rejected → pending（撤销剔除），统一回到待确认 */
export async function personalRevoke(ctx: PersonalApiContext, id: string): Promise<PersonalReceipt> {
  return transition(ctx, id, 'revoke', (e) => e.state === 'confirmed' || e.state === 'rejected', (e) => ({
    ...e, state: 'pending', confirmed_at: null, rejected_at: null,
  }), () => ({ confidence_delta: 0 }));
}

/** 删除：必须显式二次确认（confirm=true），只写墓碑；已删除的行不可再操作 */
export async function personalDelete(
  ctx: PersonalApiContext,
  id: string,
  confirm: boolean,
): Promise<PersonalReceipt> {
  const entryId = assertId(id);
  if (confirm !== true) {
    throw new Error('删除需二次确认：请在确认框中再次确认（未删除任何条目）');
  }
  return transition(ctx, entryId, 'delete', (e) => !e.deleted, (e, now) => ({
    ...e, deleted: true, deleted_at: now,
  }), () => ({ tombstone: true, confidence_delta: 0 }));
}

/** 组装内核 API（agent 与数据面共用同一实现，禁止各端另写一套） */
export function createPersonalApi(ctx: PersonalApiContext): PersonalApi {
  return {
    available: !!ctx.store,
    owner: ctx.owner,
    quickAdd: (content) => personalQuickAdd(ctx, content),
    list: () => personalList(ctx.store, ctx.owner),
    confirm: (id) => personalConfirm(ctx, id),
    reject: (id) => personalReject(ctx, id),
    revoke: (id) => personalRevoke(ctx, id),
    remove: (id, confirm) => personalDelete(ctx, id, confirm),
  };
}

// ─── 召回准入（第一轮）：只有 confirmed 条目进召回，pending / rejected 不进 ──────────

function tokensOf(text: string): string[] {
  const s = text.toLowerCase();
  const out = new Set<string>();
  for (const w of s.match(/[a-z0-9_]+/g) ?? []) out.add(w);
  for (const seg of s.replace(/[^\u4e00-\u9fff]+/g, ' ').split(/\s+/)) {
    if (!seg) continue;
    if (seg.length === 1) out.add(seg);
    for (let i = 0; i + 1 < seg.length; i++) out.add(seg.slice(i, i + 2));
  }
  return [...out];
}

/** 关键词重合度（CJK 二元组 + 英文词），0–1；不冒充向量相关度 */
export function personalRecallScore(content: string, query: string): number {
  const q = tokensOf(query);
  if (!q.length) return 0;
  const hay = content.toLowerCase();
  const hit = q.filter((t) => hay.includes(t)).length;
  return Math.round((hit / q.length) * 1000) / 1000;
}

/**
 * 召回候选：owner 的 confirmed 条目按关键词重合度排序，最多 limit 条；分数 0 的不进。
 * pending / rejected / 墓碑一律不可见 —— 这是「未确认不得被 agent 使用」的唯一判据。
 */
export async function selectPersonalRecall(
  store: PersonalMemoryStore,
  owner: string,
  query: string,
  limit = 3,
): Promise<{ entry: PersonalEntry; score: number }[]> {
  const all = await store.list(owner);
  return all
    .filter((e) => e.state === 'confirmed' && !e.deleted)
    .map((entry) => ({ entry, score: personalRecallScore(entry.content, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => (b.score - a.score) || ((b.entry.confirmed_at ?? 0) - (a.entry.confirmed_at ?? 0)))
    .slice(0, limit);
}
