// 日志记录页（REQ-011 / P15）接真内核：审计流存内核 InMemoryStorage（append-only），
// L0 解锁走 ma.browse（真实写 l0_view 审计 → 日志流实时可见）。
// ⚠ 禁止注入演示/种子数据：日志完全来自真实操作（l0_view / 其他 audit 动作），空库即空列表。
import type { MemAgent } from '../../core/memagent/types.ts';
import type { AuditRecord } from '../../core/memagent/types.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { getKernel, getKernelStorage } from '../kernel.ts';
import type { LogEntry } from './types.ts';

interface LogsCtx {
  ma: MemAgent;
  storage: StorageBackend;
}

function getCtx(): LogsCtx {
  return { ma: getKernel(), storage: getKernelStorage() };
}

/** 内核审计行 → 页面 LogEntry（展示映射，列表与链路查询共用） */
function toLogEntry(a: AuditRecord): LogEntry {
  const d = a.detail as { message?: string; level?: LogEntry['level']; extra?: LogEntry['extra'] };
  return {
    ts: new Date(a.ts).toISOString(),
    level: d.level ?? (a.action === 'llm_fallback' ? 'warn' : 'info'),
    form: a.form ?? 'web',
    action: a.action as LogEntry['action'],
    request_id: a.request_id,
    message: d.message ?? JSON.stringify(a.detail).slice(0, 120),
    ref_audit: a.request_id || undefined,
    extra: d.extra,
  };
}

/** 内核审计流 → 页面 LogEntry（展示映射） */
export async function coreLoadLogs(): Promise<LogEntry[]> {
  const { storage } = await getCtx();
  const audits = await storage.queryAudit({});
  return audits.map(toLogEntry);
}

/**
 * 审计全链路（18.2-E / R-LOG6）：按 request_id 真查内核账本，时间升序。
 * 查无 → 空数组；内核不可达 → 原样上抛（调用方须区分「查无记录」与「查不了」，
 * 旧 modal 两者都不查、只把 request_id 印成「（真实审计记录）」。
 */
export async function coreAuditChain(requestId: string): Promise<LogEntry[]> {
  const { storage } = await getCtx();
  const audits = await storage.queryAudit({ request_id: requestId });
  return audits.map(toLogEntry).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/** 用已建立的连续 L0 会话真读 L0（每次查阅内核写 l0_view 审计）。
 *  - ok：有解密内容；empty：L0 层真实为空；null：会话过期/被撤销/读取失败（内核已写审计） */
export async function coreL0Browse(
  l0SessionId: string,
): Promise<{ status: 'ok' | 'empty'; sample?: string } | null> {
  const { ma } = await getCtx();
  try {
    const r = await ma.browse({ layer: 'L0', project_id: 'P1', l0_auth: { l0_session_id: l0SessionId } });
    if (!r.rows || r.rows.length === 0) return { status: 'empty' };
    return { status: 'ok', sample: r.rows[0]?.content };
  } catch {
    return null; // E_AUTH_L0 / E_L0_EXPIRED / E_L0_NO_GRANT：内核已写审计
  }
}
