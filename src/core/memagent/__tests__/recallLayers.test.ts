// A4（召回模式接线第四步）：分层取用——disabledLayers 剔层 + trimOrder 决定超预算先删哪层。
// 口径与 A2/A3 一致：只对手动模式生效，auto 档沿用全局 score 升序裁剪（默认档行为逐条不变）。
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const KEY = 'layerprobe';

function makeAgent() {
  const storage = new InMemoryStorage();
  const vector = new JsVectorBackend();
  const ma = createMemAgent({
    form: 'desktop', account: ACCOUNT, llm: new FakeLlmProvider(), vector, storage,
  });
  return { ma, storage };
}

/** 精确控制字符数（estTokens = ceil(len/2)），并保证每条都含检索关键词 */
function body(tag: string, chars: number): string {
  const head = `${KEY} ${tag} `;
  return head + 'z'.repeat(Math.max(0, chars - head.length));
}

interface SeedOpts { l2Chars: number; l5Chars: number; l3Chars: number; l2Conf: number; l5Conf: number; l3Conf: number }

async function seedLayers(ma: ReturnType<typeof makeAgent>['ma'], storage: InMemoryStorage, o: SeedOpts) {
  const l2 = await ma._seedMemory({ content: body('L2 会话摘要', o.l2Chars), category: 'fact', project_id: 'P1', layer: 'L2' });
  const l5 = await ma._seedMemory({ content: body('L5 高层洞察', o.l5Chars), category: 'decision', project_id: 'P1', layer: 'L5' });
  const l3 = [] as Awaited<ReturnType<typeof ma._seedMemory>>[];
  for (let i = 0; i < 3; i += 1) {
    l3.push(await ma._seedMemory({ content: body(`L3 工程事实 ${i}`, o.l3Chars), category: 'fact', project_id: 'P1', layer: 'L3' }));
  }
  // _seedMemory 不透传 confidence，直接覆盖落库（embedding 保留）
  await storage.putMemory({ ...l2, confidence: o.l2Conf, importance: 0.5, access_count: 0 });
  await storage.putMemory({ ...l5, confidence: o.l5Conf, importance: 0.5, access_count: 0 });
  for (const m of l3) await storage.putMemory({ ...m, confidence: o.l3Conf, importance: 0.5, access_count: 0 });
  return { l2Id: l2.mem_id, l5Id: l5.mem_id, l3Ids: l3.map((m) => m.mem_id) };
}

const layersOf = (hits: { layer: string }[]) => hits.map((h) => h.layer);

describe('A4 · disabledLayers（minimal 禁 L2/L5）', () => {
  it('手动 minimal：L2/L5 直接不进候选，只留 L3', async () => {
    const { ma, storage } = makeAgent();
    await seedLayers(ma, storage, { l2Chars: 600, l5Chars: 600, l3Chars: 200, l2Conf: 0.9, l5Conf: 0.9, l3Conf: 0.9 });

    const r = await ma.recall({ query: KEY, project_id: 'P1', mode: 'minimal', top_k: 5 });

    expect(r.hits.length).toBe(3);
    expect(layersOf(r.hits)).toEqual(['L3', 'L3', 'L3']);
  });

  it('同一批数据换成 fact_first：L2/L5 照常参与', async () => {
    const { ma, storage } = makeAgent();
    await seedLayers(ma, storage, { l2Chars: 600, l5Chars: 600, l3Chars: 200, l2Conf: 0.9, l5Conf: 0.9, l3Conf: 0.9 });

    const r = await ma.recall({ query: KEY, project_id: 'P1', mode: 'fact_first', top_k: 5 });

    expect(layersOf(r.hits)).toContain('L5');
    expect(layersOf(r.hits)).toContain('L2');
  });
});

describe('A4 · trimOrder（超预算先删哪层）', () => {
  // 总 3150t：L5 300 + L2 300 + L3 850×3 = 2550 —— 必须裁掉一层才回到 3000 以内
  const BIG: SeedOpts = { l2Chars: 600, l5Chars: 600, l3Chars: 1700, l2Conf: 0.06, l5Conf: 0.95, l3Conf: 0.3 };

  it('fact_first（trimOrder 先删 L5）→ L5 被裁，L3 三条全保', async () => {
    const { ma, storage } = makeAgent();
    const { l5Id, l3Ids } = await seedLayers(ma, storage, BIG);

    const r = await ma.recall({ query: KEY, project_id: 'P1', mode: 'fact_first', top_k: 5 });

    expect(r.payload_tokens).toBeLessThanOrEqual(3000);
    expect(r.hits.map((h) => h.mem_id)).not.toContain(l5Id);
    for (const id of l3Ids) expect(r.hits.map((h) => h.mem_id)).toContain(id);
  });

  it('auto 档不接管 trimOrder：L5 仍在（全局按分数裁剪，行为与改造前一致）', async () => {
    const { ma, storage } = makeAgent();
    const { l5Id } = await seedLayers(ma, storage, BIG);

    const r = await ma.recall({ query: KEY, project_id: 'P1', top_k: 5 });

    expect(r.payload_tokens).toBeLessThanOrEqual(3000);
    expect(r.hits.map((h) => h.mem_id)).toContain(l5Id);
  });
});
