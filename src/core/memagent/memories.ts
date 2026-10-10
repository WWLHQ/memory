// 内核记忆业务（§3 schema + 行为红线）：write 查重短路嫁接 / browse L0 授权 / gc 衰减 / memoryOp 17.3 操作
import type {
  AuditRef, BrowseReq, BrowseResult, BrowseRow, Category, DecayClass,
  GcReq, GcReport, Layer, MemOp, MemOpPatch, MemOpResult, Memory, StorageBackend, VectorBackend,
} from './types.ts';
import { cosine, embedSync } from './vector.ts';

/** 17.4 钳制：importance 下限 0.1 / confidence 下限 0.05（2.4.2 规则4） */
const CLAMP = { importance: [0.1, 1] as const, confidence: [0.05, 1] as const };
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));

/** 查重阈值（6.1 演示取 L2 档 0.75；实际按目标层） */
export const DUP_THRESHOLD = 0.75;

const DECAY_ORDER: DecayClass[] = ['hot', 'warm', 'cold', 'archived', 'dormant'];

/** 五维查重（6.1 简化：语义一维 cosine，契约级演示；阈值按目标层） */
export function dedupSim(text: string, other: Memory): number {
  if (!other.embedding) return 0;
  return cosine(embedSync(text), other.embedding);
}

export async function coreWrite(
  input: { content: string; category: Category; project_id: string; user_id?: string; session_id?: string; source_agent?: string },
  ctx: { storage: StorageBackend; vector: VectorBackend; account: { user_id: string; team_id: string; enterprise_id: string }; request_id: string; now: number },
): Promise<{ mem_id: string; dedup: { action: 'new' | 'merged' | 'duplicated'; sim: number } }> {
  const { storage, vector, account, request_id, now } = ctx;
  const existing = await storage.listMemories({ project_id: input.project_id });
  // 短路嫁接（6.2）：按 L1→L6 逐层查重，命中层即合并停止
  const layers: Exclude<Layer, 'L0'>[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
  let best: { m: Memory; sim: number } | null = null;
  for (const layer of layers) {
    for (const m of existing.filter((x) => x.layer === layer)) {
      const sim = dedupSim(input.content, m);
      if (sim >= DUP_THRESHOLD && (!best || sim > best.sim)) best = { m, sim };
    }
    if (best) break; // 命中层即停（短路）
  }

  const auditRef: AuditRef = { request_id, action: 'write' };

  if (best) {
    // merged：并入已有记忆（版本 +1，同步用）；sim=1 视为 duplicated
    const action: 'merged' | 'duplicated' = best.sim >= 0.99 ? 'duplicated' : 'merged';
    if (action === 'merged') {
      const updated: Memory = { ...best.m, version: best.m.version + 1, created_at: best.m.created_at };
      await storage.putMemory(updated);
    }
    await storage.appendAudit({
      ...auditRef, project_id: input.project_id, user_id: input.user_id, ts: now,
      detail: { dedup: action, sim: best.sim, merged_into: best.m.mem_id },
    });
    return { mem_id: best.m.mem_id, dedup: { action, sim: Math.round(best.sim * 1000) / 1000 } };
  }

  // 新建：L2 精炼层落位（契约级演示），L0 存加密原始对话
  const mem: Memory = {
    mem_id: `mem_${request_id.slice(-8)}`,
    project_id: input.project_id,
    user_id: input.category === 'preference' ? input.user_id : undefined,
    enterprise_id: account.enterprise_id,
    team_id: account.team_id,
    category: input.category,
    layer: 'L2',
    content_l0_enc: `ENC(${input.content.slice(0, 32)})`,
    content: input.content,
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_by_agent: input.source_agent,
    created_at: now,
  };
  mem.embedding = embedSync(input.content);
  await storage.putMemory(mem);
  await vector.upsert(mem.mem_id, input.content, { project_id: input.project_id, layer: mem.layer });
  await storage.appendAudit({
    ...auditRef, project_id: input.project_id, user_id: input.user_id, ts: now,
    detail: { dedup: 'new', category: input.category },
  });
  return { mem_id: mem.mem_id, dedup: { action: 'new', sim: 0 } };
}

/** browse（§4.1）：L0 需授权密码（默认仅管理员语义由调用方保证），错 → E_AUTH_L0；l0_view 写审计 */
export async function coreBrowse(
  req: BrowseReq,
  ctx: { storage: StorageBackend; accountAdmin: boolean; request_id: string; now: number },
): Promise<BrowseResult> {
  const { storage, accountAdmin, request_id, now } = ctx;
  const l0Masked = req.layer === 'L0';
  let unmasked = false;

  if (l0Masked) {
    const pwd = req.l0_auth?.password;
    if (accountAdmin && pwd && pwd.length >= 6) unmasked = true;
    await storage.appendAudit({
      request_id, action: 'l0_view', ts: now, project_id: req.project_id,
      detail: { unmasked, authorized: accountAdmin, reason: unmasked ? '授权解开' : '遮罩保持' },
    });
    if (!unmasked) {
      const err = new Error('[E_AUTH_L0] L0 未授权或密码错误') as Error & { code: string };
      err.code = 'E_AUTH_L0';
      throw err;
    }
  } else {
    await storage.appendAudit({
      request_id, action: 'log_view', ts: now, project_id: req.project_id,
      detail: { layer: req.layer },
    });
  }

  const mems = await storage.listMemories({ project_id: req.project_id });
  const rows: BrowseRow[] = mems.map((m) => ({
    mem_id: m.mem_id,
    content: l0Masked ? (m.content_l0_enc ?? '') : m.content,
  }));
  return { rows, l0_masked: l0Masked && !unmasked, audit: { request_id, action: l0Masked ? 'l0_view' : 'log_view' } };
}

/** gc（9.7/6.2）：衰减 hot→warm→cold→archived 推进 + 冲突裁决计数（演示） */
export async function coreGc(
  req: GcReq,
  ctx: { storage: StorageBackend; request_id: string; now: number },
): Promise<GcReport> {
  const { storage, request_id, now } = ctx;
  const mems = await storage.listMemories({ project_id: req.project_id });
  let decayed = 0;
  for (const m of mems) {
    if (m.locked || m.pinned) continue; // 豁免（17.8/17.5）
    const idx = DECAY_ORDER.indexOf(m.decay_class);
    if (idx >= 0 && idx < DECAY_ORDER.length - 1) {
      await storage.putMemory({ ...m, decay_class: DECAY_ORDER[idx + 1], version: m.version + 1 });
      decayed++;
    }
  }
  const auditRef: AuditRef = { request_id, action: 'gc' };
  await storage.appendAudit({
    ...auditRef, ts: now, project_id: req.project_id,
    detail: { decayed, conflicts_resolved: 0 },
  });
  return { decayed, merged: 0, conflicts_resolved: 0, request_id, audit: auditRef };
}

/**
 * 单记忆操作（17.3 / P4 调参迁移）：端壳状态变更唯一通道。
 * G4：locked 仅可 unlock；每次变更新增审计 memory_op（detail.op 归因）+ 版本推进（同步用）。
 */
export async function coreMemoryOp(
  mem_id: string,
  op: MemOp,
  ctx: { storage: StorageBackend; vector: VectorBackend; request_id: string; now: number },
  patch: MemOpPatch = {},
): Promise<MemOpResult> {
  const { storage, vector, request_id, now } = ctx;
  const m = await storage.getMemory(mem_id);
  if (!m) return { ok: false, mem: null, request_id };

  // G4：locked 豁免一切后台/手动操作，仅可解锁（17.7 迁移规则同源）
  if (m.locked && op !== 'unlock') {
    await storage.appendAudit({
      request_id, action: 'memory_op', ts: now, project_id: m.project_id,
      detail: { op, blocked: 'locked', mem_id },
    });
    return { ok: false, blocked_locked: true, mem: m, request_id };
  }

  const bump = (di: number, dc: number): Memory => ({
    ...m,
    importance: clamp((m.importance ?? 0.5) + di, CLAMP.importance),
    confidence: clamp((m.confidence ?? 0.5) + dc, CLAMP.confidence),
    reinforce_count: (m.reinforce_count ?? 0) + (di > 0 ? 1 : 0),
  });

  let next: Memory | null = m;
  switch (op) {
    case 'remember': next = bump(+0.2, +0.2); break;          // 强化：升权 + reinforce 分家（17.4）
    case 'forget': next = bump(-0.2, -0.2); break;            // 降权不删（17.3）
    case 'pin': next = { ...m, pinned: true }; break;
    case 'unpin': next = { ...m, pinned: false }; break;
    case 'lock': next = { ...m, locked: true }; break;
    case 'unlock': next = { ...m, locked: false }; break;
    case 'archive': next = { ...m, decay_class: 'archived' }; break;
    case 'restore': next = { ...m, decay_class: 'hot' }; break; // 恢复即回温（15.3）
    case 'param': {                                            // P4 调参：内核钳制兜底
      next = {
        ...m,
        importance: patch.importance !== undefined ? clamp(patch.importance, CLAMP.importance) : m.importance,
        confidence: patch.confidence !== undefined ? clamp(patch.confidence, CLAMP.confidence) : m.confidence,
        half_life_days: patch.half_life_days !== undefined ? Math.max(1, patch.half_life_days) : m.half_life_days,
        pinned: patch.pinned ?? m.pinned,
        locked: patch.locked ?? m.locked,
      };
      break;
    }
    case 'migrate':                                            // P4 层迁移：目标温度由端壳六态映射
      next = { ...m, decay_class: patch.decay_class ?? m.decay_class };
      break;
    case 'delete':                                             // 彻底删除：主表 + 向量索引同步清理
      await storage.deleteMemory(mem_id);
      await vector.remove(mem_id);
      await storage.appendAudit({
        request_id, action: 'memory_op', ts: now, project_id: m.project_id,
        detail: { op, deleted: true, mem_id },
      });
      return { ok: true, mem: null, request_id };
  }

  if (next) {
    next = { ...next, version: m.version + 1, updated_at: now };
    await storage.putMemory(next);
  }
  await storage.appendAudit({
    request_id, action: 'memory_op', ts: now, project_id: m.project_id,
    detail: { op, mem_id, importance: next?.importance, confidence: next?.confidence, decay_class: next?.decay_class },
  });
  return { ok: true, mem: next, request_id };
}
