// B-2026-11-22：recall 命中计数回写 putMemory 失败（跨租户/权限等）不得中断 recall 与审计。
// 两轨并行验证：主分支（项目召回）+ session 分支（scope=session）。
// 闸门 C：变异验证 —— 故意让 putMemory 抛错，必须看到 recall 返回正常 + audit 落盘。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { JsVectorBackend } from '../vector.ts';
import { InMemoryStorage } from '../storage.ts';
import type { Memory } from '../types.ts';
import { ulid } from '../ulid.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

function baseMemory(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_default',
    project_id: 'P1',
    enterprise_id: 'e1',
    team_id: 't1',
    category: 'fact',
    layer: 'L1',
    content: 'connection pool timeout 排查记录',
    content_l1: 'connection pool timeout 排查记录',
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_at: 1000,
    ...over,
  };
}

describe('B-2026-11-22 · 命中计数回写 putMemory 失败不阻断 recall 与审计', () => {
  let storage: InMemoryStorage;
  let boomSpy: ReturnType<typeof vi.spyOn>;
  let ma: ReturnType<typeof createMemAgent>;

  beforeEach(() => {
    storage = new InMemoryStorage();
    ma = createMemAgent({
      form: 'desktop',
      account: ACCOUNT,
      llm: new FakeLlmProvider(),
      vector: new JsVectorBackend(),
      storage,
    });
    // 灌数必须在 spy 之前（putMemory 是真实写入）
    // 每个 test 自行控制灌哪些 mem，这里只保证 storage 可用
    // boomSpy 在 each test 内精确设置
  });

  afterEach(() => {
    if (boomSpy) boomSpy.mockRestore();
  });

  it('项目召回：putMemory 抛错时 recall 仍返回 hits 且审计落盘', async () => {
    // 先灌数（真实 putMemory）
    await storage.putMemory(baseMemory({ mem_id: 'mem_hit_1' }));
    // 再拦截后续所有 put（命中计数回写）
    boomSpy = vi.spyOn(storage, 'putMemory').mockImplementation(async () => {
      throw new Error('模拟跨租户/权限拒绝：禁止跨租户写入');
    });

    const r = await ma.recall({ query: 'connection pool timeout', project_id: 'P1', top_k: 5 });

    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.request_id).toBeDefined();
    expect(boomSpy).toHaveBeenCalled();
    // 审计落盘——主分支先写 mode_dispatch 再写 recall；会话分支只写 recall。统一取 recall 条目验证。
    const audits = await storage.queryAudit({ request_id: r.request_id });
    const recallAudits = audits.filter((a) => a.action === 'recall');
    expect(recallAudits.length).toBeGreaterThan(0);
  });

  it('会话视图：putMemory 抛错时 scope=session 召回仍正常', async () => {
    const sid = `sess_${ulid()}`;
    await storage.putMemory(baseMemory({
      mem_id: 'mem_sess_hit',
      session_id: sid,
      content: '本次会话已确认的结论',
      content_l1: '本次会话已确认的结论',
    }));
    boomSpy = vi.spyOn(storage, 'putMemory').mockImplementation(async () => {
      throw new Error('模拟跨租户/权限拒绝：禁止跨租户写入');
    });

    const r = await ma.recall({
      query: '本次会话',
      project_id: 'P1',
      scope: 'session',
      session_id: sid,
      top_k: 3,
    });

    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.request_id).toBeDefined();
    expect(boomSpy).toHaveBeenCalled();
    // 审计落盘——主分支先写 mode_dispatch 再写 recall；会话分支只写 recall。统一取 recall 条目验证。
    const audits = await storage.queryAudit({ request_id: r.request_id });
    const recallAudits = audits.filter((a) => a.action === 'recall');
    expect(recallAudits.length).toBeGreaterThan(0);
  });

  it('变异：恢复真实 putMemory 时 access_count 确实加一（回归验证，不静默降级）', async () => {
    const okStorage = new InMemoryStorage();
    const okMa = createMemAgent({
      form: 'desktop',
      account: ACCOUNT,
      llm: new FakeLlmProvider(),
      vector: new JsVectorBackend(),
      storage: okStorage,
    });
    await okStorage.putMemory(baseMemory({ mem_id: 'mem_ok_1', access_count: 0 }));
    const r = await okMa.recall({ query: 'connection pool timeout', project_id: 'P1', top_k: 5 });
    expect(r.hits.length).toBeGreaterThan(0);
    const updated = await okStorage.getMemory('mem_ok_1');
    expect(updated?.access_count).toBe(1);
  });
});
