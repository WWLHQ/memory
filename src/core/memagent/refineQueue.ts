// 批次39：L2–L6 后台补炼队列（纯函数 + 落盘状态 + 单行补炼）。
// 用户拍板口径（2026-11-02 22:xx）：写入只落 L0+脱敏 L1，L2–L6 交给后台异步队列补炼；
// 单条最多试 3 个引擎；每日最多补炼 500 行；llm_partial 不自动重试（重试要人显式点）；
// 队列状态落 refine-queue.json（重启续炼），文件里只有 mem_id 与状态，正文一个字都不落。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmProvider, Memory, StorageBackend, VectorBackend } from './types.ts';
import { buildL6Input, layerSpecsFrom, makeLayerGenerator } from './memories.ts';
import {
  LAYER_ORDER, checkLayerSpecDetailed, depthCapFor, headlineLayer, isFullyRefined, layerSpecOf, meaningfulLength,
  targetLayers, type LayerViolation, type RefineLayer,
} from './layerRules.ts';
import { sha256hex } from './sync.ts';

/** 队列文件（落 ledger 目录，与 memories.db.json 同目录，随数据根迁移白名单外的独立文件） */
export const REFINE_QUEUE_FILE = 'refine-queue.json';
/** 单条记忆一次补炼里最多试几个引擎（用户拍板 D：≤3，超出即判失败，不再往下烧） */
export const REFINE_MAX_ENGINES_PER_CALL = 3;
/**
 * 每个自然日（UTC+08:00）最多补炼多少行。
 * 批次39 用户拍板 D 的正常口径是 **≤500/日**（成本闸门：补炼会真调引擎花钱）。
 * 〔批次41-I 临时放开〕为取「全量 stop_code × state 分布」以定深度档位，本轮把闸门抬到
 *   100_000（约等于不限，但保持有限值——不能用 Infinity，JSON.stringify(Infinity)=null 会让
 *   参数页卡片 `day_limit ?? 500` 谎报 500）。**pending 排空、41-I 定档完成后必须回落为 500**。
 */
export const REFINE_MAX_ROWS_PER_DAY = 100_000; // 41-I 临时值，正常口径见上行 = 500

export type RefineItemState = 'pending' | 'done' | 'failed' | 'skipped';

/**
 * 队列条目上的稳定原因码（批次40-C）。
 * `LAYER_STOP_CODES` = 阶梯为什么停在这一步；正文一个字都不落这里。
 */
export const LAYER_STOP_CODES = [
  'empty', 'too_short', 'too_long', 'missing_keyword', 'bad_prefix', 'bad_json',
  'refine_error', 'no_llm', 'no_source', 'protected', 'thin',
] as const;
export type RefineStopCode = (typeof LAYER_STOP_CODES)[number];

export interface RefineQueueItem {
  state: RefineItemState;
  /** 已尝试次数；failed 不自动重试，只由 retryFailed 显式回到 pending */
  attempts: number;
  /** 失败/跳过原因（截断后的错误文案，绝不含正文与密钥） */
  reason?: string;
  /** 批次40-C：阶梯停在哪个深层（done 的残缺行也有它，回答「为什么只炼到 L3」） */
  stop_layer?: RefineLayer;
  /** 批次40-C：停下来那个层的稳定原因码 */
  stop_code?: RefineStopCode;
  queued_at: number;
  updated_at: number;
}

export interface RefineQueueState {
  version: 1;
  /** 队列总开关：false = worker 不起活（新写入仍照常入队，等开关打开再炼） */
  enabled: boolean;
  /** 当前记账日（UTC+08:00 的 YYYY-MM-DD）与当日已补炼行数；跨日自动归零 */
  day: string;
  dayRows: number;
  items: Record<string, RefineQueueItem>;
  updated_at: number;
}

const REASON_MAX = 200;
const clampReason = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);

/** 记账日用 UTC+08:00（与全站用户可见时间同一口径），不是 UTC */
export function dayKey(now: number): string {
  const t = new Date(now + 8 * 3600_000);
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${t.getUTCFullYear()}-${mm}-${dd}`;
}

export function emptyRefineQueue(now = Date.now()): RefineQueueState {
  return { version: 1, enabled: true, day: dayKey(now), dayRows: 0, items: {}, updated_at: now };
}

/** 读回来的状态一律归一化：坏字段丢弃、未知状态按 pending、跨日把计数清零 */
export function clampRefineQueue(raw: unknown, now = Date.now()): RefineQueueState {
  const r = (raw ?? {}) as Partial<RefineQueueState>;
  const items: Record<string, RefineQueueItem> = {};
  const src = (r.items ?? {}) as Record<string, unknown>;
  for (const [id, v] of Object.entries(src)) {
    if (!id || !v || typeof v !== 'object') continue;
    const it = v as Partial<RefineQueueItem>;
    const state: RefineItemState = it.state === 'done' || it.state === 'failed' || it.state === 'skipped'
      ? it.state : 'pending';
    items[id] = {
      state,
      attempts: typeof it.attempts === 'number' && Number.isFinite(it.attempts) && it.attempts > 0 ? Math.floor(it.attempts) : 1,
      ...(typeof it.reason === 'string' && it.reason ? { reason: clampReason(it.reason) } : {}),
      ...(it.stop_layer === 'L2' || it.stop_layer === 'L3' || it.stop_layer === 'L4'
        || it.stop_layer === 'L5' || it.stop_layer === 'L6' ? { stop_layer: it.stop_layer } : {}),
      ...(typeof it.stop_code === 'string' && (LAYER_STOP_CODES as readonly string[]).includes(it.stop_code)
        ? { stop_code: it.stop_code as RefineStopCode } : {}),
      queued_at: typeof it.queued_at === 'number' ? it.queued_at : now,
      updated_at: typeof it.updated_at === 'number' ? it.updated_at : now,
    };
  }
  const day = dayKey(now);
  return {
    version: 1,
    enabled: r.enabled !== false,
    day,
    dayRows: r.day === day && typeof r.dayRows === 'number' && r.dayRows > 0 ? Math.floor(r.dayRows) : 0,
    items,
    updated_at: typeof r.updated_at === 'number' ? r.updated_at : now,
  };
}

export function loadRefineQueue(dir: string, now = Date.now()): RefineQueueState {
  try {
    return clampRefineQueue(JSON.parse(readFileSync(join(dir, REFINE_QUEUE_FILE), 'utf8')), now);
  } catch {
    return emptyRefineQueue(now);
  }
}

/** 0600 落盘（与 llm-keys.json 同先例：状态文件不进备份白名单也不带正文） */
export function saveRefineQueue(dir: string, state: RefineQueueState): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, REFINE_QUEUE_FILE), JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

/** 该行是否「有 L1 但一个深层都没有」——补炼的唯一目标形态 */
export function hasAnyDeepLayer(m: Memory): boolean {
  return [m.content_l2, m.content_l3, m.content_l4, m.content_l5, m.content_l6]
    .some((v) => typeof v === 'string' && v.trim() !== '');
}

/** 可补炼判据：未删除、有 L1、当前无任何 L2–L6 正文；pinned/locked 由调用方按受保护单独计数 */
export function isRefinable(m: Memory): boolean {
  return !m.deleted && !!m.content_l1?.trim() && !hasAnyDeepLayer(m);
}

export interface EnqueueReport {
  added: number;
  already_queued: number;
  /** 已炼好或上次失败/跳过的行：不重复入队（重复入队等于重复花钱） */
  settled: number;
  protected_skipped: number;
  /** 没有可炼输入（缺 L1）或已有深层正文 */
  not_eligible: number;
  /** 批次40-C：L1 短到连 L2 都炼不出（`depthCapFor` 给 null）→ 直接记 skipped，不起活不占额度 */
  thin_skipped: number;
}

/** 批量入队（存量补炼与采集新行共用）：只增不改，已有条目一律不覆盖状态 */
export function enqueueRows(state: RefineQueueState, memories: Memory[], now = Date.now()): { state: RefineQueueState; report: EnqueueReport } {
  const items = { ...state.items };
  const report: EnqueueReport = { added: 0, already_queued: 0, settled: 0, protected_skipped: 0, not_eligible: 0, thin_skipped: 0 };
  for (const m of memories) {
    if (!m?.mem_id) continue;
    if (m.pinned || m.locked) { report.protected_skipped++; continue; }
    if (m.deleted || !m.content_l1?.trim() || hasAnyDeepLayer(m)) { report.not_eligible++; continue; }
    const cur = items[m.mem_id];
    if (cur) {
      if (cur.state === 'pending') report.already_queued++;
      else report.settled++;
      continue;
    }
    // 批次40-C：入库门槛之上的历史短行也照样没料炼摘要——这里当场判死，不烧引擎、不占当日额度
    if (!depthCapFor(meaningfulLength(m.content_l1))) {
      items[m.mem_id] = {
        state: 'skipped', attempts: 0, reason: 'L1 有效内容不够炼 L2（料太少，硬炼只能编造）',
        stop_code: 'thin', queued_at: now, updated_at: now,
      };
      report.thin_skipped++;
      continue;
    }
    items[m.mem_id] = { state: 'pending', attempts: 0, queued_at: now, updated_at: now };
    report.added++;
  }
  return { state: { ...state, items, updated_at: now }, report };
}

/** 当日还能炼几行 */
export function dailyBudgetLeft(state: RefineQueueState, now = Date.now()): number {
  const used = state.day === dayKey(now) ? state.dayRows : 0;
  return Math.max(0, REFINE_MAX_ROWS_PER_DAY - used);
}

/** 取下一个可跑条目（插入序）；未启用 / 无 pending / 当日额度用尽 → null */
export function nextPending(state: RefineQueueState, now = Date.now()): string | null {
  if (!state.enabled) return null;
  if (dailyBudgetLeft(state, now) <= 0) return null;
  for (const [id, it] of Object.entries(state.items)) if (it.state === 'pending') return id;
  return null;
}

function settle(
  state: RefineQueueState, id: string, next: RefineItemState, now: number,
  reason?: string, countsToDaily = true, stop?: { layer?: RefineLayer; code?: RefineStopCode },
): RefineQueueState {
  const cur = state.items[id];
  const day = dayKey(now);
  // 跨日先将旧日计数归零，再决定是否 +1（漏掉这一步会把新日第一行算成 0，日额度形同虚设）
  const used = state.day === day ? state.dayRows : 0;
  // done = 这一行重新记账：上一次「为什么停在 L3」不能留着冒充本次结论；failed/skipped 保留旧原因兜底
  const carry = next === 'done' ? undefined : cur;
  const item: RefineQueueItem = {
    state: next,
    attempts: (cur?.attempts ?? 0) + 1,
    queued_at: cur?.queued_at ?? now,
    updated_at: now,
  };
  const keepReason = reason ?? carry?.reason;
  if (keepReason) item.reason = clampReason(keepReason);
  const keepLayer = stop?.layer ?? carry?.stop_layer;
  if (keepLayer) item.stop_layer = keepLayer;
  const keepCode = stop?.code ?? carry?.stop_code;
  if (keepCode) item.stop_code = keepCode;
  return { ...state, day, dayRows: countsToDaily ? used + 1 : used, updated_at: now, items: { ...state.items, [id]: item } };
}

export const markRefined = (
  s: RefineQueueState, id: string, now = Date.now(),
  stop?: { layer?: RefineLayer; code?: RefineStopCode },
): RefineQueueState => settle(s, id, 'done', now, undefined, true, stop);
export const markRefineFailed = (s: RefineQueueState, id: string, reason: string, now = Date.now(), code?: RefineStopCode): RefineQueueState => settle(s, id, 'failed', now, reason, true, code ? { code } : undefined);
export const markRefineSkipped = (s: RefineQueueState, id: string, reason: string, now = Date.now(), code?: RefineStopCode): RefineQueueState => settle(s, id, 'skipped', now, reason, false, code ? { code } : undefined);

/** 显式重试：failed → pending（用户拍板「partial 不自动重试」，所以只有这里会把失败行放回队列） */
export function retryFailed(state: RefineQueueState, now = Date.now()): { state: RefineQueueState; retried: number } {
  const items = { ...state.items };
  let retried = 0;
  for (const [id, it] of Object.entries(items)) {
    if (it.state !== 'failed') continue;
    items[id] = { ...it, state: 'pending', reason: undefined, stop_layer: undefined, stop_code: undefined, updated_at: now };
    retried++;
  }
  return { state: { ...state, items, updated_at: now }, retried };
}

/**
 * 批次41-C：把指定的 mem_id 从队列里摘掉（任意状态都摘——行没了，它的 pending/done/failed/skipped 都成了幽灵）。
 * 队列是「待炼行」的索引：删除行的通道（硬删 / 清空重采 / 规则重判）若不同步摘除，
 * 这些 id 会一直留在文件里，`summarizeRefineQueue` 把死行算进 pending/failed、`nextPending` 反复取到 no_source。
 * 只删、不新增；id 不在队列里即幂等返回 removed=0。
 */
export function removeRefineRows(state: RefineQueueState, ids: Iterable<string>, now = Date.now()): { state: RefineQueueState; removed: number } {
  const target = new Set(ids);
  let removed = 0;
  const items = { ...state.items };
  for (const id of target) if (id in items) { delete items[id]; removed++; }
  return { state: removed ? { ...state, items, updated_at: now } : state, removed };
}

/**
 * 批次41-C：按「当前仍活着的行」对账，摘掉所有账本里已不存在的条目（一次性自净，
 * 覆盖任何删除通道遗留的幽灵，含启动前就攒下的存量）。`liveIds` = 未删除行的 mem_id 集合。
 */
export function reconcileRefineQueue(state: RefineQueueState, liveIds: Iterable<string>, now = Date.now()): { state: RefineQueueState; pruned: number } {
  const live = new Set(liveIds);
  const dead = Object.keys(state.items).filter((id) => !live.has(id));
  if (dead.length === 0) return { state, pruned: 0 };
  const { state: next, removed } = removeRefineRows(state, dead, now);
  return { state: next, pruned: removed };
}

/**
 * 批次41-H：把「对账 → 只在真摘到幽灵才落盘」的判定收成纯函数，主进程 `reconcileRefineQueueDir`
 * 调用它——接线级测试直接覆盖「dir 未就绪不碰盘 / 无幽灵不落盘（幂等）/ 有幽灵才 save」三条分支。
 * `load`/`save` 由调用方注入（主进程 = `loadRefineQueue`/`saveRefineQueue`），本模块不碰文件系统。
 */
export function reconcileAndPersistRefineQueue(opts: {
  queueDir: string | null;
  liveIds: Iterable<string>;
  now?: number;
  load: () => RefineQueueState;
  save: (state: RefineQueueState) => void;
}): { pruned: number; persisted: boolean; state: RefineQueueState | null } {
  const { queueDir, liveIds, now = Date.now(), load, save } = opts;
  if (!queueDir) return { pruned: 0, persisted: false, state: null };
  const { state, pruned } = reconcileRefineQueue(load(), liveIds, now);
  if (pruned > 0) { save(state); return { pruned, persisted: true, state }; }
  return { pruned: 0, persisted: false, state: null };
}

/**
 * 批次41-H：单条硬删后「只摘这一个 id + 仅在真摘到才落盘」的判定，主进程 `removeRefineQueueRow`
 * 调用（热路径不做全量对账；`id` 不在队列则幂等、不落盘、不记 updated_at）。
 */
export function removeRefineQueueRowAndPersist(opts: {
  queueDir: string | null;
  id: string;
  now?: number;
  load: () => RefineQueueState;
  save: (state: RefineQueueState) => void;
}): { removed: number; persisted: boolean; state: RefineQueueState | null } {
  const { queueDir, id, now = Date.now(), load, save } = opts;
  if (!queueDir || !id) return { removed: 0, persisted: false, state: null };
  const { state, removed } = removeRefineRows(load(), [id], now);
  if (removed > 0) { save(state); return { removed, persisted: true, state }; }
  return { removed: 0, persisted: false, state: null };
}

export interface RefineQueueSummary {
  enabled: boolean;
  pending: number;
  done: number;
  failed: number;
  skipped: number;
  day: string;
  day_rows: number;
  day_limit: number;
  /** 当日还能炼几行（0 = 今天不再起活，明天自动恢复） */
  day_left: number;
  max_engines_per_call: number;
  /**
   * 批次40-C：阶梯停在哪个原因码的行数分布（done/failed/skipped 都计入）。
   * UI 用它回答「为什么这一行只炼到 L2」，而不是只报「炼完了 N 行」。
   */
  stop_codes: Record<string, number>;
  updated_at: number | null;
  queue_path: string;
}

export function summarizeRefineQueue(state: RefineQueueState, queuePath: string, now = Date.now()): RefineQueueSummary {
  const counts = { pending: 0, done: 0, failed: 0, skipped: 0 };
  const stopCodes: Record<string, number> = {};
  for (const it of Object.values(state.items)) {
    counts[it.state]++;
    if (it.state !== 'pending' && it.stop_code) stopCodes[it.stop_code] = (stopCodes[it.stop_code] ?? 0) + 1;
  }
  const day = dayKey(now);
  const used = state.day === day ? state.dayRows : 0;
  return {
    enabled: state.enabled,
    pending: counts.pending,
    done: counts.done,
    failed: counts.failed,
    skipped: counts.skipped,
    day,
    day_rows: used,
    day_limit: REFINE_MAX_ROWS_PER_DAY,
    day_left: Math.max(0, REFINE_MAX_ROWS_PER_DAY - used),
    max_engines_per_call: REFINE_MAX_ENGINES_PER_CALL,
    stop_codes: stopCodes,
    updated_at: state.updated_at,
    queue_path: queuePath,
  };
}

/**
 * 把一行补炼的结果落成队列状态（主进程 worker 与测试共用这一条判定，不在 worker 里各写一份）：
 * 成功 → done；没得炼（缺 L1 / 受保护 / 料太短）→ skipped（不占当日额度）；炼不出来 → failed（占额度：调用真发生了）。
 * 批次40-C：done 也要把「阶梯停在哪一层、什么原因码」记下来，否则用户只能看到「炼完了」而不知道为何只有 L2。
 */
export function settleRowOutcome(
  state: RefineQueueState,
  mem_id: string,
  r: Pick<RefineRowResult, 'ok' | 'code' | 'error' | 'stop_layer' | 'stop_code'>,
  now = Date.now(),
): RefineQueueState {
  if (r.ok) return markRefined(state, mem_id, now, { layer: r.stop_layer, code: r.stop_code });
  // 这三类是「这一行本身没得炼」：不占额度、放回队列也没用（no_llm 不在此列——引擎回来就该重试）
  if (r.code === 'no_source' || r.code === 'protected' || r.code === 'thin') {
    return markRefineSkipped(state, mem_id, r.error ?? r.code, now, r.code);
  }
  return markRefineFailed(state, mem_id, r.error ?? r.code ?? '未知失败', now, r.stop_code);
}

// ── 单行补炼（worker 每轮调一次；与正常写入管道同源，不复制实现）────────────────

export interface RefineRowCtx {
  storage: StorageBackend;
  /** 进程内向量索引：补炼只改 `layer` 元数据（L1 不动 → 向量原样保留） */
  vector?: VectorBackend;
  llm?: LlmProvider;
  llmModel?: string;
  request_id: string;
  now: number;
  /** 审计署名：后台队列没有会话，固定记队列自身的身份，绝不冒充某个用户点了什么 */
  actor: string;
}

export interface RefineRowResult {
  mem_id: string;
  /** false = 这一行没写成（没产出任何深层 / 被保护 / 缺 L1 / 调用失败） */
  ok: boolean;
  layers: RefineLayer[];
  /** 批次40-C：写进行上 `layer` 的那一层（有 L6 判不了深度，见 `headlineLayer`） */
  to_layer: RefineLayer;
  /** 批次40-C：这一行按 L1 的料**应当**炼到的层（写进审计，回答「为什么只到 L3」） */
  targets?: RefineLayer[];
  refined_by: 'stub' | 'llm' | 'llm_partial';
  llm_calls: number;
  /** 阶梯停在哪个深层（done 的残缺行也有） */
  stop_layer?: RefineLayer;
  /** 停下来的稳定原因码 */
  stop_code?: RefineStopCode;
  /** no_source / protected / no_llm / thin / refine_error / spec_violation */
  code?: 'no_source' | 'protected' | 'no_llm' | 'thin' | 'refine_error' | 'spec_violation';
  error?: string;
  /** 判废层的完整原因码（只到审计，不进正文） */
  violations?: LayerViolation[];
}

/**
 * 用行上**已有的 L1** 补炼 L2–L6：输入只能是上一层（§2.2 不变量 1），
 * L0 原文一次都不上送；每层产物过 `checkLayerSpecDetailed`，不合规格即阶梯停止。
 * 批次40-C 的两条新口径：
 * 1. **深度按料给**——最深只到 `depthCapFor(L1 有效字数)`，短记忆不再被要求编出五层；
 * 2. **L6 是独立通道**——中间层判废也要跳到 L6 再试一次（索引不吃上游连续性，到手的检索键不该陪葬）。
 * 与批次37-E 重建的区别：这里**不动 L1、不动正文来源、不做质量门重判**，所以不需要备份、不碰游标。
 * 一行都没炼出来就不写行（宁可原样留着，绝不把 `layers_generated_at` 刷成今天来冒充进度）。
 */
export async function refineRowLayers(mem_id: string, ctx: RefineRowCtx): Promise<RefineRowResult> {
  const { storage, request_id, now } = ctx;
  const m = await storage.getMemory(mem_id);
  const base: RefineRowResult = { mem_id, ok: false, layers: ['L1'], to_layer: 'L1', refined_by: 'stub', llm_calls: 0 };
  if (!m || m.deleted || !m.content_l1?.trim()) return { ...base, code: 'no_source', error: '该行没有可炼的 L1（或已删除）', stop_code: 'no_source' };
  if (m.pinned || m.locked) return { ...base, code: 'protected', error: 'pinned/locked 行不补炼', stop_code: 'protected' };

  const targets = targetLayers(meaningfulLength(m.content_l1));
  if (targets.length <= 1) {
    return { ...base, code: 'thin', error: 'L1 有效内容不够炼 L2（料太少，硬炼只能编造）', stop_code: 'thin', targets };
  }
  const generator = makeLayerGenerator(ctx.llm, ctx.llmModel, m.category, request_id);
  if (!generator.canLlm) return { ...base, code: 'no_llm', error: '没有可用的真实 LLM 引擎（未启用 / 未拨通 / 未配密钥）', targets, stop_code: 'no_llm' };

  const generated: Partial<Record<RefineLayer, string>> = { L1: m.content_l1 };
  const violations: LayerViolation[] = [];
  let error: string | undefined;
  let stopLayer: RefineLayer | undefined;
  let stopCode: RefineStopCode | undefined;
  for (let i = 1; i < targets.length; i++) {
    const layer = targets[i];
    const upstream = layer === 'L6' ? buildL6Input(generated) : generated[targets[i - 1]];
    if (!upstream) break;
    let out = '';
    try {
      out = await generator.call(layer, upstream);
    } catch (e) {
      error = String((e as Error)?.message ?? e).slice(0, REASON_MAX);
      stopLayer = layer;
      stopCode = 'refine_error';
      break;  // 传输失败 = 这一行的引擎预算已用完，不再往下烧
    }
    const bad = checkLayerSpecDetailed(layerSpecOf(layer), out, upstream);
    if (bad.length > 0) {
      violations.push(...bad);
      stopLayer = layer;
      stopCode = bad[0].code;
      // L6 独立通道：中间层判废也要跳过去试一次索引
      const l6 = targets.indexOf('L6');
      if (layer !== 'L6' && l6 > i) { i = l6 - 1; continue; }
      break;
    }
    generated[layer] = out;
  }

  const produced = LAYER_ORDER.filter((id) => generated[id] !== undefined);
  const llmCalls = generator.calls();
  if (produced.length <= 1) {    return {
      ...base, llm_calls: llmCalls, targets, stop_layer: stopLayer, stop_code: stopCode ?? (error ? 'refine_error' : 'empty'),
      violations: violations.length ? violations : undefined,
      code: error ? 'refine_error' : 'spec_violation',
      error: error ?? '首层（L2）就没有产出：模型答复不合规格或为空',
    };
  }
  const deepest = headlineLayer(produced, targets);
  const mainContent = generated[deepest]!;
  // 批次40-C：llm = 本行该炼的层全炼到了（深度按料给）；提前停在中间层才算残缺
  const refinedBy: 'stub' | 'llm' | 'llm_partial' = isFullyRefined(produced, targets) ? 'llm' : 'llm_partial';

  await storage.putMemory({
    ...m,
    layer: deepest,
    content: mainContent,
    content_l2: generated.L2,
    content_l3: generated.L3,
    content_l4: generated.L4,
    content_l5: generated.L5,
    content_l6: generated.L6,
    refined_by: refinedBy,
    layer_specs: layerSpecsFrom(generated),
    layers_generated_at: now,
    version: m.version + 1,
    updated_at: now,
    sha256: sha256hex(mainContent),
  });
  // L1 未变 → 向量原样有效，只刷新索引里的 layer 元数据
  if (ctx.vector) await ctx.vector.upsert(m.mem_id, m.content_l1, { project_id: m.project_id, layer: deepest });

  // 审计只记层名、原因码与计数：新正文一个字都不进账本
  await storage.appendAudit({
    request_id, action: 'memory_op', user_id: ctx.actor, ts: now, project_id: m.project_id,
    detail: {
      op: 'layer_refine', actor: ctx.actor, mem_id,
      from_layer: m.layer, to_layer: deepest, layers: produced, targets,
      refined_by: refinedBy, llm_calls: llmCalls,
      ...(stopLayer ? { stop_layer: stopLayer } : {}),
      ...(stopCode ? { stop_code: stopCode } : {}),
      ...(violations.length ? { violation_codes: violations.map((v) => `${v.layer}:${v.code}`) } : {}),
      ...(error ? { refine_error: error } : {}),
    },
  });

  return {
    mem_id, ok: true, layers: produced, to_layer: deepest, targets, refined_by: refinedBy, llm_calls: llmCalls,
    ...(stopLayer ? { stop_layer: stopLayer } : {}),
    ...(stopCode ? { stop_code: stopCode } : {}),
    ...(violations.length ? { violations } : {}),
    ...(error ? { code: 'refine_error' as const, error } : {}),
  };
}
