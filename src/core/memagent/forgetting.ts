// REQ-010 遗忘机制后台任务（17.4–17.11）：新鲜度/打分/层迁移/合并摘要/周期任务
// 约束：不物理删除（AC-01）、locked 豁免（AC-04）、失败不伤原文（AC-10）、可审计可关闭（AC-14）
import { ulid } from './ulid.ts';
import type {
  AuditAction, AuditRecord, Category, DecayClass, Memory, StorageBackend,
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

/** 17.9 合并组 → 摘要记忆（importance 取最高、merged_from 记来源、原文降 Cold 保留；失败不影响原文） */
export function buildSummary(group: Memory[], now: number): { summary: Memory; originals: Memory[] } | null {
  if (group.length < 3) return null; // 17.9 触发条件：≥3 条相似
  const keepLocked = group.filter((m) => !m.locked);      // 锁定原文不参与合并
  if (keepLocked.length < 3) return null;
  const maxImp = Math.max(...keepLocked.map((m) => m.importance ?? 0.5));
  const summary: Memory = {
    mem_id: `sum_${ulid(now)}`,
    project_id: keepLocked[0].project_id,
    enterprise_id: keepLocked[0].enterprise_id,
    team_id: keepLocked[0].team_id,
    category: keepLocked[0].category,
    layer: 'L3',
    content: `【摘要】${keepLocked.map((m) => m.content.slice(0, 20)).join(' / ')}`,
    decay_class: 'warm',
    pinned: false,
    locked: false,
    importance: maxImp,
    confidence: 0.6,
    merged_from: keepLocked.map((m) => m.mem_id),
    version: 1,
    created_at: now,
  };
  // 原文保留：降 Cold，不删除（AC-09）
  const originals = keepLocked.map((m) => ({
    ...m, decay_class: 'cold' as DecayClass, merged_into: summary.mem_id, version: m.version + 1,
  }));
  return { summary, originals };
}

export interface ForgettingCycleReport {
  freshness_updated: number;
  migrated: number;
  summaries_created: number;
  merged_originals: number;
  compressed: number;
  request_id: string;
}

export interface ForgettingOptions {
  /** AC-14：自动策略可关闭 */
  enabled?: boolean;
  /** 是否执行冷压缩（17.10 每周） */
  weeklyCompress?: boolean;
}

/**
 * 17.10 一轮生命周期任务：新鲜度计算 → 层迁移 → 重复识别合并 → 冷压缩。
 * 不阻塞用户交互（纯同步内存操作，演示级）；锁定项跳过；结果全审计。
 */
export async function runForgettingCycle(
  storage: StorageBackend,
  now: number,
  opts: ForgettingOptions = {},
): Promise<ForgettingCycleReport> {
  const request_id = `req_${ulid(now)}`;
  const report: ForgettingCycleReport = {
    freshness_updated: 0, migrated: 0, summaries_created: 0, merged_originals: 0, compressed: 0, request_id,
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

  // 2) 重复识别合并（17.9：同 category 相似 ≥3 → 摘要；演示用内容前缀聚类）
  const live = (await storage.listMemories({})).filter((m) => !m.merged_into && !m.locked);
  const groups = new Map<string, Memory[]>();
  for (const m of live) {
    const key = `${m.category}:${m.content.slice(0, 8)}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  for (const group of groups.values()) {
    const built = buildSummary(group, now);
    if (!built) continue;
    await storage.putMemory(built.summary);
    for (const o of built.originals) await storage.putMemory(o);
    report.summaries_created++;
    report.merged_originals += built.originals.length;
  }

  // 3) 冷压缩（17.10 每周；演示 = cold/archived/dormant 计数）
  if (opts.weeklyCompress) {
    const colds = (await storage.listMemories({})).filter(
      (m) => m.decay_class === 'cold' || m.decay_class === 'archived' || m.decay_class === 'dormant',
    );
    report.compressed = colds.length;
  }

  await auditWrite(storage, request_id, 'gc', { ...report, task: 'forgetting_cycle' }, now);
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
