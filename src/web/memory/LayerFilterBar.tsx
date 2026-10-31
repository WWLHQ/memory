// 记忆层级管理页（19.11）· 每层 L0-L6 过滤栏 + 分页控件
// 过滤原理与记忆管理页一致（搜索/类型/状态/来源，AND 组合）；默认每层每页 5 条。
// 每层独立持有过滤+分页状态（LayerFilterState），父组件受控。
import type { CSSProperties } from 'react';
import { LAYER_PAGE_SIZES } from './layerFilter.ts';
import type { LayerFilterState } from './layerFilter.ts';

/** 类型选项（与记忆管理页一致） */
const TYPE_OPTS = ['all', 'fact', 'decision', 'pitfall', 'preference', 'project', 'feedback'];
const STATUS_OPTS = ['all', 'active', 'hibernating', 'archived', 'deprecated', 'stale', 'dormant'];
const SOURCE_OPTS = ['all', 'collected', 'manual', 'webhook', 'mcp'];

const selStyle: CSSProperties = {
  padding: '3px 6px', background: 'var(--panel2)', border: '1px solid var(--line)',
  borderRadius: 6, color: 'var(--txt)', fontSize: 11,
};
const inputStyle: CSSProperties = {
  padding: '3px 7px', background: 'var(--panel2)', border: '1px solid var(--line)',
  borderRadius: 6, color: 'var(--txt)', fontSize: 11, width: 150,
};

/**
 * 层卡片内的过滤栏（搜索/类型/状态/来源 + 每页条数）。
 * 紧凑单行，随层卡片宽度自适应换行。
 */
export function LayerFilterBar({
  layer,
  state,
  onChange,
}: {
  layer: string;
  state: LayerFilterState;
  onChange: (next: LayerFilterState) => void;
}) {
  const update = (patch: Partial<LayerFilterState>) => {
    // 过滤条件变更 → 重置到第 1 页
    const filterKeys: (keyof LayerFilterState)[] = ['search', 'type', 'status', 'source', 'pageSize'];
    const resetPage = filterKeys.some((k) => k in patch);
    onChange({ ...state, ...patch, ...(resetPage ? { page: 1 } : {}) });
  };
  const label = `🔍 过滤`;
  return (
    <div
      className="layer-filter"
      data-testid={`${layer}-filter-bar`}
      style={{
        display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
        padding: '6px 10px', borderBottom: '1px solid var(--line)',
        background: 'var(--panel)',
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{label}</span>
      <input
        type="search"
        data-testid={`${layer}-filter-search`}
        placeholder="搜索内容 / ID / 标签…"
        value={state.search}
        onChange={(e) => update({ search: e.target.value })}
        style={inputStyle}
      />
      <select data-testid={`${layer}-filter-type`} value={state.type} onChange={(e) => update({ type: e.target.value })} style={selStyle}>
        {TYPE_OPTS.map((o) => <option key={o} value={o}>{o === 'all' ? '全部类型' : o}</option>)}
      </select>
      <select data-testid={`${layer}-filter-status`} value={state.status} onChange={(e) => update({ status: e.target.value })} style={selStyle}>
        {STATUS_OPTS.map((o) => <option key={o} value={o}>{o === 'all' ? '全部状态' : o}</option>)}
      </select>
      <select data-testid={`${layer}-filter-source`} value={state.source} onChange={(e) => update({ source: e.target.value })} style={selStyle}>
        {SOURCE_OPTS.map((o) => <option key={o} value={o}>{o === 'all' ? '全部来源' : o === 'collected' ? '⚡采集' : o === 'manual' ? '✍️手动' : o === 'webhook' ? '⚡Webhook' : '🔌MCP'}</option>)}
      </select>
      <input
        type="date"
        data-testid={`${layer}-filter-created-from`}
        value={state.createdFrom}
        onChange={(e) => update({ createdFrom: e.target.value })}
        style={selStyle}
        title="创建时间 ≥"
      />
      <span style={{ fontSize: 10, color: 'var(--muted)' }}>—</span>
      <input
        type="date"
        data-testid={`${layer}-filter-created-to`}
        value={state.createdTo}
        onChange={(e) => update({ createdTo: e.target.value })}
        style={selStyle}
        title="创建时间 ≤"
      />
      {/* 每页条数：固定在过滤栏最后 */}
      <select data-testid={`${layer}-filter-pagesize`} value={String(state.pageSize)} onChange={(e) => update({ pageSize: Number(e.target.value) })} style={selStyle}>
        {LAYER_PAGE_SIZES.map((n) => <option key={n} value={n}>{n} 条/页</option>)}
      </select>
    </div>
  );
}

/**
 * 层卡片底部的分页控件（上一页 / 页码 / 下一页 + 计数）。
 * 仅在 total>0 时渲染。
 */
export function LayerPager({
  layer,
  state,
  total,
  totalPages,
  onChange,
}: {
  layer: string;
  state: LayerFilterState;
  total: number;
  totalPages: number;
  onChange: (next: LayerFilterState) => void;
}) {
  if (total === 0) return null;
  const page = state.page;
  const pgBtn: CSSProperties = { padding: '2px 8px', fontSize: 11 };
  return (
    <div
      className="layer-pager"
      data-testid={`${layer}-pager`}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px',
        borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap',
      }}
    >
      <button
        className="btn"
        data-testid={`${layer}-pg-first`}
        disabled={page <= 1}
        style={pgBtn}
        title="首页"
        onClick={() => onChange({ ...state, page: 1 })}
      >
        ⏮ 首页
      </button>
      <button
        className="btn"
        data-testid={`${layer}-pg-prev`}
        disabled={page <= 1}
        style={pgBtn}
        title="上一页"
        onClick={() => onChange({ ...state, page: page - 1 })}
      >
        ‹ 上页
      </button>
      <span data-testid={`${layer}-pg-info`}>
        第
        <input
          type="number"
          min={1}
          max={totalPages}
          data-testid={`${layer}-pg-goto-input`}
          value={page}
          style={{ width: 34, padding: '1px 3px', margin: '0 3px', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--txt)', fontSize: 11, textAlign: 'center' }}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v >= 1 && v <= totalPages) onChange({ ...state, page: v });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = parseInt((e.target as HTMLInputElement).value, 10);
              if (!isNaN(v) && v >= 1 && v <= totalPages) onChange({ ...state, page: v });
            }
          }}
        />
        / {totalPages} 页 · 共 {total} 条
      </span>
      <button
        className="btn"
        data-testid={`${layer}-pg-next`}
        disabled={page >= totalPages}
        style={pgBtn}
        title="下一页"
        onClick={() => onChange({ ...state, page: page + 1 })}
      >
        下页 ›
      </button>
      <button
        className="btn"
        data-testid={`${layer}-pg-last`}
        disabled={page >= totalPages}
        style={pgBtn}
        title="尾页"
        onClick={() => onChange({ ...state, page: totalPages })}
      >
        尾页 ⏭
      </button>
    </div>
  );
}
