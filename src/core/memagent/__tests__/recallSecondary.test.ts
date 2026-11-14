// A5（召回模式接线第五步）：次模式降级注入。
// 只作为独立 hint 字段下发（secondary_mode_hint），**不混进 hits、不计入 payload**——
// 这条路如果偷偷把 200t 塞进 payload，硬熔断与省量口径都会失真。
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import { estTokens } from '../recallInsight.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
/** 两个模式各命中 2 分：top_insight（架构+选型）与 fact_first（报错+日志） */
const QUERY = '架构选型 报错日志';

function makeAgent() {
  const storage = new InMemoryStorage();
  const vector = new JsVectorBackend();
  const ma = createMemAgent({
    form: 'desktop', account: ACCOUNT, llm: new FakeLlmProvider(), vector, storage,
  });
  return { ma, storage };
}

/**
 * 两条 L3 都落在次模式 fact_first 的首选层，且置信度一高一低：
 * 高置信那条会进 hits——若实现时忘了排除已命中记忆，次模式就会把同一条再说一遍，被「不复用」用例抓住。
 */
async function seed(ma: ReturnType<typeof makeAgent>['ma'], storage: InMemoryStorage) {
  const inHits = await ma._seedMemory({
    content: `${QUERY} 顶层原则：先定架构再动手 规范文档`, category: 'decision', project_id: 'P1', layer: 'L3',
  });
  const spare = await ma._seedMemory({
    content: `${QUERY} 上次排错的完整记录与教训`, category: 'pitfall', project_id: 'P1', layer: 'L3',
  });
  await ma._seedMemory({ content: '无关的会话摘要内容', category: 'context', project_id: 'P1', layer: 'L2' });
  await storage.putMemory({ ...inHits, confidence: 0.9 });
  await storage.putMemory({ ...spare, confidence: 0.2 });
}

describe('A5 · 次模式降级注入', () => {
  it('自动分流命中两个模式 → 次模式给出 ≤200t 参考摘要', async () => {
    const { ma, storage } = makeAgent();
    await seed(ma, storage);

    // top_k=1：只让主模式那一条进 hits，其余留作次模式的取材池
    const r = await ma.recall({ query: QUERY, project_id: 'P1', scene: 'task_start', top_k: 1 });

    expect(r.mode).toBe('top_insight');
    expect(r.secondary_mode_hint).not.toBeNull();
    expect(r.secondary_mode_hint?.mode).toBe('fact_first');
    expect(r.secondary_mode_hint?.content.length).toBeGreaterThan(0);
    expect(estTokens(r.secondary_mode_hint!.content)).toBeLessThanOrEqual(200);
    expect(r.secondary_mode_hint?.note).toContain('次模式');
  });

  it('次模式摘要不占 payload：payload_tokens 仍只等于 hits 之和', async () => {
    const { ma, storage } = makeAgent();
    await seed(ma, storage);

    const r = await ma.recall({ query: QUERY, project_id: 'P1', scene: 'task_start', top_k: 1 });

    expect(r.secondary_mode_hint).not.toBeNull();
    expect(r.payload_tokens).toBe(hitsTokens(r.hits));
  });

  it('次模式取材不复用已命中的那条（否则等于把同一条记忆说两遍）', async () => {
    const { ma, storage } = makeAgent();
    await seed(ma, storage);

    const r = await ma.recall({ query: QUERY, project_id: 'P1', scene: 'task_start', top_k: 1 });

    const hitContents = r.hits.map((h) => h.content);
    expect(hitContents).not.toContain(r.secondary_mode_hint?.content);
  });

  it('手动模式不产生次模式（手动即定论，不做降级注入）', async () => {
    const { ma, storage } = makeAgent();
    await seed(ma, storage);

    const r = await ma.recall({ query: QUERY, project_id: 'P1', mode: 'fact_first', top_k: 3 });

    expect(r.mode).toBe('fact_first');
    expect(r.secondary_mode_hint).toBeNull();
  });

  it('极简主模式无次模式（§2.4.3 极简不做降级注入）', async () => {
    const { ma, storage } = makeAgent();
    await seed(ma, storage);

    const r = await ma.recall({ query: '现在几点了', project_id: 'P1', mode: 'minimal', top_k: 3 });

    expect(r.mode).toBe('minimal');
    expect(r.secondary_mode_hint).toBeNull();
  });
});

// A11：次模式取材池必须复用主链路的硬过滤，且不得与项目背景重复注入同一条记忆。
describe('A11 · 次模式池与 hardFilter / 背景去重', () => {
  async function seedTwo(ma: ReturnType<typeof makeAgent>['ma'], storage: InMemoryStorage, mark: string, extra: Record<string, unknown> = {}) {
    const primary = await ma._seedMemory({
      content: `${QUERY} 主命中原则记录`, category: 'decision', project_id: 'P1', layer: 'L3',
    });
    await storage.putMemory({ ...primary, confidence: 0.9 });
    const spare = await ma._seedMemory({
      content: `${mark} 这条记忆的取材资格待测`, category: 'decision', project_id: 'P1', layer: 'L3', ...extra,
    } as Parameters<typeof ma._seedMemory>[0]);
    await storage.putMemory({ ...spare, confidence: 0.95 });
    return spare;
  }

  it('次模式池子要过 hardFilter：冷层记忆不得作为参考摘要下发', async () => {
    const { ma, storage } = makeAgent();
    await seedTwo(ma, storage, 'COLD_SECONDARY_MARK', { decay_class: 'cold' });
    const r = await ma.recall({ query: QUERY, project_id: 'P1', scene: 'task_start', top_k: 1 });
    expect(r.dispatch?.reason).toContain('次模式'); // 分流确实给出了次模式，用例没空转
    expect(r.secondary_mode_hint?.content ?? '').not.toContain('COLD_SECONDARY_MARK');
  });

  it('同一条记忆不得在次模式摘要与项目背景里重复注入', async () => {
    const { ma, storage } = makeAgent();
    await seedTwo(ma, storage, 'SHARED_MARK');
    const r = await ma.recall({ query: QUERY, project_id: 'P1', scene: 'task_start', top_k: 1 });
    const inHint = (r.secondary_mode_hint?.content ?? '').includes('SHARED_MARK');
    const inBackground = r.background.items.some((b) => b.content.includes('SHARED_MARK'));
    // 至少要出现一次（否则用例空转），但绝不能两处都出现
    expect(inHint || inBackground).toBe(true);
    expect(inHint && inBackground).toBe(false);
  });
});

function hitsTokens(hits: { content: string }[]): number {
  return hits.reduce((a, h) => a + estTokens(h.content), 0);
}
