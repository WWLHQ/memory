import { describe, it, expect } from 'vitest';
import { actionLabel, filterEntries, chainByRequest, exportCsv, exportJson } from '../logic.ts';
import { SEED_AUDIT } from '../seed.ts';
import type { AuditAction, AuditEntry, AuditFilter } from '../types.ts';

const ent = (over: Partial<AuditEntry>): AuditEntry => ({
  enterprise_id: 'ent_001', user_id: 'u1', ip_address: '10.0.0.5', device_info: 'desktop/X',
  action: 'recall', resource_type: 'memory', resource_id: 'm1',
  request_id: 'r1', payload_tokens: 0, pipeline_llm_tokens: 0,
  created_at: '2026-10-08T09:00:00.000Z', ...over,
});

describe('actionLabel', () => {
  it('可读化 4.3 枚举', () => {
    expect(actionLabel('recall')).toBe('召回');
    expect(actionLabel('recall_breach')).toBe('召回超支');
    expect(actionLabel('mode_dispatch')).toBe('模式分流');
  });
});

describe('filterEntries', () => {
  const list = [
    ent({ user_id: 'u1', action: 'recall', request_id: 'r1' }),
    ent({ user_id: 'u2', action: 'write', request_id: 'r2' }),
    ent({ enterprise_id: 'ent_002', user_id: 'u9', action: 'archive', request_id: 'r3' }),
  ];
  it('按 user_id 过滤', () => {
    const r = filterEntries(list, { user_id: 'u2' } as AuditFilter);
    expect(r).toHaveLength(1);
    expect(r[0].action).toBe('write');
  });
  it('按 action 过滤', () => {
    expect(filterEntries(list, { action: 'recall' as AuditAction })).toHaveLength(1);
  });
  it('按 enterprise_id 过滤', () => {
    expect(filterEntries(list, { enterprise_id: 'ent_002' })).toHaveLength(1);
  });
  it('组合过滤（AND）', () => {
    expect(filterEntries(list, { user_id: 'u1', action: 'recall' as AuditAction })).toHaveLength(1);
    expect(filterEntries(list, { user_id: 'u1', action: 'write' as AuditAction })).toHaveLength(0);
  });
  it('时间区间过滤', () => {
    const list2 = [
      ent({ created_at: '2026-10-08T09:00:00.000Z' }),
      ent({ user_id: 'u2', created_at: '2026-10-08T10:00:00.000Z' }),
      ent({ enterprise_id: 'ent_002', user_id: 'u9', created_at: '2026-10-09T18:00:00.000Z' }),
    ];
    const r = filterEntries(list2, { from: '2026-10-08T00:00:00.000Z', to: '2026-10-08T23:59:59.000Z' } as AuditFilter);
    expect(r).toHaveLength(2);
  });
});

describe('chainByRequest', () => {
  it('返回同 request_id 全部行并按时间升序', () => {
    const chain = chainByRequest(SEED_AUDIT, 'req_a1');
    expect(chain).toHaveLength(3);
    expect(chain[0].action).toBe('recall');
    expect(chain[2].action).toBe('cold_recall');
  });
  it('无匹配返回空', () => {
    expect(chainByRequest(SEED_AUDIT, 'nope')).toHaveLength(0);
  });
});

describe('导出', () => {
  it('exportCsv 含表头与行', () => {
    const csv = exportCsv(SEED_AUDIT.slice(0, 1));
    expect(csv.split('\n')[0]).toContain('request_id');
    expect(csv.split('\n')).toHaveLength(2);
  });
  it('exportCsv 转义含逗号/引号字段', () => {
    const csv = exportCsv([ent({ device_info: 'a,b"c' })]);
    expect(csv).toContain('"a,b""c"');
  });
  it('exportJson 可解析回原数组', () => {
    const json = exportJson(SEED_AUDIT);
    expect(JSON.parse(json)).toHaveLength(SEED_AUDIT.length);
  });
});
