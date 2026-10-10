// 日志记录页（REQ-011 / P15）纯逻辑层
// R-LOG1 error 恒置顶 / R-LOG2 缺审计链补 n/a / R-LOG3 L0 授权 / R-LOG8 审计删除需 Admin。
import type { ErrorKind, L0State, LogEntry, LogFilter } from './types.ts';

const WINDOW_MS: Record<LogFilter['window'], number> = {
  '5min': 5 * 60e3, '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3,
};

/** R-LOG2：每条日志必带 request_id，缺失补 `n/a` 并标记告警 */
export function ensureRequestId(list: LogEntry[]): { fixed: LogEntry[]; missing: number } {
  let missing = 0;
  const fixed = list.map((l) => {
    if (!l.request_id) {
      missing += 1;
      return { ...l, request_id: 'n/a' };
    }
    return l;
  });
  return { fixed, missing };
}

/** error 分类（§2.3）：按 extra.kind 或 action 推断 */
export function classifyError(l: LogEntry): ErrorKind | null {
  if (l.level !== 'error') return null;
  const kind = String(l.extra?.kind ?? '');
  if (kind.includes('熔断')) return 'breaker_open';
  if (kind.includes('同步')) return 'sync_fail';
  if (kind.includes('额度')) return 'quota_exceed';
  if (kind.includes('L0')) return 'l0_decrypt_fail';
  if (kind.includes('向量')) return 'vector_error';
  if (kind.includes('冲突')) return 'conflict_pending';
  return null;
}

/** 异常聚合（§2.3）：按类型分组 + 处置入口 */
export const ERROR_TARGET: Record<ErrorKind, string> = {
  breaker_open: 'P10 Agent 接入页',
  sync_fail: '查看 extra（重试同步）',
  quota_exceed: 'P13 大模型配置',
  l0_decrypt_fail: '重新授权',
  vector_error: '回退 JS 实现',
  conflict_pending: 'P8 冲突裁决页',
};

export function aggrErrors(list: LogEntry[]): { kind: ErrorKind; count: number; target: string }[] {
  const map = new Map<ErrorKind, number>();
  for (const l of list) {
    const k = classifyError(l);
    if (k) map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([kind, count]) => ({ kind, count, target: ERROR_TARGET[kind] }));
}

/** R-LOG1 + §2.1：过滤六维 AND，error 恒置顶（不被时间窗过滤掉），同级 ts 倒序 */
export function filterLogs(list: LogEntry[], f: LogFilter, now = Date.now()): LogEntry[] {
  const errors = list.filter((l) => l.level === 'error');
  const others = list.filter((l) => l.level !== 'error');
  const byLevel = (arr: LogEntry[]) =>
    arr.filter((l) => {
      if (f.level !== 'all' && l.level !== f.level) return false;
      if (f.form !== 'all' && l.form !== f.form) return false;
      if (f.actions.length > 0 && !f.actions.includes(l.action)) return false;
      if (f.onlyAbnormal && l.level === 'info') return false;
      const kw = f.keyword.trim().toLowerCase();
      if (kw && !`${l.request_id} ${l.message} ${l.agent ?? ''}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  const sortTs = (arr: LogEntry[]) => [...arr].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  // error 独立通道：仅异常=只看 error+warn；关键词等过滤仍适用，但 error 不受时间窗限制（R-LOG1）
  const keptErrors = byLevel(errors).filter((l) => {
    const kw = f.keyword.trim().toLowerCase();
    if (kw && !`${l.request_id} ${l.message} ${l.agent ?? ''}`.toLowerCase().includes(kw)) return false;
    if (f.form !== 'all' && l.form !== f.form) return false;
    if (f.actions.length > 0 && !f.actions.includes(l.action)) return false;
    return true;
  });
  const keptOthers = byLevel(others).filter((l) => {
    const age = now - new Date(l.ts).getTime();
    return age <= WINDOW_MS[f.window];
  });
  return [...sortTs(keptErrors), ...sortTs(keptOthers)];
}

/** R-LOG3：L0 授权。密码固定 `l0pass`（demo）；错 5 次锁 15min；每次成功 l0_view 记审计 */
export const L0_PASSWORD = 'l0pass';
export const L0_MAX_FAIL = 5;
export const L0_LOCK_MS = 15 * 60e3;

export function l0Auth(pwd: string, state: L0State, now = Date.now()): { state: L0State; ok: boolean; message: string } {
  if (state.role !== 'admin') return { state, ok: false, message: '非管理员：L0 恒遮罩，需管理员授权' };
  if (state.lockedUntil && now < state.lockedUntil) {
    const min = Math.ceil((state.lockedUntil - now) / 60e3);
    return { state, ok: false, message: `已锁定（l0_auth_fail），剩余 ${min} 分钟` };
  }
  if (pwd === L0_PASSWORD) {
    return { state: { ...state, unlocked: true, failCount: 0, lockedUntil: null }, ok: true, message: '已解锁（本次会话有效，l0_view 已记审计）' };
  }
  const failCount = state.failCount + 1;
  if (failCount >= L0_MAX_FAIL) {
    return {
      state: { ...state, failCount, lockedUntil: now + L0_LOCK_MS },
      ok: false,
      message: `密码错误，已记审计；连续 ${L0_MAX_FAIL} 次锁定 15 分钟`,
    };
  }
  return { state: { ...state, failCount }, ok: false, message: '密码错误，已记审计' };
}

/** R-LOG8：审计删除仅 Admin + 二次确认 + 写 audit_delete（不可无痕） */
export function canDeleteAudit(role: 'admin' | 'member', confirmed: boolean): { allowed: boolean; reason: string } {
  if (role !== 'admin') return { allowed: false, reason: '普通用户无删除权限（R-LOG8）' };
  if (!confirmed) return { allowed: false, reason: '需二次确认' };
  return { allowed: true, reason: '将写审计 action=audit_delete（记录删除者/时间/范围，不可无痕）' };
}
