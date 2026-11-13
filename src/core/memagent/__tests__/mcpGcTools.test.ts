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
const FULL_ACCOUNT = { ...ACCOUNT, scope_project_ids: ['*'] };
const SCOPED_P1 = { ...FULL_ACCOUNT, scope_project_ids: ['P1'] };
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
    const r = await runGcReportTool(ma, { project_id: 'P1' }, FULL_ACCOUNT);
    expect(r.ok).toBe(true);
    expect(r.dry_run).toBe(true);
    expect(r.report.decayed).toBe(1);
    expect(r.audit_written).toBe(false);
    expect((await storage.getMemory('mem_old'))?.decay_class).toBe('hot');
    expect((await storage.getMemory('mem_old'))?.version).toBe(1);
    expect(await storage.queryAudit({ request_id: r.request_id })).toHaveLength(0);
  });

  it('显式 dry_run=false → 真实执行衰减、audit_written=true', async () => {
    const r = await runGcReportTool(ma, { project_id: 'P1', dry_run: false }, FULL_ACCOUNT);
    expect(r.dry_run).toBe(false);
    expect(r.report.decayed).toBe(1);
    expect(r.audit_written).toBe(true);
    expect((await storage.getMemory('mem_old'))?.decay_class).toBe('warm');
    expect(await storage.queryAudit({ request_id: r.request_id })).toHaveLength(1);
  });

  it('46-4 报告字段对齐：保留三项 + 六项真实字段 + scanned；note 分层说明', async () => {
    const r = await runGcReportTool(ma, { project_id: 'P1' }, FULL_ACCOUNT);
    expect(Object.keys(r.report)).toEqual([
      'decayed', 'merged', 'conflicts_resolved',
      'freshness_updated', 'scanned', 'migrated',
      'summaries_created', 'summaries_filtered', 'merged_originals', 'compressed',
    ]);
    expect(r.report.decayed).toBe(1);
    expect(r.report.scanned).toBe(r.report.freshness_updated); // D4 如实命名
    expect(r.report.decayed).toBe(r.report.migrated);          // D5 别名不双计
    expect(r.report.merged).toBe(0);
    expect(r.report.conflicts_resolved).toBe(0);               // 未触发裁决，诚实 0
    expect(r.report.compressed).toBe(0);                       // MCP 未注入 vector，诚实 0
    expect(r.conflict_resolution).toEqual({ requested: false, verdict: null, resolved: 0 });
    expect(r.note).toBe(GC_REPORT_NOTE);
    expect(r.note).toContain('真实字段');
    expect(r.note).not.toContain('没有对应统计量');
  });

  it('project_id 缺失/空串/越界 → -32602，且不改库、不写审计', async () => {
    for (const args of [{}, { project_id: '' }, { project_id: 123 }]) {
      await expect(runGcReportTool(ma, args, FULL_ACCOUNT)).rejects.toBeInstanceOf(McpToolError);
    }
    await expect(runGcReportTool(ma, { project_id: 'P2' }, SCOPED_P1)).rejects.toThrow(/作用域不含项目 P2/);
    expect((await storage.getMemory('mem_old'))?.decay_class).toBe('hot');
    expect(await storage.queryAudit({})).toHaveLength(0);
  });

  it('dry_run 非布尔、裁决参数不完整、缺 project_id 的错误码均为 -32602', async () => {
    const cases: Array<Record<string, unknown>> = [
      { project_id: 'P1', dry_run: 'true' },
      { project_id: 'P1', dry_run: 1 },
      { project_id: 'P1', resolve_conflicts: true },
      {},
    ];
    for (const args of cases) {
      try {
        await runGcReportTool(ma, args, FULL_ACCOUNT);
        throw new Error('expected McpToolError');
      } catch (e) {
        expect(e).toBeInstanceOf(McpToolError);
        expect((e as McpToolError).code).toBe(-32602);
      }
    }
  });

  it('resolve_conflicts=true 不给 verdict → 明确拒绝（禁止自动 auto_override）', async () => {
    await expect(runGcReportTool(ma, { project_id: 'P1', resolve_conflicts: true }, FULL_ACCOUNT))
      .rejects.toThrow(/verdict|禁止自动/);
  });

  it('空项目也如实回零报告（不伪造统计量、不补造记录）', async () => {
    const r = await runGcReportTool(ma, { project_id: 'P_EMPTY' }, FULL_ACCOUNT);
    expect(r.report.decayed).toBe(0);
    expect(r.report.freshness_updated).toBe(0);
    expect(r.report.scanned).toBe(0);
    expect(r.report.conflicts_resolved).toBe(0);
    expect(r.audit_written).toBe(false);
  });
});

describe('批次46-4：MCP 裁决参数（D3/D8 二者都给才落定）', () => {
  let storage: InMemoryStorage;
  let ma: MemAgent;

  beforeEach(async () => {
    ({ storage, ma } = fixture());
    // 一对真实 pending 冲突（共享 conflict_id，均非 archived/dormant/deleted）
    await storage.putMemory(mem({
      mem_id: 'cf_old', conflict_id: 'cf_mcp', created_at: Date.now() - 2 * DAY, confidence: 0.5,
    }));
    await storage.putMemory(mem({
      mem_id: 'cf_new', conflict_id: 'cf_mcp', created_at: Date.now() - DAY, confidence: 0.6,
    }));
  });

  it('resolve_conflicts=true + verdict=auto_override + dry_run=false → 真实落定、成对审计', async () => {
    const r = await runGcReportTool(ma, {
      project_id: 'P1', dry_run: false, resolve_conflicts: true, verdict: 'auto_override',
    }, FULL_ACCOUNT);
    expect(r.report.conflicts_resolved).toBe(1);
    expect(r.conflict_resolution).toEqual({ requested: true, verdict: 'auto_override', resolved: 1 });
    expect(r.audit_written).toBe(true);
    expect((await storage.getMemory('cf_old'))?.decay_class).toBe('archived');
    expect((await storage.getMemory('cf_old'))?.conflict_id).toBeUndefined();
    expect((await storage.getMemory('cf_new'))?.confidence).toBeCloseTo(0.7, 5);
    const audits = await storage.queryAudit({ action: 'conflict_resolve' });
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({
      old_id: 'cf_old', new_id: 'cf_new', verdict: 'auto_override', pending: false,
    });
  });

  it('user_confirm / hold → 不落定、库状态不变、保持 pending', async () => {
    for (const v of ['user_confirm', 'hold'] as const) {
      const s = new InMemoryStorage();
      const agent: MemAgent = createMemAgent({
        form: 'desktop', account: ACCOUNT,
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage: s,
      });
      await s.putMemory(mem({ mem_id: 'cf_old', conflict_id: 'cf_mcp', created_at: Date.now() - 2 * DAY }));
      await s.putMemory(mem({ mem_id: 'cf_new', conflict_id: 'cf_mcp', created_at: Date.now() - DAY }));
      const before = (await s.listMemories({})).map((m) => ({ ...m }));
      const r = await runGcReportTool(agent, {
        project_id: 'P1', dry_run: false, resolve_conflicts: true, verdict: v,
      }, FULL_ACCOUNT);
      expect(r.report.conflicts_resolved).toBe(0);
      expect(r.conflict_resolution).toEqual({ requested: true, verdict: v, resolved: 0 });
      expect((await s.listMemories({})).map((m) => ({ ...m }))).toEqual(before);
      const audits = await s.queryAudit({ action: 'conflict_resolve' });
      expect(audits[0].detail).toMatchObject({ pending: true, verdict: v });
    }
  });

  it('dry_run=true 且带裁决 → 全程零写入、audit_written=false、resolved=0', async () => {
    const before = (await storage.listMemories({})).map((m) => ({ ...m }));
    const r = await runGcReportTool(ma, {
      project_id: 'P1', resolve_conflicts: true, verdict: 'auto_override',
    }, FULL_ACCOUNT);
    expect(r.dry_run).toBe(true);
    expect(r.report.conflicts_resolved).toBe(0);
    expect(r.audit_written).toBe(false);
    expect((await storage.listMemories({})).map((m) => ({ ...m }))).toEqual(before);
    expect(await storage.queryAudit({})).toHaveLength(0);
  });

  it('只给 verdict 不给 resolve_conflicts → 明确拒绝，不静默忽略高风险参数', async () => {
    await expect(runGcReportTool(ma, { project_id: 'P1', verdict: 'auto_override' }, FULL_ACCOUNT))
      .rejects.toThrow(/resolve_conflicts/);
  });

  it('非法 verdict / 非布尔 resolve_conflicts → -32602 且不改库', async () => {
    const cases: Array<Record<string, unknown>> = [
      { project_id: 'P1', resolve_conflicts: true, verdict: 'bogus' },
      { project_id: 'P1', resolve_conflicts: 'true', verdict: 'auto_override' },
      { project_id: 'P1', resolve_conflicts: true, verdict: 1 },
    ];
    for (const args of cases) {
      try {
        await runGcReportTool(ma, args, FULL_ACCOUNT);
        throw new Error('expected McpToolError');
      } catch (e) {
        expect(e).toBeInstanceOf(McpToolError);
        expect((e as McpToolError).code).toBe(-32602);
      }
    }
    expect((await storage.getMemory('cf_old'))?.decay_class).toBe('hot');
    expect(await storage.queryAudit({})).toHaveLength(0);
  });

  it('四 verdict 均能通过校验且回执如实标注（dry_run 不落定）', async () => {
    for (const v of ['auto_override', 'user_confirm', 'merge', 'hold'] as const) {
      const r = await runGcReportTool(ma, {
        project_id: 'P1', dry_run: true, resolve_conflicts: true, verdict: v,
      }, FULL_ACCOUNT);
      expect(r.ok).toBe(true);
      expect(r.conflict_resolution).toEqual({ requested: true, verdict: v, resolved: 0 });
    }
  });
});

// 批次61 GAP-3（规格 C1/C2/C5）：gc_report 附只读 Agent 侧聚合。
// 红线：dry_run 语义一字不变（零写入零审计）；聚合数字必须与审计逐条对得上。
describe('GAP-3 gc_report × Agent 侧聚合', () => {
  const NOW = 1_800_000_000_000;

  it('C1：注入 storage 后 dry_run 仍零写入零审计，agent_usage 正常回读', async () => {
    const { storage, ma } = fixture();
    await seed(storage);
    await storage.appendAudit({
      request_id: 'r1', action: 'recall', form: 'desktop', project_id: 'P1', ts: NOW - 1000,
      detail: { hits: 2, client: 'qoder', saved_tokens: 500, evidence_thin: false },
    } as never);
    const before = (await storage.queryAudit({})).length;

    const r = await runGcReportTool(ma, { project_id: 'P1' }, FULL_ACCOUNT, { storage, now: NOW });
    expect(r.dry_run).toBe(true);
    expect(r.audit_written).toBe(false);
    expect((await storage.queryAudit({})).length).toBe(before);            // 零审计
    expect((await storage.getMemory('mem_old'))?.decay_class).toBe('hot'); // 零落库
    expect(r.agent_usage.ok).toBe(true);
    if (r.agent_usage.ok) {
      // 窗口：now-1000 在 7 天内；seed 里没有别的 recall
      expect(r.agent_usage.usage.totals).toMatchObject({ recalls: 1, saved_tokens: 500 });
      expect(r.agent_usage.usage.agents[0]).toMatchObject({ client: 'qoder', recalls: 1 });
    }
  });

  it('C2：聚合每个数字都能在审计里数出来（含未标识桶）', async () => {
    const { storage, ma } = fixture();
    await seed(storage);
    const mk = (ts: number, detail: Record<string, unknown>) => ({
      request_id: `r_${ts}`, action: 'recall', form: 'desktop', project_id: 'P1', ts, detail,
    } as never);
    await storage.appendAudit(mk(NOW - 1000, { hits: 1, client: 'qoder', saved_tokens: 100 }));
    await storage.appendAudit(mk(NOW - 2000, { hits: 1, client: 'qoder', saved_tokens: 200, evidence_thin: true }));
    await storage.appendAudit(mk(NOW - 3000, { hits: 1 }));                 // 无 client
    await storage.appendAudit({ request_id: 'c1', action: 'mcp_call', agent: 'qoder', ts: NOW - 500,
      detail: { reliable: true, first_call: true, recalled_before: true } } as never);

    const r = await runGcReportTool(ma, { project_id: 'P1' }, FULL_ACCOUNT, { storage, now: NOW, windowDays: 7 });
    if (!r.agent_usage.ok) throw new Error('agent_usage 应可读');
    const u = r.agent_usage.usage;
    expect(u.totals).toMatchObject({ recalls: 3, saved_tokens: 300, evidence_thin: 1, calls: 1 });
    expect(u.agents.map((a) => a.client).sort()).toEqual(['qoder', '未标识']);
    expect(u.agents.find((a) => a.client === '未标识')!.recalls).toBe(1);
    expect(u.totals.first_call_compliance).toBe(1);
  });

  it('未注入 storage → agent_usage 如实 ok:false（向后兼容，报告主体照出）', async () => {
    const { storage, ma } = fixture();
    await seed(storage);
    const r = await runGcReportTool(ma, { project_id: 'P1' }, FULL_ACCOUNT);
    expect(r.ok).toBe(true);
    expect(r.report.decayed).toBe(1);                 // 主体不因缺 storage 而失败
    expect(r.agent_usage.ok).toBe(false);
    if (!r.agent_usage.ok) expect(r.agent_usage.error).toContain('未注入');
  });

  it('审计不可读 → 报告仍出，agent_usage.ok=false 带原因（不阻断 gc_report）', async () => {
    const { storage, ma } = fixture();
    await seed(storage);
    class BadAudit extends InMemoryStorage {
      override async queryAudit(): Promise<never> {
        throw new Error('audit unreadable');
      }
    }
    const r = await runGcReportTool(ma, { project_id: 'P1' }, FULL_ACCOUNT, { storage: new BadAudit(), now: NOW });
    expect(r.ok).toBe(true);
    expect(r.agent_usage.ok).toBe(false);
  });

  it('C5：报告带互斥提示（gc 与 cron decay 双跑会双计）', async () => {
    const { storage, ma } = fixture();
    await seed(storage);
    const r = await runGcReportTool(ma, { project_id: 'P1' }, FULL_ACCOUNT);
    expect(r.concurrency_note).toContain('双计');
    expect(r.note).toContain('agent_usage');
  });
});
