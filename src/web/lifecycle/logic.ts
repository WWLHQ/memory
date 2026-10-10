// 生命周期页（REQ-006 / P4）纯逻辑层
// 全部为纯函数，便于单测覆盖（T2 验收）。
import type { LifeOp, LifecycleRecord, MemoryStatus, OpResult } from './types.ts';
import { M_DAYS, N_DAYS } from './seed.ts';

/** freshness = 0.5^(age/half)，下限 0.05（17.5） */
export function freshnessPreview(ageDays: number, halfLifeDays: number): number {
  const hl = halfLifeDays > 0 ? halfLifeDays : 1;
  return Math.max(0.05, Math.pow(0.5, ageDays / hl));
}

/** 六态机合法迁移（9.10.1/9.10.3）：任意活跃态 → 休眠/归档/过期/失效/休眠态；归档可恢复活跃；失效可恢复 */
export const STATUS_FLOW: Record<MemoryStatus, MemoryStatus[]> = {
  active: ['hibernating', 'archived', 'stale', 'deprecated', 'dormant'],
  hibernating: ['active', 'archived', 'dormant'],
  archived: ['active', 'dormant', 'deprecated'],
  deprecated: ['active'], // 替代/撤销替代
  stale: ['active', 'hibernating', 'archived'],
  dormant: ['active', 'archived'],
};

export function canMigrate(from: MemoryStatus, to: MemoryStatus): boolean {
  return STATUS_FLOW[from].includes(to);
}

/** 重要性 1–5 级映射（15.1，0–1 → 档） */
export function importanceLevel(importance: number): 1 | 2 | 3 | 4 | 5 {
  if (importance >= 0.9) return 5;
  if (importance >= 0.7) return 4;
  if (importance >= 0.5) return 3;
  if (importance >= 0.3) return 2;
  return 1;
}

/** hibernating 判定：age ≥ N(90) 天（9.10.1）；archived：age ≥ M(180) 天 */
export function staleCheck(rec: LifecycleRecord): { hibernate: boolean; archive: boolean } {
  return { hibernate: rec.ageDays >= N_DAYS, archive: rec.ageDays >= M_DAYS };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 应用生命周期操作（写审计 lifecycle_change + request_id，9.10.4/18.2-E） */
export function applyLifecycle(list: LifecycleRecord[], rec: LifecycleRecord, op: LifeOp, requestId: string): OpResult {
  if (op.kind === 'param') {
    if (rec.locked) {
      // G4：锁定态唯一可操作 = 解锁
      if (op.locked === false) {
        return {
          ok: true,
          affected: [{ ...rec, locked: false }],
          audit: 'lifecycle_change',
          request_id: requestId,
          message: '已解锁。',
        };
      }
      return { ok: false, affected: [], audit: 'lifecycle_change', request_id: requestId, message: '已锁定，先解锁才能调参。' };
    }
    const next: LifecycleRecord = { ...rec };
    if (op.half_life_days !== undefined) next.half_life_days = Math.max(1, op.half_life_days);
    if (op.confidence !== undefined) next.confidence = clamp(op.confidence, 0.05, 1);
    if (op.importance !== undefined) next.importance = clamp(op.importance, 0.1, 1);
    if (op.pinned !== undefined) next.pinned = op.pinned;
    if (op.locked !== undefined) next.locked = op.locked;
    return { ok: true, affected: [next], audit: 'lifecycle_change', request_id: requestId };
  }

  if (op.kind === 'migrate') {
    if (rec.locked) return { ok: false, affected: [], audit: 'lifecycle_change', request_id: requestId, message: '已锁定，先解锁才能迁移。' };
    if (!canMigrate(rec.status, op.target)) {
      return { ok: false, affected: [], audit: 'lifecycle_change', request_id: requestId, message: `非法迁移：${rec.status} → ${op.target}` };
    }
    const next = { ...rec, status: op.target } as LifecycleRecord;
    return { ok: true, affected: [next], audit: 'lifecycle_change', request_id: requestId };
  }

  // batch_migrate
  if (op.kind === 'batch_migrate') {
    const affected: LifecycleRecord[] = [];
    for (const id of op.ids) {
      const target = list.find((r) => r.id === id);
      if (!target) continue;
      if (target.locked) continue; // G4
      if (target.status === op.target) continue;
      if (!canMigrate(target.status, op.target)) continue;
      affected.push({ ...target, status: op.target });
    }
    return { ok: true, affected, audit: 'lifecycle_change', request_id: requestId };
  }

  return { ok: false, affected: [], audit: 'lifecycle_change', request_id: requestId };
}
