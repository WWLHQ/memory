// 批次8-B 验收：图谱面板交互（筛选/搜索/缩放/详情/G3 遮罩/刷新/键盘/空态）
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { Memory } from '../../../core/memagent/types.ts';
import { deriveLayerGraph } from '../layerGraph.ts';
import { LayerGraphPanel } from '../LayerGraphPanel.tsx';

const BASE = 1_700_000_000_000;

function makeMemory(over: Partial<Memory> & Pick<Memory, 'mem_id'>): Memory {
  return {
    project_id: 'p1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L1', content: '内容', decay_class: 'hot',
    pinned: false, locked: false, version: 1, created_at: BASE,
    ...over,
  } as Memory;
}

function fixture() {
  return deriveLayerGraph([
    makeMemory({
      mem_id: 'mem_a', category: 'fact', content_l1: '重构失败原因是缓存击穿', tags: ['缓存'],
    }),
    makeMemory({
      mem_id: 'mem_b', category: 'decision', layer: 'L2', content: '主B',
      content_l1: '决策原文B', content_l2: '决策摘要B', pinned: true, importance: 0.9,
    }),
    makeMemory({
      mem_id: 'mem_c', category: 'pitfall', decay_class: 'cold',
      content_l1: '冷记忆原文不能出现',
    }),
    makeMemory({
      mem_id: 'mem_d', category: 'insight', layer: 'L5', content: '主D',
      content_l1: '洞察L1', content_l2: '洞察L2', content_l3: '洞察L3', content_l4: '洞察L4', content_l5: '洞察结论D',
      conflict_id: 'cf_1',
    }),
    makeMemory({
      mem_id: 'mem_e', category: 'context', content_l1: '上下文E',
      conflict_id: 'cf_1', merged_into: 'mem_a',
    }),
  ]);
}

function node(container: HTMLElement, memId: string): Element {
  const el = container.querySelector(`[data-graph-node="mem:${memId}"]`);
  if (!el) throw new Error(`node ${memId} not found`);
  return el;
}

describe('LayerGraphPanel · 图层与关系渲染', () => {
  it('渲染六层锚点、全部记忆节点、合并/冲突连线与统计', () => {
    const { container } = render(<LayerGraphPanel graph={fixture()} />);
    expect(container.querySelector('#layerGraph')).not.toBeNull();
    expect(container.querySelectorAll('[data-graph-hub]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-graph-node]')).toHaveLength(5);
    expect(container.querySelectorAll('.lg-edge.merge')).toHaveLength(1);
    expect(container.querySelectorAll('.lg-edge.conflict')).toHaveLength(1);
    const text = container.textContent ?? '';
    expect(text).toContain('冲突');
    expect(text).toContain('合并');
    expect(text).toContain('全部');
  });

  it('空账本：六层结构仍在 + 诚实空态（不渲染演示节点）', () => {
    const { container } = render(<LayerGraphPanel graph={deriveLayerGraph([])} />);
    expect(container.querySelectorAll('[data-graph-hub]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-graph-node]')).toHaveLength(0);
    expect(container.querySelector('#lgEmpty')?.textContent).toContain('暂无记忆');
    expect(container.textContent).toContain('无演示节点');
  });
});

describe('LayerGraphPanel · 筛选与搜索', () => {
  it('层 chip 过滤只保留该层有内容的记忆；再次点击恢复全部', () => {
    const { container } = render(<LayerGraphPanel graph={fixture()} />);
    fireEvent.click(container.querySelector('#lgChipL5')!);
    expect(container.querySelectorAll('[data-graph-node]')).toHaveLength(1);
    expect(container.querySelector('[data-graph-node="mem:mem_d"]')).not.toBeNull();
    fireEvent.click(container.querySelector('#lgChipL5')!);
    expect(container.querySelectorAll('[data-graph-node]')).toHaveLength(5);
  });

  it('点击层锚点等价于层筛选', () => {
    const { container } = render(<LayerGraphPanel graph={fixture()} />);
    fireEvent.click(container.querySelector('[data-graph-hub="L5"]')!);
    expect(container.querySelectorAll('[data-graph-node]')).toHaveLength(1);
    expect(container.querySelector('[data-graph-node="mem:mem_d"]')).not.toBeNull();
  });

  it('搜索命中高亮、非命中变暗；无命中显示诚实提示', () => {
    const { container } = render(<LayerGraphPanel graph={fixture()} />);
    const search = container.querySelector('#lgSearch')!;
    fireEvent.change(search, { target: { value: '重构' } });
    expect(node(container, 'mem_a').classList.contains('dim')).toBe(false);
    expect(node(container, 'mem_b').classList.contains('dim')).toBe(true);
    fireEvent.change(search, { target: { value: '不存在的关键词xyz' } });
    expect(container.querySelector('#lgSearchEmpty')?.textContent).toContain('没有匹配');
    fireEvent.click(container.querySelector('#lgSearchClear')!);
    expect(container.querySelector('#lgSearchEmpty')).toBeNull();
  });

  it('冷记忆不参与原文搜索（G3：只按遮罩标签/mem_id 匹配）', () => {
    const { container } = render(<LayerGraphPanel graph={fixture()} />);
    fireEvent.change(container.querySelector('#lgSearch')!, { target: { value: '冷记忆原文' } });
    expect(container.querySelector('#lgSearchEmpty')).not.toBeNull();
  });
});

describe('LayerGraphPanel · 详情抽屉与 G3', () => {
  it('点击热记忆节点 → 抽屉展示真实层内容与 mem_id', () => {
    const { container } = render(<LayerGraphPanel graph={fixture()} />);
    fireEvent.click(node(container, 'mem_d'));
    const drawer = container.querySelector('#lgDrawer');
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent).toContain('洞察结论D');
    expect(drawer!.textContent).toContain('mem_d');
    expect(drawer!.querySelectorAll('.lg-layer-row')).toHaveLength(5);
    fireEvent.click(container.querySelector('.lg-drawer-close')!);
    expect(container.querySelector('#lgDrawer')).toBeNull();
  });

  it('冷记忆节点 → 抽屉只显示 G3 提示，原文不进入 DOM', () => {
    const { container } = render(<LayerGraphPanel graph={fixture()} />);
    fireEvent.click(node(container, 'mem_c'));
    expect(container.querySelector('#lgPrivacy')?.textContent).toContain('G3');
    expect(container.textContent).not.toContain('冷记忆原文不能出现');
    expect(container.querySelectorAll('.lg-layer-row')).toHaveLength(0);
  });

  it('键盘 Enter 也能打开详情（可访问性）', () => {
    const { container } = render(<LayerGraphPanel graph={fixture()} />);
    fireEvent.keyDown(node(container, 'mem_a'), { key: 'Enter' });
    expect(container.querySelector('#lgDrawer')?.textContent).toContain('重构失败原因是缓存击穿');
  });

  it('悬停节点显示提示卡（类别/层/摘要）', () => {
    const { container } = render(<LayerGraphPanel graph={fixture()} />);
    fireEvent.pointerOver(node(container, 'mem_a'));
    const tip = container.querySelector('.lg-tip');
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toContain('事实');
    expect(tip!.textContent).toContain('L1');
    fireEvent.pointerOut(node(container, 'mem_a'), { relatedTarget: document.body });
    expect(container.querySelector('.lg-tip')).toBeNull();
  });
});

describe('LayerGraphPanel · 缩放与刷新', () => {
  it('放大/复位更新缩放百分比与 data-zoom', () => {
    const { container } = render(<LayerGraphPanel graph={fixture()} />);
    const svg = container.querySelector('#layerGraphSvg')!;
    expect(container.querySelector('#lgZoomValue')?.textContent).toBe('100%');
    fireEvent.click(container.querySelector('#lgZoomIn')!);
    expect(container.querySelector('#lgZoomValue')?.textContent).toBe('120%');
    expect(svg.getAttribute('data-zoom')).toBe('1.20');
    fireEvent.click(container.querySelector('#lgZoomReset')!);
    expect(container.querySelector('#lgZoomValue')?.textContent).toBe('100%');
    expect(svg.getAttribute('data-zoom')).toBe('1.00');
  });

  it('刷新按钮触发真实重聚合回调', async () => {
    const onRefresh = vi.fn(async () => {});
    const { container } = render(<LayerGraphPanel graph={fixture()} onRefresh={onRefresh} />);
    fireEvent.click(container.querySelector('#lgRefresh')!);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('未提供 onRefresh 时不渲染刷新按钮（不伪造能力）', () => {
    const { container } = render(<LayerGraphPanel graph={fixture()} />);
    expect(container.querySelector('#lgRefresh')).toBeNull();
  });
});
