// 批次8-A 验收：L1–L6 图谱确定性布局（六层轨道/边界/连线端点/无随机抖动）
import { describe, expect, it } from 'vitest';
import type { Memory } from '../../../core/memagent/types.ts';
import { deriveLayerGraph } from '../layerGraph.ts';
import { layoutLayerGraph } from '../layerGraphLayout.ts';

const BASE = 1_700_000_000_000;

function makeMemory(over: Partial<Memory> & Pick<Memory, 'mem_id'>): Memory {
  return {
    project_id: 'p1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L1', content: '内容', decay_class: 'hot',
    pinned: false, locked: false, version: 1, created_at: BASE,
    ...over,
  } as Memory;
}

function sampleGraph() {
  return deriveLayerGraph([
    makeMemory({ mem_id: 'm1', content_l1: 'L1 记忆一' }),
    makeMemory({ mem_id: 'm2', content_l1: 'L1 记忆二', pinned: true, importance: 0.9 }),
    makeMemory({ mem_id: 'm3', layer: 'L3', content: '主三', content_l1: 'L1三', content_l2: 'L2三', content_l3: 'L3三' }),
    makeMemory({ mem_id: 'm4', layer: 'L5', content: '主五', content_l1: 'L1五', content_l5: '洞察五', conflict_id: 'cf_1' }),
    makeMemory({ mem_id: 'm5', content_l1: 'L1 五', conflict_id: 'cf_1', merged_into: 'm1' }),
    makeMemory({ mem_id: 'm6', content_l1: '冷记忆', decay_class: 'cold' }),
  ]);
}

describe('layerGraphLayout · 确定性', () => {
  it('同一输入两次布局坐标完全一致（无随机数）', () => {
    const graph = sampleGraph();
    const a = layoutLayerGraph(graph);
    const b = layoutLayerGraph(graph);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('六个层锚点等角度分布，中心核心位于画布中央', () => {
    const layout = layoutLayerGraph(sampleGraph());
    expect(layout.hubs).toHaveLength(6);
    expect(layout.core).toMatchObject({ x: 580, y: 300, r: 44, total: 6 });
    const positions = new Set(layout.hubs.map((h) => `${h.x.toFixed(2)},${h.y.toFixed(2)}`));
    expect(positions.size).toBe(6);
    expect(layout.spokes).toHaveLength(6);
    expect(layout.spokes.every((s) => s.x1 === 580 && s.y1 === 300)).toBe(true);
  });

  it('所有节点/锚点坐标落在画布安全区内', () => {
    const layout = layoutLayerGraph(sampleGraph());
    const all = [...layout.hubs, ...layout.nodes];
    for (const p of all) {
      expect(p.x).toBeGreaterThanOrEqual(20);
      expect(p.x).toBeLessThanOrEqual(layout.width - 20);
      expect(p.y).toBeGreaterThanOrEqual(20);
      expect(p.y).toBeLessThanOrEqual(layout.height - 20);
    }
  });

  it('不同记忆的卫星坐标不重叠（黄金角散布）', () => {
    const layout = layoutLayerGraph(sampleGraph());
    const positions = new Set(layout.nodes.map((n) => `${n.x.toFixed(1)},${n.y.toFixed(1)}`));
    expect(positions.size).toBe(layout.nodes.length);
  });

  it('每条连线端点与节点/锚点坐标严格一致（member 指向所属层）', () => {
    const graph = sampleGraph();
    const layout = layoutLayerGraph(graph);
    const points = new Map<string, { x: number; y: number }>();
    for (const hub of layout.hubs) points.set(hub.id, { x: hub.x, y: hub.y });
    for (const node of layout.nodes) points.set(node.id, { x: node.x, y: node.y });
    expect(layout.edges.length).toBe(graph.edges.length);
    for (const edge of layout.edges) {
      const from = points.get(edge.source)!;
      const to = points.get(edge.target)!;
      expect([edge.x1, edge.y1]).toEqual([from.x, from.y]);
      expect([edge.x2, edge.y2]).toEqual([to.x, to.y]);
      if (edge.kind === 'member') expect(edge.target.startsWith('layer:')).toBe(true);
    }
  });

  it('自定义画布尺寸仍然生效并收敛边界', () => {
    const layout = layoutLayerGraph(sampleGraph(), { width: 800, height: 400 });
    expect(layout.width).toBe(800);
    expect(layout.height).toBe(400);
    expect(layout.core).toMatchObject({ x: 400, y: 200 });
    for (const p of [...layout.hubs, ...layout.nodes]) {
      expect(p.x).toBeGreaterThanOrEqual(20);
      expect(p.x).toBeLessThanOrEqual(780);
      expect(p.y).toBeGreaterThanOrEqual(20);
      expect(p.y).toBeLessThanOrEqual(380);
    }
  });

  it('空图谱：只渲染六层锚点与核心辐条（无连线/卫星）', () => {
    const layout = layoutLayerGraph(deriveLayerGraph([]));
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.spokes).toHaveLength(6);
    expect(layout.core.total).toBe(0);
    expect(layout.hubs.every((h) => h.count === 0 && h.r >= 18)).toBe(true);
  });
});
