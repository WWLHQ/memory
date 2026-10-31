// 批次3-A：逃生阀冷回填不得击穿 3000t 硬熔断，payload_tokens 必须等于最终 hits 之和
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const QUERY = 'cold topic connection pool timeout';

function makeAgent() {
  const storage = new InMemoryStorage();
  const vector = new JsVectorBackend();
  const ma = createMemAgent({
    form: 'desktop', account: ACCOUNT, llm: new FakeLlmProvider(), vector, storage,
  });
  return { ma, storage };
}

describe('批次3-A recall 预算（含冷回填）', () => {
  it('冷回填把总量推过 3000t → 按分数裁剪，payload_tokens/budget 取最终值', async () => {
    const { ma } = makeAgent();
    // 热层弱相关命中：1000t、score≈0（触发 evidence_thin 的前提）
    const hot = await ma._seedMemory({
      content: 'lorem ipsum dolor sit amet consectetur '.repeat(50),
      category: 'fact', project_id: 'P1', decay_class: 'hot',
    });
    // 冷层强信号：2500t、sim≈1（≥0.85 才允许回填）
    const cold = await ma._seedMemory({
      content: `${QUERY} `.repeat(160),
      category: 'fact', project_id: 'P1', decay_class: 'cold',
    });

    const r = await ma.recall({ query: QUERY, project_id: 'P1', top_k: 5 });

    expect(r.evidence_thin).toBe(true);
    // 回填后真实总量 3500t，必须裁剪到硬熔断内
    expect(r.payload_tokens).toBeLessThanOrEqual(3000);
    expect(r.payload_tokens).toBe(r.hits.reduce((a, h) => a + Math.ceil(h.content.length / 2), 0));
    // 热层 score 更低 → 被裁掉；冷层证据保留
    expect(r.hits.map((h) => h.mem_id)).toEqual([cold.mem_id]);
    expect(r.hits.map((h) => h.mem_id)).not.toContain(hot.mem_id);
    expect(r.budget.status).toBe('warn');
  });
});
