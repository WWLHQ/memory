// A6（回显贯通）：`RecallResult.dispatch` 与 `mode_dispatch` 审计同源，且会话视图不冒充分流。
// 断言口径：同一次召回里「回显看到的分流事实」必须与审计逐字段一致；没有分流动作就显式 null。
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import { buildRecallHint, buildRecallModeLine, buildRecallCompactMarkdown } from '../recallInsight.ts';

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

describe('A6 · dispatch 与审计同源', () => {
  it('自动档：dispatch.source=auto，五个字段与 mode_dispatch 审计逐字段相同', async () => {
    const { ma, storage } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '架构选型怎么定', project_id: 'P1', scene: 'task_start' });
    expect(r.dispatch).not.toBeNull();
    const d = r.dispatch!;
    expect(d.source).toBe('auto');
    expect(d.suggested).toBe('top_insight');
    expect(d.applied).toBe('top_insight');
    expect(d.secondary).toBeNull();
    expect(d.weights_source).toBe('growth:v1');

    const [audit] = await storage.queryAudit({ action: 'mode_dispatch' });
    const detail = audit.detail as Record<string, unknown>;
    // 同源铁律：回显里的 reason / 建议 / 实际 / 权重来源必须与审计一字不差
    expect(detail.reason).toBe(d.reason);
    expect(detail.mode).toBe(d.suggested);
    expect(detail.applied_mode).toBe(d.applied);
    expect(detail.weights_source).toBe(d.weights_source);
  });

  it('手动档：dispatch.source=manual，权重来源 manual，次模式为 null', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '架构选型怎么定', project_id: 'P1', mode: 'fact_first' });
    expect(r.dispatch).toMatchObject({
      source: 'manual', suggested: 'fact_first', applied: 'fact_first', secondary: null, weights_source: 'manual',
    });
    expect(r.dispatch!.reason).toContain('手动指定');
  });

  it('自动极简观测档：suggested=minimal / applied=auto，回显不冒充分流已落地', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '现在几点了', project_id: 'P1' });
    expect(r.dispatch).toMatchObject({ source: 'auto', suggested: 'minimal', applied: 'auto' });
  });

  it('会话视图没有分流动作 → dispatch 显式 null（不拿 auto 冒充已分流）', async () => {
    const { ma } = makeAgent();
    await ma._seedMemory({
      content: '本次会话已确认：先做 A1 再做 A2', category: 'context', project_id: 'P1',
      session_id: 's-a6', decay_class: 'hot',
    });
    const r = await ma.recall({ query: '我们聊到哪了', project_id: 'P1', scope: 'session', session_id: 's-a6' });
    expect(r.dispatch).toBeNull();
  });
});

describe('A6 · 回显模式行（§3.4 透明）', () => {
  it('手动档：写明「用户指定」', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '架构选型怎么定', project_id: 'P1', mode: 'fact_first' });
    expect(buildRecallModeLine(r)).toBe('⚙ 模式：事实优先（用户指定）');
  });

  it('自动档：写明生效模式 + 命中特征词', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '架构选型怎么定', project_id: 'P1', scene: 'task_start' });
    expect(buildRecallModeLine(r)).toBe('⚙ 模式：顶层洞察优先（自动分流 · 命中「架构」「选型」）');
  });

  it('自动极简观测档：写明「分流建议…本轮按默认口径执行」', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '现在几点了', project_id: 'P1' });
    expect(buildRecallModeLine(r)).toBe('⚙ 模式：自动（分流建议极简轻量 · 本轮按默认口径执行）');
  });

  it('会话视图：无模式行，compact 摘要也不凭空多一行', async () => {
    const { ma } = makeAgent();
    await ma._seedMemory({
      content: '本次会话已确认：先做 A1 再做 A2', category: 'context', project_id: 'P1',
      session_id: 's-a6b', decay_class: 'hot',
    });
    const r = await ma.recall({ query: '我们聊到哪了', project_id: 'P1', scope: 'session', session_id: 's-a6b' });
    expect(buildRecallModeLine(r)).toBeNull();
    const hint = buildRecallHint(r, { today_calls: 1, today_injected_tokens: 1, today_saved_tokens: 1, today_legacy_calls: 0, all_calls: 1, all_injected_tokens: 1, all_saved_tokens: 1, all_legacy_calls: 0 }, null);
    expect(buildRecallCompactMarkdown(hint)).not.toContain('⚙ 模式');
  });

  it('compact 摘要：模式行落在「汇总」之后、「明细」链接之前', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '架构选型怎么定', project_id: 'P1', scene: 'task_start' });
    const hint = buildRecallHint(r, { today_calls: 1, today_injected_tokens: 1, today_saved_tokens: 1, today_legacy_calls: 0, all_calls: 1, all_injected_tokens: 1, all_saved_tokens: 1, all_legacy_calls: 0 }, null);
    const md = buildRecallCompactMarkdown(hint, 'http://127.0.0.1:8204/recall/abcdefghij0123456789AB');
    const iStats = md.indexOf('📊 汇总');
    const iMode = md.indexOf('⚙ 模式');
    const iLink = md.indexOf('▶ [展开本次召回明细');
    expect(iStats).toBeGreaterThan(-1);
    expect(iMode).toBeGreaterThan(iStats);
    expect(iLink).toBeGreaterThan(iMode);
  });
});
