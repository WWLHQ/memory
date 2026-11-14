// REQ-014 / T1（C6-A）：合并影子探测补带契约测试。
// 覆盖：强信号才补带 / 目标可读性 / 去重与链式影子 / 分层禁用 / 预算无关的纯函数边界 /
// 「无影子时零产出」的守恒断言（C6 不得改变既有召回行为）。
import { describe, expect, it } from 'vitest';
import {
  SUPERSEDE_MAX_EXTRA_HITS, SUPERSEDE_PROBE_MIN_SIM,
  buildSupersedeHit, mergeSupersededHits, probeSupersededTargets, supersedeNote,
} from '../recallSupersede.ts';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { DEFAULT_VECTOR_DIM, JsVectorBackend, embedSync } from '../vector.ts';
import type { Hit, Memory } from '../types.ts';

const NOW = 1_800_000_000_000;

function mem(o: Partial<Memory> = {}): Memory {
  return {
    mem_id: o.mem_id ?? `m${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2', content: o.content ?? 'some content here',
    decay_class: 'hot', pinned: false, locked: false, version: 1,
    created_at: NOW - 3600_000,
    embedding: [1, 0, 0],
    ...o,
  };
}

function hit(o: Partial<Hit> = {}): Hit {
  return {
    mem_id: o.mem_id ?? 'mem_a',
    content: o.content ?? 'absorbed content',
    layer: o.layer ?? 'L2',
    decay_class: o.decay_class ?? 'hot',
    pinned: false, locked: false, score: 0.5,
    evidence_ref: `l0:${o.mem_id ?? 'mem_a'}`,
    ...o,
  };
}

/** 固定余弦：按 mem_id 查表，缺失返回 0 */
function fixedCos(table: Record<string, number>) {
  return (a: readonly number[], b: readonly number[]): number => {
    void a;
    const key = (b as unknown as { __id?: string }).__id ?? '';
    return table[key] ?? 0;
  };
}

/** 给记忆挂上「余弦表可识别的 id」——测试里用它把 sim 稳定映射到影子 */
function withId(m: Memory): Memory {
  const emb = [...(m.embedding ?? [])];
  (emb as unknown as { __id?: string }).__id = m.mem_id;
  return { ...m, embedding: emb };
}

describe('REQ-014 T1 · 影子探测（probeSupersededTargets）', () => {
  it('强信号（sim ≥ 0.85）才补带，弱信号一律不产出', () => {
    const target = mem({ mem_id: 'mem_new' });
    const strong = withId(mem({ mem_id: 'mem_old', merged_into: 'mem_new' }));
    const weak = withId(mem({ mem_id: 'mem_old2', merged_into: 'mem_new2' }));
    const target2 = mem({ mem_id: 'mem_new2' });
    const cos = fixedCos({ mem_old: SUPERSEDE_PROBE_MIN_SIM, mem_old2: 0.6 });

    const probes = probeSupersededTargets({
      queryVec: [], memories: [target, strong, weak, target2], cosine: cos,
      excludeIds: new Set(),
    });
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({ shadow_id: 'mem_old', target_id: 'mem_new' });
    expect(probes[0].sim).toBeCloseTo(SUPERSEDE_PROBE_MIN_SIM, 6);
  });

  it('无影子 → 空数组（既有召回行为逐字不变的守恒断言）', () => {
    const cos = fixedCos({ mem_a: 0.99, mem_b: 0.99 });
    const probes = probeSupersededTargets({
      queryVec: [],
      memories: [withId(mem({ mem_id: 'mem_a' })), withId(mem({ mem_id: 'mem_b' }))],
      cosine: cos, excludeIds: new Set(),
    });
    expect(probes).toEqual([]);
  });

  it('目标已命中（excludeIds）/ 目标已删 / 目标是影子（合并链）→ 均不重复补带', () => {
    const shadow1 = withId(mem({ mem_id: 's1', merged_into: 'mem_known' }));
    const known = mem({ mem_id: 'mem_known' });
    const shadow2 = withId(mem({ mem_id: 's2', merged_into: 'mem_deleted' }));
    const deleted = mem({ mem_id: 'mem_deleted', deleted: true } as Partial<Memory>);
    const shadow3 = withId(mem({ mem_id: 's3', merged_into: 'mem_chain' }));
    const chained = mem({ mem_id: 'mem_chain', merged_into: 'mem_final' });
    const final = mem({ mem_id: 'mem_final' });
    const shadow4 = withId(mem({ mem_id: 's4', merged_into: 'mem_missing' }));
    const cos = fixedCos({ s1: 0.99, s2: 0.99, s3: 0.99, s4: 0.99 });

    const probes = probeSupersededTargets({
      queryVec: [], memories: [shadow1, known, shadow2, deleted, shadow3, chained, final, shadow4],
      cosine: cos, excludeIds: new Set(['mem_known']),
    });
    expect(probes).toEqual([]);
  });

  it('影子自身 deleted / 无 embedding → 不作为触发源', () => {
    const t = mem({ mem_id: 'mem_new' });
    const dead = withId(mem({ mem_id: 's_dead', merged_into: 'mem_new', deleted: true }));
    const noVec = mem({ mem_id: 's_novec', merged_into: 'mem_new', embedding: undefined });
    const cos = fixedCos({ s_dead: 0.99, s_novec: 0.99 });
    const probes = probeSupersededTargets({
      queryVec: [], memories: [t, dead, noVec], cosine: cos, excludeIds: new Set(),
    });
    expect(probes).toEqual([]);
  });

  it('同一目标被多个影子命中 → 只留最高 sim 的一条', () => {
    const t = mem({ mem_id: 'mem_new' });
    const s1 = withId(mem({ mem_id: 's1', merged_into: 'mem_new' }));
    const s2 = withId(mem({ mem_id: 's2', merged_into: 'mem_new' }));
    const cos = fixedCos({ s1: 0.86, s2: 0.95 });
    const probes = probeSupersededTargets({
      queryVec: [], memories: [t, s1, s2], cosine: cos, excludeIds: new Set(),
    });
    expect(probes).toHaveLength(1);
    expect(probes[0].shadow_id).toBe('s2');
    expect(probes[0].sim).toBeCloseTo(0.95, 6);
  });

  it('多目标按 sim 降序并截断到 SUPERSEDE_MAX_EXTRA_HITS', () => {
    const targets = [1, 2, 3].map((i) => mem({ mem_id: `t${i}` }));
    const shadows = [1, 2, 3].map((i) => withId(mem({ mem_id: `s${i}`, merged_into: `t${i}` })));
    const cos = fixedCos({ s1: 0.87, s2: 0.99, s3: 0.93 });
    const probes = probeSupersededTargets({
      queryVec: [], memories: [...targets, ...shadows], cosine: cos, excludeIds: new Set(),
    });
    expect(probes.map((p) => p.target_id)).toEqual(['t2', 't3']);
    expect(probes).toHaveLength(SUPERSEDE_MAX_EXTRA_HITS);
  });

  it('目标落在手动模式禁用层 → 不补带（不得绕开分层裁剪）', () => {
    const t = mem({ mem_id: 'mem_l5', layer: 'L5' });
    const s = withId(mem({ mem_id: 's1', merged_into: 'mem_l5' }));
    const cos = fixedCos({ s1: 0.99 });
    const probes = probeSupersededTargets({
      queryVec: [], memories: [t, s], cosine: cos, excludeIds: new Set(), disabledLayers: ['L5'],
    });
    expect(probes).toEqual([]);
  });
});

describe('REQ-014 T1 · 补带与合并（buildSupersedeHit / mergeSupersededHits）', () => {
  it('补带命中：正文与目标逐字一致，只加标记与溯源', () => {
    const target = mem({
      mem_id: 'mem_new', content: '部署端口是 8204', layer: 'L2',
      merged_from: ['old1', 'old2'],
    });
    const out = buildSupersedeHit({
      target, probe: { shadow_id: 'old_shadow', target_id: 'mem_new', sim: 0.92 },
      score: 0.7321, matched_terms: ['部署', '8204'],
    });
    expect(out.content).toBe('部署端口是 8204');
    expect(out.mem_id).toBe('mem_new');
    expect(out.score).toBe(0.732);
    expect(out.superseded).toBe(true);
    expect(out.superseded_from).toEqual(['old_shadow']);
    expect(out.merged_from_count).toBe(2);
    expect(out.evidence_ref).toBe('l0:mem_new');
  });

  it('产物无来源条数时不臆造 merged_from_count', () => {
    const target = mem({ mem_id: 'mem_plain', content: 'x' });
    const out = buildSupersedeHit({
      target, probe: { shadow_id: 's', target_id: 'mem_plain', sim: 0.9 },
      score: 0.5, matched_terms: [],
    });
    expect(out.merged_from_count).toBeUndefined();
  });

  it('新目标追加到尾部；已在命中的目标只补溯源、不重复、不改顺序与正文', () => {
    const a = hit({ mem_id: 'mem_a', content: 'A' });
    const b = hit({ mem_id: 'mem_b', content: 'B' });
    const extraNew = hit({ mem_id: 'mem_c', content: 'C', superseded: true, superseded_from: ['s1'] });
    const extraDup = hit({ mem_id: 'mem_a', content: 'A', score: 0.99, superseded: true, superseded_from: ['s2'] });

    const r1 = mergeSupersededHits([a, b], [extraNew]);
    expect(r1.added).toBe(1);
    expect(r1.hits.map((h) => h.mem_id)).toEqual(['mem_a', 'mem_b', 'mem_c']);

    const r2 = mergeSupersededHits([a, b], [extraDup]);
    expect(r2.added).toBe(0);
    expect(r2.hits).toHaveLength(2);
    expect(r2.hits[0].mem_id).toBe('mem_a');
    expect(r2.hits[0].content).toBe('A');          // 正文没被改写
    expect(r2.hits[0].score).toBe(0.5);            // 分数没被覆盖
    expect(r2.hits[0].superseded).toBe(true);
    expect(r2.hits[0].superseded_from).toEqual(['s2']);
  });
});

describe('REQ-014 T1 · 中性标注（supersedeNote）', () => {
  it('只有 superseded 命中才有标注；普通命中返回 null（不产生常驻噪声）', () => {
    expect(supersedeNote(hit({ mem_id: 'mem_a' }))).toBeNull();
    const note = supersedeNote(hit({ mem_id: 'mem_b', superseded: true, superseded_from: ['s1'], merged_from_count: 3 }));
    expect(note).toContain('以本条为准');
    expect(note).toContain('3 条旧记录');
  });

  it('缺来源条数时标注不含数字（不编造）', () => {
    const note = supersedeNote(hit({ mem_id: 'mem_c', superseded: true, superseded_from: ['s1'] }));
    expect(note).toContain('由旧记录合并而来');
    expect(note).not.toMatch(/\d+ 条/);
  });
});

describe('REQ-014 T1 · 内核接线（agent.recall 端到端）', () => {
  const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
  const OLD = 'API 网关重试策略：指数退避，初始 200ms';
  const NEW = 'API 网关重试策略（最新）：指数退避 200ms，最多 5 次';

  function seed(m: Partial<Memory> & Pick<Memory, 'mem_id' | 'content'>): Memory {
    return {
      project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
      category: 'decision', layer: 'L2', decay_class: 'hot',
      pinned: false, locked: false, version: 1, created_at: NOW - 3600_000,
      embedding: embedSync(m.content, DEFAULT_VECTOR_DIM),
      ...m,
    };
  }

  it('问旧事项 → 合并目标被补带并打 superseded 标；影子本身不出现在命中里', async () => {
    const storage = new InMemoryStorage();
    const agent = createMemAgent({
      form: 'desktop', account: ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
    });
    // 影子（旧记录，已并入 mem_new）与目标（最新版）都落库
    await storage.putMemory(seed({ mem_id: 'mem_old_shadow', content: OLD, merged_into: 'mem_new' }));
    await storage.putMemory(seed({ mem_id: 'mem_new', content: NEW, merged_from: ['mem_old_shadow'] }));

    const r = await agent.recall({ query: OLD, project_id: 'P1' });
    const ids = r.hits.map((h) => h.mem_id);
    expect(ids).not.toContain('mem_old_shadow');   // 影子仍不进命中
    const carried = r.hits.find((h) => h.mem_id === 'mem_new');
    expect(carried).toBeTruthy();
    expect(carried!.superseded).toBe(true);
    expect(carried!.superseded_from).toEqual(['mem_old_shadow']);
    expect(carried!.content).toBe(NEW);            // 正文逐字来自目标，未改写
  });

  it('库里没有影子时，同一次召回的命中组成与改造前一致（守恒）', async () => {
    const storage = new InMemoryStorage();
    const agent = createMemAgent({
      form: 'desktop', account: ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
    });
    await storage.putMemory(seed({ mem_id: 'mem_new', content: NEW }));
    const r = await agent.recall({ query: OLD, project_id: 'P1' });
    expect(r.hits.map((h) => h.mem_id)).toEqual(['mem_new']);
    expect(r.hits[0].superseded).toBeUndefined();  // 无影子触发 → 不标注
  });
});
