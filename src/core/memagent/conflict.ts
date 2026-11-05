// 批次46-3：内核冲突裁决原子 API（方案 §3 / §9.7 + P7 hold）
//
// 红线（不得突破）：
// ① 用户显式给 verdict 才落定；绝不默认 auto_override；resolve_conflicts 只是「是否处理已排队裁决」开关。
// ② dry_run=true 全程零写入：不 putMemory、不 appendAudit、不 vector、不写合并记忆，audit=null。
// ③ 裁决只归档不删除（restore 可回温），不触碰 L0 密文，不回显 content_l0_enc / content_orig / has_l0。
// ④ conflicts_resolved 只数本周期真实落定的冲突对；历史 conflict_resolve 审计不得回放计数。
// ⑤ 单次裁决必须写成对审计（detail 带 old_id + new_id）。
// ⑥ 内核没有 detect_conflicts 检测引擎 → 不伪造 conflict_score / conflict_type，如实为 null。
import { ulid } from './ulid.ts';
import { checkL0ToL1Quality, QUALITY_GATE_VERSION } from './qualityGate.ts';
import { layerSpecOf } from './layerRules.ts';
import { sha256hex } from './sync.ts';
import { DEFAULT_VECTOR_DIM, embedSync } from './vector.ts';
import type {
  AuditAction, AuditRef, ConflictPair, ConflictResolveReq, ConflictResolveResult,
  ConflictVerdict, DecayClass, Memory, StorageBackend,
} from './types.ts';

/** 诚实口径：没有检测引擎，就不输出分数与类型 */
export const CONFLICT_NOTE =
  '内核未实现 §9.7 的 detect_conflicts 伪码检测引擎：不输出 conflict_score、不猜测 conflict_type，二者如实为 null；'
  + '配对只来自真实账本（共享 conflict_id 或 pending=true 的 conflict_resolve 审计），对手缺失/歧义/跨项目不入队；'
  + '裁决只归档不删除（restore 可回温），不触碰 L0 密文。';

export const CONFLICT_VERDICTS: readonly ConflictVerdict[] = [
  'auto_override', 'user_confirm', 'merge', 'hold',
];

const CLAMP_CONFIDENCE = { min: 0.05, max: 1 } as const;
const clampConfidence = (v: number): number =>
  Math.min(CLAMP_CONFIDENCE.max, Math.max(CLAMP_CONFIDENCE.min, v));

function isLive(m: Memory): boolean {
  return !m.deleted
    && m.decay_class !== 'archived'
    && m.decay_class !== 'dormant';
}

/**
 * 真实冲突配对。两种**唯一**数据来源：
 * ① 两条记忆共享非空 conflict_id 且均非 archived/dormant/deleted；
 * ② action='conflict_resolve' 审计中 detail.pending=true 且 old/new 两条记忆仍存在。
 * 对手缺失 / 三条共享同一 conflict_id（歧义）/ 跨项目 → 一律不入队，不伪造对。
 * 历史已落定（pending=false）审计不得回放。
 */
export async function coreListConflicts(
  storage: StorageBackend,
  opts: { projectId?: string } = {},
): Promise<ConflictPair[]> {
  const [mems, audits] = await Promise.all([
    storage.listMemories({}),
    storage.queryAudit({ action: 'conflict_resolve' }),
  ]);
  const pairs: ConflictPair[] = [];
  const seen = new Set<string>();

  const push = (cid: string, oldM: Memory, newM: Memory): void => {
    if (seen.has(cid)) return;                                   // 路径 1 / 2 同源去重
    if (!isLive(oldM) || !isLive(newM)) return;
    if (oldM.project_id !== newM.project_id) return;            // 跨项目拒绝
    if (opts.projectId && oldM.project_id !== opts.projectId) return; // 项目隔离 / 作用域
    seen.add(cid);
    pairs.push({
      conflict_id: cid,
      old_id: oldM.mem_id,
      new_id: newM.mem_id,
      project_id: oldM.project_id,
      conflict_score: null,
      conflict_type: null,
      note: CONFLICT_NOTE,
    });
  };

  // 路径 1：conflict_id 分组。恰好两条才成一对；一条 = 对手缺失，三条 = 歧义，都不伪造。
  const byCid = new Map<string, Memory[]>();
  for (const m of mems) {
    if (!m.conflict_id || !isLive(m)) continue;
    byCid.set(m.conflict_id, [...(byCid.get(m.conflict_id) ?? []), m]);
  }
  for (const [cid, group] of byCid) {
    if (group.length !== 2) continue;
    const [a, b] = group;
    const aIsOld = a.created_at <= b.created_at;
    push(cid, aIsOld ? a : b, aIsOld ? b : a);
  }

  // 路径 2：转人工 / 保持 pending 的裁决审计
  for (const a of audits) {
    const d = a.detail as Record<string, unknown>;
    if (d.pending !== true) continue;
    if (typeof d.old_id !== 'string' || typeof d.new_id !== 'string') continue;
    const oldM = mems.find((m) => m.mem_id === d.old_id);
    const newM = mems.find((m) => m.mem_id === d.new_id);
    if (!oldM || !newM) continue;
    const cid = typeof d.conflict_id === 'string' && d.conflict_id
      ? d.conflict_id
      : `audit_${a.request_id}`;
    push(cid, oldM, newM);
  }

  return pairs;
}

async function auditWrite(
  storage: StorageBackend,
  request_id: string,
  action: AuditAction,
  detail: Record<string, unknown>,
  now: number,
  project_id: string,
): Promise<void> {
  await storage.appendAudit({ request_id, action, ts: now, project_id, detail });
}

/**
 * 原子裁决：一次只处理一对。四条 verdict 语义见方案 §3.1。
 * `dryRun=true` 只演算，不改任何记忆、不写任何审计、不生成合并记忆。
 */
export async function coreResolveConflict(
  req: ConflictResolveReq,
  ctx: { storage: StorageBackend; now: number },
): Promise<ConflictResolveResult> {
  const { storage, now } = ctx;
  const request_id = `req_${ulid(now)}`;
  const dryRun = req.dry_run === true;
  const verdict = req.verdict;

  if (!CONFLICT_VERDICTS.includes(verdict)) {
    throw new Error(`coreResolveConflict.verdict 非法：须为 ${CONFLICT_VERDICTS.join('/')}（禁止默认 auto_override）`);
  }

  const base = {
    verdict, conflict_id: req.conflict_id, old_id: req.old_id, new_id: req.new_id,
    project_id: req.project_id, dry_run: dryRun, request_id,
    note: CONFLICT_NOTE,
  };
  const refused = (reason: string, extra: Record<string, unknown> = {}): ConflictResolveResult => ({
    ...base, ok: false, resolved: false, conflicts_resolved: 0, audit: null,
    reason, ...extra,
  });

  // 先查对手：缺失时如实空态返回（不抛错），也避免端壳用夹具 ID 调用时炸页
  const [oldM, newM] = await Promise.all([
    storage.getMemory(req.old_id),
    storage.getMemory(req.new_id),
  ]);
  if (!oldM || !newM) return refused('对手缺失或记忆已删除：不入队、不伪造对');

  const projectId = (req.project_id ?? '').trim();
  if (!projectId || oldM.project_id !== newM.project_id || oldM.project_id !== projectId) {
    return refused('跨项目 / 越界：两条必须同项目且落在作用域内');
  }
  if (oldM.locked || newM.locked) {
    if (!dryRun) {
      await auditWrite(storage, request_id, 'memory_op', {
        op: 'conflict_resolve', blocked: 'locked', old_id: req.old_id, new_id: req.new_id,
      }, now, projectId);
    }
    return refused('locked 记忆仅 unlock 放行（G4），不计入 resolved', { blocked_locked: true });
  }

  const audit: AuditRef | null = dryRun ? null : { request_id, action: 'conflict_resolve' };
  const pairDetail = {
    conflict_id: req.conflict_id, verdict, old_id: req.old_id, new_id: req.new_id,
  };

  // user_confirm / hold：不改任何记忆状态，保持 pending，只写一条成对审计（非 dry_run）
  if (verdict === 'user_confirm' || verdict === 'hold') {
    if (!dryRun) {
      await auditWrite(storage, request_id, 'conflict_resolve', {
        ...pairDetail, pending: true, resolved: false,
      }, now, projectId);
    }
    return { ...base, ok: true, resolved: false, conflicts_resolved: 0, audit };
  }

  // merge：聚合内容必须先过 L0→L1 质量门，失败则整组回滚、保持 pending（零写入）
  let merged: Memory | undefined;
  if (verdict === 'merge') {
    const composed = `【合并】${oldM.content ?? ''} ⟷ ${newM.content ?? ''}`;
    const gate = checkL0ToL1Quality(composed);
    if (!gate.ok) {
      return refused(`合并内容未通过 L0→L1 质量门：${gate.reason}`, { quality_gate_blocked: true });
    }
    const contentL1 = gate.content!;
    merged = {
      mem_id: `merge_${ulid(now)}`,
      project_id: oldM.project_id,
      enterprise_id: oldM.enterprise_id,
      team_id: oldM.team_id,
      category: oldM.category,
      layer: 'L1',
      content: contentL1,
      content_l1: contentL1,
      layer_specs: { L1: `v1:${layerSpecOf('L1').name}` },
      refined_by: 'stub',
      decay_class: 'warm',
      pinned: false,
      locked: false,
      importance: Math.max(oldM.importance ?? 0.5, newM.importance ?? 0.5),
      confidence: 0.6,
      merged_from: [oldM.mem_id, newM.mem_id],
      layers_generated_at: now,
      quality_gate_v: QUALITY_GATE_VERSION,
      sha256: sha256hex(contentL1),
      embedding: embedSync(contentL1, DEFAULT_VECTOR_DIM),
      version: 1,
      created_at: now,
    };
  }

  // 真实落定（两种 verdict 都只归档，不删除；新值在 auto_override 下提升 confidence）
  const archived: DecayClass = 'archived';
  const nextOld: Memory = {
    ...oldM, decay_class: archived, conflict_id: undefined,
    version: oldM.version + 1, updated_at: now,
    ...(merged ? { merged_into: merged.mem_id } : {}),
  };
  const nextNew: Memory = {
    ...newM,
    ...(verdict === 'auto_override'
      ? { confidence: clampConfidence((newM.confidence ?? 0.5) + 0.1) }
      : { decay_class: archived }),
    conflict_id: undefined,
    version: newM.version + 1,
    updated_at: now,
    ...(merged ? { merged_into: merged.mem_id } : {}),
  };

  if (!dryRun) {
    await storage.putMemory(nextOld);
    await storage.putMemory(nextNew);
    if (merged) {
      await storage.putMemory(merged);
      await auditWrite(storage, request_id, 'merge', {
        ...pairDetail, merged_mem_id: merged.mem_id, pending: false,
      }, now, projectId);
    }
    await auditWrite(storage, request_id, 'conflict_resolve', {
      ...pairDetail,
      ...(merged ? { merged_mem_id: merged.mem_id } : {}),
      pending: false, resolved: true,
    }, now, projectId);
  }

  return {
    ...base,
    ok: true,
    resolved: !dryRun,
    conflicts_resolved: dryRun ? 0 : 1,
    audit,
    ...(merged && !dryRun ? { merged_mem_id: merged.mem_id } : {}),
  };
}
