// 批次61 GAP-3 单元用例（规格 C2/C3/C4）：Agent 侧使用画像。
// 断言口径：每个数字都能在给定审计里逐条数出来 —— 不估算、不补零、不把缺 client 猜成某个 Agent。
import { describe, expect, it } from 'vitest';
import {
  CLIENT_UNKNOWN, GC_CONCURRENCY_NOTE, readAgentUsage, summarizeAgentUsage,
} from '../agentUsage.ts';
import { InMemoryStorage } from '../storage.ts';
import type { AuditRecord } from '../types.ts';

const NOW = 1_800_000_000_000;
const DAY = 24 * 3600_000;

function recall(ts: number, o: { client?: string; saved?: number; thin?: boolean } = {}): AuditRecord {
  return {
    request_id: `req_r_${ts}`, action: 'recall', form: 'desktop', project_id: 'P1', ts,
    detail: {
      hits: 2,
      ...(o.client ? { client: o.client } : {}),
      ...(o.saved !== undefined ? { saved_tokens: o.saved } : {}),
      evidence_thin: o.thin === true,
    },
  } as AuditRecord;
}

function call(ts: number, agent: string, o: { reliable?: boolean; first?: boolean; recalled?: boolean } = {}): AuditRecord {
  return {
    request_id: `req_c_${ts}`, action: 'mcp_call', agent, ts,
    detail: {
      session_id: o.reliable === false ? 'ua-fallback' : 's1',
      reliable: o.reliable !== false,
      first_call: o.first === true,
      recalled_before: o.recalled === true,
      tool: 'recall_memory',
    },
  } as AuditRecord;
}

function op(ts: number, kind: 'confirm' | 'reject' | 'disputed', memId = 'm1'): AuditRecord {
  return {
    request_id: `req_o_${ts}`, action: 'memory_op', form: 'desktop', project_id: 'P1', ts,
    detail: { op: kind, mem_id: memId },
  } as AuditRecord;
}

describe('summarizeAgentUsage（C2：每个数字与审计逐条对得上）', () => {
  const audits = [
    recall(NOW - 1000, { client: 'qoder', saved: 1200 }),
    recall(NOW - 2000, { client: 'qoder', saved: 800, thin: true }),
    recall(NOW - 3000, { client: 'cursor' }),
    recall(NOW - 4000),                                    // 无 client → 未标识
    recall(NOW - 40 * DAY, { client: 'qoder', saved: 9999 }), // 窗外，不计
    call(NOW - 500, 'qoder', { first: true, recalled: true }),
    call(NOW - 600, 'qoder', { first: false }),
    call(NOW - 700, 'cursor', { first: true, recalled: false }),
    call(NOW - 800, 'cursor', { reliable: false, first: true, recalled: true }), // 不可靠会话不进分母
    op(NOW - 900, 'reject'),
    op(NOW - 950, 'confirm'),
  ];

  it('按 client 分组：recalls / saved_tokens / evidence_thin 逐条可加', () => {
    const u = summarizeAgentUsage(audits, NOW, 30);
    const qoder = u.agents.find((a) => a.client === 'qoder')!;
    expect(qoder).toMatchObject({ recalls: 2, saved_tokens: 2000, evidence_thin: 1, calls: 2 });
    const cursor = u.agents.find((a) => a.client === 'cursor')!;
    expect(cursor).toMatchObject({ recalls: 1, saved_tokens: 0, evidence_thin: 0, calls: 2 });
    // 缺 saved_tokens 的行不加 0 也不摊分，如实为 0
    expect(u.totals.recalls).toBe(4);
    expect(u.totals.saved_tokens).toBe(2000);
  });

  it('C3：缺 client 的审计归「未标识」，不冒充任何 Agent', () => {
    const u = summarizeAgentUsage(audits, NOW, 30);
    const unknown = u.agents.find((a) => a.client === CLIENT_UNKNOWN)!;
    expect(unknown.recalls).toBe(1);
    expect(u.agents.map((a) => a.client)).not.toContain('');
  });

  it('首调合规分母只算可靠会话（UA 兜底会话不得稀释合规率）', () => {
    const u = summarizeAgentUsage(audits, NOW, 30);
    // qoder：1 次可靠首调且命中 → 1/1；cursor：1 次可靠首调未命中 + 1 次不可靠首调（不计）→ 0/1
    expect(u.totals).toMatchObject({ first_call_recall: 1, reliable_first_calls: 2, first_call_compliance: 0.5 });
    expect(u.agents.find((a) => a.client === 'qoder')).toMatchObject({ first_call_recall: 1, reliable_first_calls: 1 });
  });

  it('verdict 只到项目级，且如实声明不可按 Agent 拆分', () => {
    const u = summarizeAgentUsage(audits, NOW, 30);
    expect(u.verdicts).toEqual({ confirm: 1, reject: 1, disputed: 0 });
    expect(u.verdicts_attributable).toBe(false);
    expect(u.note).toContain('不可按 Agent 拆分');
  });

  it('窗口生效：40 天前的记录不进 7 天窗', () => {
    const u = summarizeAgentUsage(audits, NOW, 7);
    expect(u.totals.recalls).toBe(4);
    expect(u.agents.find((a) => a.client === 'qoder')!.saved_tokens).toBe(2000); // 9999 那条被排除
  });

  it('C4：空账本 → agents 为空、totals 全 0、合规率 null（不是 0）', () => {
    const u = summarizeAgentUsage([], NOW);
    expect(u.agents).toEqual([]);
    expect(u.totals).toMatchObject({
      recalls: 0, saved_tokens: 0, calls: 0, first_call_recall: 0, reliable_first_calls: 0,
      first_call_compliance: null,
    });
    expect(u.verdicts).toEqual({ confirm: 0, reject: 0, disputed: 0 });
  });

  it('排序稳定：先按 recalls 降序，再按 calls 降序，最后按名字', () => {
    const u = summarizeAgentUsage([
      recall(NOW - 1, { client: 'b' }), recall(NOW - 2, { client: 'a' }),
    ], NOW);
    expect(u.agents.map((a) => a.client)).toEqual(['a', 'b']);
  });
});

describe('readAgentUsage（读不到 ≠ 没有 Agent 在用）', () => {
  it('正常账本 → ok:true，数字与纯函数一致', async () => {
    const s = new InMemoryStorage();
    await s.appendAudit(recall(NOW - 1000, { client: 'qoder', saved: 300 }));
    await s.appendAudit(call(NOW - 500, 'qoder', { first: true, recalled: true }));
    const r = await readAgentUsage(s, NOW, 7);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usage.totals).toMatchObject({ recalls: 1, saved_tokens: 300, calls: 1 });
      expect(r.usage.source).toBe('audit');
    }
  });

  it('审计读不到 → ok:false 带原因（绝不用空数组冒充「无使用」）', async () => {
    class BadStorage extends InMemoryStorage {
      override async queryAudit(): Promise<AuditRecord[]> {
        throw new Error('audit store unreadable');
      }
    }
    const r = await readAgentUsage(new BadStorage(), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unreadable');
  });
});

describe('C5 互斥提示', () => {
  it('明确写出 gc 与 cron decay 双跑会双计，并给对齐办法', () => {
    expect(GC_CONCURRENCY_NOTE).toContain('cron decay');
    expect(GC_CONCURRENCY_NOTE).toContain('双计');
    expect(GC_CONCURRENCY_NOTE).toContain('错开');
  });
});
