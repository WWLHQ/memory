// 调度计划纯函数（M0）：把「当前配置的表达式」与「历史 schedule_run 审计」合并成确定的下次到期。
//
// 为什么必须单独成纯函数而不是写在 main.ts 里：
//   `task.expr` 在主进程有**两处**消费点——启动时从历史审计反推 next_due、运行期推进 next_due。
//   只改一处就会出现「改了频率却不生效 / 提前触发」的静默漂移，而这种 bug 只有抽成纯函数才锁得住。
import { nextDue } from './cron.ts';
import { DEFAULT_SCHEDULE_EXPRS, type ScheduleKey } from './growthConfig.ts';

/** 表达式不可达时的兜底：按 24h 推进（与改造前 `?? row.ts + 24h` 逐字一致） */
export const SCHEDULE_FALLBACK_MS = 24 * 3600_000;

export interface SchedulePlanInput {
  key: ScheduleKey;
  /** 当前生效表达式（已 resolve，保证可解析） */
  expr: string;
  /** 历史审计里记录的表达式；旧记录没有该字段 → null */
  audit_expr: string | null;
  /** 历史审计里记录的 next_due_at；缺失/非法 → null */
  audit_next_due: number | null;
  /** 该条审计的发生时刻（重算的起算点） */
  last_run_ts: number;
  tz_offset_min: number;
}

/**
 * 历史 next_due 是否已失效（必须按新表达式重算）。
 *
 * 两种失效情形：
 *  ① 审计记录的 expr 与当前表达式不同 —— 那条 next_due 是按旧节奏算出来的；
 *  ② 旧审计没有 expr 字段（无法比对），且当前表达式已不是默认值 —— 同样视为失效。
 *
 * 为什么②也要算失效：改造前的历史行可能没写 expr，用户此时若已把频率从默认改掉，
 * 沿用旧 next_due 就等于「改了不生效」；宁可多算一次确定性纯函数，也不留静默漂移。
 */
export function isAuditPlanStale(
  i: Pick<SchedulePlanInput, 'key' | 'expr' | 'audit_expr'>,
): boolean {
  return i.audit_expr !== null
    ? i.audit_expr !== i.expr
    : i.expr !== DEFAULT_SCHEDULE_EXPRS[i.key];
}

/**
 * 启动恢复：可信的历史 next_due 优先，否则按当前表达式从 last_run 重算。
 * 不可达 → last_run + 24h（与改造前兜底一致，绝不返回 NaN/null 让调用方崩在比较上）。
 */
export function planNextDue(i: SchedulePlanInput): number {
  if (!isAuditPlanStale(i) && i.audit_next_due !== null && Number.isFinite(i.audit_next_due)) {
    return i.audit_next_due;
  }
  return nextDue(i.expr, i.last_run_ts, i.tz_offset_min) ?? i.last_run_ts + SCHEDULE_FALLBACK_MS;
}

/** 运行期推进：一律按当前表达式从现在算下一次（不看历史，历史只用于启动恢复） */
export function advanceNextDue(expr: string, fromMs: number, tzOffsetMin: number): number {
  return nextDue(expr, fromMs, tzOffsetMin) ?? fromMs + SCHEDULE_FALLBACK_MS;
}
