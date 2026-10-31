// 冲突裁决页（REQ-006 / P7）接真内核：队列 = 真实账本冲突（conflict_id 标记 + conflict_resolve 审计），
// 裁决走 ma._memoryOp（auto_override/merge 落定出队，user_confirm/hold 写审计保持 pending）。
// 数据真相 = 内核账本（桌面 Electron 下 = 主进程 FileStorage 持久库；浏览器降级内存态，无冲突诚实空态）。
// 与记忆库管理页一致：禁止注入演示/种子冲突 —— 队列只反映真实账本中 pending 冲突；
// 空账本/无冲突 → 页面诚实空态并引导去写入页产生真实记忆。
import type { MemAgent } from '../../core/memagent/types.ts';
import type { InMemoryStorage } from '../../core/memagent/storage.ts';
import { getKernel, getKernelStorage, newRequestId } from '../kernel.ts';
import type { ConflictRecord, Verdict } from './types.ts';

const DAY = 24 * 3600 * 1000;

function getCtx(): { ma: MemAgent; storage: InMemoryStorage } {
  return { ma: getKernel(), storage: getKernelStorage() };
}

/** 从真实账本读冲突队列：
 *  1) 记忆表里带 conflict_id 且未 archived/dormant 的记忆（9.7 挂起的冲突对）
 *  2) conflict_resolve 审计里「转人工」记录（内核真实冲突事件）
 *  无真实冲突 → 空数组（页面诚实空态） */
export async function coreConflicts(): Promise<ConflictRecord[]> {
  const { storage } = await getCtx();
  const [mems, audits] = await Promise.all([
    storage.listMemories({}),
    storage.queryAudit({ action: 'conflict_resolve' }),
  ]);

  // 路径 1：带 conflict_id 标记的 pending 冲突记忆（archived/dormant 视为已裁决出队）
  const pending: ConflictRecord[] = [];
  for (const m of mems) {
    if (!m.conflict_id) continue;
    if (m.decay_class === 'archived' || m.decay_class === 'dormant') continue; // 已裁决
    const partner = mems.find((o) => o.conflict_id === m.conflict_id && o.mem_id !== m.mem_id);
    if (!partner) continue; // 对手缺失（已删/已归档）→ 不伪造对
    const isOld = m.created_at <= partner.created_at;
    const oldM = isOld ? m : partner;
    const newM = isOld ? partner : m;
    const rec: ConflictRecord = {
      id: m.conflict_id,
      old_id: oldM.mem_id,
      new_id: newM.mem_id,
      old_content: oldM.content,
      new_content: newM.content,
      old_confidence: oldM.confidence ?? 0.5,
      new_confidence: newM.confidence ?? 0.5,
      // 类型：内核无独立 conflict_type 字段 → 诚实按内容实算（完全相同=uncertain，否则 direct_contradiction）
      conflict_type: oldM.content === newM.content ? 'uncertain' : 'direct_contradiction',
      conflict_score: 0.8, // 内核无独立 score 采样 → 中性 0.8（触发线 0.7 之上，诚实标注估算）
      dispute_flag: true,
      overdue_days: Math.max(0, Math.floor((Date.now() - (m.created_at ?? Date.now())) / DAY)),
      created_at: new Date(m.created_at ?? Date.now()).toISOString(),
    };
    // 去重：同 conflict_id 只入队一次（以较旧的 created_at 为准）
    const exists = pending.find((p) => p.id === rec.id);
    if (!exists || rec.created_at < exists.created_at) pending.push(rec);
  }

  // 路径 2：conflict_resolve 审计「转人工」事件（真实内核冲突记录；detail.extra.conflict = "old vs new"）
  for (const a of audits) {
    const extra = (a.detail as { extra?: { conflict?: string } })?.extra;
    const conflictRef = extra?.conflict;
    if (!conflictRef) continue;
    // "mem_020 vs mem_021" 解析
    const parts = conflictRef.split(/\s+vs\s+/i);
    if (parts.length !== 2) continue;
    const oldM = mems.find((m) => m.mem_id === parts[0]);
    const newM = mems.find((m) => m.mem_id === parts[1]);
    if (!oldM || !newM) continue; // 记忆已删/已归档 → 不伪造
    if (oldM.decay_class === 'archived' || newM.decay_class === 'archived') continue;
    const cid = `audit_${a.request_id}`;
    if (pending.find((p) => p.id === cid)) continue; // 路径 1 已覆盖
    pending.push({
      id: cid,
      old_id: oldM.mem_id,
      new_id: newM.mem_id,
      old_content: oldM.content,
      new_content: newM.content,
      old_confidence: oldM.confidence ?? 0.5,
      new_confidence: newM.confidence ?? 0.5,
      conflict_type: oldM.content === newM.content ? 'uncertain' : 'direct_contradiction',
      conflict_score: 0.8,
      dispute_flag: true,
      overdue_days: Math.max(0, Math.floor((Date.now() - (a.ts ?? Date.now())) / DAY)),
      created_at: new Date(a.ts ?? Date.now()).toISOString(),
      replaced_by: undefined,
    });
  }

  return pending.sort((x, y) => y.overdue_days - x.overdue_days);
}

export interface VerdictOutcome {
  kernel_request_ids: string[];
  merged_mem_id?: string;
}

/** 裁决（9.7 三模式 + 保留）→ 内核执行（真实写账本 + 审计）：
 *  auto_override：旧值 archived + 新值 confidence +0.1（真实落定）
 *  merge：双 archived + ma.write 生成合并记忆（真实查重）
 *  user_confirm / hold：写审计保持 pending（G6 全动作可查） */
export async function coreVerdict(rec: ConflictRecord, v: Verdict): Promise<VerdictOutcome> {
  const { ma, storage } = await getCtx();
  const kernelReqIds: string[] = [];
  const stripV = (id: string) => id.split('@')[0];
  const oldId = stripV(rec.old_id);
  const newId = stripV(rec.new_id);
  let mergedMemId: string | undefined;

  if (v === 'auto_override') {
    const r1 = await ma._memoryOp(oldId, 'archive');
    if (r1.request_id) kernelReqIds.push(r1.request_id);
    const r2 = await ma._memoryOp(newId, 'param', {
      confidence: Math.min(1, Math.round((rec.new_confidence + 0.1) * 100) / 100),
    });
    if (r2.request_id) kernelReqIds.push(r2.request_id);
  } else if (v === 'merge') {
    const r1 = await ma._memoryOp(oldId, 'archive');
    const r2 = await ma._memoryOp(newId, 'archive');
    kernelReqIds.push(r1.request_id, r2.request_id);
    const w = await ma.write({
      content: `【合并】${rec.old_content} ⟷ ${rec.new_content}`,
      category: 'fact', project_id: 'P1',
    });
    mergedMemId = w.mem_id;
    kernelReqIds.push(w.audit.request_id);
  }

  // user_confirm / hold：内核无状态变更，但操作本身写审计（G6 全动作可查）
  if (v === 'user_confirm' || v === 'hold') {
    await storage.appendAudit({
      request_id: newRequestId('req'),
      action: 'memory_op',
      form: 'web',
      project_id: 'P1',
      ts: Date.now(),
      detail: { op: 'dispute', verdict: v, old_id: rec.old_id, new_id: rec.new_id, conflict: rec.id },
    });
  }

  // 裁决事件入账（真实冲突事件：监控/日志/裁决队列都从这里回放，不再依赖种子）
  await storage.appendAudit({
    request_id: kernelReqIds[0] ?? newRequestId('req'),
    action: 'conflict_resolve',
    form: 'web',
    project_id: 'P1',
    ts: Date.now(),
    detail: {
      conflict_id: rec.id, verdict: v, old_id: oldId, new_id: newId,
      merged_mem_id: mergedMemId, request_ids: kernelReqIds,
      extra: { conflict: `${oldId} vs ${newId}` },
    },
  });

  return { kernel_request_ids: kernelReqIds, merged_mem_id: mergedMemId };
}
