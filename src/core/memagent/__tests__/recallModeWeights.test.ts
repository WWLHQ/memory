// A3（召回模式接线第三步）：模式权重透传进 scoreMemory。
// 口径（P1 决策）：手动模式用该模式的权重向量；auto/缺省仍走 growth:v1 自生长权重，默认档召回质量不被一次性推翻。
// 权重真相：recallModes.ts 的 {f,i,c,a} → growthConfig.ts 的 {w_f,w_i,w_c,w_a}，字段名不同，必须显式映射。
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import { DEFAULT_RECALL_WEIGHTS } from '../../../shared/growthConfig.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const DAY = 86_400_000;
const QUERY = 'recall weight 权重 排序 验证';

function makeAgent() {
  const storage = new InMemoryStorage();
  const vector = new JsVectorBackend();
  const ma = createMemAgent({
    form: 'desktop', account: ACCOUNT, llm: new FakeLlmProvider(), vector, storage,
  });
  return { ma, storage };
}

/**
 * 两条同主题记忆，只在「新鲜度」与「置信度」上相反：
 *   旧：200 天未访问（freshness 钳到 0.05）、confidence 0.95
 *   新：刚创建（freshness 1.0）、confidence 0.10
 * importance 相同、access_count 都为 0（boost 0），所以排序只由 f 与 c 的权重之比决定。
 */
async function seedOpposite(
  ma: ReturnType<typeof makeAgent>['ma'],
  storage: InMemoryStorage,
) {
  const now = Date.now();
  const old = await ma._seedMemory({
    content: `${QUERY} 旧记忆 高置信 反复核对过`, category: 'fact', project_id: 'P1', decay_class: 'hot',
  });
  const fresh = await ma._seedMemory({
    content: `${QUERY} 新记忆 低置信 仅一次记录`, category: 'fact', project_id: 'P1', decay_class: 'hot',
  });
  await storage.putMemory({
    ...old, created_at: now - 200 * DAY, last_access_time: now - 200 * DAY,
    half_life_days: 30, confidence: 0.95, importance: 0.9, access_count: 0,
  });
  await storage.putMemory({
    ...fresh, created_at: now, last_access_time: now,
    half_life_days: 30, confidence: 0.1, importance: 0.9, access_count: 0,
  });
  return { oldId: old.mem_id, freshId: fresh.mem_id };
}

describe('A3 · 模式权重透传', () => {
  it('fact_first（c 权重 0.40）→ 高置信的旧记忆胜出', async () => {
    const { ma, storage } = makeAgent();
    const { oldId } = await seedOpposite(ma, storage);

    const r = await ma.recall({ query: QUERY, project_id: 'P1', mode: 'fact_first', top_k: 5 });

    expect(r.hits[0]?.mem_id).toBe(oldId);
  });

  it('event_replay（f 权重 0.40）→ 刚创建的低置信记忆胜出（排序真的翻转）', async () => {
    const { ma, storage } = makeAgent();
    const { freshId } = await seedOpposite(ma, storage);

    const r = await ma.recall({ query: QUERY, project_id: 'P1', mode: 'event_replay', top_k: 5 });

    expect(r.hits[0]?.mem_id).toBe(freshId);
  });

  it('审计如实记录权重来源与生效权重（手动）', async () => {
    const { ma, storage } = makeAgent();
    await seedOpposite(ma, storage);

    await ma.recall({ query: QUERY, project_id: 'P1', mode: 'fact_first', top_k: 5 });

    const [d] = await storage.queryAudit({ action: 'mode_dispatch' });
    expect(d.detail).toMatchObject({
      weights_source: 'manual',
      weights: { w_f: 0.10, w_i: 0.20, w_c: 0.40, w_a: 0.30 },
    });
  });

  it('auto 档不接管权重：仍走 growth:v1（默认档行为不被模式改动污染）', async () => {
    const { ma, storage } = makeAgent();
    await seedOpposite(ma, storage);

    await ma.recall({ query: QUERY, project_id: 'P1', top_k: 5 });

    const [d] = await storage.queryAudit({ action: 'mode_dispatch' });
    expect(d.detail).toMatchObject({ weights_source: 'growth:v1', weights: DEFAULT_RECALL_WEIGHTS });
  });
});
