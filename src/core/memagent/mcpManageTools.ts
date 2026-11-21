// MCP 治理工具编排（批次44-D5-2）：feedback / manage_memory。
// TCP(8202) 与 HTTP(8204) 共用同一份参数校验、令牌作用域校验、delete 门禁与字段裁剪，避免两端漂移。
//
// 红线：
// ① L0 不泄——回执里的 mem 一律经 toMemoryView 白名单裁剪，绝不返回原始 Memory；
// ② 越界不泄——按 mem_id 操作时先读项目再校验，报错文案不带项目 ID、不回显记忆正文；
// ③ delete 默认关闭，需服务端 MCP_ALLOW_DELETE=1 或显式注入 allowDelete 才放行；
// ④ 内核错误语义原样保留（不存在 ok:false / locked 的 blocked_locked / delete 后 mem:null），
//    MCP 层不得提前 return 绕过 coreMemoryOp 的 G4 locked 检查与审计。
//
// 与 APP 页面的互通口径（字段命名不同、语义与账本同一）：
//   APP `FeedbackDraft.memory_id/action`（FeedbackAction = confirm|reject|disputed）
//     ↔ MCP `feedback.mem_id/verdict` ↔ 内核 `FeedbackKind`，同走 coreFeedback；
//   APP `coreMemoryOps` 的 17.3 操作 ↔ MCP `manage_memory.action` ↔ 内核 `MemOp`，同走 coreMemoryOp。
// MCP 侧统一用 mem_id 以对齐 get_memory / recall_memory 的 hits[].mem_id，不引入 APP 的 memory_id 别名。
import { projectInScope, type McpAccount } from './mcpAuth.ts';
import { McpToolError } from './mcpRecall.ts';
import { toMemoryView, type MemoryView } from './mcpReadTools.ts';
import { ulid } from './ulid.ts';
import type {
  DecayClass, FeedbackKind, MemAgent, MemOp, MemOpPatch, StorageBackend,
} from './types.ts';

const VERDICTS: readonly FeedbackKind[] = ['confirm', 'reject', 'disputed'];
const MEM_OPS: readonly MemOp[] = [
  'remember', 'forget', 'pin', 'unpin', 'lock', 'unlock',
  'archive', 'restore', 'delete', 'param', 'migrate',
];
const DECAY_CLASSES: readonly DecayClass[] = ['hot', 'warm', 'cold', 'archived', 'dormant'];
const PATCH_KEYS = ['importance', 'confidence', 'half_life_days', 'pinned', 'locked', 'decay_class'];

/** delete 门禁：服务端环境变量 MCP_ALLOW_DELETE=1 才在缺省配置下放行（浏览器/无 process 环境恒 false） */
export function deleteAllowed(): boolean {
  return typeof process !== 'undefined' && process.env.MCP_ALLOW_DELETE === '1';
}

export interface ManageToolOpts {
  /** 是否放行不可逆的 delete（服务端开关）；由两端在启动时一次性注入 */
  allowDelete: boolean;
}

export interface FeedbackToolResult {
  ok: boolean;
  mem: MemoryView | null;
  trust_delta: number;
  request_id: string;
  /** M1-3：反馈→召回归因结果（linked=false 时不写 recall_feedback 审计，绝不把猜测当标签） */
  recall_link: { linked: boolean; recall_id: string | null };
  /** 批次 A1：implicit confirm 弱信号（不动信任分，只 reinforce_count+1，进评估样本池） */
  implicit?: boolean;
  /** 批次 A1：同一 request_id+mem_id 已记过隐式反馈（幂等去重，不再重复 +1） */
  duplicate?: boolean;
}

export interface ManageToolResult {
  ok: boolean;
  mem: MemoryView | null;
  request_id: string;
  /** G4：目标是 locked 记忆且 action ≠ unlock 时由内核置 true */
  blocked_locked?: boolean;
}

function requiredId(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new McpToolError(`${field} 必填且须为非空字符串`);
  return v.trim();
}

/** 越界即拒；不存在时交给内核回 ok:false（诚实降级，不补造空记录、不提前泄露项目信息） */
async function assertInScope(storage: StorageBackend, memId: string, account: McpAccount): Promise<void> {
  const m = await storage.getMemory(memId);
  if (m && !projectInScope(account, m.project_id)) {
    throw new McpToolError('当前 MCP 令牌作用域不含该 mem_id 所属项目（三池可见性校验，D6-2）');
  }
}

function numberInRange(v: unknown, field: string, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
    throw new McpToolError(`manage_memory.patch.${field} 须为 ${lo}–${hi} 的数字`);
  }
  return v;
}

/** patch 仅 param/migrate 可用；未知字段、越界值一律报错，不静默丢弃也不靠内核悄悄钳制 */
function parsePatch(raw: unknown, action: MemOp): MemOpPatch {
  if (raw === undefined) {
    if (action === 'migrate') throw new McpToolError('manage_memory.migrate 须提供 patch.decay_class');
    if (action === 'param') throw new McpToolError('manage_memory.param 须提供至少一个 patch 字段');
    return {};
  }
  if (action !== 'param' && action !== 'migrate') {
    throw new McpToolError(`manage_memory.patch 仅 action=param/migrate 可用（当前 action=${action}）`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new McpToolError('manage_memory.patch 须为对象');
  }
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!PATCH_KEYS.includes(k)) throw new McpToolError(`manage_memory.patch.${k} 不受支持`);
  }
  if (action === 'migrate' && obj.decay_class === undefined) {
    throw new McpToolError('manage_memory.migrate 须提供 patch.decay_class');
  }
  if (action === 'param' && Object.keys(obj).length === 0) {
    throw new McpToolError('manage_memory.param 须提供至少一个 patch 字段');
  }
  const patch: MemOpPatch = {};
  if (obj.importance !== undefined) patch.importance = numberInRange(obj.importance, 'importance', 0.1, 1);
  if (obj.confidence !== undefined) patch.confidence = numberInRange(obj.confidence, 'confidence', 0.05, 1);
  if (obj.half_life_days !== undefined) {
    const v = obj.half_life_days;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      throw new McpToolError('manage_memory.patch.half_life_days 须为 ≥1 的整数');
    }
    patch.half_life_days = v;
  }
  if (obj.pinned !== undefined) {
    if (typeof obj.pinned !== 'boolean') throw new McpToolError('manage_memory.patch.pinned 须为布尔值');
    patch.pinned = obj.pinned;
  }
  if (obj.locked !== undefined) {
    if (typeof obj.locked !== 'boolean') throw new McpToolError('manage_memory.patch.locked 须为布尔值');
    patch.locked = obj.locked;
  }
  if (obj.decay_class !== undefined) {
    if (typeof obj.decay_class !== 'string' || !DECAY_CLASSES.includes(obj.decay_class as DecayClass)) {
      throw new McpToolError(`manage_memory.patch.decay_class 非法（允许：${DECAY_CLASSES.join('/')}）`);
    }
    patch.decay_class = obj.decay_class as DecayClass;
  }
  return patch;
}

/**
 * 用户反馈：trust_delta 由内核 coreFeedback 计算，MCP 层不自行判定。
 * 批次 A1（记忆闭环方案）：verdict=confirm 可携 implicit=true —— 「引用即隐式确认」弱信号口：
 * 不走 coreFeedback（confidence 一分不动），只 reinforce_count+1 并落两条审计
 * （memory_op[op=confirm,implicit] + recall_feedback[implicit]——后者会被 recallEval
 * 自动当强标签进评估样本池，这正是「只进样本池」的落点）。
 * 红线：必须能归因到具体召回（linked=false 直接拒绝，不写任何标签，M1-4）；
 * 同一 request_id + mem_id 幂等去重，重复返回 duplicate:true 且不再 +1（防刷）。
 */
export async function runFeedbackTool(
  ma: MemAgent,
  storage: StorageBackend,
  args: Record<string, unknown>,
  account: McpAccount,
): Promise<FeedbackToolResult> {
  const memId = requiredId(args.mem_id, 'feedback.mem_id');
  const verdict = args.verdict;
  if (typeof verdict !== 'string' || !VERDICTS.includes(verdict as FeedbackKind)) {
    throw new McpToolError(`feedback.verdict 非法：${String(verdict)}（允许：${VERDICTS.join('/')}）`);
  }
  // 批次 A1：implicit 仅布尔且仅 confirm 可携，其它组合明确拒绝，不静默降级
  const implicit = args.implicit === true;
  if (args.implicit !== undefined && typeof args.implicit !== 'boolean') {
    throw new McpToolError('feedback.implicit 须为布尔值');
  }
  if (implicit && verdict !== 'confirm') {
    throw new McpToolError(`feedback.implicit 仅 verdict=confirm 可用（当前 verdict=${verdict}）：隐式信号只在采信 [n] 时提交`);
  }
  // M1-3：可选 recall_id（产生该记忆的召回 request_id）；显式给了就必须是合法非空串
  const rawRecallId = args.recall_id;
  if (rawRecallId !== undefined && (typeof rawRecallId !== 'string' || !rawRecallId.trim())) {
    throw new McpToolError('feedback.recall_id 非法：须为非空字符串（recall_memory 回执里的 request_id）');
  }
  await assertInScope(storage, memId, account);

  // ── 批次 A1：implicit confirm 弱信号分支（内核 coreFeedback 一行不改） ──
  if (implicit) {
    return runImplicitConfirm(storage, memId, account,
      typeof rawRecallId === 'string' ? rawRecallId.trim() : undefined);
  }

  // 内核行为一行不改：trust_delta 仍由 coreFeedback 计算（M1-3 只新增归因审计）
  const r = await ma.feedback(memId, verdict as FeedbackKind);
  // M1-3 归因：显式 recall_id 优先，否则按「最近一次含该 mem_id 的召回」自动关联；
  // 关联不到只回 linked:false，不写 recall_feedback，绝不把猜测当标签（M1-4）。
  const recallLink = await resolveRecallLink(
    storage, memId, typeof rawRecallId === 'string' ? rawRecallId.trim() : undefined, r.mem?.project_id,
  );
  if (recallLink.linked && recallLink.recall_id) {
    const ts = Date.now();
    await storage.appendAudit({
      request_id: r.request_id, action: 'recall_feedback', ts,
      project_id: r.mem?.project_id, user_id: account.user_id,
      detail: { recall_id: recallLink.recall_id, mem_id: memId, verdict, ts },
    });
  }
  return {
    ok: r.ok,
    mem: r.mem ? toMemoryView(r.mem) : null,
    trust_delta: r.trust_delta,
    request_id: r.request_id,
    recall_link: recallLink,
  };
}

/**
 * 批次 A1：implicit confirm 弱信号落地（MCP 层，内核 coreFeedback 一行不改）。
 * - 必须能归因到具体召回（linked=false 直接拒绝——不可归因的弱信号既无法去重也不该当标签）；
 * - 幂等去重：同一 request_id + mem_id 只记一次（查 recall_feedback 审计里 implicit 条目）；
 * - 只 reinforce_count+1（version+1 / updated_at 照走），confidence 不动（trust_delta 恒 0）；
 * - 不延寿、不触发降档（弱信号只进评估样本池，批次 C 才给显式 confirm 加延寿）。
 */
async function runImplicitConfirm(
  storage: StorageBackend,
  memId: string,
  account: McpAccount,
  explicitRecallId: string | undefined,
): Promise<FeedbackToolResult> {
  const recallLink = await resolveRecallLink(storage, memId, explicitRecallId, undefined);
  if (!recallLink.linked || !recallLink.recall_id) {
    throw new McpToolError(
      'feedback.implicit 关联不到召回审计（recall_link.linked=false）：不可归因的隐式信号不记录，'
      + '请携带本次 recall_memory 回执的 request_id 作为 recall_id',
    );
  }
  const recallId = recallLink.recall_id;
  const requestId = `req_${ulid()}`;
  const now = Date.now();

  // 防刷去重：同一 request_id + mem_id 已记过 → 幂等返回，不再 +1、不再写审计
  const past = await storage.queryAudit({ action: 'recall_feedback' });
  const already = past.some((a) => {
    const d = a.detail;
    return d.implicit === true && d.recall_id === recallId && d.mem_id === memId;
  });
  const current = await storage.getMemory(memId);
  if (!current) {
    return { ok: false, mem: null, trust_delta: 0, request_id: requestId, recall_link: recallLink };
  }
  if (already) {
    return {
      ok: true, mem: toMemoryView(current), trust_delta: 0, request_id: requestId,
      recall_link: recallLink, implicit: true, duplicate: true,
    };
  }

  // 只强化计数，不动信任分（confidence / half_life_days / decay_class 一律不碰）
  const next = {
    ...current,
    reinforce_count: (current.reinforce_count ?? 0) + 1,
    version: current.version + 1,
    updated_at: now,
  };
  await storage.putMemory(next);
  // 状态变更照走 memory_op 审计（trust_delta 诚实为 0，reinforce_only 标明不是打分确认）
  await storage.appendAudit({
    request_id: requestId, action: 'memory_op', ts: now, project_id: current.project_id,
    user_id: account.user_id,
    detail: { op: 'confirm', implicit: true, trust_delta: 0, reinforce_only: true, mem_id: memId },
  });
  // 复用 recall_feedback action（implicit 标记区分强弱）：recallEval 会自动当强标签进评估样本池
  await storage.appendAudit({
    request_id: requestId, action: 'recall_feedback', ts: now,
    project_id: current.project_id, user_id: account.user_id,
    detail: { recall_id: recallId, mem_id: memId, verdict: 'confirm', implicit: true, ts: now },
  });
  return {
    ok: true, mem: toMemoryView(next), trust_delta: 0, request_id: requestId,
    recall_link: recallLink, implicit: true,
  };
}

/**
 * M1-3：把一次反馈归因到具体召回。
 * - 显式 recallId：必须真实存在且其 `detail.mems` 含该 mem_id 才算 linked（否则如实 linked:false）；
 * - 未显式给：在同项目、`detail.mems` 含该 mem_id 的召回里取 ts 最新一条；
 * - 关联不到 → `{ linked:false, recall_id:null }`，调用方据此**不写** recall_feedback 审计（M1-4）。
 */
async function resolveRecallLink(
  storage: StorageBackend,
  memId: string,
  explicitRecallId: string | undefined,
  projectId: string | undefined,
): Promise<{ linked: boolean; recall_id: string | null }> {
  const recalls = await storage.queryAudit({ action: 'recall' });
  const hasMem = (a: (typeof recalls)[number]): boolean => {
    const mems = a.detail.mems;
    return Array.isArray(mems) && mems.includes(memId);
  };
  if (explicitRecallId) {
    const hit = recalls.find((a) => a.request_id === explicitRecallId && hasMem(a));
    return hit ? { linked: true, recall_id: explicitRecallId } : { linked: false, recall_id: null };
  }
  const pool = recalls.filter(
    (a) => hasMem(a) && (!projectId || a.project_id === undefined || a.project_id === projectId),
  );
  if (pool.length === 0) return { linked: false, recall_id: null };
  pool.sort((a, b) => b.ts - a.ts);
  return { linked: true, recall_id: pool[0].request_id };
}

/** 单条生命周期变更：11 个 op 全量转发 coreMemoryOp，locked / 版本 / 审计语义原样保留 */
export async function runManageMemoryTool(
  ma: MemAgent,
  storage: StorageBackend,
  args: Record<string, unknown>,
  account: McpAccount,
  opts: ManageToolOpts,
): Promise<ManageToolResult> {
  const memId = requiredId(args.mem_id, 'manage_memory.mem_id');
  const action = args.action;
  if (typeof action !== 'string' || !MEM_OPS.includes(action as MemOp)) {
    throw new McpToolError(`manage_memory.action 非法：${String(action)}（允许：${MEM_OPS.join('/')}）`);
  }
  const op = action as MemOp;
  if (op === 'delete' && !opts.allowDelete) {
    throw new McpToolError(
      'manage_memory.delete 默认不开放：需服务端开启 MCP_ALLOW_DELETE=1 且用户明确要求删除；'
      + '请改用 forget（降权不删）或 archive（归档可恢复）',
    );
  }
  const patch = parsePatch(args.patch, op);
  await assertInScope(storage, memId, account);
  const r = await ma.memoryOp(memId, op, patch);
  return {
    ok: r.ok,
    ...(r.blocked_locked ? { blocked_locked: true } : {}),
    mem: r.mem ? toMemoryView(r.mem) : null,
    request_id: r.request_id,
  };
}
