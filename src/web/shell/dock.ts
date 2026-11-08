// 底部面板真实数据源（S6）：输出=程序动作日志尾读；问题=该日志派生的错误/警告；
// 审计=当前选中对象在本机账本里的审计行；任务=账本 schedule_run 执行记录。
//
// 口径（与全站零演示数据一致）：
// - 每个加载器只返回 ok / unavailable（有明确原因）/ error 三态；
// - unavailable 绝不退化成 0 条：0 只在「真实读到了、确实是空」时出现；
// - 浏览器模式读不到主进程日志/调度记录时给原因，不猜数。

import type { AuditRecord } from '../../core/memagent/types.ts';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import type { ActionLogTailResult } from '../../shared/actionLog.ts';
import { SCHEDULE_TASKS } from '../../shared/growthConfig.ts';
import { parseProgramLogLine, type ProgramLogLine } from '../Home/programLog.ts';
import { getKernelStorage } from '../kernel.ts';
import { currentSessionId } from '../shared/session.ts';

export type DockResult<T> =
  | { status: 'ok'; view: T }
  | { status: 'unavailable'; detail: string }
  | { status: 'error'; detail: string };

/* ── 输出：程序动作日志 ─────────────────────────────── */

export interface OutputLogView {
  /** actions.log 绝对路径；日志未初始化时为 null */
  path: string | null;
  /** 真实尾读行（已由主进程脱敏） */
  lines: ProgramLogLine[];
  scanLines: number;
  capturedAt: number;
}

export async function loadOutputLog(scanLines = 50): Promise<DockResult<OutputLogView>> {
  if (hostCapability() === 'none') {
    return { status: 'unavailable', detail: '浏览器模式：没有主进程，读不到本机 actions.log；请在桌面端查看。' };
  }
  try {
    const res = await hostCall<ActionLogTailResult>('log:tail', [scanLines]);
    if (!res?.ok) {
      return { status: 'error', detail: res?.error ?? '日志读取失败（主进程未返回原因）' };
    }
    return {
      status: 'ok',
      view: {
        path: res.path ?? null,
        lines: (res.lines ?? []).map((l) => parseProgramLogLine(l)),
        scanLines,
        capturedAt: Date.now(),
      },
    };
  } catch (e) {
    return { status: 'error', detail: String((e as Error)?.message ?? e) };
  }
}

/** 问题面板：从真实日志派生错误/警告行（不是独立的问题库，标题里必须写明来源） */
export interface ProblemRow {
  ts: string | null;
  level: 'warn' | 'error';
  scope: string;
  action: string;
  message: string;
}

export function problemsFromLog(view: OutputLogView): ProblemRow[] {
  return view.lines
    .filter((l): l is ProgramLogLine & { level: 'warn' | 'error' } => l.level === 'warn' || l.level === 'error')
    .map((l) => ({ ts: l.ts, level: l.level, scope: l.scope, action: l.action, message: l.message }));
}

/* ── 任务：账本 schedule_run 执行记录 ─────────────────── */

export interface ScheduleRun {
  requestId: string;
  taskKey: string;
  /** 任务中文名（取共享真源 SCHEDULE_TASKS；未知 key 原样显示） */
  label: string;
  trigger: string;
  /** 主进程回报的真实状态（'ok' / 'error' / 其它原样） */
  status: string;
  startedAt: number | null;
  durationMs: number | null;
  nextDueAt: number | null;
  error: string | null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function scheduleRunFrom(a: AuditRecord): ScheduleRun {
  const d = a.detail as Record<string, unknown>;
  const key = typeof d.task === 'string' ? d.task : '';
  const spec = SCHEDULE_TASKS.find((t) => t.key === key);
  return {
    requestId: a.request_id,
    taskKey: key || '未标注（审计 detail 无 task）',
    label: spec?.label ?? (key || '未标注任务'),
    trigger: typeof d.trigger === 'string' ? d.trigger : '未记录',
    status: typeof d.status === 'string' ? d.status : '未记录',
    startedAt: num(d.started_at) ?? (Number.isFinite(a.ts) ? a.ts : null),
    durationMs: num(d.duration_ms),
    nextDueAt: num(d.next_due_at),
    error: typeof d.error === 'string' ? d.error : null,
  };
}

export async function loadScheduleRuns(limit = 20): Promise<DockResult<ScheduleRun[]>> {
  // 调度由主进程执行并写本机账本；浏览器未登录时只有进程内空账本，读它只会得到误导性的 0。
  if (hostCapability() === 'none' && !currentSessionId()) {
    return {
      status: 'unavailable',
      detail: '未登录：浏览器使用进程内内存账本，读不到主进程的调度运行记录；请在桌面端查看。',
    };
  }
  try {
    const rows = await getKernelStorage().queryAudit({ action: 'schedule_run' });
    const runs = rows.map(scheduleRunFrom).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    return { status: 'ok', view: runs.slice(0, limit) };
  } catch (e) {
    return { status: 'error', detail: String((e as Error)?.message ?? e) };
  }
}

/* ── 审计：当前选中对象的账本审计行 ───────────────────── */

export interface AuditRow {
  requestId: string;
  action: string;
  ts: number;
  /** detail 的紧凑摘要（原样 JSON 截断，不做解读） */
  summary: string;
}

/** 一条审计记录是否指向该记忆：优先认已知字段，再退回 detail 全文精确包含 */
export function auditMentions(a: AuditRecord, memId: string): boolean {
  if (!memId) return false;
  const d = a.detail as Record<string, unknown>;
  for (const k of ['mem_id', 'resource_id', 'new_id', 'old_id', 'id']) {
    if (typeof d[k] === 'string' && d[k] === memId) return true;
  }
  try {
    return JSON.stringify(d).includes(memId);
  } catch {
    return false;
  }
}

function auditRowFrom(a: AuditRecord): AuditRow {
  let summary = '（detail 无法序列化）';
  try {
    const s = JSON.stringify(a.detail);
    summary = s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    /* 保留上面给的原因 */
  }
  return { requestId: a.request_id, action: a.action, ts: a.ts, summary };
}

export async function loadAuditForMemory(memId: string, limit = 20): Promise<DockResult<AuditRow[]>> {
  if (!memId) return { status: 'unavailable', detail: '未选中对象：审计没有可过滤的键。' };
  try {
    const audits = await getKernelStorage().queryAudit({});
    const rows = audits.filter((a) => auditMentions(a, memId)).map(auditRowFrom).sort((a, b) => b.ts - a.ts);
    return { status: 'ok', view: rows.slice(0, limit) };
  } catch (e) {
    return { status: 'error', detail: String((e as Error)?.message ?? e) };
  }
}
