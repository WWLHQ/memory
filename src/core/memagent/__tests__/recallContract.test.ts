// A1（召回模式接线第一步）：RecallResult 契约先行——分流结果字段必须「恒在」，不允许有时有有时无。
// 本文件只锁契约，不锁分流算法（A2 负责）；所以这里断言的是「字段存在且为空」而不是「字段等于某个模式」。
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import type { RecallResult } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

function makeAgent() {
  const storage = new InMemoryStorage();
  const vector = new JsVectorBackend();
  const ma = createMemAgent({
    form: 'desktop', account: ACCOUNT, llm: new FakeLlmProvider(), vector, storage,
  });
  return { ma, storage };
}

describe('A1 · RecallResult 分流契约', () => {
  it('项目召回：hit_keywords 恒为数组；secondary_mode_hint 显式 null（不是 undefined）', async () => {
    const { ma } = makeAgent();
    await ma._seedMemory({
      content: 'connection pool timeout 排查记录', category: 'fact', project_id: 'P1', decay_class: 'hot',
    });

    const r = await ma.recall({ query: 'connection pool timeout', project_id: 'P1', top_k: 5 });

    expect(Array.isArray(r.hit_keywords)).toBe(true);
    // 显式 null 才能让回显层区分「没有次模式」与「运行时忘了填」
    expect(r.secondary_mode_hint).toBeNull();
  });

  it('会话视图（scope=session）同样遵守契约：字段存在且为空', async () => {
    const { ma } = makeAgent();
    await ma._seedMemory({
      content: '本次会话已确认的结论', category: 'fact', project_id: 'P1', decay_class: 'hot', session_id: 's1',
    });

    const r = await ma.recall({
      query: '本次会话', project_id: 'P1', scope: 'session', session_id: 's1', top_k: 3,
    });

    expect(Array.isArray(r.hit_keywords)).toBe(true);
    expect(r.secondary_mode_hint).toBeNull();
  });

  it('类型层强制：缺 hit_keywords 的 RecallResult 必须编译失败（@ts-expect-error 由 typecheck 门禁校验）', () => {
    // 若有人把 hit_keywords 改成可选，这条 expect-error 会变成「未使用的抑制」→ tsc 直接失败。
    // @ts-expect-error hit_keywords 为必填字段，缺它必须报错
    const missingKeywords: RecallResult = {
      hits: [],
      payload_tokens: 0,
      pipeline_llm_tokens: 0,
      budget: { soft: 1500, warn: 2000, hard: 3000, status: 'ok' },
      mode: 'auto',
      request_id: 'req_contract',
      scanned_memories: 0,
      background: { items: [], tokens: 0, candidates: 0 },
      savings: {
        corpus_tokens: 0, payload_tokens: 0, background_tokens: 0, injected_tokens: 0,
        budget_trimmed_tokens: 0, saved_tokens: 0,
      },
      secondary_mode_hint: null,
    };

    // 运行时不断言内容，只为让 tsc 真正检查上面那行
    expect(missingKeywords).toBeDefined();
  });
});
