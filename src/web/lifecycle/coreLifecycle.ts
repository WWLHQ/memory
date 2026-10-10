// 生命周期页（REQ-006 / P4）接真内核：迁移/调参/批量统一走 ma._memoryOp
// module singleton：SEED_LIFECYCLE 灌入内核；六态→内核温度映射在此，锁定(G4)由内核拒绝。
import type { MemAgent, Memory } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';
import { SEED_LIFECYCLE } from './seed.ts';
import { canMigrate } from './logic.ts';
import type { LifeOp, LifecycleRecord, MemoryStatus, OpResult } from './types.ts';

const DAY = 24 * 3600 * 1000;

/** 六态（9.10.1）→ 内核五档温度（17.7）：迁移时写 decay_class */
export const STATUS_TO_DECAY: Record<MemoryStatus, Memory['decay_class']> = {
  active: 'hot',
  hibernating: 'cold',
  stale: 'cold',
  deprecated: 'archived',
  archived: 'archived',
  dormant: 'dormant',
};

let agentP: Promise<MemAgent> | null = null;

function getAgent(): Promise<MemAgent> {
  if (!agentP) {
    agentP = (async () => {
      const ma = createMemAgent({
        form: 'web', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage: new InMemoryStorage(),
      });
      for (const r of SEED_LIFECYCLE) {
        await ma._seedMemory({
          mem_id: r.id,
          project_id: 'P1',
          content: r.content,
          category: 'fact',
          layer: 'L2',
          decay_class: r.decay_class,
          pinned: r.pinned,
          locked: r.locked,
          importance: r.importance,
          confidence: r.confidence,
          access_count: r.access_count,
          reinforce_count: r.reinforce_count,
          half_life_days: r.half_life_days,
          last_access_time: Date.now() - r.ageDays * DAY,
        });
      }
      return ma;
    })();
  }
  return agentP;
}

/** 内核 Memory → 页面 LifecycleRecord：温度/参数回填，六态由迁移目标回填 */
function mergeBack(prev: LifecycleRecord, m: Memory, status?: MemoryStatus): LifecycleRecord {
  return {
    ...prev,
    importance: m.importance ?? prev.importance,
    confidence: m.confidence ?? prev.confidence,
    half_life_days: m.half_life_days ?? prev.half_life_days,
    pinned: m.pinned,
    locked: m.locked,
    decay_class: m.decay_class,
    status: status ?? prev.status,
  };
}

/** 迁移单条：内核 _memoryOp('migrate') + G4/合法性校验 */
async function migrateOne(rec: LifecycleRecord, target: MemoryStatus): Promise<{ ok: boolean; rec?: LifecycleRecord; request_id: string; message?: string }> {
  if (!canMigrate(rec.status, target)) {
    return { ok: false, request_id: '', message: `非法迁移：${rec.status} → ${target}` };
  }
  if (rec.status === target) {
    return { ok: true, rec, request_id: '' }; // 已处目标态，跳过
  }
  const ma = await getAgent();
  const r = await ma._memoryOp(rec.id, 'migrate', { decay_class: STATUS_TO_DECAY[target] });
  if (!r.ok) {
    return { ok: false, request_id: r.request_id, message: '已锁定（G4）：仅可解锁' };
  }
  return { ok: true, rec: r.mem ? mergeBack(rec, r.mem, target) : rec, request_id: r.request_id };
}

/** 页面编排入口：与 applyLifecycle 同语义（OpResult），数据变更由内核执行 */
export async function coreLifeOp(records: LifecycleRecord[], rec: LifecycleRecord, op: LifeOp): Promise<OpResult> {
  if (op.kind === 'migrate') {
    const r = await migrateOne(rec, op.target);
    return {
      ok: r.ok, affected: r.rec ? [r.rec] : [], audit: 'lifecycle_change',
      request_id: r.request_id, message: r.message,
    };
  }
  if (op.kind === 'param') {
    const ma = await getAgent();
    // G4：锁定态唯一可操作 = 解锁（op.locked === false → 内核 unlock）
    if (rec.locked && op.locked === false) {
      const r = await ma._memoryOp(rec.id, 'unlock');
      return {
        ok: r.ok, affected: r.mem ? [mergeBack(rec, r.mem)] : [rec],
        audit: 'lifecycle_change', request_id: r.request_id, message: r.ok ? '已解锁。' : '已锁定（G4）',
      };
    }
    const r = await ma._memoryOp(rec.id, 'param', op);
    if (!r.ok) {
      return { ok: false, affected: [], audit: 'lifecycle_param', request_id: r.request_id, message: '已锁定（G4）：仅可解锁' };
    }
    return {
      ok: true,
      affected: r.mem ? [mergeBack(rec, r.mem)] : [rec],
      audit: 'lifecycle_param', request_id: r.request_id,
    };
  }
  // batch_migrate：逐条走内核；锁定(G4)与已处目标态自动跳过
  const affected: LifecycleRecord[] = [];
  let requestId = '';
  for (const id of op.ids) {
    const target = records.find((r) => r.id === id);
    if (!target) continue;
    const r = await migrateOne(target, op.target);
    if (r.request_id) requestId = r.request_id;
    if (r.ok && r.rec && r.rec !== target) affected.push(r.rec);
  }
  return { ok: true, affected, audit: 'lifecycle_change', request_id: requestId };
}
