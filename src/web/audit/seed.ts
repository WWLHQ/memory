// 审计日志页（REQ-006 / P11）种子数据
// 覆盖各 action 样例；含同一 request_id 多条以演示链路追踪（18.2-E）。
import type { AuditEntry } from './types.ts';

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
