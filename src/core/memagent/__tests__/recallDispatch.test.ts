// A2（召回模式接线第二步）：把 resolveMode 接进 agent.recall()——只做「分流 + 审计」，不改打分与裁剪。
// 断言口径：模式由 scene × 关键词裁决；手动强制采用；critical 禁极简；非法值明确报错；分流留审计。
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import type { RecallMode } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

function makeAgent() {
  const storage = new InMemoryStorage();
  const vector = new JsVectorBackend();
  const ma = createMemAgent({
    form: 'desktop', account: ACCOUNT, llm: new FakeLlmProvider(), vector, storage,
  });
  return { ma, storage };
}

async function seed(ma: ReturnType<typeof makeAgent>['ma']) {
  await ma._seedMemory({ content: '架构选型记录：内核缓存分层', category: 'decision', project_id: 'P1', decay_class: 'hot' });
}

describe('A2 · 自动分流（scene × 关键词）', () => {
  it('task_start + 「架构/选型」→ top_insight，命中词回传', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '架构选型怎么定', project_id: 'P1', scene: 'task_start' });
    expect(r.mode).toBe('top_insight');
    expect(r.hit_keywords.length).toBeGreaterThan(0);
    expect(r.hit_keywords).toContain('架构');
  });

  it('history_query + 「复盘」→ event_replay（高置信单字命中 1 个即达标）', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '复盘上次的排查过程', project_id: 'P1', scene: 'history_query' });
    expect(r.mode).toBe('event_replay');
    expect(r.hit_keywords).toContain('复盘');
  });

  it('default + 短中文零命中 → 分流建议 minimal，但 A2 阶段不执行（如实报 auto）', async () => {
    const { ma, storage } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '现在几点了', project_id: 'P1' });
    // 分流看到了极简信号并留审计，但执行口径仍是旧行为；回显如实报 auto，不冒充「分流已生效」
    expect(r.mode).toBe('auto');
    expect(r.hit_keywords).toEqual([]);
    const [d] = await storage.queryAudit({ action: 'mode_dispatch' });
    expect(d.detail).toMatchObject({ mode: 'minimal', applied_mode: 'auto' });
  });

  it('显式 minimal 一直真执行：结果模式即 minimal', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '现在几点了', project_id: 'P1', mode: 'minimal' });
    expect(r.mode).toBe('minimal');
  });
});

describe('A2 · 手动与红线', () => {
  it('手动 fact_first：强制采用，不做自动分流', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '架构选型怎么定', project_id: 'P1', scene: 'task_start', mode: 'fact_first' });
    expect(r.mode).toBe('fact_first');
    expect(r.hit_keywords).toEqual([]);   // 手动不分流，不产生命中词
  });

  it('critical + 手动 minimal → 强制降 fact_first（16.5 红线）', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '资金合规口径', project_id: 'P1', scene: 'critical', mode: 'minimal' });
    expect(r.mode).toBe('fact_first');
  });

  it('枚举外的 mode 一律报错，不静默降级成 auto', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    await expect(
      ma.recall({ query: '任意问题', project_id: 'P1', mode: 'manual' as unknown as RecallMode }),
    ).rejects.toThrow(/mode/i);
  });
});

describe('A2 · 分流审计', () => {
  it('每次项目召回写一条 mode_dispatch，detail 含 mode / hit_keywords / reason', async () => {
    const { ma, storage } = makeAgent();
    await seed(ma);
    await ma.recall({ query: '架构选型怎么定', project_id: 'P1', scene: 'task_start' });

    const rows = await storage.queryAudit({ action: 'mode_dispatch' });
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({ mode: 'top_insight' });
    expect((rows[0].detail as { hit_keywords: string[] }).hit_keywords).toContain('架构');
    expect(typeof (rows[0].detail as { reason: string }).reason).toBe('string');
  });

  it('会话视图不分流：不写 mode_dispatch', async () => {
    const { ma, storage } = makeAgent();
    await ma._seedMemory({
      content: '本次会话结论', category: 'fact', project_id: 'P1', decay_class: 'hot', session_id: 's2',
    });
    await ma.recall({ query: '本次会话', project_id: 'P1', scope: 'session', session_id: 's2', top_k: 3 });
    expect(await storage.queryAudit({ action: 'mode_dispatch' })).toHaveLength(0);
  });
});
