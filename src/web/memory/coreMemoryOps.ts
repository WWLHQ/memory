// 记忆管理页（REQ-006 / P8）接真内核：17.3 九操作统一走 ma._memoryOp
// module singleton：SEED_MEMORIES 灌入内核 InMemoryStorage，操作结果由内核返回（G4/钳制/版本/审计真实发生）。
import type { Memory, MemOp as CoreOp } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import type { MemAgent } from '../../core/memagent/types.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';
import { SEED_MEMORIES } from './seed.ts';
import { decayClass } from './logic.ts';
import type { MemoryOp, MemoryRecord, OpResult } from './types.ts';

const DAY = 24 * 3600 * 1000;

/** 页面六类（§P8）→ 内核六类（17.6） */
const TYPE_MAP: Record<MemoryRecord['type'], Memory['category']> = {
  decision: 'decision',
  pitfall: 'pitfall',
  preference: 'preference',
  fact: 'fact',
  project: 'decision',   // 工作项目 → 决策档
  feedback: 'insight',   // 反馈 → 洞察档
};

let agentP: Promise<MemAgent> | null = null;

function getAgent(): Promise<MemAgent> {
  if (!agentP) {
    agentP = (async () => {
      const ma = createMemAgent({
        form: 'web', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage: new InMemoryStorage(),
      });
      for (const r of SEED_MEMORIES) {
        await ma._seedMemory({
          mem_id: r.id,
          project_id: 'P1',
          content: r.content,
          category: TYPE_MAP[r.type],
          layer: 'L2',
          // 15.3 温度由 age/half_life 推导（复用页面 decayClass，种子语义一致）
          decay_class: decayClass(r),
          pinned: r.pinned,
          locked: r.locked,
          importance: r.importance,
          confidence: r.confidence,
          access_count: r.access_count,
          reinforce_count: r.reinforce_count,
          half_life_days: r.halfLifeDays,
          tags: r.tags,
          merged_from: r.merged_from,
          last_access_time: Date.now() - r.ageDays * DAY,
        });
      }
      return ma;
    })();
  }
  return agentP;
}

/** 内核 Memory → 页面 MemoryRecord：只覆盖操作涉及的字段，展示字段沿用原记录 */
function mergeBack(prev: MemoryRecord, m: Memory): MemoryRecord {
  const d = m.decay_class;
  return {
    ...prev,
    importance: m.importance ?? prev.importance,
    confidence: m.confidence ?? prev.confidence,
    pinned: m.pinned,
    locked: m.locked,
    archived: d === 'archived',
    status: d === 'archived' ? 'archived' : d === 'dormant' ? 'dormant' : prev.status,
    updated_at: new Date(m.updated_at ?? Date.now()).toISOString(),
  };
}

/** 17.3 操作：内核执行（locked 拒绝 / 钳制 / 版本推进 / memory_op 审计）→ 映射页面回执 */
export async function coreApplyOp(rec: MemoryRecord, op: MemoryOp): Promise<OpResult> {
  const ma = await getAgent();
  const r = await ma._memoryOp(rec.id, op as CoreOp);
  if (!r.ok) {
    // G4：locked 约束拒绝（记录不变）
    return { rec, audit: 'locked_blocked', ok: false };
  }
  if (r.mem === null) {
    return { rec: null, audit: 'memory_delete', ok: true };
  }
  return { rec: mergeBack(rec, r.mem), audit: `memory_${op}`, ok: true };
}
