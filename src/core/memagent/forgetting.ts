// REQ-010 遗忘机制后台任务（17.4–17.11）：新鲜度/打分/层迁移/合并摘要/周期任务
// 约束：不物理删除（AC-01）、locked 豁免（AC-04）、失败不伤原文（AC-10）、可审计可关闭（AC-14）
import { ulid } from './ulid.ts';
import { checkL0ToL1Quality, QUALITY_GATE_VERSION } from './qualityGate.ts';
import { layerSpecOf } from './layerRules.ts';
import { DEFAULT_VECTOR_DIM, cosine, embedSync } from './vector.ts';
import { sha256hex } from './sync.ts';
import type {
  AuditAction, AuditRecord, Category, DecayClass, Memory, StorageBackend, VectorBackend,
} from './types.ts';

const DAY = 24 * 3600 * 1000;

/** 下限钳制（17.5） */
const CLAMP = { freshness: 0.05, importance: 0.1, confidence: 0.05 } as const;

/** 默认打分权重（17.5 顶层洞察优先基准；其他模式按 2.4.3 权重向量） */
export const SCORE_WEIGHTS = { w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 } as const;

/** 17.6 不同知识库默认策略 */
export interface ForgettingPolicy {
  half_life_days: number;
  auto_archive_days: number;
  auto_merge: boolean | 'cautious';
}

const POLICIES: Record<Category, ForgettingPolicy> = {
  fact: { half_life_days: 365, auto_archive_days: 730, auto_merge: false },             // 关键事实
  preference: { half_life_days: 180, auto_archive_days: 365, auto_merge: 'cautious' },  // 个人偏好
  decision: { half_life_days: 30, auto_archive_days: 90, auto_merge: true },            // 工作项目/决策
  pitfall: { half_life_days: 14, auto_archive_days: 30, auto_merge: true },             // 任务状态/坑
  insight: { half_life_days: 30, auto_archive_days: 90, auto_merge: true },             // 洞察（工作项目档）
  context: { half_life_days: 2, auto_archive_days: 14, auto_merge: false },             // 对话上下文
};

export function policyFor(category: Category): ForgettingPolicy {
  return { ...POLICIES[category] };
}

/** 17.5 新鲜度：0.5^(age_days / half_life_days)，钳制 ≥0.05 */
export function freshnessOf(m: Memory, now: number): number {
  const last = m.last_access_time ?? m.created_at;
  const ageDays = Math.max(0, (now - last) / DAY);
  const hl = m.half_life_days ?? policyFor(m.category).half_life_days;
  return Math.max(CLAMP.freshness, Math.pow(0.5, ageDays / hl));
}

/**
 * 17.5/17.8 打分：score = relevance × (w_f·f + w_i·imp + w_c·conf + w_a·boost)
 * pinned +0.15 且免检进候选集（AC-03）；下限钳制防清零。
 */
export function scoreMemory(
  m: Memory, relevance: number, now: number,
  w: typeof SCORE_WEIGHTS = SCORE_WEIGHTS,
): number {
  const f = freshnessOf(m, now);
  const imp = Math.max(CLAMP.importance, m.importance ?? 0.5);
  const conf = Math.max(CLAMP.confidence, m.confidence ?? 0.5);
  const boost = Math.min(1, (m.access_count ?? 0) / 10);
  let score = relevance * (w.w_f * f + w.w_i * imp + w.w_c * conf + w.w_a * boost);
  if (m.pinned) score += 0.15; // 置顶加分
  return Math.round(score * 1000) / 1000;
}

/** pinned 免检：直接进候选集（17.8 第一层 / AC-03） */
export function hardFilter(m: Memory): boolean {
  if (m.pinned) return true;                          // 免检直进候选
  if (m.confidence !== undefined && m.confidence <= 0.05) return false;
  return m.decay_class === 'hot' || m.decay_class === 'warm'; // 默认只扫 Hot/Warm（AC-11）
}

/**
 * 17.7 层迁移单条判定（返回新 decay_class 或 null = 不变）。
 * locked/pinned 只豁免降级方向；升级（命中/恢复/强化）不受 locked 影响（17.4：在线召回正常参与）。
 */
export function classifyLayer(m: Memory, now: number): DecayClass | null {
  if (m.locked || m.pinned) return null; // AC-04：锁定/置顶不参与自动迁移
  const last = m.last_access_time ?? m.created_at;
  const ageDays = (now - last) / DAY;
  const f = freshnessOf(m, now);
  const conf = m.confidence ?? 0.5;

  switch (m.decay_class) {
    case 'hot':
      if (ageDays > 3) return 'warm';
      return null;
    case 'warm':
      if (ageDays > 30 || f < 0.1 || conf < 0.3) return 'cold';
      return null;
    case 'cold':
      // freshnessOf 已钳制 ≥0.05：钳制值触底 = 真实新鲜度 ≤0.05
      if (f <= CLAMP.freshness && ageDays > 90) return 'dormant';
      return null;
    default:
      return null; // archived/dormant 只能被显式找回（恢复操作），不自动迁
  }
}

/** 「忘记这条」= 降权不删除（17.3 / AC-05） */
export function forgetOne(m: Memory): Memory {
  return {
    ...m,
    confidence: Math.max(0, (m.confidence ?? 0.5) - 0.2),
    importance: Math.max(0, (m.importance ?? 0.5) - 0.1),
    decay_class: m.decay_class === 'hot' ? 'warm' : 'cold',
    version: m.version + 1,
  };
}

/** 「恢复」= 从 Cold/Archived/Dormant 拉回 Warm（17.3 / AC-06） */
export function restoreOne(m: Memory, now: number): Memory {
  return {
    ...m,
    confidence: Math.min(1, (m.confidence ?? 0.5) + 0.1),
    decay_class: 'warm',
    last_access_time: now,
    version: m.version + 1,
  };
}

/** 「记住这条」= 提升优先级进 Hot（17.3） */
export function reinforceOne(m: Memory, now: number): Memory {
  return {
    ...m,
    importance: Math.min(1, (m.importance ?? 0.5) + 0.1),
    confidence: Math.min(1, (m.confidence ?? 0.5) + 0.1),
    reinforce_count: (m.reinforce_count ?? 0) + 1,
    last_access_time: now,
    decay_class: 'hot',
    version: m.version + 1,
  };
}

/** buildSummary 结果：null = 条件不满足；ok:false = 质量门拦截（原文保持不动） */
export type SummaryBuildResult =
  | { ok: true; summary: Memory; originals: Memory[] }
  | { ok: false; reason: string }
  | null;

/**
 * 17.9 合并组 → 摘要记忆（importance 取最高、merged_from 记来源、原文降 Cold 保留；失败不影响原文）
 * 批次10：自动摘要与手动写入共用 L0→L1 质量门——成员内容与聚合产物都必须过门，
 * 否则跳过合并（原文不降级、不删除），由周期审计记录拦截原因。
 * 批次41-B：摘要行与写入路径同字段口径（`sha256` + `embedding` 都在这里算出来，纯函数、无 I/O）。
 */
export function buildSummary(group: Memory[], now: number): SummaryBuildResult {
  if (group.length < 3) return null; // 17.9 触发条件：≥3 条相似
  // 跨项目/跨团队/跨租户绝不合并（摘要会继承首个成员的归属，混组会造成数据串档）
  const scope = group[0];
  const sameScope = group.filter(
    (m) => m.project_id === scope.project_id
      && m.team_id === scope.team_id
      && m.enterprise_id === scope.enterprise_id,
  );
  if (sameScope.length !== group.length) return null;
  const keepLocked = sameScope.filter((m) => !m.locked);  // 锁定原文不参与合并
  if (keepLocked.length < 3) return null;

  const snippets: string[] = [];
  for (const m of keepLocked) {
    const q = checkL0ToL1Quality(m.content ?? '');
    if (!q.ok) return { ok: false, reason: `成员内容未通过质量门：${q.reason}` };
    snippets.push(q.content!.slice(0, 20));
  }
  const composed = `【摘要】${snippets.join(' / ')}`;
  const gate = checkL0ToL1Quality(composed);
  if (!gate.ok) return { ok: false, reason: `摘要聚合内容未通过质量门：${gate.reason}` };

  const maxImp = Math.max(...keepLocked.map((m) => m.importance ?? 0.5));
  const contentL1 = gate.content!;
  // 批次28-C：摘要行曾打 layer:'L3' 且不带 content_l1/refined_by —— 未接 LLM 的本地摘要
  // 却以深层身份出现，正是「没有 LLM 却有 L2-L6」的直接来源之一。本地合成属 L1 产物：
  // layer=L1、正文落 content_l1、refined_by=stub，与写入路径同一口径。
  // 批次41-B（评审 P1-4 的另一半）：同一口径还包括**sha256 与语义向量**——摘要行此前既不落
  // sha256 也不带 embedding，于是语义召回对它恒 0 分、按 sha256 查重永远匹配不到它、
  // reconcile 把它判成「缺失」（违反需求规格书 §2.2 不变量 7「向量源自 L1」）。
  // 与 memories.ts 写入路径同源：sha256 取行上报正文（这里 = L1），向量取 content_l1。
  const summary: Memory = {
    mem_id: `sum_${ulid(now)}`,
    project_id: keepLocked[0].project_id,
    enterprise_id: keepLocked[0].enterprise_id,
    team_id: keepLocked[0].team_id,
    category: keepLocked[0].category,
    layer: 'L1',
    content: contentL1,
    content_l1: contentL1,
    layer_specs: { L1: `v1:${layerSpecOf('L1').name}` },
    refined_by: 'stub',
    decay_class: 'warm',
    pinned: false,
    locked: false,
    importance: maxImp,
    confidence: 0.6,
    merged_from: keepLocked.map((m) => m.mem_id),
    layers_generated_at: now,
    quality_gate_v: QUALITY_GATE_VERSION,
    sha256: sha256hex(contentL1),
    embedding: embedSync(contentL1, DEFAULT_VECTOR_DIM),
    version: 1,
    created_at: now,
  };
  // 原文保留：降 Cold，不删除（AC-09）
  const originals = keepLocked.map((m) => ({
    ...m, decay_class: 'cold' as DecayClass, merged_into: summary.mem_id, version: m.version + 1,
  }));
  return { ok: true, summary, originals };
}

export interface ForgettingCycleReport {
  freshness_updated: number;
  migrated: number;
  summaries_created: number;
  /** 批次10：被 L0→L1 质量门拦下的合并组数（原文保持原状） */
  summaries_filtered: number;
  merged_originals: number;
  /** 本轮真实清掉向量索引副本并写回的冷层行数（无 vector 后端时为 0；7 天内对同一行幂等） */
  compressed: number;
  request_id: string;
}

export interface ForgettingOptions {
  /** AC-14：自动策略可关闭 */
  enabled?: boolean;
  /** 是否执行冷压缩（17.10 每周） */
  weeklyCompress?: boolean;
  /**
   * 批次41-B：向量索引。给了它，摘要行落库后同步行 upsert（与写入/补炼/重建路径一致）；
   * 不给则只写行上的 `embedding`（纯函数测试、无向量后端的调用方）——行上是真向量，
   * 语义召回（读 `m.embedding`）照常命中，缺的只是那份可丢弃的索引。
   */
  vector?: VectorBackend;
}

/**
 * 17.9「相似」判据：同行语义向量的余弦相似度阈值。
 * hash bag-of-words 起步向量下同主题碎片通常 ≥0.8，取 0.75 留出分词/浮点余量；
 * 与 15.3 冷层补查阈值 0.85 同族但更宽松——合并针对同主题碎片，不是精确召回。
 * 聚合产物仍要过 buildSummary 的 L0→L1 质量门，噪声不会因此被写进账本。
 */
export const MERGE_SIM_THRESHOLD = 0.75;

/** 行上向量优先；历史行缺向量时按 L1 正文现算（纯函数、不落盘，维度与写入路径一致） */
function vectorOf(m: Memory): number[] {
  if (m.embedding && m.embedding.length > 0) return m.embedding;
  return embedSync(m.content_l1 ?? m.content, DEFAULT_VECTOR_DIM);
}

/**
 * 17.9 重复识别：桶内按语义相似度聚类。以簇种子为中心做单遍贪心（不做链式传递，
 * 避免 A~B、B~C 但 A≁C 时被串成一组造成语义漂移）；按 mem_id 排序保证结果可复现。
 * 零向量（无正文历史行）与任何向量相似度都是 0，不会被误并。
 */
export function clusterSimilar(mems: Memory[], threshold = MERGE_SIM_THRESHOLD): Memory[][] {
  const sorted = [...mems].sort((a, b) => a.mem_id.localeCompare(b.mem_id));
  const vectors = new Map(sorted.map((m) => [m.mem_id, vectorOf(m)]));
  const used = new Set<string>();
  const clusters: Memory[][] = [];
  for (const seed of sorted) {
    if (used.has(seed.mem_id)) continue;
    const seedVec = vectors.get(seed.mem_id)!;
    const cluster = [seed];
    used.add(seed.mem_id);
    for (const m of sorted) {
      if (used.has(m.mem_id)) continue;
      if (cosine(seedVec, vectors.get(m.mem_id)!) >= threshold) {
        cluster.push(m);
        used.add(m.mem_id);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

/**
 * 17.10 一轮生命周期任务：新鲜度计算 → 层迁移 → 重复识别合并 → 冷压缩。
 * 不阻塞用户交互（纯内存计算 + 账本写回，不调用 LLM）；锁定项跳过；结果全审计。
 */
export async function runForgettingCycle(
  storage: StorageBackend,
  now: number,
  opts: ForgettingOptions = {},
): Promise<ForgettingCycleReport> {
  const request_id = `req_${ulid(now)}`;
  const report: ForgettingCycleReport = {
    freshness_updated: 0, migrated: 0, summaries_created: 0, summaries_filtered: 0,
    merged_originals: 0, compressed: 0, request_id,
  };
  if (opts.enabled === false) {
    await auditWrite(storage, request_id, 'gc', { skipped: true, reason: 'auto_policy_disabled' }, now);
    return report; // AC-14：可关闭
  }

  const mems = await storage.listMemories({});
  report.freshness_updated = mems.length;

  // 1) 层迁移（locked/pinned 豁免在 classifyLayer 内）
  for (const m of mems) {
    const next = classifyLayer(m, now);
    if (next && next !== m.decay_class) {
      await storage.putMemory({ ...m, decay_class: next, version: m.version + 1 });
      report.migrated++;
    }
  }

  // 2) 重复识别合并（17.9：同实体/主题「相似」≥3 → 摘要）
  // 批次42 阶段4：原按内容前 8 字符分组只是字符串前缀近似 —— 前缀相同但主题无关的行会被
  // 硬凑成一组，同主题换措辞的行又永远聚不到一起。现按行上语义向量的余弦相似度聚类（clusterSimilar）。
  // 分桶键必须含租户/团队/项目/类别：跨归属绝不合并（摘要继承首条归属，混组会串档），
  // buildSummary 内还有一道同归属二次校验。auto_merge=false 的类别不自动合并
  //（17.6；'cautious' 暂按不自动合并处理，需人工确认）。
  const live = (await storage.listMemories({})).filter((m) => !m.merged_into && !m.locked);
  const buckets = new Map<string, Memory[]>();
  for (const m of live) {
    if (policyFor(m.category).auto_merge !== true) continue;
    const key = [m.enterprise_id, m.team_id, m.project_id, m.category].join('\u0000');
    buckets.set(key, [...(buckets.get(key) ?? []), m]);
  }
  const filterReasons: string[] = [];
  for (const bucket of buckets.values()) {
    for (const group of clusterSimilar(bucket)) {
      if (group.length < 3) continue; // 17.9 触发条件：≥3 条相似
      const built = buildSummary(group, now);
      if (!built) continue;
      if (!built.ok) {
        report.summaries_filtered++;
        filterReasons.push(built.reason);
        continue;
      }
      await storage.putMemory(built.summary);
      // 批次41-B：摘要行也要进向量索引（与 memories.ts 写入路径同口径：按 content_l1 建索引）
      if (opts.vector) {
        await opts.vector.upsert(built.summary.mem_id, built.summary.content_l1!, {
          project_id: built.summary.project_id, layer: 'L1',
        });
      }
      for (const o of built.originals) await storage.putMemory(o);
      report.summaries_created++;
      report.merged_originals += built.originals.length;
    }
  }

  // 3) 冷压缩（17.10 每周）：真实移除冷层在向量索引里的副本，降低索引内存占用。
  // 行上 embedding 一律保留 —— agent.ts 冷层补查读行上向量（§2.2 不变量 7「向量源自 L1」），
  // fieldBackfill（41-T）还会把缺向量的行判「缺失」并回填；清行上向量等于制造假删 + 反复回填。
  // 磁盘正文压缩（L0 分库 / 冷表折叠）尚未落地，此处不假装做了：见 specs/demo-data-baseline.md。
  // 只有给了 vector 后端才有可压缩对象；没后端时 compressed 诚实为 0，不拿冷层行数冒充成绩。
  if (opts.weeklyCompress && opts.vector) {
    const colds = (await storage.listMemories({})).filter(
      (m) => m.decay_class === 'cold' || m.decay_class === 'archived' || m.decay_class === 'dormant',
    );
    for (const m of colds) {
      // 幂等：7 天内已压过的行不重复 remove / 不重复计数 / 不重复写回（与每周调度同频）
      if (m.compressed_at !== undefined && now - m.compressed_at < 7 * DAY) continue;
      await opts.vector.remove(m.mem_id);
      await storage.putMemory({ ...m, compressed_at: now, version: m.version + 1 });
      report.compressed++;
    }
  }

  await auditWrite(storage, request_id, 'gc', {
    ...report, task: 'forgetting_cycle', weeklyCompress: opts.weeklyCompress === true,
    ...(filterReasons.length > 0 ? { summary_filter_reasons: filterReasons.slice(0, 10) } : {}),
  }, now);
  return report;
}

async function auditWrite(
  storage: StorageBackend, request_id: string, action: AuditAction,
  detail: Record<string, unknown>, now: number,
): Promise<void> {
  const rec: AuditRecord = {
    request_id, action, ts: now, detail,
  };
  await storage.appendAudit(rec);
}
