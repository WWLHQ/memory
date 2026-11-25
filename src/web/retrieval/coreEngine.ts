// REQ-012 接真内核引擎（T7）：与 fakeEngine 同签名（async），内部走 memagent-core ma.recall
// 数据源 = 内核 InMemoryStorage（禁止注入种子；空库即无命中，返回 EMPTY 态）；UI 类型/横幅/预算语义不变。
import type { BudgetData, ModeBannerData, RetrievalHit, Scene, ModeSel, RecallHistoryRow, RecentRecallRow } from './types.ts';
import { budgetLevel, resolveSceneBudget, sortHits, freshness, approxTokens } from './logic.ts';
import type { Memory, RecallReq } from '../../core/memagent/types.ts';
import type { MemAgent } from '../../core/memagent/types.ts';
import { getKernel, getKernelStorage } from '../kernel.ts';
import { DEFAULT_PROJECT_ID, listProjectIds } from '../shared/kernelProjects.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';

export interface EngineResult {
  hits: RetrievalHit[];
  banner: ModeBannerData;
  budget: BudgetData;
  evidence_thin: 'none' | 'backfill_hit' | 'backfill_miss';
  breach: boolean;
  /** 本次真实墙钟耗时（毫秒） */
  latency_ms: number;
  /** 本次查询条注入深度选择 */
  depth: string;
}

/** 查询条可选参数（预算 / 深度）；缺省时行为与旧签名完全一致 */
export interface EngineOptions {
  /** 预算（tokens）；给定时按分数顺序真实裁剪注入集，命中仍全部展示 */
  budgetTokens?: number;
  /** 注入深度：仅影响展示口径，注入纪律始终只 L1 */
  depth?: string;
}

const DAY = 24 * 3600 * 1000;

function getStorage(): StorageBackend {
  return getKernelStorage();
}

/** 内核单例由 kernel.ts 收敛；模型配置变更会重建单例，此处不得再缓存旧实例 */
function getAgent(): Promise<MemAgent> {
  return Promise.resolve(getKernel());
}

/**
 * Hit → RetrievalHit 映射：真实字段优先（importance/confidence/half_life/tags/created_at），
 * 冷/归档/休眠层或 L2 层 → l2_only=true；无种子兜底。
 */
function toRetrievalHit(
  h: { mem_id: string; content: string; layer?: string; decay_class: string; pinned: boolean; locked: boolean; score: number },
  mem: Memory | null,
): RetrievalHit {
  const now = Date.now();
  const lastAccess = mem?.last_access_time ?? mem?.created_at ?? now;
  const age_days = Math.max(0, Math.round((now - lastAccess) / DAY));
  const decayClass = h.decay_class as RetrievalHit['decay_class'];
  // R2：cold/archived/dormant 仅 L2 摘要占位
  const l2_only = decayClass === 'cold' || decayClass === 'archived' || decayClass === 'dormant';
  const half_life_days = mem?.half_life_days ?? 30;
  return {
    memory_id: h.mem_id,
    content: h.content,
    l2_only,
    decay_class: decayClass,
    pinned: h.pinned,
    locked: h.locked,
    freshness: freshness(age_days, half_life_days),
    importance: mem?.importance ?? 0.5,
    confidence: mem?.confidence ?? 0.5,
    score: h.score,
    project_id: mem?.project_id,
    layer: h.layer ?? mem?.layer,
    tags: mem?.tags ?? [],
    conflict_note: mem?.conflict_id ? `[冲突] ${mem.conflict_id}` : undefined,
    age_days,
    half_life_days,
  };
}

/**
 * 按 mem_id 从真实账本取完整记忆（用于补 importance/confidence/tags 等 Hit 未携带字段）。
 * 空库返回 null，不伪造数据。
 */
async function loadMemByMids(mids: string[]): Promise<Map<string, Memory | null>> {
  if (mids.length === 0) return new Map();
  const mems = await getStorage().listMemories({});
  const idx = new Map(mems.map((m) => [m.mem_id, m] as const));
  const out = new Map<string, Memory | null>();
  for (const mid of mids) out.set(mid, idx.get(mid) ?? null);
  return out;
}

/** 检索结果「记住 / 忘记」：真走内核 17.3 操作（remember/forget 提升或降低权重并记 memory_op 审计） */
export async function coreReorderMemory(memId: string, op: 'remember' | 'forget'): Promise<{ ok: boolean; blocked_locked: boolean }> {
  const ma = await getAgent();
  const r = await ma._memoryOp(memId, op);
  return { ok: r.ok, blocked_locked: Boolean(r.blocked_locked) };
}

/** 批次48 A26：项目范围 —— 'all' = 全部真实项目（默认），其余 = 指定项目 */
export const ALL_PROJECTS_SCOPE = 'all';

export async function coreEngine(
  query: string,
  scene: Scene,
  modeSel: ModeSel,
  _requestId: string,
  projectScope: string = ALL_PROJECTS_SCOPE,
  opts: EngineOptions = {},
): Promise<EngineResult> {
  const started = Date.now();
  const depth = opts.depth ?? 'L1';
  const ma = await getAgent();
  const table = resolveSceneBudget(scene);

  // 内核 recall（17.5/17.8 打分 + pinned 免检 + 冷层补查 + critical 禁 minimal）
  // A6：scene 原样下传——内核 Scene 已含 history_query（A1 补齐），不再把它降级成 default。
  // 降级会让「历史查询」这个场景在内核侧根本不存在，分流必然落到 default 的候选集上。
  const coreScene: Scene = scene;
  // 批次48 A26：项目范围。默认「全部项目」——逐个项目真实召回后合并，绝不静默丢弃其它项目命中；
  // 单项目场景下 all ≡ 该项目，行为与原先一致。空账本回落 DEFAULT_PROJECT_ID 占位（A10）。
  const projects = await listProjectIds();
  const scopes: string[] = projectScope === ALL_PROJECTS_SCOPE
    ? (projects.length > 0 ? projects : [DEFAULT_PROJECT_ID])
    : [projectScope];
  const recalls = await Promise.all(scopes.map((project_id) => {
    const req: RecallReq = { query, project_id, scene: coreScene, mode: modeSel, top_k: 5 };
    return ma.recall(req);
  }));
  // 合并命中（按 mem_id 去重；同时记下每条命中的来源项目，供结果行标注）
  const mergedHits = new Map<string, { hit: (typeof recalls)[number]['hits'][number]; project_id: string }>();
  recalls.forEach((rr, i) => {
    for (const h of rr.hits) {
      if (!mergedHits.has(h.mem_id)) mergedHits.set(h.mem_id, { hit: h, project_id: scopes[i] ?? DEFAULT_PROJECT_ID });
    }
  });
  const r = recalls[recalls.length - 1] ?? null;
  const hitList = [...mergedHits.values()];

  const memByMid = await loadMemByMids(hitList.map((v) => v.hit.mem_id));
  const hits: RetrievalHit[] = hitList.map((v) => {
    const mapped = toRetrievalHit(v.hit, memByMid.get(v.hit.mem_id) ?? null);
    return { ...mapped, project_id: mapped.project_id ?? v.project_id };
  });
  const ordered = sortHits(hits);

  // 预算真实裁剪：按分数顺序累计 L1 近似 token，超出预算的命中不计入注入集（结果仍全部展示）
  let injectedTokens = 0;
  let injectedCount = 0;
  for (const h of ordered) {
    const t = approxTokens(h.content);
    if (opts.budgetTokens !== undefined && injectedTokens + t > opts.budgetTokens) continue;
    injectedTokens += t;
    injectedCount += 1;
  }
  const droppedCount = Math.max(0, ordered.length - injectedCount);

  const payload = recalls.reduce((sum, rr) => sum + rr.payload_tokens, 0);
  const breach = budgetLevel(payload) === 'breach';
  // 漏斗/裁剪明细口径：全部取内核真实计数，不在这里估。
  // 扫描 = 逐项目 scanned_memories 求和（「本轮扫了多少条」）；背景 = 逐项目 background 求和；
  // 注入总量 = 内核 savings.injected_tokens 求和（= payload + 背景，永不超过硬熔断）。
  const scannedTotal = recalls.reduce((sum, rr) => sum + (rr.scanned_memories ?? 0), 0);
  const backgroundTokens = recalls.reduce((sum, rr) => sum + (rr.background?.tokens ?? 0), 0);
  const backgroundCount = recalls.reduce((sum, rr) => sum + (rr.background?.candidates ?? 0), 0);
  const injectedTotal = recalls.reduce((sum, rr) => sum + (rr.savings?.injected_tokens ?? rr.payload_tokens), 0);

  // 2.4.3 逃生阀：任一项目触发过补查 → 合并后按是否有命中归档
  const anyThin = recalls.some((rr) => rr.evidence_thin);
  const evidence_thin: EngineResult['evidence_thin'] = anyThin
    ? (ordered.length > 0 ? 'backfill_hit' : 'backfill_miss')
    : 'none';

  // A6（消除第三套口径）：模式 / 命中词 / 次模式一律取内核 RecallResult，Web 不再自己算。
  // 同一 query + scene 下 resolveMode 是纯函数，逐项目结论必然一致，故取第一条带 dispatch 的即可；
  // 找不到时退回 modeSel（手动）或 scene 表默认（仅类型收敛，实际内核项目召回必带 dispatch）。
  const primary = recalls.find((rr) => rr.dispatch !== null) ?? r;
  const disp = primary?.dispatch ?? null;
  const appliedMode: ModeBannerData['mode'] = disp
    ? (disp.applied === 'auto' ? disp.suggested : disp.applied)
    : (modeSel ?? table.defaultMode);

  const banner: ModeBannerData = {
    scene,
    mode: appliedMode,
    fallback: !modeSel,
    hit_keywords: primary?.hit_keywords ?? [],
    // A6：次模式提示来自内核真实产出（A5 的 secondary_mode_hint），不再写死「极简 200t」
    secondary_mode_hint: primary?.secondary_mode_hint
      ? {
          mode: primary.secondary_mode_hint.mode,
          note: primary.secondary_mode_hint.note ?? '次模式参考摘要（未并入命中、不计入 payload）',
          content: primary.secondary_mode_hint.content,
        }
      : null,
    dispatch: disp,
    // 多项目合并：banner 的 dispatch / hit_keywords / 次模式都取自 primary，
    // request_id 必须同源，否则点「按 id 查审计」回放的是另一条链路，展示与审计对不上。
    request_id: primary?.request_id ?? r?.request_id ?? _requestId,
    evidence_thin,
    cold_recall: evidence_thin === 'backfill_hit',
  };

  const budget: BudgetData = {
    payload_tokens: payload,
    // 本地 rerank（规则排序），无 LLM 消耗；不再写死 640
    pipeline_llm_tokens: 0,
    stage1_count: ordered.length,
    stage2_count: Math.min(5, ordered.length),
    rerank_applied: table.rerank === true,
    budget_breach: budgetLevel(payload) !== 'ok',
    // 真实 breach 时由核心引擎补充明细；不写死估算文案
    breach_detail: undefined,
    budget_tokens: opts.budgetTokens,
    injected_tokens: injectedTokens,
    injected_count: injectedCount,
    dropped_count: droppedCount,
    depth,
    scanned_count: scannedTotal,
    background_tokens: backgroundTokens,
    background_count: backgroundCount,
    injected_total_tokens: injectedTotal,
    trimmed_tokens: recalls.reduce((sum, rr) => sum + (rr.savings?.budget_trimmed_tokens ?? 0), 0),
  };

  return { hits: ordered, banner, budget, evidence_thin, breach, latency_ms: Date.now() - started, depth };
}

/** 账本里最近一次真实召回的快照（右侧栏在「本次还没检索」时用它，保证面板里没有一处是空占位） */
export interface LastRecallSnapshot {
  data: BudgetData;
  ts: number;
  request_id: string;
  scene: string;
  mode: string;
  query: string;
}

/**
 * 取最近一次 recall 审计行，按同一套口径还原成右侧栏结构。
 * 审计没写的字段（如注入条数、未注入条数）一律留 undefined —— 由 UI 决定「不渲染这一行」，
 * 绝不拿命中数冒充注入条数、也不写「—」冒充读数。
 */
export async function coreLastRecall(): Promise<LastRecallSnapshot | null> {
  const rows = await getStorage().queryAudit({ action: 'recall' });
  const latest = rows.slice().sort((a, b) => b.ts - a.ts)[0];
  if (!latest) return null;
  const d = latest.detail as Record<string, unknown>;
  const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : undefined);
  const hits = num('hits') ?? 0;
  const payload = num('payload_tokens') ?? 0;
  const background = num('background_tokens') ?? 0;
  const trimmed = num('budget_trimmed_tokens');
  return {
    ts: latest.ts,
    request_id: latest.request_id,
    scene: typeof d.scene === 'string' ? d.scene : 'default',
    mode: typeof d.mode === 'string' ? d.mode : 'auto',
    query: typeof d.query === 'string' ? d.query : '',
    data: {
      payload_tokens: payload,
      pipeline_llm_tokens: num('pipeline_llm_tokens') ?? 0,
      stage1_count: hits,
      stage2_count: hits,
      rerank_applied: false,
      budget_breach: (trimmed ?? 0) > 0,
      budget_tokens: 3000,
      // 审计不记录「注入条数」，这里不填 —— 面板据此不渲染该行，而不是拿命中数冒充
      injected_count: undefined,
      injected_tokens: undefined,
      dropped_count: undefined,
      scanned_count: num('scanned_memories'),
      background_tokens: background,
      injected_total_tokens: num('injected_tokens') ?? payload + background,
      trimmed_tokens: trimmed,
    },
  };
}

/**
 * 最近召回时间线（右侧栏）：只取账本 recall 审计行，按时间倒序。
 * 「今日 N 次」按**北京时间自然日**归属（跨项目长期约定），不按 UTC 也不按本机时区。
 * 注入量取审计里的 injected_tokens（payload + 背景的真实值）；旧行缺该字段时如实回落到 payload_tokens。
 */
export async function coreRecentRecalls(limit = 5): Promise<{ rows: RecentRecallRow[]; today: number }> {
  const rows = await getStorage().queryAudit({ action: 'recall' });
  const start = beijingDayStart(Date.now());
  const now = Date.now();
  const today = rows.filter((a) => a.ts >= start && a.ts <= now).length;
  const mapped = rows
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .map((a) => {
      const d = a.detail as Record<string, unknown>;
      const hits = typeof d.hits === 'number' ? d.hits : 0;
      const injected = typeof d.injected_tokens === 'number' ? d.injected_tokens : (typeof d.payload_tokens === 'number' ? d.payload_tokens : 0);
      return {
        request_id: a.request_id,
        ts: a.ts,
        query: typeof d.query === 'string' ? d.query : '（未记录查询词）',
        hits,
        injected_tokens: injected,
      };
    });
  return { rows: mapped, today };
}

/** 北京时间当日 00:00 的毫秒时间戳（UTC+08:00，跨项目约定：日期归属一律按北京时） */
export function beijingDayStart(now: number): number {
  const OFFSET = 8 * 3600 * 1000;
  const shifted = now + OFFSET;
  return Math.floor(shifted / 86400000) * 86400000 - OFFSET;
}

/**
 * 检索历史 = 账本审计 action=recall 的真实记录（最近 N 条）。
 * 缺字段（旧行没写 latency_ms 等）如实留空，不用演示值补齐。
 */
export async function coreRecallHistory(limit = 10): Promise<RecallHistoryRow[]> {
  const rows = await getStorage().queryAudit({ action: 'recall' });
  return rows
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .map((a) => {
      const d = a.detail as Record<string, unknown>;
      return {
        request_id: a.request_id,
        ts: a.ts,
        query: typeof d.query === 'string' ? d.query : '无',
        scene: typeof d.scene === 'string' ? d.scene : '无',
        mode: typeof d.mode === 'string' ? d.mode : '无',
        hits: typeof d.hits === 'number' ? d.hits : 0,
        payload_tokens: typeof d.payload_tokens === 'number' ? d.payload_tokens : 0,
        latency_ms: typeof d.latency_ms === 'number' ? d.latency_ms : null,
        evidence_thin: d.evidence_thin === true,
      };
    });
}
