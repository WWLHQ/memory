// 首页 L1–L6 关系图谱交互面板（批次8-B）：
// 深色 SVG 画布（点阵底纹 + 六层轨道 + 记忆卫星），支持按层筛选、搜索、拖拽平移、Ctrl/⌘+滚轮缩放、
// 悬停高亮与提示、点击详情抽屉、刷新真实聚合。全部数据来自 layerGraph 推导（真实账本，无演示节点）。
// 交互动作写结构化日志（scope=home）；搜索只记长度与命中数，绝不落用户输入原文。
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { uiLog } from '../shared/actionLog.ts';
import './layerGraph.css';
import {
  GRAPH_CATEGORIES,
  GRAPH_LAYERS,
  type GraphLayerId,
  type LayerGraph,
  type MemoryGraphNode,
} from './layerGraph.ts';
import { layoutLayerGraph } from './layerGraphLayout.ts';

export interface LayerGraphPanelProps {
  graph: LayerGraph;
  /** 重新聚合真实账本（首页主入口传入）；缺省不显示刷新按钮 */
  onRefresh?: () => void | Promise<void>;
}

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.4;

const DECAY_LABELS: Record<MemoryGraphNode['decay'], string> = {
  hot: '热',
  warm: '温',
  cold: '冷',
  archived: '归档',
  dormant: '休眠',
};

function clampZoom(v: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v));
}

/** 搜索匹配：冷/归档节点只匹配遮罩标签与 mem_id（G3：不按原文检索） */
function nodeMatches(node: MemoryGraphNode, q: string): boolean {
  if (node.masked) return `${node.label} ${node.memId}`.toLowerCase().includes(q);
  const hay = [
    node.label,
    node.categoryName,
    ...node.tags,
    ...Object.values(node.contents).filter((v): v is string => typeof v === 'string'),
  ].join(' ');
  return hay.toLowerCase().includes(q);
}

export function LayerGraphPanel({ graph, onRefresh }: LayerGraphPanelProps) {
  const layout = useMemo(() => layoutLayerGraph(graph), [graph]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const [activeLayer, setActiveLayer] = useState<GraphLayerId | null>(null);
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const normalized = query.trim().toLowerCase();
  const layerNodes = useMemo(
    () => (activeLayer === null ? layout.nodes : layout.nodes.filter((n) => n.layers.includes(activeLayer))),
    [layout.nodes, activeLayer],
  );
  const visibleIds = useMemo(() => new Set(layerNodes.map((n) => n.id)), [layerNodes]);
  const matchIds = useMemo(() => {
    if (!normalized) return null;
    const hits = new Set<string>();
    for (const node of layerNodes) if (nodeMatches(node, normalized)) hits.add(node.id);
    return hits;
  }, [layerNodes, normalized]);

  const selected = selectedId ? layout.nodes.find((n) => n.id === selectedId) ?? null : null;
  const hoverNode = hover ? layout.nodes.find((n) => n.id === hover.id) ?? null : null;
  const focusId = hover?.id ?? selected?.id ?? null;
  const focusNeighbors = useMemo(() => {
    if (!focusId) return null;
    const near = new Set<string>([focusId]);
    for (const e of layout.edges) {
      if (e.source === focusId) near.add(e.target);
      else if (e.target === focusId) near.add(e.source);
    }
    return near;
  }, [layout.edges, focusId]);

  const visibleEdges = useMemo(
    () => layout.edges.filter((e) => {
      const endpointOk = (id: string) => (id.startsWith('layer:')
        ? activeLayer === null || id === `layer:${activeLayer}`
        : visibleIds.has(id));
      return endpointOk(e.source) && endpointOk(e.target);
    }),
    [layout.edges, visibleIds, activeLayer],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // 仅 Ctrl/⌘+滚轮缩放；普通滚轮保留页面滚动（人体工学）
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.12 : 0.89)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const isDim = (id: string) => Boolean(
    (matchIds && !matchIds.has(id)) || (focusNeighbors && !focusNeighbors.has(id)),
  );

  const zoomBy = (direction: 'in' | 'out') => {
    const next = clampZoom(zoom * (direction === 'in' ? 1.2 : 1 / 1.2));
    setZoom(next);
    uiLog('home', 'graph_zoom', { zoom: Number(next.toFixed(2)), direction });
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    uiLog('home', 'graph_reset_view', {});
  };

  const toggleLayer = (layer: GraphLayerId) => {
    const next = activeLayer === layer ? null : layer;
    setActiveLayer(next);
    const nodes = next === null ? layout.nodes.length : layout.nodes.filter((n) => n.layers.includes(next)).length;
    uiLog('home', 'graph_filter_layer', { layer: next ?? 'all', nodes });
  };

  const showAllLayers = () => {
    setActiveLayer(null);
    uiLog('home', 'graph_filter_layer', { layer: 'all', nodes: layout.nodes.length });
  };

  const openNode = (node: MemoryGraphNode) => {
    setSelectedId(node.id);
    setHover(null);
    uiLog('home', 'graph_node_open', {
      mem_id: node.memId,
      layer: node.layer,
      category: node.category,
      masked: node.masked,
    });
  };

  const logSearch = () => {
    const len = query.trim().length;
    if (len === 0) return;
    uiLog('home', 'graph_search', { query_len: len, hits: matchIds?.size ?? 0 });
  };

  const clearSearch = () => {
    setQuery('');
    uiLog('home', 'graph_search_clear', {});
  };

  const refresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    uiLog('home', 'graph_refresh', {});
    try {
      await onRefresh();
    } catch (err) {
      uiLog('home', 'graph_refresh_failed', { error: err }, { level: 'error' });
    } finally {
      setRefreshing(false);
    }
  };

  const onCanvasPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest('[data-graph-node]') || target.closest('[data-graph-hub]')) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pan.x, originY: pan.y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onCanvasPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) setPan({ x: drag.originX + dx, y: drag.originY + dy });
  };

  const onCanvasPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!drag) return;
    if (drag.moved) {
      suppressClickRef.current = true;
      uiLog('home', 'graph_pan', {
        dx: Math.round(e.clientX - drag.startX),
        dy: Math.round(e.clientY - drag.startY),
      });
    }
  };

  const onCanvasClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const target = e.target as Element;
    if (target.closest('[data-graph-node]') || target.closest('[data-graph-hub]')) return;
    setSelectedId(null);
  };

  const showHover = (node: MemoryGraphNode, e: ReactPointerEvent<SVGGElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    setHover({ id: node.id, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
  };

  const wrapWidth = wrapRef.current?.clientWidth ?? 0;
  const tipLeft = hover ? Math.max(8, Math.min(hover.x + 14, Math.max(8, wrapWidth - 260))) : 0;
  const tipTop = hover ? hover.y + 14 : 0;

  const onNodeKey = (node: MemoryGraphNode) => (e: ReactKeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openNode(node);
    }
  };

  const onHubKey = (layer: GraphLayerId) => (e: ReactKeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleLayer(layer);
    }
  };

  return (
    <section className="lg-card" id="layerGraph" aria-label="L1–L6 记忆关系图谱">
      <header className="lg-head">
        <div className="lg-title">
          <h2>L1–L6 关系图谱</h2>
          <p>真实账本 · 节点=记忆 · 连线=层归属 / 合并 / 冲突 · 冷记忆按 G3 遮罩</p>
        </div>
        <div className="lg-tools">
          <div className="lg-search">
            <span className="lg-search-icon" aria-hidden="true">⌕</span>
            <input
              id="lgSearch"
              type="text"
              value={query}
              placeholder="搜索记忆 / 标签…"
              aria-label="搜索图谱节点"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') logSearch(); }}
            />
            {query.length > 0 && (
              <button type="button" id="lgSearchClear" className="lg-search-clear" aria-label="清空搜索" onClick={clearSearch}>×</button>
            )}
          </div>
          {onRefresh && (
            <button className="btn lg-refresh" id="lgRefresh" type="button" onClick={refresh} disabled={refreshing}>
              {refreshing ? '刷新中…' : '↻ 刷新'}
            </button>
          )}
        </div>
      </header>

      <div className="lg-chips" role="group" aria-label="按层筛选">
        <button
          type="button"
          id="lgChipAll"
          className={`lg-chip${activeLayer === null ? ' on' : ''}`}
          aria-pressed={activeLayer === null}
          onClick={showAllLayers}
        >
          全部 <em>{layout.nodes.length}</em>
        </button>
        {GRAPH_LAYERS.map((meta) => {
          const on = activeLayer === meta.id;
          const count = layout.hubs.find((h) => h.layer === meta.id)?.count ?? 0;
          return (
            <button
              key={meta.id}
              id={`lgChip${meta.id}`}
              type="button"
              className={`lg-chip${on ? ' on' : ''}`}
              aria-pressed={on}
              title={`${meta.desc} · ${count} 条`}
              onClick={() => toggleLayer(meta.id)}
              style={on ? { color: meta.color, borderColor: `${meta.color}99`, background: `${meta.color}18` } : undefined}
            >
              <i style={{ background: meta.color }} aria-hidden="true" />
              {meta.id} {meta.name}
              <em>{count}</em>
            </button>
          );
        })}
        <div className="lg-legend" aria-label="记忆类别与连线图例">
          {GRAPH_CATEGORIES.map((c) => (
            <span key={c.id}><i style={{ background: c.color }} aria-hidden="true" />{c.name}</span>
          ))}
          {graph.nodes.some((n) => n.category === 'unknown') && (
            <span><i style={{ background: '#7c8b9e' }} aria-hidden="true" />未分类</span>
          )}
          <span className="lg-legend-edge"><i className="edge" aria-hidden="true" />层归属</span>
          <span className="lg-legend-edge"><i className="edge merge" aria-hidden="true" />合并</span>
          <span className="lg-legend-edge"><i className="edge conflict" aria-hidden="true" />冲突</span>
          {graph.stats.grafts > 0 && (
            <span className="lg-legend-edge"><i className="edge graft" aria-hidden="true" />嫁接</span>
          )}
        </div>
      </div>

      <div className="lg-canvas-wrap" ref={wrapRef}>
        <svg
          id="layerGraphSvg"
          className="lg-canvas"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label="L1–L6 记忆关系图谱画布"
          data-zoom={zoom.toFixed(2)}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
          onClick={onCanvasClick}
          onDoubleClick={(e) => {
            const target = e.target as Element;
            if (target.closest('[data-graph-node]') || target.closest('[data-graph-hub]')) return;
            resetView();
          }}
        >
          <defs>
            <radialGradient id="lgCanvasGlow" cx="50%" cy="42%" r="68%">
              <stop offset="0%" stopColor="#1b2636" />
              <stop offset="55%" stopColor="#111922" />
              <stop offset="100%" stopColor="#0a0f15" />
            </radialGradient>
            <pattern id="lgDots" width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="1.2" cy="1.2" r="1.1" fill="#8b98a7" opacity="0.10" />
            </pattern>
          </defs>
          <rect x={0} y={0} width={layout.width} height={layout.height} fill="url(#lgCanvasGlow)" />
          <rect x={0} y={0} width={layout.width} height={layout.height} fill="url(#lgDots)" />

          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {layout.spokes.map((s) => (
              <line key={s.id} className="lg-spoke" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} style={{ stroke: s.color }} />
            ))}

            {visibleEdges.map((e) => (
              <line
                key={e.id}
                className={`lg-edge ${e.kind}${isDim(e.source) && isDim(e.target) ? ' dim' : ''}${focusNeighbors && !focusNeighbors.has(e.source) && !focusNeighbors.has(e.target) ? ' dim' : ''}`}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
              />
            ))}

            {layout.hubs.map((hub) => {
              const inactive = activeLayer !== null && activeLayer !== hub.layer;
              const dim = focusNeighbors !== null && !focusNeighbors.has(hub.id);
              return (
                <g
                  key={hub.id}
                  data-graph-hub={hub.layer}
                  className={`lg-hub${inactive ? ' off' : ''}${dim ? ' dim' : ''}`}
                  transform={`translate(${hub.x} ${hub.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${hub.layer} ${hub.label} · ${hub.count} 条 · 点击筛选该层`}
                  onClick={(e) => { e.stopPropagation(); toggleLayer(hub.layer); }}
                  onKeyDown={onHubKey(hub.layer)}
                >
                  <circle className="lg-hub-halo" r={hub.r + 9} fill={hub.color} />
                  <circle className="lg-hub-ring" r={hub.r + 4} stroke={hub.color} />
                  <circle className="lg-hub-dot" r={hub.r} fill="#0d131a" stroke={hub.color} strokeWidth={2} />
                  <text className="lg-hub-id" y={4} fill={hub.color}>{hub.layer}</text>
                  <text className="lg-hub-name" y={hub.r + 17}>{hub.label}</text>
                  <text className="lg-hub-count" y={hub.r + 31}>{hub.count} 条</text>
                </g>
              );
            })}

            {layerNodes.map((node) => {
              const selectedOn = selected?.id === node.id;
              const anchorEnd = node.x > layout.width - 190;
              return (
                <g
                  key={node.id}
                  data-graph-node={node.id}
                  className={`lg-node${isDim(node.id) ? ' dim' : ''}${selectedOn ? ' on' : ''}${node.masked ? ' masked' : ''}`}
                  transform={`translate(${node.x} ${node.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.categoryName} · ${node.layer} · ${node.label}`}
                  onClick={(e) => { e.stopPropagation(); openNode(node); }}
                  onKeyDown={onNodeKey(node)}
                  onPointerOver={(e) => showHover(node, e)}
                  onPointerLeave={() => setHover(null)}
                >
                  <circle className="lg-node-halo" r={node.r + 5} fill={node.color} />
                  <circle className="lg-node-dot" r={node.r} fill={node.color} />
                  {node.pinned && (
                    <circle className="lg-node-pin" r={1.8} fill="#ffe6a8" cx={-node.r - 1.5} cy={-node.r - 1.5} />
                  )}
                  <text
                    className={`lg-node-label${node.masked ? ' masked' : ''}`}
                    x={anchorEnd ? -(node.r + 6) : node.r + 6}
                    y={3.5}
                    textAnchor={anchorEnd ? 'end' : 'start'}
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}

            <g className="lg-core" transform={`translate(${layout.core.x} ${layout.core.y})`}>
              <circle className="lg-core-halo" r={layout.core.r + 10} />
              <circle className="lg-core-dot" r={layout.core.r} />
              <text className="lg-core-title" y={-3}>记忆账本</text>
              <text className="lg-core-count" y={15}>{layout.core.total} 条</text>
            </g>
          </g>
        </svg>

        {graph.stats.total === 0 && (
          <div className="lg-empty" id="lgEmpty">
            <b>内核账本暂无记忆</b>
            <span>写入或采集后，L1–L6 关系图谱实时生成（无演示节点）</span>
          </div>
        )}
        {normalized && matchIds && matchIds.size === 0 && (
          <div className="lg-empty search" id="lgSearchEmpty">没有匹配「{query.trim()}」的节点</div>
        )}

        {hoverNode && hover && (
          <div className="lg-tip" style={{ left: tipLeft, top: tipTop }}>
            <div className="lg-tip-head">
              <i style={{ background: hoverNode.color }} aria-hidden="true" />
              {hoverNode.label}
            </div>
            <div className="lg-tip-meta">
              {hoverNode.categoryName} · {hoverNode.layer} · {DECAY_LABELS[hoverNode.decay]}
              {hoverNode.masked ? ' · G3 遮罩' : ''}
            </div>
            <div className="lg-tip-text">
              {hoverNode.masked
                ? '冷/归档记忆仅显示 L2 占位，原文需审计授权。'
                : Object.values(hoverNode.contents).find((v) => v) ?? ''}
            </div>
          </div>
        )}

        <div className="lg-zoom" data-graph-ui="true" role="group" aria-label="图谱缩放">
          <button type="button" id="lgZoomOut" aria-label="缩小" onClick={() => zoomBy('out')}>−</button>
          <span id="lgZoomValue">{Math.round(zoom * 100)}%</span>
          <button type="button" id="lgZoomIn" aria-label="放大" onClick={() => zoomBy('in')}>+</button>
          <button type="button" id="lgZoomReset" aria-label="复位视图" title="复位视图" onClick={resetView}>⟲</button>
        </div>

        {selected && (
          <aside className="lg-drawer" id="lgDrawer" aria-label="记忆详情">
            <header className="lg-drawer-head">
              <span className="lg-drawer-dot" style={{ background: selected.color }} aria-hidden="true" />
              <b>{selected.categoryName}</b>
              <span className="lg-badge">{selected.layer}</span>
              <span className="lg-badge dim">{DECAY_LABELS[selected.decay]}</span>
              {selected.pinned && <span className="lg-badge">📌 置顶</span>}
              {selected.locked && <span className="lg-badge">🔒 锁定</span>}
              {selected.conflict && <span className="lg-badge danger">⚖ 冲突</span>}
              {selected.graftTo && <span className="lg-badge">🌿 嫁接{selected.graftLayer ? ` · ${selected.graftLayer}` : ''}</span>}
              <button type="button" className="lg-drawer-close" aria-label="关闭详情" onClick={() => setSelectedId(null)}>×</button>
            </header>
            <div className="lg-drawer-title">{selected.label}</div>
            {selected.masked ? (
              <div className="lg-privacy" id="lgPrivacy">
                G3 隐私保护：冷/休眠/归档记忆仅显示 L2 占位，不展示任何层原文。
              </div>
            ) : (
              <div className="lg-layer-list">
                {GRAPH_LAYERS.filter((l) => selected.contents[l.id]).map((l) => (
                  <div className="lg-layer-row" key={l.id}>
                    <span className="lg-layer-id" style={{ color: l.color, borderColor: `${l.color}66` }}>{l.id}</span>
                    <div className="lg-layer-text">{selected.contents[l.id]}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="lg-meta">mem_id · <code>{selected.memId}</code></div>
            {selected.mergedCount > 0 && <div className="lg-meta">合并来源 · {selected.mergedCount} 条</div>}
            {selected.mergedInto && <div className="lg-meta">已并入 · <code>{selected.mergedInto}</code></div>}
            {selected.graftTo && <div className="lg-meta">嫁接至 · <code>{selected.graftTo}</code>（{selected.graftLayer ?? '命中'} 起停止生成下一层）</div>}
            {selected.graftedCount > 0 && <div className="lg-meta">被嫁接 · {selected.graftedCount} 条新记忆</div>}
            {selected.tags.length > 0 && (
              <div className="lg-taglist">
                {selected.tags.map((t) => <span key={t}>{t}</span>)}
              </div>
            )}
            <div className="lg-drawer-hint">层归属来自真实 content_lN；本卡片只读，改/删请前往「记忆层级」页。</div>
          </aside>
        )}
      </div>

      <footer className="lg-foot">
        <span>记忆 <b>{graph.stats.total}</b></span>
        {graph.stats.truncated > 0 && (
          <span className="warn">渲染 {graph.stats.rendered} · 截断 {graph.stats.truncated}（按冲突/置顶/重要度）</span>
        )}
        <span>精炼 <b>{graph.stats.refined}</b></span>
        <span>合并 <b>{graph.stats.merges}</b></span>
        <span>冲突 <b>{graph.stats.conflicts}</b> 组 / {graph.stats.conflictMemories} 条</span>
        {graph.stats.grafts > 0 && <span>嫁接 <b>{graph.stats.grafts}</b></span>}
        {graph.stats.masked > 0 && <span>G3 遮罩 <b>{graph.stats.masked}</b></span>}
        {activeLayer && <span className="lg-foot-filter">筛选 {activeLayer} · 显示 {layerNodes.length}</span>}
        {normalized && <span className="lg-foot-filter">搜索命中 {matchIds?.size ?? 0}</span>}
        <span className="lg-hint">Ctrl/⌘+滚轮缩放 · 拖拽平移 · 双击复位 · 点击节点看详情</span>
      </footer>
    </section>
  );
}
