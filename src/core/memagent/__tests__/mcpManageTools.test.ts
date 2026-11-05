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
