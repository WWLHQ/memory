// A6（回显贯通）：`RecallResult.dispatch` 与 `mode_dispatch` 审计同源，且会话视图不冒充分流。
// 断言口径：同一次召回里「回显看到的分流事实」必须与审计逐字段一致；没有分流动作就显式 null。
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import {
  buildRecallHint, buildRecallModeLine, buildRecallCompactMarkdown, buildRecallMarkdown, buildRecallDetailPage,
} from '../recallInsight.ts';

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

// A8：模式行不能只在 display.markdown 里出现。四种呈现载体 + 单行兜底（display.line/text/content[0]）
// 必须同口径；会话视图（dispatch=null）仍不编模式行。夹具用真实 dispatch，不用 dispatch:null 假绿。
describe('A8 · 模式行四档贯通 + 单行兜底同口径', () => {
  const rollup = {
    today_calls: 1, today_injected_tokens: 1, today_saved_tokens: 1, today_legacy_calls: 0,
    all_calls: 1, all_injected_tokens: 1, all_saved_tokens: 1, all_legacy_calls: 0,
  };
  const meta = { project_id: 'P1', query: '架构选型怎么定', issuedAt: 1000, expiresAt: 1000 + 30 * 60_000 };

  async function realRecall() {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '架构选型怎么定', project_id: 'P1', scene: 'task_start' });
    expect(r.dispatch).not.toBeNull(); // 夹具真实性锁：本组不允许 dispatch:null 空转
    return { ma, r, hint: buildRecallHint(r, rollup, null) };
  }

  it('display.line 仍是单行，但末尾携带与 markdown 同源的 ⚙ 模式段', async () => {
    const { r, hint } = await realRecall();
    const modeLine = buildRecallModeLine(r)!;
    expect(hint.line).toContain(modeLine);
    expect(hint.line).not.toContain('\n');
    expect(hint.shortLine).toContain(modeLine);
    expect(hint.echo?.mode_line).toBe(modeLine);
  });

  it('会话视图没有分流动作 → 单行兜底也不编模式行', async () => {
    const { ma } = makeAgent();
    await ma._seedMemory({
      content: '本次会话已确认：先做 A8', category: 'context', project_id: 'P1',
      session_id: 's-a8', decay_class: 'hot',
    });
    const r = await ma.recall({ query: '我们聊到哪了', project_id: 'P1', scope: 'session', session_id: 's-a8' });
    const hint = buildRecallHint(r, rollup, null);
    expect(hint.line).not.toContain('⚙ 模式');
    expect(hint.shortLine).not.toContain('⚙ 模式');
  });

  it('四种载体都带 ⚙ 模式行，且与 buildRecallModeLine 逐字一致', async () => {
    const { r, hint } = await realRecall();
    const modeLine = buildRecallModeLine(r)!;
    const carriers = {
      'markdown-compact': buildRecallCompactMarkdown(hint, 'http://127.0.0.1:8204/recall/abcdefghij0123456789AB'),
      'markdown-full': buildRecallMarkdown(r, hint, null, { htmlDetails: false }),
      'html-details': buildRecallMarkdown(r, hint, null, { htmlDetails: true }),
      'detail-page': buildRecallDetailPage(r, hint, null, meta),
    };
    for (const [name, text] of Object.entries(carriers)) {
      expect(text, `${name} 缺模式行`).toContain(modeLine);
    }
    expect(carriers['markdown-compact']).toContain(`**${modeLine}**`);
    expect(carriers['markdown-full']).toContain(`**${modeLine}**`);
    expect(carriers['html-details']).toContain(`**${modeLine}**`);
    expect(carriers['detail-page']).toContain(`<p class="sum">${modeLine}</p>`);
  });
});

// A9：回显必须消费内核 dispatch.reason，且审计可按 request_id 查回「手动/自动」。
describe('A9 · 回显不伪造用户意图 / 审计可查分流来源', () => {
  it('critical + 手动 minimal 被 16.5 降级：模式行读 dispatch.reason，不写「用户指定」', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '任何内容', project_id: 'P1', scene: 'critical', mode: 'minimal' });
    expect(r.dispatch?.source).toBe('manual');
    expect(r.dispatch?.reason).toContain('16.5');
    const line = buildRecallModeLine(r)!;
    expect(line).toContain('16.5');
    expect(line).not.toContain('用户指定');
  });

  it('普通手动档仍写「用户指定」，不被降级口径误伤', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '架构选型怎么定', project_id: 'P1', mode: 'fact_first' });
    expect(buildRecallModeLine(r)).toBe('⚙ 模式：事实优先（用户指定）');
  });

  it('mode_dispatch 审计落 source，手动/自动都能按 request_id 查回', async () => {
    const cases = [
      { req: { query: '架构选型怎么定', project_id: 'P1', scene: 'task_start' as const }, expected: 'auto' },
      { req: { query: '架构选型怎么定', project_id: 'P1', mode: 'fact_first' as const }, expected: 'manual' },
    ];
    for (const { req, expected } of cases) {
      const { ma, storage } = makeAgent();
      await seed(ma);
      const r = await ma.recall(req);
      expect(r.dispatch?.source).toBe(expected);
      const [audit] = await storage.queryAudit({ action: 'mode_dispatch' });
      expect((audit.detail as Record<string, unknown>).source).toBe(expected);
    }
  });
});

// A10：内核边界与数据一致性。
describe('A10 · 内核边界 / dispatch 与 hint 一致性', () => {
  it('非法 scene 在 agent 层不崩，审计 scene 归一化为 default', async () => {
    const { ma, storage } = makeAgent();
    await seed(ma);
    const r = await ma.recall({ query: '修一下这个空指针', project_id: 'P1', scene: '' as 'default' });
    expect(r.dispatch).not.toBeNull();
    const [audit] = await storage.queryAudit({ action: 'mode_dispatch' });
    expect((audit.detail as Record<string, unknown>).scene).toBe('default');
  });

  it('top_k 非整数明确报错，不静默取整', async () => {
    const { ma } = makeAgent();
    await seed(ma);
    await expect(ma.recall({ query: '架构选型怎么定', project_id: 'P1', top_k: 2.5 }))
      .rejects.toThrow(/top_k/);
  });

  it('dispatch.secondary 与 secondary_mode_hint.mode 恒一致（池子空时不虚报次模式）', async () => {
    const { ma } = makeAgent();
    // 只放 1 条主命中：次模式结论会产生，但 A5 取材池为空
    await ma._seedMemory({ content: '架构选型 报错日志 主命中原则文档', category: 'decision', project_id: 'P1', layer: 'L3' });
    const r = await ma.recall({ query: '架构选型 报错日志', project_id: 'P1', scene: 'task_start', top_k: 5 });
    expect(r.dispatch?.reason).toContain('次模式');
    expect(r.secondary_mode_hint).toBeNull();
    expect(r.dispatch?.secondary).toBe(r.secondary_mode_hint?.mode ?? null);
  });
});
