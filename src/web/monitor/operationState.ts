// REQ-013 / C5：异步操作真实状态机（借鉴 dsh-hindsight 的 operation 状态语义）。
//
// 核心口径（对比报告 §4 P0#3 / Hindsight 对标）：
//   · 409 = 「排队中」(queued)，**不是失败**——服务端已受理但尚未处理完，应继续轮询；
//   · 2xx = 已完成；其余 4xx/5xx = 失败；
//   · 未知（undefined / 网络中断）= running（进行中），宁可继续轮询也不谎报失败。
//
// 纯函数、零 IO：监控页 / 审计页 / 轮询器共用同一份口径，避免各处各写一套状态判断而漂移。
// 边界：只读真实审计（audit.jsonl）做展示与轮询判定，**不改审计落盘**（AGENTS §0.1 / T6 边界）。
import type { AuditRecord } from '../../core/memagent/types.ts';

export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed';

const HOUR = 3600 * 1000;

/** HTTP 语义 → 操作状态（409=排队中，非失败；2xx=成功；其余数字=失败；未知=进行中）。 */
export function classifyOperationOutcome(httpStatus?: number): OperationStatus {
  if (typeof httpStatus !== 'number' || !Number.isFinite(httpStatus)) return 'running';
  if (httpStatus === 409) return 'queued';
  if (httpStatus >= 200 && httpStatus < 300) return 'succeeded';
  return 'failed';
}

/** 终态：已完成 / 失败（不会再变，可停止轮询）。 */
export function isTerminal(s: OperationStatus): boolean {
  return s === 'succeeded' || s === 'failed';
}

/** 是否应继续轮询（排队中 / 进行中 → 继续；终态 → 停）。 */
export function shouldKeepPolling(s: OperationStatus): boolean {
  return !isTerminal(s);
}

/** 第 attempt 次重试后的下次轮询延迟（指数退避 + 封顶；attempt 从 1 起）。 */
export function nextPollDelay(attempt: number, baseMs = 2000, capMs = 30_000): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(capMs, baseMs * Math.pow(2, n - 1));
}

/** 状态中文文案（UI 展示用：把「排队中」与「失败」明确区分开）。 */
export function operationLabel(s: OperationStatus): string {
  switch (s) {
    case 'queued': return '排队中';
    case 'running': return '进行中';
    case 'succeeded': return '已完成';
    case 'failed': return '失败';
  }
}

/** 把一组操作状态汇总为计数（UI 用；键固定覆盖四态）。 */
export function summarizeOperations(states: Iterable<OperationStatus>): Record<OperationStatus, number> {
  const out: Record<OperationStatus, number> = { queued: 0, running: 0, succeeded: 0, failed: 0 };
  for (const s of states) out[s] += 1;
  return out;
}

/** 一条真实审计对应的后台操作（展示用；只读派生，不新增任何审计写入）。 */
export interface OperationEntry {
  request_id: string;
  action: string;
  /** 中文标签（审计 action → 人读名） */
  label: string;
  status: OperationStatus;
  ts: number;
}

/** 单类审计的映射规则：人读名 + 「从 detail 判状态」的纯函数。 */
interface OperationSpec {
  label: string;
  status: (detail: Record<string, unknown>) => OperationStatus;
}

/** detail.error 有值即失败，否则成功（完成记录类审计的通用口径）。 */
function okUnlessError(detail: Record<string, unknown>): OperationStatus {
  const err = detail.error;
  return typeof err === 'string' && err.trim() !== '' ? 'failed' : 'succeeded';
}

/**
 * REQ-013 / C5：真实审计 action → 后台操作语义（唯一映射表，页面/轮询器共用）。
 *
 * 只收「本机真会产生」的审计（2026-11-14 实测 audit.jsonl 结构确认为准）：
 *   · sync_*       —— 同步（本机 remote=false 时不会产生）
 *   · schedule_run —— 定时任务，detail.status=ok/error
 *   · memory_op    —— 逐层精炼队列，detail.op=layer_refine
 *   · graft        —— 记忆合并（score/threshold）
 *   · gc           —— 遗忘周期（forgetting_cycle）
 *   · auto_bind    —— Agent 一键接入，detail.result=pass / status=CONNECTED
 * 这些都是**完成记录**，所以只会判出 succeeded/failed；queued/running 留给真异步接口，
 * 绝不从审计里凭空造出「排队中」。
 */
export const OPERATION_ACTION_SPECS: Readonly<Record<string, OperationSpec>> = {
  sync_up: { label: '同步上传', status: () => 'succeeded' },
  sync_down: { label: '同步下载', status: () => 'succeeded' },
  sync_reconcile: { label: '同步对账', status: () => 'succeeded' },
  sync_fail: { label: '同步失败', status: () => 'failed' },
  schedule_run: {
    label: '定时任务',
    status: (d) => {
      if (d.status === 'ok') return 'succeeded';
      if (d.status === 'error' || d.status === 'failed') return 'failed';
      return 'running';
    },
  },
  memory_op: { label: '记忆精炼', status: okUnlessError },
  graft: { label: '记忆合并', status: okUnlessError },
  gc: { label: '遗忘周期', status: okUnlessError },
  auto_bind: {
    label: 'Agent 接入',
    status: (d) => (d.result === 'pass' || d.status === 'CONNECTED' ? 'succeeded' : 'failed'),
  },
};

/**
 * 从真实审计按 request_id 取每个后台操作的最新一条（窗口内），按时间倒序返回。
 * 复用 audit.jsonl、只读不改落盘；无相关审计 → 空数组（诚实空态）。
 * now / windowMs 可注入以便确定性测试。
 */
export function operationEntriesFromAudits(
  audits: AuditRecord[], now: number = Date.now(), windowMs: number = 24 * HOUR,
): OperationEntry[] {
  const latest = new Map<string, OperationEntry>();
  for (const a of audits) {
    const spec = OPERATION_ACTION_SPECS[a.action];
    if (!spec) continue;
    if (typeof a.ts !== 'number' || a.ts < now - windowMs) continue;
    const detail = (a.detail ?? {}) as Record<string, unknown>;
    const prev = latest.get(a.request_id);
    if (prev && a.ts < prev.ts) continue;
    latest.set(a.request_id, {
      request_id: a.request_id,
      action: a.action,
      label: spec.label,
      status: spec.status(detail),
      ts: a.ts,
    });
  }
  return [...latest.values()].sort((x, y) => y.ts - x.ts);
}

/** 只要状态列表（汇总计数用；与 operationEntriesFromAudits 同一份派生，不另起一套口径）。 */
export function operationStatusFromAudits(
  audits: AuditRecord[], now: number = Date.now(), windowMs: number = 24 * HOUR,
): OperationStatus[] {
  return operationEntriesFromAudits(audits, now, windowMs).map((e) => e.status);
}

/**
 * 轮询直到终态：按 nextPollDelay 退避重试，每次取最新 HTTP 码，终态即停并返回。
 * fetchStatus 与 sleep 可注入，便于单测；真实调用传 fetch 包装（返回 response.status）。
 */
export async function pollOperationUntilTerminal(
  fetchStatus: () => Promise<number | undefined>,
  opts: {
    baseMs?: number; capMs?: number; maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<OperationStatus> {
  const baseMs = opts.baseMs ?? 2000;
  const capMs = opts.capMs ?? 30_000;
  const maxAttempts = opts.maxAttempts ?? 30;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let status: OperationStatus = 'running';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    status = classifyOperationOutcome(await fetchStatus());
    if (isTerminal(status)) return status;
    if (attempt < maxAttempts) await sleep(nextPollDelay(attempt, baseMs, capMs));
  }
  return status;
}
