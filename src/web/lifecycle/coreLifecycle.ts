// 生命周期页（REQ-006 / P4）接真内核：迁移/调参/批量统一走 ma._memoryOp
// 数据真相 = 内核账本（桌面 Electron 下 = 主进程 FileStorage 持久库；浏览器降级内存态）。
// 与记忆库管理页一致：禁止注入演示/种子数据 —— 列表只反映账本真实内容；
// 空账本 → 页面诚实空态并引导去写入页产生真实记忆。
import type { MemAgent, Memory } from '../../core/memagent/types.ts';
import type { InMemoryStorage } from '../../core/memagent/storage.ts';
import { getKernel, getKernelStorage } from '../kernel.ts';
import { policyFor } from '../../core/memagent/forgetting.ts';
import { canMigrate } from './logic.ts';
import type { LifeOp, LifecycleRecord, MemoryStatus, OpResult } from './types.ts';

const DAY = 24 * 3600 * 1000;

/** 内核五档温度（17.7）→ 页面六态（9.10.1）：读到的 decay_class 翻译成六态 chip。
 *  诚实口径：内核无 stale/deprecated 独立标记，只翻译可推的 4 态（active/hibernating/archived/dormant）。 */
export const DECAY_TO_STATUS: Record<Memory['decay_class'], MemoryStatus> = {
  hot: 'active',
  warm: 'active',
  cold: 'hibernating',
  archived: 'archived',
  dormant: 'dormant',
};

/** 六态（9.10.1）→ 内核五档温度（17.7）：迁移时写 decay_class */
export const STATUS_TO_DECAY: Record<MemoryStatus, Memory['decay_class']> = {
  active: 'hot',
  hibernating: 'cold',
  stale: 'cold',
  deprecated: 'archived',
  archived: 'archived',
  dormant: 'dormant',
};

/** 共享 storage（与全部页面同源） */
function getStorage(): InMemoryStorage {
  return getKernelStorage();
}

/** 内核单例由 kernel.ts 收敛；模型配置变更会重建单例，此处不得再缓存旧实例 */
function getAgent(): Promise<MemAgent> {
  return Promise.resolve(getKernel());
}

/** 内核 Memory → 页面 LifecycleRecord：六态由真实 decay_class 翻译；参数取真实字段 */
export function toLifecycleRecord(m: Memory): LifecycleRecord {
  const ageDays = Math.max(0, Math.floor((Date.now() - (m.created_at ?? Date.now())) / DAY));
  return {
    id: m.mem_id,
    content: m.content,
    status: DECAY_TO_STATUS[m.decay_class],
    ageDays,
    half_life_days: m.half_life_days ?? policyFor(m.category).half_life_days,
    confidence: m.confidence ?? 0.5,
    importance: m.importance ?? 0.5,
    access_count: m.access_count ?? 0,
    reinforce_count: m.reinforce_count ?? 0,
    pinned: m.pinned,
    locked: m.locked,
    decay_class: m.decay_class,
  };
}

/** 从真实账本读全量生命周期列表（页面唯一真相源，无种子兜底） */
export async function coreListLifecycle(): Promise<LifecycleRecord[]> {
  const storage = getStorage();
  const mems = await storage.listMemories({});
  return mems.map(toLifecycleRecord);
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
    status: status ?? DECAY_TO_STATUS[m.decay_class],
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
