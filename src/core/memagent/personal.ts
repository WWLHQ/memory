// 个人记忆内核 API（第一轮本机闭环 + 第二轮跨端同步）：quick_add / confirm / reject / revoke / delete
// + list + pushToTeam（显式授权上行）/ retrySync。
//
// 口径：
// - 每个动作都写真实审计（action='personal_memory'）并回执 request_id；审计只记状态与指纹，不复制正文；
// - 状态机：pending → confirmed（confirm）/ rejected（reject）；confirmed / rejected → pending（revoke）；
// - delete 必须显式二次确认（confirm=true），只写墓碑，不物理删除账本记录；
// - 「不是我的」只把条目移出本机收件箱（state=rejected），不删账本 —— 撤销走 revoke；
// - confidence 与 coreFeedback 同口径：confirm +0.1 / reject −0.05，个人条目本身不带 confidence 分，
//   只把该 delta 记进审计，供口径对齐与后续同步使用。
// - 第二轮同步（用户定稿）：
//   · 个人条目默认 sync_state='local'：仅本机 + 本人；confirm 绝不自动变成团队可见；
//   · 上行团队必须显式授权（pushToTeam 的 explicit=true），授权 + 待上行先落盘，再走真实中枢；
//   · 指纹 sha256（与 sync.ts 同算法），重复上行不产生重复中枢条目（mem_id 稳定 + 中枢 sha256 去重）；
//   · 上行失败如实落 stage + code 并回传，绝不写「已同步」；
//   · 取消确认 / 删除只影响本机账本，不回撤已写入的团队副本（页面口径如实写明）。
import { MemAgentError } from './errors.ts';
import { sha256hex, vcTick, type PushOutcome } from './sync.ts';
import { ulid } from './ulid.ts';
import type { AuditRecord, Form, Memory } from './types.ts';
import {
  personalContentHash, resolvePersonalOwner,
  type PersonalEntry, type PersonalMemoryStore, type PersonalOwnerBinding, type PersonalOwnerResolution,
  type PersonalState, type PersonalSyncStage,
} from './personalStore.ts';

/** 与 coreFeedback（17.4）同一口径 */
export const PERSONAL_CONFIDENCE_DELTA = { confirm: 0.1, reject: -0.05 } as const;

export type PersonalOp = 'quick_add' | 'confirm' | 'reject' | 'revoke' | 'delete';
export type PersonalSyncOp = 'push_team' | 'retry_sync';

/** 真实同步中枢端口（桌面/后端注入同一 PgSyncHub；缺省 = 上行如实不可用） */
export interface PersonalSyncPort {
  push(mem: Memory, form: Form): Promise<PushOutcome> | PushOutcome;
}

export interface PersonalReceipt {
  ok: true;
  request_id: string;
  action: PersonalOp;
  /** 本次动作后的条目；delete 后为墓碑副本 */
  entry: PersonalEntry;
}

/** 上行结果（outcome=failed 时必有 stage + code，页面不得显示「已同步」） */
export interface PersonalSyncOutcome {
  outcome: 'synced' | 'failed';
  /** 中枢采纳口径（synced 时）：applied / dedup / lww */
  result?: 'applied' | 'dedup' | 'lww';
  stage?: PersonalSyncStage;
  code?: string;
  message?: string;
}

export interface PersonalSyncReceipt {
  ok: true;
  request_id: string;
  action: PersonalSyncOp;
  /** 授权/上行后的条目（含 sync_state / sync_error / vclock） */
  entry: PersonalEntry;
  sync: PersonalSyncOutcome;
}

export interface PersonalSnapshot {
  owner: string;
  /** owner 口径（第二轮）：登录账号 / 内核账号 / 是否绑定（未绑定 = agent 不可召回） */
  owner_binding: PersonalOwnerResolution;
  /** 已确认（左窗），按确认时间倒序 */
  confirmed: PersonalEntry[];
  /** 收件箱待确认（右窗），按投递时间倒序；含 quick_note 与 agent 来源 */
  pending: PersonalEntry[];
  /** 已剔除（右窗可撤销），按剔除时间倒序 */
  rejected: PersonalEntry[];
  /** 本机待上行队列：已确认 + 显式授权，但 sync_state 为 pending_sync / failed（页面「本机待上行」段真源） */
  sync_queue: PersonalEntry[];
  counts: {
    confirmed: number;
    pending: number;
    /** 待确认中来自 agent 的条数（导航/页签徽标用真实待确认口径） */
    pending_agent: number;
    /** 待确认中本机快速记录的条数（本机待确认，不会自动上行） */
    pending_quick: number;
    rejected: number;
    /** 已授权待上行（尚未送达中枢） */
    pending_sync: number;
    /** 上行失败（含阶段/错误码，可重试） */
    sync_failed: number;
    /** 已落团队中枢 */
    synced: number;
    /** 已显式授权团队可见的条目（含已同步/待上行/失败） */
    team_shared: number;
  };
}

export interface PersonalApi {
  /** 存储端口是否注入（未注入时写操作如实 E_NOT_IMPLEMENTED，读操作同样报错） */
  readonly available: boolean;
  /** 存储 owner（已绑定 = 内核 user_id；未绑定 = 登录账号） */
  readonly owner: string;
  /** owner 口径解析结果（页面如实展示绑定状态） */
  readonly ownerResolution: PersonalOwnerResolution;
  quickAdd(content: string): Promise<PersonalReceipt>;
  list(): Promise<PersonalSnapshot>;
  confirm(id: string): Promise<PersonalReceipt>;
  reject(id: string): Promise<PersonalReceipt>;
  revoke(id: string): Promise<PersonalReceipt>;
  remove(id: string, confirm: boolean): Promise<PersonalReceipt>;
  /** 显式授权并上行到团队中枢（explicit 不为 true 一律拒绝，不改状态） */
  pushToTeam(id: string, opts: { explicit: boolean; team_id?: string }): Promise<PersonalSyncReceipt>;
  /** 重试上行（仅 team_shared + pending_sync/failed 可重试；不会二次索取授权） */
  retrySync(id: string): Promise<PersonalSyncReceipt>;
}

export interface PersonalApiContext {
  store: PersonalMemoryStore | undefined;
  /** 登录账号（会话 user_id）；owner 由 resolvePersonalOwner 解析 */
  owner: string;
  /** 内核 account.user_id（召回口径）；缺省 = owner（同名口径，旧行为零变化） */
  kernelUserId?: string;
  /** 登录账号 → 内核账号显式绑定表（不同名时唯一合法映射） */
  ownerBindings?: PersonalOwnerBinding[];
  form: Form;
  appendAudit: (a: AuditRecord) => Promise<void>;
  now?: () => number;
  /** 上行目标团队/企业（会话或内核三元组）；缺省 = 无法上行（E_SYNC_NO_TEAM） */
  team_id?: string;
  enterprise_id?: string;
  /** 真实同步中枢（PgSyncHub / SyncHub）；缺省 = 上行如实 E_SYNC_HUB_UNAVAILABLE */
  sync?: PersonalSyncPort;
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
  op: PersonalOp | PersonalSyncOp,
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
      sha256: entry.sha256,
      vclock: entry.vclock,
      sync_state: entry.sync_state,
      sync_result: entry.sync_result,
      team_shared: entry.team_shared,
      team_id: entry.team_id,
      ...(entry.sync_error ? {
        sync_stage: entry.sync_error.stage, sync_code: entry.sync_error.code,
      } : {}),
      version: entry.version,
      deleted: entry.deleted,
      ...extra,
    },
  });
}

/** 读快照（只读，不写审计：页面轮询不制造噪音；写动作各自有审计） */
export async function personalList(
  store: PersonalMemoryStore | undefined,
  owner: string,
  binding: PersonalOwnerResolution = resolvePersonalOwner(owner),
): Promise<PersonalSnapshot> {
  const s = requireStore(store);
  const all = await s.list(owner);
  const confirmed = all.filter((e) => e.state === 'confirmed')
    .sort((a, b) => ((b.confirmed_at ?? 0) - (a.confirmed_at ?? 0)) || b.id.localeCompare(a.id));
  const pending = all.filter((e) => e.state === 'pending')
    .sort((a, b) => (b.delivered_at - a.delivered_at) || b.id.localeCompare(a.id));
  const rejected = all.filter((e) => e.state === 'rejected')
    .sort((a, b) => ((b.rejected_at ?? 0) - (a.rejected_at ?? 0)) || b.id.localeCompare(a.id));
  // 「本机待上行」段真源：已确认 + 已显式授权，但还没送达中枢（pending_sync / failed）
  const syncQueue = confirmed
    .filter((e) => e.sync_state === 'pending_sync' || e.sync_state === 'failed')
    .sort((a, b) => (a.sync_state === 'failed' ? -1 : 0) - (b.sync_state === 'failed' ? -1 : 0)
      || b.version - a.version);
  return {
    owner,
    owner_binding: binding,
    confirmed,
    pending,
    rejected,
    sync_queue: syncQueue,
    counts: {
      confirmed: confirmed.length,
      pending: pending.length,
      pending_agent: pending.filter((e) => e.source === 'agent').length,
      pending_quick: pending.filter((e) => e.source === 'quick_note').length,
      rejected: rejected.length,
      pending_sync: confirmed.filter((e) => e.sync_state === 'pending_sync').length,
      sync_failed: confirmed.filter((e) => e.sync_state === 'failed').length,
      synced: confirmed.filter((e) => e.sync_state === 'synced').length,
      team_shared: all.filter((e) => e.team_shared).length,
    },
  };
}

/**
 * 快速记一条（source=quick_note，state=pending，layer=L1）。
 * 不写项目记忆表；默认 sync_state='local'（仅本机+本人），确认后才进入已确认视图，上行需显式授权。
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
    sha256: sha256hex(text),
    vclock: vcTick(undefined, ctx.form),
    sync_state: 'local',
    sync_error: null,
    sync_result: null,
    team_shared: false,
    team_id: null,
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
  const next: PersonalEntry = {
    ...apply(cur, now),
    version: cur.version + 1,
    vclock: vcTick(cur.vclock, ctx.form),
  };
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

// ─── 第二轮：显式授权上行到团队中枢（真实 PgSyncHub，失败如实报 stage + code） ──────

/** 中枢采纳口径 → 个人同步结论：只有 applied / dedup / lww 算「已同步」 */
const SYNC_ACCEPTED: ReadonlySet<PushOutcome> = new Set(['applied', 'dedup', 'lww']);

/** 个人条目 → 中枢 Memory：mem_id 稳定（pm:<id>），sha256 来自条目内容指纹（幂等真源） */
function entryToMemory(entry: PersonalEntry, ctx: PersonalApiContext, teamId: string): Memory {
  return {
    mem_id: `pm:${entry.id}`,
    project_id: 'personal',
    user_id: entry.owner,
    enterprise_id: ctx.enterprise_id ?? '',
    team_id: teamId,
    category: 'preference',
    layer: entry.layer === 'L0' ? 'L1' : entry.layer,
    content: entry.content,
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: entry.version,
    created_at: entry.delivered_at,
    updated_at: entry.confirmed_at ?? entry.delivered_at,
    sha256: entry.sha256,
    vclock: entry.vclock,
  };
}

/**
 * 执行一次真上行：先把「已授权待上行」落盘（进程中断也不会假装已同步），再推真实中枢，
 * 最后把 synced / failed(stage+code) 写回条目。审计每次动作一条。
 */
async function uploadEntry(
  ctx: PersonalApiContext,
  entry: PersonalEntry,
  action: PersonalSyncOp,
): Promise<PersonalSyncReceipt> {
  const s = requireStore(ctx.store);
  const request_id = newRequestId();
  const teamId = (entry.team_id ?? '').trim();
  if (!entry.team_shared || !teamId) {
    throw new MemAgentError('E_SYNC_NOT_AUTHORIZED', '本条未获显式团队授权：个人记忆默认仅本机 + 本人，不能上行');
  }
  if (entry.state !== 'confirmed' || entry.deleted) {
    throw new MemAgentError('E_SYNC_STATE', `只有未删除的已确认条目可上行：${entry.id} 当前为 ${entry.state}`);
  }
  // 待上行先落盘（同一次写动作顺带 version+1 / vclock 推进）
  const started: PersonalEntry = {
    ...entry,
    version: entry.version + 1,
    vclock: vcTick(entry.vclock, ctx.form),
    sync_state: 'pending_sync',
    sync_error: null,
  };
  await s.put(started);

  let outcome: PersonalSyncOutcome;
  const sync = ctx.sync;
  if (!sync) {
    outcome = {
      outcome: 'failed', stage: 'hub_init', code: 'E_SYNC_HUB_UNAVAILABLE',
      message: '同步中枢未接入：本条保持本机账本，未送达团队',
    };
  } else {
    try {
      const mem = entryToMemory(started, ctx, teamId);
      const result = await sync.push(mem, ctx.form);
      if (SYNC_ACCEPTED.has(result)) {
        outcome = { outcome: 'synced', result: result as 'applied' | 'dedup' | 'lww' };
      } else if (result === 'behind') {
        outcome = {
          outcome: 'failed', stage: 'hub_result', code: 'E_SYNC_HUB_BEHIND',
          message: '团队中枢已有更新版本，本条未被采纳；本机状态未改，不显示已同步',
        };
      } else {
        outcome = {
          outcome: 'failed', stage: 'hub_result', code: 'E_SYNC_CONFLICT',
          message: '团队中枢判为并发冲突，本条未写入；本机状态未改',
        };
      }
    } catch (err) {
      outcome = {
        outcome: 'failed', stage: 'hub_push', code: 'E_SYNC_PUSH_FAILED',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const final: PersonalEntry = outcome.outcome === 'synced'
    ? { ...started, sync_state: 'synced', sync_result: outcome.result ?? null, sync_error: null }
    : {
        ...started,
        sync_state: 'failed',
        sync_result: null,
        sync_error: {
          stage: (outcome.stage ?? 'hub_push') as PersonalSyncStage,
          code: outcome.code ?? 'E_SYNC_PUSH_FAILED',
          message: outcome.message ?? '',
          at: (ctx.now ?? Date.now)(),
        },
      };
  await s.put(final);
  await writeAudit(ctx, request_id, action, final, entry.state, {
    sync_outcome: outcome.outcome,
    sync_stage: outcome.stage ?? null,
    sync_code: outcome.code ?? null,
    sync_result: outcome.result ?? null,
    explicit_authorization: true,
  });
  return { ok: true, request_id, action, entry: final, sync: outcome };
}

/**
 * 显式授权并上行到团队中枢。
 * - explicit 不为 true → E_SYNC_NOT_AUTHORIZED，条目一字不改（不会因「确认」自动提权）；
 * - 只有已确认、未删除条目可上行；
 * - 目标团队必须与会话 team_id 一致（不允许把个人条目丢到别的团队）。
 */
export async function personalPushToTeam(
  ctx: PersonalApiContext,
  id: string,
  opts: { explicit: boolean; team_id?: string },
): Promise<PersonalSyncReceipt> {
  const s = requireStore(ctx.store);
  const entryId = assertId(id);
  if (opts?.explicit !== true) {
    throw new MemAgentError(
      'E_SYNC_NOT_AUTHORIZED',
      '团队上行必须显式授权（explicit=true）：个人记忆默认仅本机 + 本人，个人确认不会自动变为团队可见',
    );
  }
  const cur = await s.get(ctx.owner, entryId);
  if (!cur) throw new Error(`个人记忆不存在或已删除：${entryId}`);
  if (cur.state !== 'confirmed') {
    throw new MemAgentError('E_SYNC_STATE', `只有已确认条目可上行：${entryId} 当前为 ${cur.state}`);
  }
  const teamId = (opts.team_id ?? ctx.team_id ?? '').trim();
  if (!teamId) {
    throw new MemAgentError('E_SYNC_NO_TEAM', '缺少上行目标团队：当前会话没有 team_id，未写入任何同步状态');
  }
  if (ctx.team_id && teamId !== ctx.team_id) {
    throw new MemAgentError(
      'E_SYNC_TEAM_MISMATCH',
      `上行目标团队 ${teamId} 与当前会话团队 ${ctx.team_id} 不一致：拒绝跨团队上行`,
    );
  }
  const authorized: PersonalEntry = {
    ...cur, team_shared: true, team_id: teamId, sync_state: 'pending_sync', sync_error: null,
  };
  return uploadEntry(ctx, authorized, 'push_team');
}

/** 重试上行：只对已显式授权且 pending_sync / failed 的条目开放，不二次索取授权 */
export async function personalRetrySync(ctx: PersonalApiContext, id: string): Promise<PersonalSyncReceipt> {
  const s = requireStore(ctx.store);
  const entryId = assertId(id);
  const cur = await s.get(ctx.owner, entryId);
  if (!cur) throw new Error(`个人记忆不存在或已删除：${entryId}`);
  if (!cur.team_shared || !cur.team_id) {
    throw new MemAgentError('E_SYNC_NOT_AUTHORIZED', '本条未获显式团队授权，不能重试上行');
  }
  if (cur.sync_state !== 'pending_sync' && cur.sync_state !== 'failed') {
    throw new MemAgentError('E_SYNC_STATE', `当前同步状态为 ${cur.sync_state}，无需重试`);
  }
  return uploadEntry(ctx, { ...cur, sync_error: null }, 'retry_sync');
}

/** 组装内核 API（agent 与数据面共用同一实现，禁止各端另写一套） */
export function createPersonalApi(ctx: PersonalApiContext): PersonalApi {
  // owner 口径：召回侧取内核 account.user_id；登录账号不同名时按显式绑定解析（未绑定仅本机）
  const resolution = resolvePersonalOwner(ctx.owner, ctx.kernelUserId, ctx.ownerBindings ?? []);
  const scoped: PersonalApiContext = { ...ctx, owner: resolution.owner };
  return {
    available: !!ctx.store,
    owner: resolution.owner,
    ownerResolution: resolution,
    quickAdd: (content) => personalQuickAdd(scoped, content),
    list: () => personalList(scoped.store, resolution.owner, resolution),
    confirm: (id) => personalConfirm(scoped, id),
    reject: (id) => personalReject(scoped, id),
    revoke: (id) => personalRevoke(scoped, id),
    remove: (id, confirm) => personalDelete(scoped, id, confirm),
    pushToTeam: (id, opts) => personalPushToTeam(scoped, id, opts),
    retrySync: (id) => personalRetrySync(scoped, id),
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
