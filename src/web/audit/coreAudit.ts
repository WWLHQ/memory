// 审计日志页（REQ-006 / P11）接真内核：审计流存内核 InMemoryStorage（append-only），
// 查询经 storage.queryAudit（§3.2 全动作可查）。⚠ 禁止注入演示/种子数据：
// 审计完全来自真实操作（内核写账本）；空库即空列表。
import type { AuditRecord, MemAgent } from '../../core/memagent/types.ts';
import type { InMemoryStorage } from '../../core/memagent/storage.ts';
import { getKernel, getKernelStorage, getTenant } from '../kernel.ts';
import type { AuditEntry } from './types.ts';

interface AuditCtx {
  ma: MemAgent;
  storage: InMemoryStorage;
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
  const rid = (d.mem_id ?? d.resource_id ?? d.id ?? '—') as string;
  return {
    enterprise_id: (d.enterprise_id as string) ?? tenant.enterprise_id,
    user_id: a.user_id ?? (d.user_id as string) ?? tenant.user_id,
    ip_address: (d.ip_address as string) ?? '—',
    device_info: (d.device_info as string) ?? '—',
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
  };
}

/** 内核审计账本 → 页面 AuditEntry（链路追踪/过滤/导出仍在页面纯逻辑层；空库即空列表） */
export async function coreLoadAudit(): Promise<AuditEntry[]> {
  const { storage } = await getCtx();
  const audits = await storage.queryAudit({});
  return audits
    .map(toAuditEntry)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}
