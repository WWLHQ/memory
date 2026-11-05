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
import { projectInScope } from './mcpAuth.ts';
import { McpToolError } from './mcpRecall.ts';
import { toMemoryView, type MemoryView } from './mcpReadTools.ts';
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
async function assertInScope(storage: StorageBackend, memId: string, scope?: string[]): Promise<void> {
  const m = await storage.getMemory(memId);
  if (m && !projectInScope(scope, m.project_id)) {
    throw new McpToolError('当前 MCP 令牌作用域不含该 mem_id 所属项目（scope 校验）');
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

/** 用户反馈：trust_delta 由内核 coreFeedback 计算，MCP 层不自行判定 */
export async function runFeedbackTool(
  ma: MemAgent,
  storage: StorageBackend,
  args: Record<string, unknown>,
  scope?: string[],
): Promise<FeedbackToolResult> {
  const memId = requiredId(args.mem_id, 'feedback.mem_id');
  const verdict = args.verdict;
  if (typeof verdict !== 'string' || !VERDICTS.includes(verdict as FeedbackKind)) {
    throw new McpToolError(`feedback.verdict 非法：${String(verdict)}（允许：${VERDICTS.join('/')}）`);
  }
  await assertInScope(storage, memId, scope);
  const r = await ma.feedback(memId, verdict as FeedbackKind);
  return {
    ok: r.ok,
    mem: r.mem ? toMemoryView(r.mem) : null,
    trust_delta: r.trust_delta,
    request_id: r.request_id,
  };
}

/** 单条生命周期变更：11 个 op 全量转发 coreMemoryOp，locked / 版本 / 审计语义原样保留 */
export async function runManageMemoryTool(
  ma: MemAgent,
  storage: StorageBackend,
  args: Record<string, unknown>,
  scope: string[] | undefined,
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
  await assertInScope(storage, memId, scope);
  const r = await ma.memoryOp(memId, op, patch);
  return {
    ok: r.ok,
    ...(r.blocked_locked ? { blocked_locked: true } : {}),
    mem: r.mem ? toMemoryView(r.mem) : null,
    request_id: r.request_id,
  };
}
