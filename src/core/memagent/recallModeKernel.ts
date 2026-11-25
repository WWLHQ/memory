// P2-9 内核增量纯函数（已批准口径 2026-11-25）：
//  ① 只对账本显式标记的冲突对仲裁（conflict_id 成对），不自动推断语义冲突；
//  ② critical 最低深度 L3+L4+L2 = 裁剪下限守卫，缺层时补该层最高分，预算不够如实标注；
//  ③ 热更词表/阈值/权重由调用方从 growth:v1.mode_dispatch 注入，resolveMode 保持纯函数。
// 本文件不读存储、不调 LLM；所有写审计与预算重算留给 agent.ts。
import { RECALL_MODE_SPECS, type ConcreteMode, type LayerKey } from './recallModes.ts';
import type { Hit, Layer, Memory } from './types.ts';

export interface ConflictNote {
  a: string;
  b: string;
  winner: string;
  loser: string;
  rationale: string;
  loser_role: string;
  text: string;
}

/** 由模式 conflictRule 尾句推导的败方角色（唯一映射表，不再另立第二套文案） */
const LOSER_ROLE: Record<ConcreteMode, string> = {
  top_insight: '历史参考',
  fact_first: '待核实',
  event_replay: '注脚',
  pattern_reasoning: '特例',
  minimal: '历史参考',
};

function layerRank(mode: ConcreteMode, layer: Layer): number {
  const i = RECALL_MODE_SPECS[mode].selectPriority.indexOf(layer as LayerKey);
  return i < 0 ? RECALL_MODE_SPECS[mode].selectPriority.length : i;
}

/**
 * 显式冲突对仲裁：只认同 conflict_id 且**恰好两条 live 记忆同时在本次命中里**的对。
 * 17.2 硬约束前置由调用方保证（已裁决/归档/删除不进 hits）。
 * winner = 该模式内层级排位更高者（同层按 score 降序），rationale 逐字引用模式条款。
 */
export function buildConflictNotes(
  hits: Hit[], mems: Memory[], mode: ConcreteMode,
): ConflictNote[] {
  const byId = new Map(hits.map((h) => [h.mem_id, h] as const));
  const memById = new Map(mems.map((m) => [m.mem_id, m] as const));
  const groups = new Map<string, string[]>();
  for (const m of mems) {
    if (!m.conflict_id || m.deleted || m.decay_class === 'archived' || m.decay_class === 'dormant') continue;
    if (!byId.has(m.mem_id)) continue;
    groups.set(m.conflict_id, [...(groups.get(m.conflict_id) ?? []), m.mem_id]);
  }
  const notes: ConflictNote[] = [];
  for (const [cid, ids] of groups) {
    if (ids.length !== 2) continue; // 恰好一对；一条=对手缺失，三条=歧义，都不伪造
    const [x, y] = ids.map((id) => byId.get(id)!);
    const mx = memById.get(x.mem_id)!;
    const my = memById.get(y.mem_id)!;
    const rx = layerRank(mode, x.layer), ry = layerRank(mode, y.layer);
    const preferX = rx < ry || (rx === ry && x.score >= y.score);
    const winner = preferX ? x : y;
    const loser = preferX ? y : x;
    const wm = preferX ? mx : my, lm = preferX ? my : mx;
    const spec = RECALL_MODE_SPECS[mode];
    const role = LOSER_ROLE[mode];
    const text = `[冲突] ${cid}: ${x.mem_id}(${x.layer}/${wm.project_id ?? '本机'}/${new Date(wm.created_at).toISOString().slice(0, 10)}) vs ${y.mem_id}(${y.layer}/${lm.project_id ?? '本机'}/${new Date(lm.created_at).toISOString().slice(0, 10)}) → 本模式=${spec.name} → 裁定以 ${winner.mem_id} 为准，${loser.mem_id} 作${role}。依据：${spec.conflictRule}`;
    notes.push({
      a: x.mem_id, b: y.mem_id, winner: winner.mem_id, loser: loser.mem_id,
      rationale: spec.conflictRule, loser_role: role, text,
    });
  }
  return notes.sort((p, q) => p.a.localeCompare(q.a));
}

export interface DepthGuardInfo {
  triggered: boolean;
  scene: 'critical';
  required: LayerKey[];
  present: LayerKey[];
  missing: LayerKey[];
  restored: string[];
  reason?: string;
}

/**
 * critical 硬下限守卫：有候选的层裁剪后至少留 1 条；补回该层最高分，
 * 若补回后超硬顶则由调用方按既有熔断处理（本函数不改预算口径，只如实标注）。
 */
export function applyDepthGuard(
  hits: Hit[], candidates: Hit[], scene: string, hardBudget: number, estTokens: (s: string) => number,
): { hits: Hit[]; guard: DepthGuardInfo } {
  if (scene !== 'critical') {
    return { hits, guard: { triggered: false, scene: 'critical', required: [], present: [], missing: [], restored: [] } };
  }
  const required: LayerKey[] = ['L3', 'L4', 'L2'];
  const present = required.filter((l) => hits.some((h) => h.layer === l));
  const missing = required.filter((l) => !present.includes(l) && candidates.some((c) => c.layer === l));
  const restored: string[] = [];
  let budgetBlocked = false;
  let out = [...hits];
  let payload = out.reduce((a, h) => a + estTokens(h.content), 0);
  for (const layer of missing) {
    const pick = [...candidates].filter((c) => c.layer === layer).sort((a, b) => b.score - a.score)[0];
    if (!pick || out.some((h) => h.mem_id === pick.mem_id)) continue;
    const cost = estTokens(pick.content);
    let victimIdx = -1;
    if (payload + cost > hardBudget) {
      // 让位规则：先丢非必需层里分数最低的一条（个人记忆受保护，不参与让位）
      const pool = out.map((h, i) => ({ h, i })).filter(({ h }) =>
        !required.includes(h.layer as LayerKey) && !h.mem_id.startsWith('pm:'));
      pool.sort((a, b) => a.h.score - b.h.score);
      if (pool.length === 0) {
        budgetBlocked = true;
        continue;
      }
      victimIdx = pool[0].i;
      payload -= estTokens(out[victimIdx].content);
    }
    if (victimIdx >= 0) out = out.filter((_, i) => i !== victimIdx);
    out.push(pick);
    payload += cost;
    restored.push(pick.mem_id);
  }
  const stillMissing = missing.filter((l) => !out.some((h) => h.layer === l));
  return {
    hits: out,
    guard: {
      triggered: missing.length > 0, scene: 'critical', required, present,
      missing, restored,
      ...(payload > hardBudget || budgetBlocked ? { reason: '预算不足以容纳三层，按 2.4.1 硬熔断处理，不伪造占位内容' } : {}),
      ...(stillMissing.length > 0 && payload <= hardBudget && !budgetBlocked ? { reason: `候选层缺失：${stillMissing.join('、')}` } : {}),
    },
  };
}
