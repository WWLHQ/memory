// 批次44-D5-1：list_memories / get_memory 共用编排的单元契约
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../storage.ts';
import { McpToolError } from '../mcpRecall.ts';
import { runGetMemoryTool, runListMemoriesTool, toMemoryView } from '../mcpReadTools.ts';
import type { Memory } from '../types.ts';

const FULL_ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1', scope_project_ids: ['*'] };
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

describe('toMemoryView（L0 不泄 + 白名单字段）', () => {
  it('只回可读摘要，绝不携带 L0 密文/原文/has_l0', () => {
    const view = toMemoryView(mem({ tags: ['d5'], importance: 0.8 }));
    expect(view.snippet).toBe('脱敏后的可读正文'); // content_l1 优先
    expect(view.tags).toEqual(['d5']);
    expect(view.importance).toBe(0.8);
    expect(view).not.toHaveProperty('content_l0_enc');
    expect(view).not.toHaveProperty('content_orig');
    expect(view).not.toHaveProperty('has_l0');
    expect(view).not.toHaveProperty('content');
    expect(view).not.toHaveProperty('embedding');
  });

  it('snippet 截断至 200 字，无 content_l1 时回退 content', () => {
    expect(toMemoryView(mem({ content_l1: 'x'.repeat(300) })).snippet).toHaveLength(200);
    expect(toMemoryView(mem({ content_l1: undefined, content: '回退正文' })).snippet).toBe('回退正文');
  });
});

describe('runListMemoriesTool', () => {
  let storage: InMemoryStorage;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    await storage.putMemory(mem({ mem_id: 'mem_1', category: 'fact', created_at: 1000, tags: ['alpha'], created_by_agent: 'workbuddy' }));
    await storage.putMemory(mem({ mem_id: 'mem_2', category: 'decision', created_at: 3000, tags: ['beta'], created_by_agent: 'cursor', decay_class: 'warm' }));
    await storage.putMemory(mem({ mem_id: 'mem_3', category: 'fact', created_at: 2000, tags: ['alpha', 'beta'], created_by_agent: 'workbuddy', importance: 0.9 }));
    await storage.putMemory(mem({ mem_id: 'mem_deleted', created_at: 4000, deleted: true }));
  });

  it('默认列出全部非删除条目，按最近活动倒序，只回白名单字段', async () => {
    const r = await runListMemoriesTool(storage, {}, FULL_ACCOUNT);
    expect(r.ok).toBe(true);
    expect(r.project_id).toBe('P1');
    expect(r.resolved_from).toBe('single_project');
    expect(r.total).toBe(3);
    expect(r.limit).toBe(20);
    expect(r.offset).toBe(0);
    expect(r.items.map((i) => i.mem_id)).toEqual(['mem_2', 'mem_3', 'mem_1']);
    for (const item of r.items) {
      expect(item).not.toHaveProperty('content_l0_enc');
      expect(item).not.toHaveProperty('content_orig');
    }
  });

  it('category / decay_class / source_agent / tag / updated_since 过滤生效', async () => {
    expect((await runListMemoriesTool(storage, { category: 'decision' }, FULL_ACCOUNT)).total).toBe(1);
    expect((await runListMemoriesTool(storage, { decay_class: 'warm' }, FULL_ACCOUNT)).total).toBe(1);
    expect((await runListMemoriesTool(storage, { source_agent: 'workbuddy' }, FULL_ACCOUNT)).total).toBe(2);
    expect((await runListMemoriesTool(storage, { tag: 'beta' }, FULL_ACCOUNT)).total).toBe(2);
    expect((await runListMemoriesTool(storage, { updated_since: 2500 }, FULL_ACCOUNT)).total).toBe(1);
  });

  it('limit + offset 分页，total 为分页前总数', async () => {
    const r = await runListMemoriesTool(storage, { limit: 1, offset: 1 }, FULL_ACCOUNT);
    expect(r.total).toBe(3);
    expect(r.limit).toBe(1);
    expect(r.offset).toBe(1);
    expect(r.items.map((i) => i.mem_id)).toEqual(['mem_3']);
  });

  it('项目自动定位只看令牌可见项目；多项目且省略 → 明确报错不猜', async () => {
    await storage.putMemory(mem({ mem_id: 'mem_p2', project_id: 'P2', created_at: 5000 }));
    await expect(runListMemoriesTool(storage, {}, FULL_ACCOUNT)).rejects.toThrow(/多个项目|有 2 个项目|list_projects/);
    const onlyP1 = await runListMemoriesTool(storage, {}, SCOPED_P1);
    expect(onlyP1.project_id).toBe('P1');
    expect(onlyP1.total).toBe(3);
  });

  it('显式 project_id 越界 → 拒绝（不回显不可见项目的记忆）', async () => {
    await expect(runListMemoriesTool(storage, { project_id: 'P2' }, SCOPED_P1))
      .rejects.toThrow(/作用域不含项目 P2/);
  });

  it('非法参数 → McpToolError(-32602)，不静默按默认处理', async () => {
    const cases: Array<Record<string, unknown>> = [
      { category: 'bogus' }, { decay_class: 'bogus' }, { limit: 0 }, { limit: 101 },
      { limit: 1.5 }, { offset: -1 }, { updated_since: -1 }, { tag: 123 },
    ];
    for (const args of cases) {
      await expect(runListMemoriesTool(storage, args, FULL_ACCOUNT)).rejects.toBeInstanceOf(McpToolError);
    }
    try { await runListMemoriesTool(storage, { limit: 0 }, FULL_ACCOUNT); } catch (e) {
      expect((e as McpToolError).code).toBe(-32602);
    }
  });
});

describe('runGetMemoryTool', () => {
  let storage: InMemoryStorage;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    await storage.putMemory(mem({ mem_id: 'mem_1', project_id: 'P1' }));
    await storage.putMemory(mem({ mem_id: 'mem_p2', project_id: 'P2' }));
  });

  it('精确读单条 → ok:true + 白名单摘要，不泄 L0', async () => {
    const r = await runGetMemoryTool(storage, { mem_id: 'mem_1' }, FULL_ACCOUNT);
    expect(r.ok).toBe(true);
    expect(r.item?.mem_id).toBe('mem_1');
    expect(r.item?.snippet).toBe('脱敏后的可读正文');
    expect(r.item).not.toHaveProperty('content_l0_enc');
  });

  it('不存在 / 已删除 → 如实 ok:false，不补造空记录', async () => {
    const missing = await runGetMemoryTool(storage, { mem_id: 'mem_nope' }, FULL_ACCOUNT);
    expect(missing).toEqual({ ok: false, item: null, reason: '记忆不存在' });
  });

  it('越界项目 → 拒绝；缺 mem_id → -32602', async () => {
    await expect(runGetMemoryTool(storage, { mem_id: 'mem_p2' }, SCOPED_P1))
      .rejects.toThrow(/作用域不含项目 P2/);
    await expect(runGetMemoryTool(storage, {}, FULL_ACCOUNT)).rejects.toBeInstanceOf(McpToolError);
  });
});
