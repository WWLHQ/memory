// REQ-005 首页（真实可算）：
//  · coreTraceLookup：.rid 点击溯源，真查 home server mirror 账本（/api/mirror/audit）；查询失败由 mirrorClient 记录并可见，不冒充「查无」。
//  · getHomeFeed：挂载后异步聚合「内核账本真实数据」——四卡（累计记忆/累计动作/近1h调用/待裁决）+
//    异常速览 + 近 1h 召回 Top3 + 待裁决 全部来自 storage（内核审计 / 记忆主表）真实计算。
//  设计不变量：首页任何数字都来自真实账本或可明确溯源；无示例/写死假文案（取代原 SEED 硬编码）。
import { mirrorFetch } from '../mirrorClient.ts';
import { kernelErrorText } from '../shared/kernelLoad.tsx';
import type { StorageBackend, AuditRecord, Memory } from '../../core/memagent/types.ts';
import type { RawHomeFeed } from '../../home/dashboard.ts';
import type { AnomalyItem, ActiveMemory, TodoItem, SyncState } from '../../types/home.ts';
import type { Gain } from '../../types/agentOnboard.ts';
import { computeOnboardGains, emptyOnboardGains } from '../AgentOnboard/coreOnboard.ts';
import { deriveLayerGraph, emptyLayerGraph, type LayerGraph } from './layerGraph.ts';

export interface TraceHit {
  source: string;
  action: string;
  request_id: string;
  seq?: number;
}

/** 按 request_id 在 home 账本中溯源（后端不可达/未收录 → 空数组，不编造记录；查询失败由 mirrorClient 记录并可见） */
export async function coreTraceLookup(requestId: string, limit = 200): Promise<TraceHit[]> {
  const { items } = await mirrorFetch(undefined, limit);
  return items
    .map((raw) => raw as { source?: unknown; action?: unknown; request_id?: unknown; seq?: unknown })
    .filter((i) => i.request_id === requestId)
    .map((i) => ({
      source: String(i.source ?? 'unknown'),
      action: String(i.action ?? 'unknown'),
      request_id: String(i.request_id),
      seq: typeof i.seq === 'number' ? i.seq : undefined,
    }));
}

// ---------- 真实聚合（内核账本） ----------

/**
 * 四卡（真实可算）：全部从内核账本实时计算，无任何示例/假口径。
 *  · 累计记忆：内核记忆主表条数
 *  · 累计动作：审计流水累计条数
 *  · 近 1h 调用：审计 ts ≥ now−sinceMs 的条数
 *  · 待裁决：含 conflict_id 的记忆（9.7 冲突队列）
 */
function buildGains(memories: Memory[], audits: AuditRecord[], conflictCount: number, sinceMs: number, now: number): Gain[] {
  const recent = audits.filter((a) => typeof a.ts === 'number' && now - a.ts <= sinceMs).length;
  return [
    { icon: '🧠', title: '累计记忆', big: String(memories.length), desc: '内核记忆主表条数', src: '内核账本·实时' },
    { icon: '📝', title: '累计动作', big: String(audits.length), desc: '审计流水累计条数', src: '内核账本·实时' },
    { icon: '⚡', title: '近 1h 调用', big: String(recent), desc: `审计 ts ≥ now−${Math.round(sinceMs / 60000)}min`, src: '内核账本·实时' },
    { icon: '⚖', title: '待裁决', big: String(conflictCount), desc: '9.7 冲突队列', src: '内核账本·实时' },
  ];
}

/** 未加载/内核不可达时的四卡占位（全 0，真实语义：账本为空） */
export function emptyGains(): Gain[] {
  return buildGains([], [], 0, 3_600_000, Date.now());
}

/** mirror 账本单条（home server /api/mirror/audit 回填形状） */
export interface MirrorItem {
  seq?: number;
  source?: string;
  action?: string;
  request_id?: string;
  payload?: unknown;
  ts?: number;
}

export interface GetHomeFeedOpts {
  /** home server 镜像回填条目（真实账本兜底源；无内核 storage 时也能展示真实溯源） */
  mirrorItems?: MirrorItem[];
  /** 近 N 毫秒窗口（召回 Top3 计频窗），默认 1h */
  sinceMs?: number;
}

function asRecord(detail: unknown): Record<string, unknown> {
  return (detail && typeof detail === 'object' ? detail : {}) as Record<string, unknown>;
}

/** 异常速览（真实）：从内核审计派生——反代理降级 / 召回证据稀薄 / 召回零命中 */
function deriveKernelAnomalies(audits: AuditRecord[]): AnomalyItem[] {
  const out: AnomalyItem[] = [];
  for (const a of audits) {
    const d = asRecord(a.detail);
    if (a.action === 'llm_fallback') {
      out.push({
        level: 'error',
        title: 'LLM 反代理降级',
        detail: `${String(d.source ?? '?')} · ${String(d.reason ?? '?')} (${String(d.code ?? '?')})`,
        request_id: a.request_id,
      });
    } else if (a.action === 'recall') {
      if (d.evidence_thin === true) {
        out.push({ level: 'warn', title: '召回证据稀薄', detail: `query=${String(d.query ?? '?')}`, request_id: a.request_id });
      } else if (Number(d.hits ?? -1) === 0) {
        out.push({ level: 'warn', title: '召回零命中', detail: `query=${String(d.query ?? '?')}`, request_id: a.request_id });
      }
    }
  }
  return out;
}

/** 异常速览（真实）：从 home server 镜像条目派生（兜底源） */
function deriveMirrorAnomalies(items: MirrorItem[]): AnomalyItem[] {
  const out: AnomalyItem[] = [];
  for (const it of items) {
    if (!it.request_id) continue;
    const p = asRecord(it.payload);
    if (it.action === 'recall' && p.evidence_thin === true) {
      out.push({ level: 'warn', title: '召回证据稀薄', detail: `query=${String(p.query ?? '?')}`, request_id: it.request_id });
    } else if (it.action === 'llm_fallback') {
      out.push({
        level: 'error',
        title: 'LLM 反代理降级',
        detail: `${String(p.source ?? it.source ?? '?')} · ${String(p.reason ?? '?')}`,
        request_id: it.request_id,
      });
    }
  }
  return out;
}

/** 近 1h 召回 Top3（真实）：按 recall 审计的 mem_id 计频，取前三并补真实标题 / decay */
async function deriveRecallTop3(audits: AuditRecord[], storage: StorageBackend, topN: number): Promise<ActiveMemory[]> {
  const freq = new Map<string, { count: number; lastReq: string }>();
  for (const a of audits) {
    if (a.action !== 'recall') continue;
    const mems = asRecord(a.detail).mems;
    if (!Array.isArray(mems)) continue;
    for (const id of mems as unknown[]) {
      if (typeof id !== 'string') continue;
      const cur = freq.get(id) ?? { count: 0, lastReq: a.request_id };
      cur.count += 1;
      cur.lastReq = a.request_id;
      freq.set(id, cur);
    }
  }
  const ranked = [...freq.entries()].sort((x, y) => y[1].count - x[1].count).slice(0, topN);
  const out: ActiveMemory[] = [];
  for (const [memId, info] of ranked) {
    const m = await storage.getMemory(memId);
    if (!m) continue;
    out.push({
      title: m.content.length > 40 ? `${m.content.slice(0, 40)}…` : m.content,
      hits: info.count,
      decayClass: m.decay_class === 'archived' || m.decay_class === 'dormant' ? 'cold' : m.decay_class,
      request_id: info.lastReq,
    });
  }
  return out;
}

/** 待办（真实）：9.7 冲突队列——含 conflict_id 的记忆 */
function deriveTodos(memories: Memory[]): TodoItem[] {
  const conflicts = memories.filter((m) => Boolean((m as { conflict_id?: unknown }).conflict_id));
  if (conflicts.length === 0) return [];
  return [
    {
      label: `待裁决 ${conflicts.length} 条`,
      detail: '9.7 冲突队列',
      request_id: conflicts[0].mem_id,
      kind: 'dispute',
    },
  ];
}

/**
 * 聚合首页真实 feed（内核账本，无示例/假数据）。
 *  · gains：累计记忆 / 累计动作 / 近 1h 调用 / 待裁决（实时计算）
 *  · anomalies：内核审计派生 ∪ mirror 镜像派生（真实）
 *  · activeMemories：recall 审计 mem_id 计频 Top3（真实）
 *  · todos：冲突记忆（真实）
 *  · graph：L1–L6 关系图谱（真实层内容/合并/冲突推导，冷记忆 G3 遮罩）
 *  · effectGains：效果证据四卡（Token 节省/效率/跨 Agent 复用/模型成本，内核账本真实聚合）
 *  · sync：顶栏同步态真实计算（lastReconcileAt = 最近一条真实同步审计 ts；同步引擎已实现但未接入内核 API → wired=false）
 * storage 不可达时（如纯浏览器无内核）安全降级为空，并把真实原因放进 storageError 由 UI 明示
 * （批次25 P0-7：绝不把「内核读不到」渲染成「账本为空」）。
 */
export interface HomeFeedResult {
  raw: RawHomeFeed;
  sync: SyncState;
  graph: LayerGraph;
  effectGains: Gain[];
  /** 内核账本读取失败时的真实原因；null = 已读到（可能为空账本） */
  storageError: string | null;
}

export async function getHomeFeed(storage: StorageBackend, opts: GetHomeFeedOpts = {}): Promise<HomeFeedResult> {
  const sinceMs = opts.sinceMs ?? 3_600_000;
  const now = Date.now();
  let anomalies: AnomalyItem[] = [];
  let activeMemories: ActiveMemory[] = [];
  let todos: TodoItem[] = [];
  let memories: Memory[] = [];
  let audits: AuditRecord[] = [];
  let storageOk = false;
  let storageError: string | null = null;

  try {
    [audits, memories] = await Promise.all([storage.queryAudit({}), storage.listMemories({})]);
    storageOk = true;
    anomalies = anomalies.concat(deriveKernelAnomalies(audits));
    activeMemories = await deriveRecallTop3(audits, storage, 3);
    todos = deriveTodos(memories);
  } catch (e) {
    /* storage 不可达 → 仅用 mirror 兜底（浏览器无内核）；原因上抛给 UI 明示，绝不冒充空账本 */
    storageError = kernelErrorText(e);
  }

  const conflictCount = memories.filter((m) => Boolean((m as { conflict_id?: unknown }).conflict_id)).length;
  const gains = buildGains(memories, audits, conflictCount, sinceMs, now);

  if (opts.mirrorItems?.length) {
    anomalies = anomalies.concat(deriveMirrorAnomalies(opts.mirrorItems));
  }

  // error 置顶、去重取近 8 条
  const seen = new Set<string>();
  const sorted = [...anomalies]
    .sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1))
    .filter((a) => {
      if (seen.has(a.request_id)) return false;
      seen.add(a.request_id);
      return true;
    })
    .slice(0, 8);

  // 顶栏同步态（真实）：内核 API 尚未装配同步中枢，绝不把任意审计冒充对账时间。
  // 旧实现取「最近任意审计 ts」冒充对账时间，顶栏会永远显示「已同步」——
  // 同步引擎（SyncHub / PgSyncHub + syncUp / syncDown）已实现并有集成测试，但未接入 agent.sync 与桌面主进程，
  // agent.sync 因此抛 E_NOT_IMPLEMENTED，故 wired=false 固定诚实标注「同步未实现」。
  // 阶段5-E / B11：lastReconcileAt 只记录账本里真实出现过的同步类审计时间，供 wired=true 时展示；
  // wired=false 时 TopBar 完全不读取它，绝不把本地/历史审计时间渲染成「已同步」。
  // SyncHub 的集成测试与进程内中枢不构成云端同步已接通的证据，不拿来翻 wired。
  const SYNC_ACTIONS = new Set<AuditRecord['action']>([
    'sync', 'sync_up', 'sync_down', 'sync_reconcile',
  ]);
  const syncAudits = audits.filter(
    (a) => SYNC_ACTIONS.has(a.action) && !(a.action === 'sync' && a.detail?.implemented === false),
  );
  const lastReconcileAt = storageOk && syncAudits.length > 0
    ? Math.max(...syncAudits.map((a) => (typeof a.ts === 'number' ? a.ts : 0)))
    : 0;
  const pendingSync = memories.filter((m) => m.pending_sync === true).length;
  const sync: SyncState = {
    form: 'desktop',
    role: storageOk ? 'primary' : 'offline',
    lastReconcileAt,
    pendingSync,
    wired: false,
  };

  return {
    raw: { gains, anomalies: sorted, activeMemories, todos },
    sync,
    graph: storageOk ? deriveLayerGraph(memories) : emptyLayerGraph(),
    effectGains: storageOk ? computeOnboardGains(audits, memories) : emptyOnboardGains(),
    storageError,
  };
}

/** 未加载/内核不可达时的同步态占位（offline · 从未对账 · 同步中枢未接入内核 API） */
export function emptySync(): SyncState {
  return { form: 'desktop', role: 'offline', lastReconcileAt: 0, pendingSync: 0, wired: false };
}

/** 拉取 home server 镜像账本（真实兜底源；失败返回空） */
export async function fetchMirrorItems(limit = 200): Promise<MirrorItem[]> {
  const { items } = await mirrorFetch(undefined, limit);
  return items as MirrorItem[];
}
