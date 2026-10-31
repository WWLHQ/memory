// 审计日志页单测夹具（仅测试用；页面数据真相 = 内核审计账本）。
import type { AuditEntry } from '../types.ts';
import type { AuditRecord } from '../../../core/memagent/types.ts';
import { getKernelStorage } from '../../kernel.ts';

export const SEED_AUDIT: AuditEntry[] = [
  {
    enterprise_id: 'ent_001', user_id: 'u1', ip_address: '10.0.0.5', device_info: 'desktop/Claude Code',
    action: 'recall', resource_type: 'memory', resource_id: 'mem_001',
    request_id: 'req_a1', payload_tokens: 820, pipeline_llm_tokens: 0, created_at: '2026-10-08T09:12:00.000Z',
  },
  {
    enterprise_id: 'ent_001', user_id: 'u1', ip_address: '10.0.0.5', device_info: 'desktop/Claude Code',
    action: 'mode_dispatch', resource_type: 'recall', resource_id: 'mem_001',
    request_id: 'req_a1', payload_tokens: 820, pipeline_llm_tokens: 0, created_at: '2026-10-08T09:12:01.000Z',
  },
  {
    enterprise_id: 'ent_001', user_id: 'u1', ip_address: '10.0.0.5', device_info: 'desktop/Claude Code',
    action: 'cold_recall', resource_type: 'memory', resource_id: 'mem_004',
    request_id: 'req_a1', payload_tokens: 820, pipeline_llm_tokens: 120, created_at: '2026-10-08T09:12:02.000Z',
  },
  {
    enterprise_id: 'ent_001', user_id: 'u2', ip_address: '10.0.0.9', device_info: 'web/Chrome',
    action: 'write', resource_type: 'memory', resource_id: 'mem_020',
    request_id: 'req_b2', payload_tokens: 0, pipeline_llm_tokens: 0, created_at: '2026-10-08T10:30:00.000Z',
  },
  {
    enterprise_id: 'ent_001', user_id: 'u2', ip_address: '10.0.0.9', device_info: 'web/Chrome',
    action: 'merge', resource_type: 'memory', resource_id: 'mem_020',
    old_id: 'mem_006a', new_id: 'mem_020', request_id: 'req_b2',
    payload_tokens: 0, pipeline_llm_tokens: 300, created_at: '2026-10-08T10:30:05.000Z',
  },
  {
    enterprise_id: 'ent_001', user_id: 'u1', ip_address: '10.0.0.5', device_info: 'desktop/Claude Code',
    action: 'recall_breach', resource_type: 'recall', resource_id: 'mem_003',
    evidence_thin: true, request_id: 'req_c3', payload_tokens: 3050, pipeline_llm_tokens: 0,
    created_at: '2026-10-09T14:05:00.000Z',
  },
  {
    enterprise_id: 'ent_001', user_id: 'u1', ip_address: '10.0.0.5', device_info: 'desktop/Claude Code',
    action: 'evidence_thin', resource_type: 'recall', resource_id: 'mem_003',
    evidence_thin: true, request_id: 'req_c3', payload_tokens: 3050, pipeline_llm_tokens: 0,
    created_at: '2026-10-09T14:05:03.000Z',
  },
  {
    enterprise_id: 'ent_002', user_id: 'u9', ip_address: '192.168.1.20', device_info: 'api/worker',
    action: 'archive', resource_type: 'memory', resource_id: 'mem_007',
    old_status: 'active', new_status: 'archived', request_id: 'req_d4',
    payload_tokens: 0, pipeline_llm_tokens: 0, created_at: '2026-10-09T18:40:00.000Z',
  },
];

/**
 * 用例夹具：把页面级审计条目写进真实内核账本（append-only）。
 * 页面从账本回放（coreLoadAudit），因此单测也走真实链路，不再有内存伪数据。
 */
const KERNEL_ACTION: Record<string, AuditRecord['action']> = {
  recall: 'recall', mode_dispatch: 'recall', cold_recall: 'cold_recall',
  write: 'write', merge: 'merge', recall_breach: 'recall_breach',
  evidence_thin: 'evidence_thin', archive: 'memory_op',
};

export async function seedAuditLedger(entries: AuditEntry[] = SEED_AUDIT): Promise<void> {
  const storage = getKernelStorage();
  for (const e of entries) {
    await storage.appendAudit({
      request_id: e.request_id,
      action: KERNEL_ACTION[e.action] ?? 'recall',
      user_id: e.user_id,
      ts: Date.parse(e.created_at),
      detail: {
        action: e.action,
        resource_type: e.resource_type,
        resource_id: e.resource_id,
        enterprise_id: e.enterprise_id,
        ip_address: e.ip_address,
        device_info: e.device_info,
        old_status: e.old_status,
        new_status: e.new_status,
        old_id: e.old_id,
        new_id: e.new_id,
        evidence_thin: e.evidence_thin,
        payload_tokens: e.payload_tokens,
        pipeline_llm_tokens: e.pipeline_llm_tokens,
      },
    });
  }
}
