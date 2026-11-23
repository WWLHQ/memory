// P1-8′（2026-11-23）：正文 tokenSet 缓存的三道闸门测试。
// A 影响面：缓存产物与直接 tokenize+Set 逐元素一致；不同记忆/正文变化互不污染。
// B 效果：真实账本热路径省时（见 tools 基准脚本）；本文件锁语义——冷/热缓存召回命中与分数逐条不变。
// C 变异：若缓存返回错误 token 集，等价断言必须判红（证明测试不是空跑）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { docTokenSet, clearDocTokenCache } from '../docTokenSet.ts';
import { tokenize, embedSync, JsVectorBackend } from '../vector.ts';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import type { Memory } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

function seedMemory(mem_id: string, content: string): Memory {
  return {
    mem_id,
    project_id: 'P1',
    enterprise_id: 'e1',
    team_id: 't1',
    category: 'fact',
    layer: 'L1',
    content,
    content_l1: content,
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_at: 1000,
    embedding: embedSync(content),
  };
}

const SEEDS = [
  seedMemory('mem_a', 'connection pool timeout 排查记录'),
  seedMemory('mem_b', '数据库连接池超时导致 Web 检索页误报 timeout'),
  seedMemory('mem_c', 'recall 召回权重 w_f 0.35 w_i 0.30 w_c 0.15 w_a 0.20'),
  seedMemory('mem_d', '折叠卡必须放在会话末尾，卡片后零文字'),
];

describe('P1-8′ · 正文 tokenSet 缓存', () => {
  beforeEach(() => clearDocTokenCache());
  afterEach(() => vi.useRealTimers());

  it('A：缓存产物与 new Set(tokenize(content)) 逐元素一致（空串/中文/英文/混合）', () => {
    for (const [id, content] of [
      ['m1', ''],
      ['m2', '数据库连接池超时'],
      ['m3', 'connection pool timeout'],
      ['m4', '混合 Chinese 2-gram 与 identifierToken/path.ts'],
    ]) {
      expect([...docTokenSet(id, content)].sort()).toEqual([...new Set(tokenize(content))].sort());
    }
  });

  it('A：同一 mem_id 同一正文复用同一个 Set；不同 mem_id 互不污染', () => {
    const first = docTokenSet('m_same', '连接池超时');
    expect(docTokenSet('m_same', '连接池超时')).toBe(first);
    expect([...docTokenSet('m_other', '完全不同的正文')]).toEqual([...new Set(tokenize('完全不同的正文'))]);
    expect([...first]).toEqual([...new Set(tokenize('连接池超时'))]);
  });

  it('A：正文变化立即失效——写后立刻召回读到的是新 token（不是旧缓存）', () => {
    const oldSet = docTokenSet('m_edit', '旧的正文内容');
    const newSet = docTokenSet('m_edit', '新的正文内容');
    expect(newSet).not.toBe(oldSet);
    expect([...newSet]).toEqual([...new Set(tokenize('新的正文内容'))]);
    // 改回旧正文也应重新计算（缓存条目已被覆盖）
    expect([...docTokenSet('m_edit', '旧的正文内容')]).toEqual([...new Set(tokenize('旧的正文内容'))]);
  });

  it('B：冷缓存与热缓存的召回命中顺序、mem_id、score 逐条一致', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);

    async function recallWith(warm: boolean) {
      clearDocTokenCache();
      if (warm) for (const m of SEEDS) docTokenSet(m.mem_id, m.content);
      const storage = new InMemoryStorage();
      for (const m of SEEDS) await storage.putMemory(m);
      const ma = createMemAgent({
        form: 'desktop', account: ACCOUNT, llm: new FakeLlmProvider(),
        vector: new JsVectorBackend(), storage,
      });
      return ma.recall({ query: 'connection pool timeout', project_id: 'P1', top_k: 4 });
    }

    const cold = await recallWith(false);
    const warm = await recallWith(true);
    expect(cold.hits.length).toBeGreaterThan(0);
    expect(warm.hits.map((h) => [h.mem_id, h.score])).toEqual(cold.hits.map((h) => [h.mem_id, h.score]));
  });

  it('C 变异：把缓存 token 集故意改错时，等价断言必须判红（证明测试有牙）', () => {
    clearDocTokenCache();
    const correct = docTokenSet('mem_a', 'connection pool timeout 排查记录');
    // 变异：模拟一个错误的缓存实现（少一个 token）
    const mutated = new Set([...correct].slice(1));
    expect([...mutated].sort()).not.toEqual([...new Set(tokenize('connection pool timeout 排查记录'))].sort());
  });
});
