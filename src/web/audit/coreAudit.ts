// 审计日志页（REQ-006 / P11）接真内核：审计流存内核 InMemoryStorage（append-only），
// 查询经 storage.queryAudit（§3.2 全动作可查）。⚠ 禁止注入演示/种子数据：
// 审计完全来自真实操作（内核写账本）；空库即空列表。
import type { AuditAction as CoreAuditAction, AuditRecord, MemAgent } from '../../core/memagent/types.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { getKernel, getKernelStorage, getTenant } from '../kernel.ts';
import type { AuditEntry, AuditFilter } from './types.ts';

interface AuditCtx {
  ma: MemAgent;
  storage: StorageBackend;
}

function getCtx(): AuditCtx {
  return { ma: getKernel(), storage: getKernelStorage() };
}

/**
 * 内核 AuditRecord → 页面 AuditEntry 映射。
 * 真实内核审计字段有限（无 ip_address/device_info/enterprise_id 细粒度来源），
 * 取不到时统一填'—'，不伪造。resource_id 取 detail.mem_id / detail.resource_id / detail.id。
 */
function toAuditEntry(a: AuditRecord): AuditEntry {
  const d = a.detail as Record<string, unknown>;
  const tenant = getTenant();
  const rid = (d.mem_id ?? d.resource_id ?? d.id ?? '账本无链路') as string;
  const resultRaw = (d.result ?? d.status ?? d.outcome) as string | undefined;
  const noteRaw = (d.message ?? d.note ?? d.reason) as string | undefined;
  return {
    enterprise_id: (d.enterprise_id as string) ?? tenant.enterprise_id,
    user_id: a.user_id ?? (d.user_id as string) ?? tenant.user_id,
    ip_address: (d.ip_address as string) ?? '无',
    device_info: (d.device_info as string) ?? '无',
    action: (d.action as AuditEntry['action']) ?? (a.action as unknown as AuditEntry['action']),
    resource_type: (d.resource_type as string) ?? 'memory',
    resource_id: rid,
    old_status: d.old_status as string | undefined,
    new_status: d.new_status as string | undefined,
    old_id: d.old_id as string | undefined,
    new_id: d.new_id as string | undefined,
    evidence_thin: d.evidence_thin as boolean | undefined,
    request_id: a.request_id,
    payload_tokens: (d.payload_tokens as number) ?? 0,
    pipeline_llm_tokens: (d.pipeline_llm_tokens as number) ?? 0,
    created_at: new Date(a.ts).toISOString(),
    agent: a.agent ?? (d.agent as string) ?? undefined,
    result: resultRaw || undefined,
    source: (d.source as string) ?? (a.agent ? `agent: ${a.agent}` : undefined),
    duration_ms: typeof d.duration_ms === 'number' ? d.duration_ms : undefined,
    note: noteRaw || undefined,
  };
}

/** datetime-local / ISO → 毫秒；解析失败不传后端（不静默改变筛选语义） */
function toMs(v?: string): number | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

/**
 * 内核审计账本 → 页面 AuditEntry。
 * 动作 / 时间 / request_id / agent 四维全部下推真实 queryAudit；
 * 过滤后的展示仍走页面纯逻辑（同一份语义），空库即空列表。
 */
export async function coreLoadAudit(filter: AuditFilter = {}): Promise<AuditEntry[]> {
  const { storage } = await getCtx();
  const audits = await storage.queryAudit({
    request_id: filter.request_id || undefined,
    action: filter.action ? (filter.action as unknown as CoreAuditAction) : undefined,
    since: toMs(filter.from),
    until: toMs(filter.to),
    agent: filter.agent || undefined,
  });
  return audits
    .map(toAuditEntry)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}
