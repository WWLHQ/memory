// 首页 L1–L6 关系图谱数据推导（批次8-A，纯函数）：
// 只从内核记忆主表（Memory）推导真实节点/关系/统计——层归属=该层内容真实存在，
// 合并=merged_from/merged_into，冲突=conflict_id，分支嫁接=graft_to/graft_layer/grafted_from；
// 绝不生成示例节点或伪造关系。
// 隐私（G3）：cold/dormant/archived 记忆只保留遮罩标签，任何层原文都不进入图谱数据。
import { isCategory, type Category, type DecayClass, type Layer, type Memory } from '../../core/memagent/types.ts';

export type GraphLayerId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';
export type GraphCategoryId = Category | 'unknown';

export interface LayerMeta {
  id: GraphLayerId;
  name: string;
  color: string;
  desc: string;
}

/** 层语义与配色逐字对齐 src/web/memory/MemoryLayeredPage.tsx（L6→L1 的官方色板） */
export const GRAPH_LAYERS: readonly LayerMeta[] = [
  { id: 'L1', name: '清洗脱敏', color: '#e0884f', desc: '唯一可进 prompt 的原始形态' },
  { id: 'L2', name: '会话摘要', color: '#4d9fff', desc: '情景摘要 ≤300 字' },
  { id: 'L3', name: '得失分析', color: '#3ecf8e', desc: '总结得失 ≤200 字' },
  { id: 'L4', name: '模式归纳', color: '#c084fc', desc: '规律提炼 ≤120 字' },
  { id: 'L5', name: '洞察提炼', color: '#f59e0b', desc: '本质洞察 ≤60 字' },
  { id: 'L6', name: '投影索引', color: '#22d3ee', desc: '关键字 ≤30 词 + relevance' },
];

export interface CategoryMeta {
  id: GraphCategoryId;
  name: string;
  color: string;
}

/** 记忆六类配色（图谱节点着色；与层色板区分开，避免误读） */
export const GRAPH_CATEGORIES: readonly CategoryMeta[] = [
  { id: 'fact', name: '事实', color: '#5aa9ff' },
  { id: 'decision', name: '决策', color: '#3ecf8e' },
  { id: 'pitfall', name: '踩坑', color: '#ff7b72' },
  { id: 'insight', name: '洞察', color: '#c084fc' },
  { id: 'preference', name: '偏好', color: '#f5c451' },
  { id: 'context', name: '上下文', color: '#38d6d6' },
];

const UNKNOWN_CATEGORY: CategoryMeta = { id: 'unknown', name: '未分类', color: '#7c8b9e' };

export function categoryMeta(id: GraphCategoryId): CategoryMeta {
  return GRAPH_CATEGORIES.find((c) => c.id === id) ?? UNKNOWN_CATEGORY;
}

const LAYER_CONTENT_KEY: Record<GraphLayerId, keyof Memory> = {
  L1: 'content_l1',
  L2: 'content_l2',
  L3: 'content_l3',
  L4: 'content_l4',
  L5: 'content_l5',
  L6: 'content_l6',
};

/** 该层真实文本（content_lN；主内容层回落到 content）；空串=该层无内容 */
export function memoryLayerText(m: Memory, layer: GraphLayerId): string {
  const v = m[LAYER_CONTENT_KEY[layer]];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (m.layer === layer && typeof m.content === 'string' && m.content.trim()) return m.content.trim();
  return '';
}

function layersOf(m: Memory): GraphLayerId[] {
  return GRAPH_LAYERS.filter((l) => memoryLayerText(m, l.id).length > 0).map((l) => l.id);
}

function clip(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** 标签取最精炼的可用层（L5→L1）；L6 是 JSON 投影，不作为可读标签 */
const LABEL_PRIORITY: GraphLayerId[] = ['L5', 'L4', 'L3', 'L2', 'L1'];

function pickLabel(m: Memory, layers: GraphLayerId[]): string {
  for (const layer of LABEL_PRIORITY) {
    if (!layers.includes(layer)) continue;
    const text = clip(memoryLayerText(m, layer), 18);
    if (text) return text;
  }
  return clip(m.content ?? '', 18) || m.mem_id.slice(-8);
}

function privacyKind(decay: DecayClass): string | null {
  if (decay === 'cold' || decay === 'dormant') return '冷记忆';
  if (decay === 'archived') return '归档记忆';
  return null;
}

export type GraphEdgeKind = 'member' | 'merge' | 'conflict' | 'graft';

export interface LayerHubNode {
  id: string;
  layer: GraphLayerId;
  label: string;
  desc: string;
  color: string;
  /** 该层有内容的记忆总数（全账本，不受渲染上限影响） */
  count: number;
}

export interface MemoryGraphNode {
  id: string;
  memId: string;
  label: string;
  /** 主层（= Memory.layer，主内容所在层） */
  layer: GraphLayerId;
  /** 真实存在内容的层（用于层连线） */
  layers: GraphLayerId[];
  category: GraphCategoryId;
  categoryName: string;
  color: string;
  decay: DecayClass;
  /** G3：冷/休眠/归档记忆只显示遮罩标签，contents 为空 */
  masked: boolean;
  pinned: boolean;
  locked: boolean;
  conflict: boolean;
  mergedInto?: string;
  mergedCount: number;
  /** 分支嫁接：本条新记忆命中的目标记忆与停止层（§6.2） */
  graftTo?: string;
  graftLayer?: Exclude<Layer, 'L0'>;
  /** 有多少条新记忆嫁接到本条 */
  graftedCount: number;
  tags: string[];
  importance: number;
  createdAt: number;
  /** 各层原文（已截断；masked=true 时为空，绝不泄露原文） */
  contents: Partial<Record<GraphLayerId, string>>;
}

export interface LayerGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
}

export interface LayerGraphStats {
  /** 账本记忆总数（未删除） */
  total: number;
  /** 图谱实际渲染的节点数 */
  rendered: number;
  /** 因上限未渲染的记忆数 */
  truncated: number;
  /** 含 L2–L6 真实产物的记忆数 */
  refined: number;
  /** 冲突组数（≥2 条记忆共享 conflict_id） */
  conflicts: number;
  /** 冲突记忆条数 */
  conflictMemories: number;
  /** 合并关系数（全账本，含未渲染端点） */
  merges: number;
  /** 分支嫁接关系数（全账本，含未渲染端点） */
  grafts: number;
  /** 渲染节点中被遮罩的冷/休眠/归档记忆数 */
  masked: number;
}

export interface LayerGraph {
  hubs: LayerHubNode[];
  nodes: MemoryGraphNode[];
  edges: LayerGraphEdge[];
  stats: LayerGraphStats;
}

export interface LayerGraphOptions {
  /** 单图最多渲染的记忆节点（默认 120；超出按冲突/置顶/重要度/新鲜度截断） */
  maxNodes?: number;
}

const DEFAULT_MAX_NODES = 120;
const REFINED_LAYERS: GraphLayerId[] = ['L2', 'L3', 'L4', 'L5', 'L6'];

function rank(m: Memory): number {
  let score = 0;
  if (m.conflict_id) score += 1000;
  if (m.pinned) score += 100;
  score += Math.round((typeof m.importance === 'number' ? m.importance : 0.5) * 50);
  return score;
}

/** 从内核记忆主表推导图谱（纯函数，无示例数据） */
export function deriveLayerGraph(memories: Memory[], opts: LayerGraphOptions = {}): LayerGraph {
  const cap = Math.max(6, Math.floor(opts.maxNodes ?? DEFAULT_MAX_NODES));
  const alive = memories.filter((m) => m.deleted !== true);
  const layersById = new Map<string, GraphLayerId[]>(alive.map((m) => [m.mem_id, layersOf(m)]));

  const hubs: LayerHubNode[] = GRAPH_LAYERS.map((meta) => ({
    id: `layer:${meta.id}`,
    layer: meta.id,
    label: meta.name,
    desc: meta.desc,
    color: meta.color,
    count: alive.filter((m) => layersById.get(m.mem_id)!.includes(meta.id)).length,
  }));

  const ordered = [...alive].sort((a, b) => {
    const byRank = rank(b) - rank(a);
    if (byRank !== 0) return byRank;
    const byFresh = (b.created_at ?? 0) - (a.created_at ?? 0);
    if (byFresh !== 0) return byFresh;
    return a.mem_id < b.mem_id ? -1 : a.mem_id > b.mem_id ? 1 : 0;
  });
  const rendered = ordered.slice(0, cap);

  const nodes: MemoryGraphNode[] = rendered.map((m) => {
    const layers = layersById.get(m.mem_id) ?? [];
    const maskedKind = privacyKind(m.decay_class);
    const masked = maskedKind !== null;
    const category: GraphCategoryId = isCategory(m.category) ? m.category : 'unknown';
    const meta = categoryMeta(category);
    const contents: Partial<Record<GraphLayerId, string>> = {};
    if (!masked) {
      for (const layer of layers) contents[layer] = clip(memoryLayerText(m, layer), 240);
    }
    return {
      id: `mem:${m.mem_id}`,
      memId: m.mem_id,
      label: masked ? `${maskedKind} · ${m.mem_id.slice(-4)}` : pickLabel(m, layers),
      layer: m.layer,
      layers,
      category,
      categoryName: meta.name,
      color: meta.color,
      decay: m.decay_class,
      masked,
      pinned: m.pinned === true,
      locked: m.locked === true,
      conflict: Boolean(m.conflict_id),
      mergedInto: m.merged_into,
      mergedCount: Array.isArray(m.merged_from) ? m.merged_from.length : 0,
      graftTo: m.graft_to,
      graftLayer: m.graft_layer,
      graftedCount: Array.isArray(m.grafted_from) ? m.grafted_from.length : 0,
      tags: Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 10) : [],
      importance: typeof m.importance === 'number' && Number.isFinite(m.importance)
        ? Math.max(0, Math.min(1, m.importance))
        : 0.5,
      createdAt: m.created_at ?? 0,
      contents,
    };
  });

  const renderedIds = new Set(nodes.map((n) => n.memId));
  const edges: LayerGraphEdge[] = [];
  const seen = new Set<string>();
  const pushEdge = (source: string, target: string, kind: GraphEdgeKind) => {
    const key = `${kind}|${source}|${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ id: key, source, target, kind });
  };

  for (const node of nodes) {
    for (const layer of node.layers) pushEdge(node.id, `layer:${layer}`, 'member');
  }

  // 合并关系：父记忆 merged_from ∪ 子记忆 merged_into，双向去重
  for (const m of rendered) {
    if (m.merged_into && renderedIds.has(m.merged_into)) {
      pushEdge(`mem:${m.mem_id}`, `mem:${m.merged_into}`, 'merge');
    }
    for (const child of m.merged_from ?? []) {
      if (renderedIds.has(child)) pushEdge(`mem:${child}`, `mem:${m.mem_id}`, 'merge');
    }
  }

  // 分支嫁接：新记忆 → 命中的目标记忆（§6.2）；只画两端都在图内的真实关系
  for (const m of rendered) {
    if (m.graft_to && renderedIds.has(m.graft_to)) {
      pushEdge(`mem:${m.mem_id}`, `mem:${m.graft_to}`, 'graft');
    }
  }

  // 冲突关系：同一 conflict_id 的渲染节点依次相连（组内链），不虚构跨组冲突
  const renderedConflicts = new Map<string, string[]>();
  for (const m of rendered) {
    if (!m.conflict_id) continue;
    const group = renderedConflicts.get(m.conflict_id) ?? [];
    group.push(m.mem_id);
    renderedConflicts.set(m.conflict_id, group);
  }
  for (const group of renderedConflicts.values()) {
    for (let i = 0; i < group.length - 1; i++) {
      pushEdge(`mem:${group[i]}`, `mem:${group[i + 1]}`, 'conflict');
    }
  }

  const allConflictGroups = new Map<string, number>();
  for (const m of alive) {
    if (!m.conflict_id) continue;
    allConflictGroups.set(m.conflict_id, (allConflictGroups.get(m.conflict_id) ?? 0) + 1);
  }
  const conflictSizes = [...allConflictGroups.values()];
  const aliveIds = new Set(alive.map((m) => m.mem_id));
  const merges = alive.filter((m) => m.merged_into && aliveIds.has(m.merged_into)).length;
  const grafts = alive.filter((m) => m.graft_to && aliveIds.has(m.graft_to)).length;
  const refined = alive.filter((m) => REFINED_LAYERS.some((l) => memoryLayerText(m, l).length > 0)).length;

  return {
    hubs,
    nodes,
    edges,
    stats: {
      total: alive.length,
      rendered: nodes.length,
      truncated: Math.max(0, alive.length - nodes.length),
      refined,
      conflicts: conflictSizes.filter((n) => n >= 2).length,
      conflictMemories: conflictSizes.reduce((a, b) => a + b, 0),
      merges,
      grafts,
      masked: nodes.filter((n) => n.masked).length,
    },
  };
}

/** 未加载/内核不可达时的空图谱：保留六层结构，节点与关系为空（诚实空态） */
export function emptyLayerGraph(): LayerGraph {
  return deriveLayerGraph([]);
}
