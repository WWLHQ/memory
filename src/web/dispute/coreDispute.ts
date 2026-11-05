// 冲突裁决页（REQ-006 / P7）接真内核：队列与裁决**全部下沉到内核原子 API**（批次46-3）。
// - 配对：coreListConflicts() 只读真实账本（共享 conflict_id / pending=true 审计），
//   对手缺失、歧义、跨项目一律不入队；内核无检测引擎 → score/type 如实为 null。
// - 裁决：coreResolveConflict() 负责四 verdict + 成对审计 + 作用域 / locked 门禁。
//   端壳不再自行 _memoryOp / write，也不再硬编码 project_id:'P1' 与 conflict_score:0.8。
// 页面数据真相 = 内核账本；空账本 → 诚实空态，绝不注入演示/种子冲突。
import type { StorageBackend } from '../../core/memagent/types.ts';
import { coreListConflicts, coreResolveConflict } from '../../core/memagent/conflict.ts';
import { getKernelStorage } from '../kernel.ts';
import type { ConflictRecord, Verdict } from './types.ts';

const DAY = 24 * 3600 * 1000;

/** 测试可注入自己的 storage，避免污染全局 kernel 单例；页面缺省用真实内核账本 */
export interface DisputeCtx {
  storage: StorageBackend;
}

function getCtx(): DisputeCtx {
  return { storage: getKernelStorage() };
}

/** 内核真实配对 → UI 模型（正文/confidence 仍从账本读，不回显 L0 密文） */
export async function coreConflicts(ctx: DisputeCtx = getCtx()): Promise<ConflictRecord[]> {
  const { storage } = ctx;
  const [pairs, mems] = await Promise.all([
    coreListConflicts(storage),
    storage.listMemories({}),
  ]);
  const out: ConflictRecord[] = [];
  for (const pair of pairs) {
    const oldM = mems.find((m) => m.mem_id === pair.old_id);
    const newM = mems.find((m) => m.mem_id === pair.new_id);
    if (!oldM || !newM) continue; // 对手缺失 → 不伪造对
    const createdAt = oldM.created_at ?? Date.now();
    out.push({
      id: pair.conflict_id,
      old_id: oldM.mem_id,
      new_id: newM.mem_id,
      old_content: oldM.content ?? '',
      new_content: newM.content ?? '',
      old_confidence: oldM.confidence ?? 0.5,
      new_confidence: newM.confidence ?? 0.5,
      // 内核无 detect_conflicts 检测引擎：如实 null，不再硬编码 0.8 / 按正文猜类型
      conflict_type: pair.conflict_type,
      conflict_score: pair.conflict_score,
      dispute_flag: true,
      overdue_days: Math.max(0, Math.floor((Date.now() - createdAt) / DAY)),
      created_at: new Date(createdAt).toISOString(),
    });
  }
  return out.sort((x, y) => y.overdue_days - x.overdue_days);
}

export interface VerdictOutcome {
  kernel_request_ids: string[];
  merged_mem_id?: string;
}

/** 单次裁决 = 一次内核原子调用；project_id 取两条记忆的真实归属，不硬编码 */
export async function coreVerdict(
  rec: ConflictRecord,
  v: Verdict,
  ctx: DisputeCtx = getCtx(),
): Promise<VerdictOutcome> {
  const { storage } = ctx;
  const stripV = (id: string) => id.split('@')[0];
  const oldId = stripV(rec.old_id);
  const newId = stripV(rec.new_id);
  const oldM = await storage.getMemory(oldId);
  const r = await coreResolveConflict({
    old_id: oldId,
    new_id: newId,
    conflict_id: rec.id,
    // 对手缺失时传空串：内核会先如实返回「对手缺失」而不抛错（保住页面 toast 行为）
    project_id: oldM?.project_id ?? '',
    verdict: v,
  }, { storage, now: Date.now() });
  return {
    kernel_request_ids: [r.request_id],
    merged_mem_id: r.merged_mem_id,
  };
}
