// 首页 L1–L6 关系图谱布局（批次8-A，纯函数）：
// 确定性椭圆轨道布局——中央「记忆账本」核心 + 六层锚点（L1 顶部顺时针 L1→L6）+ 各层卫星记忆。
// 无随机数：同一输入必然得到同一坐标，刷新/搜索/筛选不跳动；黄金角散布避免卫星扎堆。
import {
  GRAPH_LAYERS,
  type LayerGraph,
  type LayerGraphEdge,
  type LayerHubNode,
  type MemoryGraphNode,
  type GraphEdgeKind,
} from './layerGraph.ts';

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface PositionedHub extends LayerHubNode, LayoutPoint {
  /** 锚点半径（随该层真实记忆数轻微增大） */
  r: number;
  /** 轨道角度（弧度，用于卫星向外散布） */
  angle: number;
}

export interface PositionedNode extends MemoryGraphNode, LayoutPoint {
  r: number;
}

export interface PositionedEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LayoutSpoke {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export interface LayerGraphLayout {
  width: number;
  height: number;
  core: { x: number; y: number; r: number; total: number };
  hubs: PositionedHub[];
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  spokes: LayoutSpoke[];
}

export interface LayerGraphLayoutOptions {
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 1160;
const DEFAULT_HEIGHT = 600;
const PADDING = 20;
const DEG = Math.PI / 180;
const GOLDEN = 0.6180339887498949;
const GOLDEN_ANGLE = 137.508;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function nodeRadius(node: MemoryGraphNode): number {
  let r = 4;
  if (node.importance >= 0.8) r += 1.2;
  if (node.pinned) r += 1;
  if (node.conflict) r += 1.4;
  return Math.round(r * 10) / 10;
}

/**
 * 计算确定性布局。
 * @param graph deriveLayerGraph 的输出
 * @param opts 画布尺寸（默认 1160×600，与 SVG viewBox 一致）
 */
export function layoutLayerGraph(graph: LayerGraph, opts: LayerGraphLayoutOptions = {}): LayerGraphLayout {
  const width = Math.max(480, opts.width ?? DEFAULT_WIDTH);
  const height = Math.max(320, opts.height ?? DEFAULT_HEIGHT);
  const cx = width / 2;
  const cy = height / 2;
  const rx = width * 0.285;
  const ry = height * 0.26;
  const outer = Math.min(width * 0.115, height * 0.22);

  const byPrimary = new Map<string, MemoryGraphNode[]>();
  for (const node of graph.nodes) {
    const list = byPrimary.get(node.layer) ?? [];
    list.push(node);
    byPrimary.set(node.layer, list);
  }

  const hubs: PositionedHub[] = GRAPH_LAYERS.map((meta, index) => {
    const angle = (-90 + index * 60) * DEG;
    const source = graph.hubs.find((h) => h.layer === meta.id);
    const count = source?.count ?? 0;
    return {
      id: `layer:${meta.id}`,
      layer: meta.id,
      label: meta.name,
      desc: meta.desc,
      color: meta.color,
      count,
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      r: Math.round((18 + Math.min(count, 60) / 6) * 10) / 10,
      angle,
    };
  });

  const nodes: PositionedNode[] = [];
  for (const hub of hubs) {
    const satellites = byPrimary.get(hub.layer) ?? [];
    const inner = hub.r + 26;
    const span = Math.max(8, outer - inner);
    satellites.forEach((node, i) => {
      const t = (i * GOLDEN) % 1;
      const radius = inner + span * Math.sqrt(t);
      const drift = (((i * GOLDEN_ANGLE) % 54) - 27) * DEG;
      const angle = hub.angle + drift;
      nodes.push({
        ...node,
        x: clamp(hub.x + radius * Math.cos(angle), PADDING, width - PADDING),
        y: clamp(hub.y + radius * Math.sin(angle), PADDING, height - PADDING),
        r: nodeRadius(node),
      });
    });
  }
  // 卫星按主层分组生成；排序回图谱节点顺序，保证渲染顺序稳定（重要节点原顺序在前）
  const order = new Map(graph.nodes.map((n, i) => [n.id, i]));
  nodes.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const points = new Map<string, LayoutPoint>();
  for (const hub of hubs) points.set(hub.id, { x: hub.x, y: hub.y });
  for (const node of nodes) points.set(node.id, { x: node.x, y: node.y });

  const edges: PositionedEdge[] = [];
  for (const edge of graph.edges) {
    const from = points.get(edge.source);
    const to = points.get(edge.target);
    if (!from || !to) continue;
    edges.push(toPositionedEdge(edge, from, to));
  }

  return {
    width,
    height,
    core: { x: cx, y: cy, r: 44, total: graph.stats.total },
    hubs,
    nodes,
    edges,
    spokes: hubs.map((hub) => ({
      id: `spoke:${hub.layer}`,
      x1: cx,
      y1: cy,
      x2: hub.x,
      y2: hub.y,
      color: hub.color,
    })),
  };
}

function toPositionedEdge(
  edge: LayerGraphEdge,
  from: LayoutPoint,
  to: LayoutPoint,
): PositionedEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
  };
}
