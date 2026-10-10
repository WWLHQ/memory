// 冲突裁决页（REQ-006 / P7）接真内核：队列 = SyncHub 真实冲突，裁决走 resolve + _memoryOp
// module singleton：hub + agent 共用一套种子故事（SEED_CONFLICTS 提供类型/分数/超期元数据）。
// 并发版本（vclock concurrent + updated_at 相同）经 hub.push 真实产出 9.7 裁决队列。
import type { Memory } from '../../core/memagent/types.ts';
import { SyncHub } from '../../core/memagent/sync.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import type { MemAgent } from '../../core/memagent/types.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';
import { SEED_CONFLICTS } from './seed.ts';
import type { ConflictRecord, Verdict } from './types.ts';

interface Ctx {
  ma: MemAgent;
  hub: SyncHub;
  storage: InMemoryStorage;
}

let ctxP: Promise<Ctx> | null = null;

function getCtx(): Promise<Ctx> {
  if (!ctxP) {
    ctxP = (async () => {
      const storage = new InMemoryStorage();
      const ma = createMemAgent({
        form: 'web', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
      });
      const hub = new SyncHub();
      for (const s of SEED_CONFLICTS) {
        const t = Date.parse(s.created_at);
        // 端上记忆表：旧值/新值各一条（内核 _memoryOp 的操作对象）
        await ma._seedMemory({
          mem_id: s.old_id, project_id: 'P1', content: s.old_content, category: 'fact',
          layer: 'L2', confidence: s.old_confidence,
        });
        await ma._seedMemory({
          mem_id: s.new_id, project_id: 'P1', content: s.new_content, category: 'fact',
          layer: 'L2', confidence: s.new_confidence,
        });
        // 中枢账本：同一记忆的并发双版本 → 真实产出 conflict（全晚挂队列）
        const oldV: Memory = {
          mem_id: s.old_id, project_id: 'P1', enterprise_id: 'e_demo', team_id: 't_demo',
          category: 'fact', layer: 'L2', content: s.old_content,
          decay_class: 'hot', pinned: false, locked: false, version: 1,
          confidence: s.old_confidence, created_at: t, updated_at: t, vclock: { desktop: 1 },
        };
        const newV: Memory = {
          ...oldV, content: s.new_content, version: 2,
          confidence: s.new_confidence,
          // 并发改：移动端从未见过桌面版本 → vclock 只有 mobile（否则 ahead 直覆盖，无冲突）
          vclock: { mobile: 1 },
        };
        hub.push(oldV, 'desktop');
        hub.push(newV, 'mobile'); // concurrent + updated_at 相同 → conflict
      }
      return { ma, hub, storage };
    })();
  }
  return ctxP;
}

/** SyncHub conflict → 页面 ConflictRecord（类型/分数/超期按内容匹配种子元数据回填） */
function toRecord(c: ReturnType<SyncHub['listConflicts']>[number]): ConflictRecord | null {
  const seed = SEED_CONFLICTS.find((s) => s.old_content === c.remote.content && s.new_content === c.local.content);
  if (!seed) return null;
  return {
    id: c.conflict_id,
    old_id: `${c.remote.mem_id}@v${c.remote.version}`,
    new_id: `${c.local.mem_id}@v${c.local.version}`,
    old_content: c.remote.content,
    new_content: c.local.content,
    old_confidence: c.remote.confidence ?? seed.old_confidence,
    new_confidence: c.local.confidence ?? seed.new_confidence,
    conflict_type: seed.conflict_type,
    conflict_score: seed.conflict_score,
    dispute_flag: true,
    overdue_days: seed.overdue_days,
    created_at: seed.created_at,
  };
}

/** 内核裁决队列 → 页面记录（resolved 已出队） */
export async function coreConflicts(): Promise<ConflictRecord[]> {
  const { hub } = await getCtx();
  return hub.listConflicts().map(toRecord).filter((r): r is ConflictRecord => r !== null);
}

export interface VerdictOutcome {
  kernel_request_ids: string[]; // 内核真实 request_id（hub.resolve 审计在 hub.audits）
  merged_mem_id?: string;
}

/** 裁决（9.7 三模式 + 保留）→ 内核执行：
 *  auto_override：hub.resolve(local 胜) + 旧值 archived + 新值 confidence +0.1
 *  merge：hub.resolve + 双 archived + ma.write 生成合并记忆（真实查重）
 *  user_confirm / hold：保持 pending（镜像维持旧值，即"保留旧值/挂起"） */
export async function coreVerdict(rec: ConflictRecord, v: Verdict): Promise<VerdictOutcome> {
  const { ma, hub, storage } = await getCtx();
  // 页面记录（可能来自种子态）→ hub conflict：按新旧内容匹配
  const conflict = hub.listConflicts().find(
    (c) => c.remote.content === rec.old_content && c.local.content === rec.new_content,
  );
  const kernelReqIds: string[] = [];
  const stripV = (id: string) => id.split('@')[0];
  const oldId = stripV(rec.old_id);
  const newId = stripV(rec.new_id);
  let mergedMemId: string | undefined;

  if (v === 'auto_override' || v === 'merge') {
    if (conflict) hub.resolve(conflict.conflict_id, 'local'); // 镜像落定：新值胜（9.7）
  }

  if (v === 'auto_override' && conflict) {
    const r1 = await ma._memoryOp(oldId, 'archive');
    if (r1.request_id) kernelReqIds.push(r1.request_id);
    const r2 = await ma._memoryOp(newId, 'param', {
      confidence: Math.min(1, Math.round((rec.new_confidence + 0.1) * 100) / 100),
    });
    if (r2.request_id) kernelReqIds.push(r2.request_id);
  } else if (v === 'merge' && conflict) {
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
      request_id: `req_${rec.id.slice(0, 12)}`,
      action: 'memory_op',
      form: 'web',
      project_id: 'P1',
      ts: Date.now(),
      detail: { op: 'dispute', verdict: v, old_id: rec.old_id, new_id: rec.new_id, conflict: conflict?.conflict_id ?? rec.id },
    });
  }

  return { kernel_request_ids: kernelReqIds, merged_mem_id: mergedMemId };
}
