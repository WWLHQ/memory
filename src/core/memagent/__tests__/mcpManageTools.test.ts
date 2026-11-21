// 批次44-D5-2：feedback / manage_memory 共用编排的单元契约（内核行为 + MCP 层红线）
import { describe, it, expect, beforeEach } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { JsVectorBackend } from '../vector.ts';
import { InMemoryStorage } from '../storage.ts';
import { McpToolError } from '../mcpRecall.ts';
import {
  deleteAllowed, runFeedbackTool, runManageMemoryTool,
} from '../mcpManageTools.ts';
import type { MemAgent, Memory } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const FULL_ACCOUNT = { ...ACCOUNT, scope_project_ids: ['*'] };
const SCOPED_P1 = { ...FULL_ACCOUNT, scope_project_ids: ['P1'] };

function mem(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_default',
    project_id: 'P1',
    enterprise_id: 'e1',
    team_id: 't1',
    category: 'fact',
    layer: 'L1',
    content: '可读正文',
    content_l1: '脱敏后的可读正文',
    content_l0_enc: 'L0_SECRET_MUST_NOT_LEAK',
    content_orig: 'ORIGINAL_MUST_NOT_LEAK',
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_at: 1000,
    ...over,
  };
}

const OPTS_OFF = { allowDelete: false };
const OPTS_ON = { allowDelete: true };

describe('批次44-D5-2：feedback（内核 trust_delta + MCP 红线）', () => {
  let storage: InMemoryStorage;
  let ma: MemAgent;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    ma = createMemAgent({
      form: 'desktop', account: ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
    });
    await storage.putMemory(mem({ mem_id: 'mem_1' }));
  });

  it('confirm → +0.1 且 reinforce_count +1；reject → −0.05；disputed → 0 且挂 conflict_id', async () => {
    const c = await runFeedbackTool(ma, storage, { mem_id: 'mem_1', verdict: 'confirm' }, FULL_ACCOUNT);
    expect(c.ok).toBe(true);
    expect(c.trust_delta).toBe(0.1);
    expect(c.mem?.confidence).toBeCloseTo(0.6);
    expect(c.mem?.reinforce_count).toBe(1);
    expect(c.mem).not.toHaveProperty('content_l0_enc');
    expect(c.mem).not.toHaveProperty('content_orig');

    const r = await runFeedbackTool(ma, storage, { mem_id: 'mem_1', verdict: 'reject' }, FULL_ACCOUNT);
    expect(r.trust_delta).toBe(-0.05);
    expect(r.mem?.confidence).toBeCloseTo(0.55);

    const d = await runFeedbackTool(ma, storage, { mem_id: 'mem_1', verdict: 'disputed' }, FULL_ACCOUNT);
    expect(d.trust_delta).toBe(0);
    expect(d.mem?.confidence).toBeCloseTo(0.55);
    expect(d.mem?.conflict_id).toMatch(/^cf_/);
  });

  it('不存在 → 如实 ok:false / mem:null / trust_delta:0，不补造空记录', async () => {
    const r = await runFeedbackTool(ma, storage, { mem_id: 'mem_nope', verdict: 'confirm' }, FULL_ACCOUNT);
    expect(r.ok).toBe(false);
    expect(r.mem).toBeNull();
    expect(r.trust_delta).toBe(0);
  });

  it('越界 mem_id → 拒绝且报错文案不泄露项目 ID / 记忆是否存在', async () => {
    await storage.putMemory(mem({ mem_id: 'mem_p2', project_id: 'P2' }));
    await expect(runFeedbackTool(ma, storage, { mem_id: 'mem_p2', verdict: 'confirm' }, SCOPED_P1))
      .rejects.toThrow(/作用域不含该 mem_id 所属项目/);
    try {
      await runFeedbackTool(ma, storage, { mem_id: 'mem_p2', verdict: 'confirm' }, SCOPED_P1);
    } catch (e) {
      expect(e).toBeInstanceOf(McpToolError);
      expect((e as McpToolError).message).not.toContain('P2');
    }
    expect((await storage.getMemory('mem_p2'))?.confidence).toBeUndefined(); // 未被改动
  });

  it('非法 verdict / 缺 mem_id → McpToolError(-32602)，不静默按默认处理', async () => {
    const cases: Array<Record<string, unknown>> = [
      { mem_id: 'mem_1' }, { mem_id: '', verdict: 'confirm' },
      { mem_id: 'mem_1', verdict: 'bogus' }, { mem_id: 'mem_1', verdict: 123 },
    ];
    for (const args of cases) {
      await expect(runFeedbackTool(ma, storage, args, FULL_ACCOUNT)).rejects.toBeInstanceOf(McpToolError);
    }
    try { await runFeedbackTool(ma, storage, { mem_id: 'mem_1' }, FULL_ACCOUNT); } catch (e) {
      expect((e as McpToolError).code).toBe(-32602);
    }
  });

  it('每次反馈都落审计 action=memory_op 且 detail.op 归因', async () => {
    const r = await runFeedbackTool(ma, storage, { mem_id: 'mem_1', verdict: 'confirm' }, FULL_ACCOUNT);
    const audits = await storage.queryAudit({ request_id: r.request_id });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('memory_op');
    expect(audits[0].detail).toMatchObject({ op: 'confirm', trust_delta: 0.1, mem_id: 'mem_1' });
  });
});

describe('M1-3 / M1-4：feedback ↔ recall 归因', () => {
  let storage: InMemoryStorage;
  let ma: MemAgent;

  const recallAudit = (request_id: string, ts: number, mems: string[]) => ({
    request_id, action: 'recall' as const, ts, project_id: 'P1',
    detail: { mems, hits: mems.length },
  });

  beforeEach(async () => {
    storage = new InMemoryStorage();
    ma = createMemAgent({
      form: 'desktop', account: ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
    });
    await storage.putMemory(mem({ mem_id: 'mem_1' }));
  });

  it('M1-3：带 recall_id 且该召回确含此 mem → 落 recall_feedback（字段齐全）', async () => {
    await storage.appendAudit(recallAudit('req_recall_A', 5000, ['mem_1', 'mem_2']));
    const r = await runFeedbackTool(
      ma, storage, { mem_id: 'mem_1', verdict: 'confirm', recall_id: 'req_recall_A' }, FULL_ACCOUNT,
    );
    expect(r.trust_delta).toBe(0.1);
    expect(r.recall_link).toEqual({ linked: true, recall_id: 'req_recall_A' });

    const rows = await storage.queryAudit({ action: 'recall_feedback' });
    expect(rows).toHaveLength(1);
    expect(rows[0].request_id).toBe(r.request_id); // 与本次反馈同 request_id 便于对账
    expect(rows[0].detail).toMatchObject({ recall_id: 'req_recall_A', mem_id: 'mem_1', verdict: 'confirm' });
    expect(typeof rows[0].detail.ts).toBe('number');
  });

  it('M1-3：不带 recall_id 且无历史召回 → 不落 recall_feedback，只改信任分（与改造前一致）', async () => {
    const r = await runFeedbackTool(ma, storage, { mem_id: 'mem_1', verdict: 'confirm' }, FULL_ACCOUNT);
    expect(r.recall_link).toEqual({ linked: false, recall_id: null });
    expect(r.trust_delta).toBe(0.1);
    expect(r.mem?.confidence).toBeCloseTo(0.6);
    expect(await storage.queryAudit({ action: 'recall_feedback' })).toHaveLength(0);
  });

  it('M1-3：不带 recall_id → 自动关联「最近一次含该 mem 的召回」', async () => {
    await storage.appendAudit(recallAudit('req_old', 1000, ['mem_1']));
    await storage.appendAudit(recallAudit('req_new', 2000, ['mem_1']));
    await storage.appendAudit(recallAudit('req_other', 3000, ['mem_9'])); // 更新但不含 mem_1 → 不选它
    const r = await runFeedbackTool(ma, storage, { mem_id: 'mem_1', verdict: 'confirm' }, FULL_ACCOUNT);
    expect(r.recall_link).toEqual({ linked: true, recall_id: 'req_new' });
    const rows = await storage.queryAudit({ action: 'recall_feedback' });
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({ recall_id: 'req_new', mem_id: 'mem_1' });
  });

  it('M1-4：陈年 mem_id 关联不到 → 不写 recall_feedback，只回 linked:false，信任分照常降', async () => {
    await storage.appendAudit(recallAudit('req_unrelated', 1000, ['mem_x']));
    const r = await runFeedbackTool(ma, storage, { mem_id: 'mem_1', verdict: 'reject' }, FULL_ACCOUNT);
    expect(r.trust_delta).toBe(-0.05);
    expect(r.recall_link).toEqual({ linked: false, recall_id: null });
    expect(await storage.queryAudit({ action: 'recall_feedback' })).toHaveLength(0);
  });

  it('M1-4：显式 recall_id 不存在 / 不含该 mem → linked:false 且不写（不伪造）', async () => {
    await storage.appendAudit(recallAudit('req_real', 1000, ['mem_other']));
    const a = await runFeedbackTool(
      ma, storage, { mem_id: 'mem_1', verdict: 'confirm', recall_id: 'req_real' }, FULL_ACCOUNT,
    );
    const b = await runFeedbackTool(
      ma, storage, { mem_id: 'mem_1', verdict: 'confirm', recall_id: 'req_ghost' }, FULL_ACCOUNT,
    );
    expect(a.recall_link).toEqual({ linked: false, recall_id: null });
    expect(b.recall_link).toEqual({ linked: false, recall_id: null });
    expect(await storage.queryAudit({ action: 'recall_feedback' })).toHaveLength(0);
  });

  it('M1-3：recall_id 非法（空串 / 非字符串）→ McpToolError，不静默忽略', async () => {
    for (const bad of ['', '   ', 123, {}]) {
      await expect(
        runFeedbackTool(ma, storage, { mem_id: 'mem_1', verdict: 'confirm', recall_id: bad }, FULL_ACCOUNT),
      ).rejects.toBeInstanceOf(McpToolError);
    }
  });
});

describe('批次 A1：feedback implicit=true（引用即隐式确认弱信号）', () => {
  let storage: InMemoryStorage;
  let ma: MemAgent;

  const recallAudit = (request_id: string, ts: number, mems: string[]) => ({
    request_id, action: 'recall' as const, ts, project_id: 'P1',
    detail: { mems, hits: mems.length },
  });

  beforeEach(async () => {
    storage = new InMemoryStorage();
    ma = createMemAgent({
      form: 'desktop', account: ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
    });
    await storage.putMemory(mem({ mem_id: 'mem_1' }));
  });

  it('隐式确认：信任分不动（confidence 不变）、只 reinforce_count+1，落 memory_op[implicit] + recall_feedback[implicit] 两条审计', async () => {
    await storage.appendAudit(recallAudit('req_r1', 5000, ['mem_1']));
    const r = await runFeedbackTool(
      ma, storage, { mem_id: 'mem_1', verdict: 'confirm', implicit: true, recall_id: 'req_r1' }, FULL_ACCOUNT,
    );
    expect(r.ok).toBe(true);
    expect(r.implicit).toBe(true);
    expect(r.trust_delta).toBe(0);
    // 信任分一分不动：存储态 confidence 保持原值（fixture 未写 → undefined，不冒出默认 0.5）
    expect((await storage.getMemory('mem_1'))?.confidence).toBeUndefined();
    expect(r.mem?.reinforce_count).toBe(1);
    expect(r.recall_link).toEqual({ linked: true, recall_id: 'req_r1' });

    const ops = await storage.queryAudit({ action: 'memory_op' });
    expect(ops).toHaveLength(1);
    expect(ops[0].detail).toMatchObject({
      op: 'confirm', implicit: true, trust_delta: 0, reinforce_only: true, mem_id: 'mem_1',
    });
    const tags = await storage.queryAudit({ action: 'recall_feedback' });
    expect(tags).toHaveLength(1);
    expect(tags[0].detail).toMatchObject({
      recall_id: 'req_r1', mem_id: 'mem_1', verdict: 'confirm', implicit: true,
    });
    expect((await storage.getMemory('mem_1'))?.version).toBe(2);
  });

  it('防刷去重：同一 request_id+mem_id 第二次 → duplicate:true 且不再 +1、不再写审计', async () => {
    await storage.appendAudit(recallAudit('req_r1', 5000, ['mem_1']));
    const args = { mem_id: 'mem_1', verdict: 'confirm', implicit: true, recall_id: 'req_r1' };
    const first = await runFeedbackTool(ma, storage, args, FULL_ACCOUNT);
    expect(first.duplicate).toBeUndefined();
    const second = await runFeedbackTool(ma, storage, args, FULL_ACCOUNT);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.implicit).toBe(true);
    expect(second.trust_delta).toBe(0);
    expect((await storage.getMemory('mem_1'))?.reinforce_count).toBe(1); // 只 +1 一次
    expect(await storage.queryAudit({ action: 'recall_feedback' })).toHaveLength(1);
    expect(await storage.queryAudit({ action: 'memory_op' })).toHaveLength(1);
  });

  it('不同 request_id 各记一次（去重键是 request_id+mem_id，不是 mem_id 单独）', async () => {
    await storage.appendAudit(recallAudit('req_r1', 5000, ['mem_1']));
    await storage.appendAudit(recallAudit('req_r2', 6000, ['mem_1']));
    await runFeedbackTool(ma, storage, { mem_id: 'mem_1', verdict: 'confirm', implicit: true, recall_id: 'req_r1' }, FULL_ACCOUNT);
    const second = await runFeedbackTool(ma, storage, { mem_id: 'mem_1', verdict: 'confirm', implicit: true, recall_id: 'req_r2' }, FULL_ACCOUNT);
    expect(second.duplicate).toBeUndefined();
    expect((await storage.getMemory('mem_1'))?.reinforce_count).toBe(2);
  });

  it('M1-4 纪律：关联不到召回 → 直接拒绝，不写任何标签、不改任何状态', async () => {
    await storage.appendAudit(recallAudit('req_other', 5000, ['mem_x']));
    await expect(
      runFeedbackTool(ma, storage, { mem_id: 'mem_1', verdict: 'confirm', implicit: true }, FULL_ACCOUNT),
    ).rejects.toThrow(/关联不到召回审计/);
    expect((await storage.getMemory('mem_1'))?.reinforce_count).toBeUndefined(); // 未被强化
    expect(await storage.queryAudit({ action: 'recall_feedback' })).toHaveLength(0);
    expect(await storage.queryAudit({ action: 'memory_op' })).toHaveLength(0);
  });

  it('组合校验：implicit 与 reject/disputed 组合、implicit 非布尔 → McpToolError', async () => {
    await storage.appendAudit(recallAudit('req_r1', 5000, ['mem_1']));
    for (const bad of [
      { mem_id: 'mem_1', verdict: 'reject', implicit: true },
      { mem_id: 'mem_1', verdict: 'disputed', implicit: true },
      { mem_id: 'mem_1', verdict: 'confirm', implicit: 'yes' },
    ]) {
      await expect(runFeedbackTool(ma, storage, bad, FULL_ACCOUNT)).rejects.toBeInstanceOf(McpToolError);
    }
    expect((await storage.getMemory('mem_1'))?.reinforce_count).toBeUndefined();
  });

  it('隐式确认不延寿：half_life_days 与 decay_class 均不动（批次 C 才给显式 confirm 加延寿）', async () => {
    await storage.putMemory(mem({ mem_id: 'mem_2', half_life_days: 30 }));
    await storage.appendAudit(recallAudit('req_r3', 7000, ['mem_2']));
    await runFeedbackTool(
      ma, storage, { mem_id: 'mem_2', verdict: 'confirm', implicit: true, recall_id: 'req_r3' }, FULL_ACCOUNT,
    );
    const m = await storage.getMemory('mem_2');
    expect(m?.half_life_days).toBe(30);
    expect(m?.decay_class).toBe('hot');
  });

  it('批次 C2：显式 confirm 延寿（+3 封顶 90；已 ≥90 不再动；未显式设置不猜默认值）', async () => {
    const base = await runFeedbackTool(ma, storage, { mem_id: 'mem_1', verdict: 'confirm' }, FULL_ACCOUNT);
    expect(base.mem?.reinforce_count).toBe(1);
    // mem_1 未显式设置 half_life_days → 不猜类别默认值，不固化
    expect((await storage.getMemory('mem_1'))?.half_life_days).toBeUndefined();

    await storage.putMemory(mem({ mem_id: 'mem_30', half_life_days: 30 }));
    const r30 = await runFeedbackTool(ma, storage, { mem_id: 'mem_30', verdict: 'confirm' }, FULL_ACCOUNT);
    expect(r30.trust_delta).toBe(0.1);
    expect((await storage.getMemory('mem_30'))?.half_life_days).toBe(33);
    const audits30 = await storage.queryAudit({ request_id: r30.request_id });
    expect(audits30[0].detail).toMatchObject({ op: 'confirm', half_life_days: 33 });

    await storage.putMemory(mem({ mem_id: 'mem_89', half_life_days: 89 }));
    await runFeedbackTool(ma, storage, { mem_id: 'mem_89', verdict: 'confirm' }, FULL_ACCOUNT);
    expect((await storage.getMemory('mem_89'))?.half_life_days).toBe(90); // 封顶

    await storage.putMemory(mem({ mem_id: 'mem_95', half_life_days: 95 }));
    await runFeedbackTool(ma, storage, { mem_id: 'mem_95', verdict: 'confirm' }, FULL_ACCOUNT);
    expect((await storage.getMemory('mem_95'))?.half_life_days).toBe(95); // 已 ≥90：不再动也不缩短
  });
});

describe('批次44-D5-2：manage_memory（11 操作 + G4 + delete 门禁）', () => {
  let storage: InMemoryStorage;
  let ma: MemAgent;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    ma = createMemAgent({
      form: 'desktop', account: ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
    });
    await storage.putMemory(mem({ mem_id: 'mem_1' }));
  });

  it('archive / pin / param / migrate 生效，回执只含白名单摘要', async () => {
    const a = await runManageMemoryTool(ma, storage, { mem_id: 'mem_1', action: 'archive' }, FULL_ACCOUNT, OPTS_OFF);
    expect(a.ok).toBe(true);
    expect(a.mem?.decay_class).toBe('archived');
    expect(a.mem).not.toHaveProperty('content_l0_enc');
    expect(a.mem).not.toHaveProperty('content_orig');
    expect(a.mem).not.toHaveProperty('content');

    const p = await runManageMemoryTool(ma, storage, { mem_id: 'mem_1', action: 'pin' }, FULL_ACCOUNT, OPTS_OFF);
    expect(p.mem?.pinned).toBe(true);

    const param = await runManageMemoryTool(ma, storage, {
      mem_id: 'mem_1', action: 'param', patch: { importance: 0.8, confidence: 0.9, half_life_days: 30 },
    }, FULL_ACCOUNT, OPTS_OFF);
    expect(param.mem?.importance).toBe(0.8);
    expect(param.mem?.confidence).toBe(0.9);

    const mig = await runManageMemoryTool(ma, storage, {
      mem_id: 'mem_1', action: 'migrate', patch: { decay_class: 'warm' },
    }, FULL_ACCOUNT, OPTS_OFF);
    expect(mig.mem?.decay_class).toBe('warm');
  });

  it('G4：locked 记忆只有 unlock 放行，其他操作回 blocked_locked:true 且不改状态', async () => {
    await storage.putMemory(mem({ mem_id: 'mem_1', locked: true, decay_class: 'hot' }));
    const blocked = await runManageMemoryTool(ma, storage, { mem_id: 'mem_1', action: 'archive' }, FULL_ACCOUNT, OPTS_OFF);
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked_locked).toBe(true);
    expect(blocked.mem?.decay_class).toBe('hot');

    const unlocked = await runManageMemoryTool(ma, storage, { mem_id: 'mem_1', action: 'unlock' }, FULL_ACCOUNT, OPTS_OFF);
    expect(unlocked.ok).toBe(true);
    expect(unlocked.mem?.locked).toBe(false);
    expect(unlocked.blocked_locked).toBeUndefined();
  });

  it('delete 默认拒绝（不改库）；显式放行才落墓碑、清正文与 L0、回 mem:null', async () => {
    await expect(runManageMemoryTool(ma, storage, { mem_id: 'mem_1', action: 'delete' }, FULL_ACCOUNT, OPTS_OFF))
      .rejects.toThrow(/默认不开放|MCP_ALLOW_DELETE/);
    expect((await storage.getMemory('mem_1'))?.deleted).toBeUndefined();

    const r = await runManageMemoryTool(ma, storage, { mem_id: 'mem_1', action: 'delete' }, FULL_ACCOUNT, OPTS_ON);
    expect(r.ok).toBe(true);
    expect(r.mem).toBeNull();
    expect(await storage.getMemory('mem_1')).toBeNull(); // 墓碑对常规读取不可见
    const audits = await storage.queryAudit({ request_id: r.request_id });
    expect(audits[0].detail).toMatchObject({ op: 'delete', deleted: true, tombstone: true });
  });

  it('delete 门禁由环境变量 MCP_ALLOW_DELETE=1 控制（缺省 false）', () => {
    const before = process.env.MCP_ALLOW_DELETE;
    try {
      delete process.env.MCP_ALLOW_DELETE;
      expect(deleteAllowed()).toBe(false);
      process.env.MCP_ALLOW_DELETE = '1';
      expect(deleteAllowed()).toBe(true);
      process.env.MCP_ALLOW_DELETE = '0';
      expect(deleteAllowed()).toBe(false);
    } finally {
      if (before === undefined) delete process.env.MCP_ALLOW_DELETE;
      else process.env.MCP_ALLOW_DELETE = before;
    }
  });

  it('patch 校验：非 param/migrate 拒收、未知字段/越界/migrate 缺 decay_class/param 空对象均报错', async () => {
    const cases: Array<Record<string, unknown>> = [
      { mem_id: 'mem_1', action: 'pin', patch: { importance: 0.8 } },
      { mem_id: 'mem_1', action: 'param', patch: { bogus: 1 } },
      { mem_id: 'mem_1', action: 'param', patch: { importance: 2 } },
      { mem_id: 'mem_1', action: 'param', patch: { confidence: 0.01 } },
      { mem_id: 'mem_1', action: 'param', patch: { half_life_days: 0 } },
      { mem_id: 'mem_1', action: 'param', patch: { pinned: 'yes' } },
      { mem_id: 'mem_1', action: 'param', patch: {} },
      { mem_id: 'mem_1', action: 'migrate' },
      { mem_id: 'mem_1', action: 'migrate', patch: { decay_class: 'bogus' } },
    ];
    for (const args of cases) {
      await expect(runManageMemoryTool(ma, storage, args, FULL_ACCOUNT, OPTS_OFF)).rejects.toBeInstanceOf(McpToolError);
    }
  });

  it('非法 action / 缺 mem_id / 不存在 / 越界 → 明确错误或诚实 ok:false', async () => {
    await expect(runManageMemoryTool(ma, storage, { mem_id: 'mem_1', action: 'bogus' }, FULL_ACCOUNT, OPTS_OFF))
      .rejects.toBeInstanceOf(McpToolError);
    await expect(runManageMemoryTool(ma, storage, { action: 'pin' }, FULL_ACCOUNT, OPTS_OFF))
      .rejects.toBeInstanceOf(McpToolError);

    const missing = await runManageMemoryTool(ma, storage, { mem_id: 'mem_nope', action: 'pin' }, FULL_ACCOUNT, OPTS_OFF);
    expect(missing.ok).toBe(false);
    expect(missing.mem).toBeNull();

    await storage.putMemory(mem({ mem_id: 'mem_p2', project_id: 'P2' }));
    await expect(runManageMemoryTool(ma, storage, { mem_id: 'mem_p2', action: 'pin' }, SCOPED_P1, OPTS_OFF))
      .rejects.toThrow(/作用域不含该 mem_id 所属项目/);
    expect((await storage.getMemory('mem_p2'))?.pinned).toBe(false); // 未被改动
  });

  it('每次变更推进 version 且落审计 detail.op 归因', async () => {
    const r = await runManageMemoryTool(ma, storage, { mem_id: 'mem_1', action: 'pin' }, FULL_ACCOUNT, OPTS_OFF);
    const audits = await storage.queryAudit({ request_id: r.request_id });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('memory_op');
    expect(audits[0].detail).toMatchObject({ op: 'pin', mem_id: 'mem_1' });
    expect((await storage.getMemory('mem_1'))?.version).toBe(2);
  });
});
