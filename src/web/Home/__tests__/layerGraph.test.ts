// 批次8-A 验收：L1–L6 图谱数据推导（真实账本口径 + G3 隐私 + 合并/冲突关系 + 截断）
import { describe, expect, it } from 'vitest';
import type { Memory } from '../../../core/memagent/types.ts';
import {
  deriveLayerGraph,
  emptyLayerGraph,
  memoryLayerText,
  GRAPH_LAYERS,
} from '../layerGraph.ts';

const BASE = 1_700_000_000_000;

function makeMemory(over: Partial<Memory> & Pick<Memory, 'mem_id'>): Memory {
  return {
    project_id: 'p1',
    enterprise_id: 'e1',
    team_id: 't1',
    category: 'fact',
    layer: 'L1',
    content: '默认内容',
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_at: BASE,
    ...over,
  } as Memory;
}

describe('layerGraph · 层级归属与节点', () => {
  it('始终输出 L1–L6 六个层锚点，计数来自真实层内容', () => {
    const graph = deriveLayerGraph([
      makeMemory({ mem_id: 'm1', content_l1: 'L1 原文' }),
      makeMemory({
        mem_id: 'm2', layer: 'L3', content: 'L3 主内容',
        content_l1: 'L1 原文', content_l2: 'L2 摘要', content_l3: 'L3 得失',
      }),
    ]);
    expect(graph.hubs.map((h) => h.layer)).toEqual(GRAPH_LAYERS.map((l) => l.id));
    const counts = Object.fromEntries(graph.hubs.map((h) => [h.layer, h.count]));
    expect(counts).toEqual({ L1: 2, L2: 1, L3: 1, L4: 0, L5: 0, L6: 0 });
  });

  it('memoryLayerText：优先 content_lN，主内容层回落 content，缺失层为空', () => {
    const m = makeMemory({ mem_id: 'm1', layer: 'L2', content: '主内容', content_l1: '清洗后', content_l2: '' });
    expect(memoryLayerText(m, 'L1')).toBe('清洗后');
    expect(memoryLayerText(m, 'L2')).toBe('主内容');
    expect(memoryLayerText(m, 'L3')).toBe('');
  });

  it('标签取最精炼可用层（L5→L1），L6 JSON 不进入标签', () => {
    const graph = deriveLayerGraph([
      makeMemory({
        mem_id: 'm1', layer: 'L6', content: '{"keywords":["a"]}',
        content_l1: '原始清洗内容', content_l2: '会话摘要内容', content_l3: '得失分析内容',
        content_l4: '模式归纳内容', content_l5: '洞察提炼内容',
        content_l6: '{"keywords":["a"]}',
      }),
    ]);
    expect(graph.nodes[0].label).toBe('洞察提炼内容');
    expect(graph.nodes[0].label).not.toContain('keywords');
    expect(graph.nodes[0].layers).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
  });

  it('多层层内容 → 记忆节点与各层锚点均有 member 边', () => {
    const graph = deriveLayerGraph([
      makeMemory({ mem_id: 'm1', layer: 'L2', content: '主', content_l1: 'L1', content_l2: 'L2' }),
    ]);
    const member = graph.edges.filter((e) => e.kind === 'member');
    expect(member).toHaveLength(2);
    expect(member.map((e) => e.target).sort()).toEqual(['layer:L1', 'layer:L2']);
    expect(member.every((e) => e.source === 'mem:m1')).toBe(true);
  });

  it('未知 category → unknown/未分类（不静默改成合法类别）', () => {
    const m = makeMemory({ mem_id: 'm1', content_l1: 'x', category: 'lesson' as never });
    const node = deriveLayerGraph([m]).nodes[0];
    expect(node.category).toBe('unknown');
    expect(node.categoryName).toBe('未分类');
  });
});

describe('layerGraph · G3 隐私', () => {
  it.each(['cold', 'dormant', 'archived'] as const)('%s 记忆只保留遮罩标签，不泄露任何层原文', (decay) => {
    const graph = deriveLayerGraph([
      makeMemory({
        mem_id: 'mem_secret_1234', decay_class: decay,
        content_l1: '用户手机号 13800000000', content_l2: '会话摘要绝密', content: '绝密主内容',
      }),
    ]);
    const node = graph.nodes[0];
    expect(node.masked).toBe(true);
    expect(node.contents).toEqual({});
    expect(node.label).not.toContain('手机号');
    expect(node.label).not.toContain('绝密');
    expect(JSON.stringify(node)).not.toContain('13800000000');
    expect(node.label).toContain('1234');
    expect(graph.stats.masked).toBe(1);
  });

  it('热/温记忆正常展示原文摘要（不被误遮罩）', () => {
    const node = deriveLayerGraph([makeMemory({ mem_id: 'm1', content_l1: '正常内容' })]).nodes[0];
    expect(node.masked).toBe(false);
    expect(node.label).toBe('正常内容');
    expect(node.contents.L1).toBe('正常内容');
  });
});

describe('layerGraph · 关系与统计', () => {
  it('同一 conflict_id 的节点连冲突边，统计冲突组/冲突条数', () => {
    const graph = deriveLayerGraph([
      makeMemory({ mem_id: 'm1', content_l1: 'a', conflict_id: 'cf_1' }),
      makeMemory({ mem_id: 'm2', content_l1: 'b', conflict_id: 'cf_1' }),
      makeMemory({ mem_id: 'm3', content_l1: 'c' }),
    ]);
    const conflict = graph.edges.filter((e) => e.kind === 'conflict');
    expect(conflict).toHaveLength(1);
    expect(conflict[0].source).toBe('mem:m1');
    expect(conflict[0].target).toBe('mem:m2');
    expect(graph.stats.conflicts).toBe(1);
    expect(graph.stats.conflictMemories).toBe(2);
    expect(graph.nodes.filter((n) => n.conflict)).toHaveLength(2);
  });

  it('merged_into / merged_from 双向去重为一条合并边', () => {
    const graph = deriveLayerGraph([
      makeMemory({ mem_id: 'child', content_l1: '子记忆', merged_into: 'parent' }),
      makeMemory({ mem_id: 'parent', content_l1: '父记忆', merged_from: ['child'] }),
    ]);
    const merge = graph.edges.filter((e) => e.kind === 'merge');
    expect(merge).toHaveLength(1);
    expect(merge[0].source).toBe('mem:child');
    expect(merge[0].target).toBe('mem:parent');
    expect(graph.stats.merges).toBe(1);
    expect(graph.nodes.find((n) => n.memId === 'parent')?.mergedCount).toBe(1);
  });

  it('graft_to/graft_layer 生成嫁接边，统计 grafts 与被嫁接数', () => {
    const graph = deriveLayerGraph([
      makeMemory({ mem_id: 'target', content_l1: '已有记忆', grafted_from: ['novel'] }),
      makeMemory({ mem_id: 'novel', layer: 'L2', content: '重复新记忆', content_l1: 'x', content_l2: 'y', graft_to: 'target', graft_layer: 'L2' }),
    ]);
    const graft = graph.edges.filter((e) => e.kind === 'graft');
    expect(graft).toHaveLength(1);
    expect(graft[0].source).toBe('mem:novel');
    expect(graft[0].target).toBe('mem:target');
    expect(graph.stats.grafts).toBe(1);
    const target = graph.nodes.find((n) => n.memId === 'target');
    expect(target?.graftedCount).toBe(1);
    const novel = graph.nodes.find((n) => n.memId === 'novel');
    expect(novel?.graftTo).toBe('target');
    expect(novel?.graftLayer).toBe('L2');
  });

  it('嫁接目标不在账本内 → 不画边，也不计入 grafts', () => {
    const graph = deriveLayerGraph([
      makeMemory({ mem_id: 'novel', content_l1: 'x', graft_to: 'gone', graft_layer: 'L1' }),
    ]);
    expect(graph.edges.filter((e) => e.kind === 'graft')).toHaveLength(0);
    expect(graph.stats.grafts).toBe(0);
  });

  it('超过 maxNodes 按冲突/置顶/新鲜度截断，并如实统计 truncated', () => {
    const mems: Memory[] = Array.from({ length: 10 }, (_, i) => makeMemory({
      mem_id: `m${String(i).padStart(2, '0')}`,
      content_l1: `记忆 ${i}`,
      created_at: BASE + i * 1000,
    }));
    mems[2] = { ...mems[2], pinned: true };
    mems[4] = { ...mems[4], conflict_id: 'cf_1' };
    const graph = deriveLayerGraph(mems, { maxNodes: 6 });
    expect(graph.nodes).toHaveLength(6);
    expect(graph.stats.total).toBe(10);
    expect(graph.stats.truncated).toBe(4);
    const ids = graph.nodes.map((n) => n.memId);
    expect(ids).toContain('m02');
    expect(ids).toContain('m04');
    // 置顶/冲突优先于更早的普通记忆
    expect(ids).not.toContain('m00');
  });

  it('删除墓碑不进入图谱与统计', () => {
    const graph = deriveLayerGraph([
      makeMemory({ mem_id: 'm1', content_l1: 'ok' }),
      makeMemory({ mem_id: 'm2', content_l1: 'gone', deleted: true }),
    ]);
    expect(graph.stats.total).toBe(1);
    expect(graph.nodes.map((n) => n.memId)).toEqual(['m1']);
    expect(graph.hubs.find((h) => h.layer === 'L1')?.count).toBe(1);
  });

  it('空账本 → 六层结构仍在，节点/关系/统计全空（诚实空态）', () => {
    const graph = emptyLayerGraph();
    expect(graph.hubs).toHaveLength(6);
    expect(graph.hubs.every((h) => h.count === 0)).toBe(true);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.stats).toMatchObject({ total: 0, rendered: 0, truncated: 0, refined: 0, conflicts: 0, merges: 0, grafts: 0, masked: 0 });
  });

  it('refined 只统计含 L2–L6 真实产物的记忆', () => {
    const graph = deriveLayerGraph([
      makeMemory({ mem_id: 'stub', content_l1: '只 L1' }),
      makeMemory({ mem_id: 'llm', layer: 'L2', content: '主', content_l1: 'L1', content_l2: 'L2' }),
    ]);
    expect(graph.stats.refined).toBe(1);
  });
});
