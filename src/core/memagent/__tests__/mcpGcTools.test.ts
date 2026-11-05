// 批次44-D5-3：gc_report 内核 dry_run 改造 + MCP 共用编排的单元契约
import { describe, it, expect, beforeEach } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { JsVectorBackend } from '../vector.ts';
import { InMemoryStorage } from '../storage.ts';
import { McpToolError } from '../mcpRecall.ts';
import { GC_REPORT_NOTE, runGcReportTool } from '../mcpGcTools.ts';
import type { MemAgent, Memory } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const DAY = 24 * 3600 * 1000;

function mem(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_default',
    project_id: 'P1',
    enterprise_id: 'e1',
    team_id: 't1',
    category: 'context',
    layer: 'L1',
    content: '可读正文',
    content_l1: '脱敏后的可读正文',
    content_l0_enc: 'L0_SECRET_MUST_NOT_LEAK',
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    half_life_days: 30,
    created_at: Date.now() - 4 * DAY, // hot 且超过 3 天 → 下一次 gc 应推进到 warm
    ...over,
  };
}

function fixture() {
  const storage = new InMemoryStorage();
  const ma: MemAgent = createMemAgent({
    form: 'desktop', account: ACCOUNT,
    llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
  });
  return { storage, ma };
}

async function seed(storage: InMemoryStorage): Promise<void> {
  await storage.putMemory(mem({ mem_id: 'mem_old' }));
  await storage.putMemory(mem({ mem_id: 'mem_pinned', pinned: true, created_at: Date.now() - 999 * DAY }));
}

describe('批次44-D5-3：内核 coreGc dry_run（B 档，原行为不回归）', () => {
  let storage: InMemoryStorage;
  let ma: MemAgent;

  beforeEach(async () => {
    ({ storage, ma } = fixture());
    await seed(storage);
  });

  it('ma.gc() 未传 dry_run → 仍是真实衰减：降档 + 版本推进 + 落审计 + audit 非 null', async () => {
    const r = await ma.gc({ project_id: 'P1' });
    expect(r.decayed).toBe(1);
    expect(r.audit).not.toBeNull();
    expect((await storage.getMemory('mem_old'))?.decay_class).toBe('warm');
    expect((await storage.getMemory('mem_old'))?.version).toBe(2);
    expect((await storage.getMemory('mem_pinned'))?.decay_class).toBe('hot'); // pinned 豁免
    const audits = await storage.queryAudit({ request_id: r.request_id });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('gc');
  });

  it('ma.gc({ dry_run: true }) → 只演算：decay_class/version 不变、零审计、audit===null', async () => {
    const r = await ma.gc({ project_id: 'P1', dry_run: true });
    expect(r.decayed).toBe(1);
    expect(r.audit).toBeNull();
    expect((await storage.getMemory('mem_old'))?.decay_class).toBe('hot');
    expect((await storage.getMemory('mem_old'))?.version).toBe(1);
    expect(await storage.queryAudit({ request_id: r.request_id })).toHaveLength(0);
    expect((await storage.queryAudit({}))).toHaveLength(0);
  });

  it('dry_run=false 与不传 dry_run 等价（真实落库）', async () => {
    const r = await ma.gc({ project_id: 'P1', dry_run: false });
    expect(r.decayed).toBe(1);
    expect((await storage.getMemory('mem_old'))?.decay_class).toBe('warm');
    expect(await storage.queryAudit({ request_id: r.request_id })).toHaveLength(1);
  });
});

describe('批次44-D5-3：runGcReportTool（MCP 层默认只演算 + 诚实统计）', () => {
  let storage: InMemoryStorage;
  let ma: MemAgent;

  beforeEach(async () => {
    ({ storage, ma } = fixture());
    await seed(storage);
  });

  it('缺省 dry_run=true → 报出会降档的条数，但不改库、audit_written=false', async () => {
    const r = await runGcReportTool(ma, { project_id: 'P1' }, ['*']);
    expect(r.ok).toBe(true);
    expect(r.dry_run).toBe(true);
    expect(r.report.decayed).toBe(1);
    expect(r.audit_written).toBe(false);
    expect((await storage.getMemory('mem_old'))?.decay_class).toBe('hot');
    expect((await storage.getMemory('mem_old'))?.version).toBe(1);
    expect(await storage.queryAudit({ request_id: r.request_id })).toHaveLength(0);
  });

  it('显式 dry_run=false → 真实执行衰减、audit_written=true', async () => {
    const r = await runGcReportTool(ma, { project_id: 'P1', dry_run: false }, ['*']);
    expect(r.dry_run).toBe(false);
    expect(r.report.decayed).toBe(1);
    expect(r.audit_written).toBe(true);
    expect((await storage.getMemory('mem_old'))?.decay_class).toBe('warm');
    expect(await storage.queryAudit({ request_id: r.request_id })).toHaveLength(1);
  });

  it('只回内核真实三项，不伪造摘要类统计；note 说明差异', async () => {
    const r = await runGcReportTool(ma, { project_id: 'P1' }, ['*']);
    expect(r.report).toEqual({ decayed: 1, merged: 0, conflicts_resolved: 0 });
    expect(Object.keys(r.report)).toEqual(['decayed', 'merged', 'conflicts_resolved']);
    expect(r.report).not.toHaveProperty('freshness_updated');
    expect(r.report).not.toHaveProperty('summaries_created');
    expect(r.report).not.toHaveProperty('compressed');
    expect(r.note).toBe(GC_REPORT_NOTE);
    expect(r.note).toContain('没有对应统计量');
  });

  it('project_id 缺失/空串/越界 → -32602，且不改库、不写审计', async () => {
    for (const args of [{}, { project_id: '' }, { project_id: 123 }]) {
      await expect(runGcReportTool(ma, args, ['*'])).rejects.toBeInstanceOf(McpToolError);
    }
    await expect(runGcReportTool(ma, { project_id: 'P2' }, ['P1'])).rejects.toThrow(/作用域不含项目 P2/);
    expect((await storage.getMemory('mem_old'))?.decay_class).toBe('hot');
    expect(await storage.queryAudit({})).toHaveLength(0);
  });

  it('dry_run 非布尔、resolve_conflicts 传入、缺 project_id 的错误码均为 -32602', async () => {
    const cases: Array<Record<string, unknown>> = [
      { project_id: 'P1', dry_run: 'true' },
      { project_id: 'P1', dry_run: 1 },
      { project_id: 'P1', resolve_conflicts: true },
      {},
    ];
    for (const args of cases) {
      try {
        await runGcReportTool(ma, args, ['*']);
        throw new Error('expected McpToolError');
      } catch (e) {
        expect(e).toBeInstanceOf(McpToolError);
        expect((e as McpToolError).code).toBe(-32602);
      }
    }
  });

  it('resolve_conflicts 明确拒绝（内核未实现冲突裁决），不静默忽略', async () => {
    await expect(runGcReportTool(ma, { project_id: 'P1', resolve_conflicts: true }, ['*']))
      .rejects.toThrow(/未实现冲突裁决|不静默忽略/);
  });

  it('空项目也如实回零报告（不伪造统计量、不补造记录）', async () => {
    const r = await runGcReportTool(ma, { project_id: 'P_EMPTY' }, ['*']);
    expect(r.report).toEqual({ decayed: 0, merged: 0, conflicts_resolved: 0 });
    expect(r.audit_written).toBe(false);
  });
});
