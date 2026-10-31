// 记忆管理页（REQ-006 / P8）列表（T3）+ 过滤 + 分页 + 可拖拽列宽
// 排序：sortMemories（pinned 置顶 → confidence 降序）。
// 过滤：filterMemories（search / type / status / source，AND 组合）。
// 分页：filterAndPaged（每页条数可选，越界自动 clamp）。
// 操作列由 T4 的 MemoryActions 通过 renderActions 注入；过滤+分页状态由父组件持有。
// 列宽：表头右侧拖拽把手调整（批次24 起与日志/审计页共用 shared/useColWidths，localStorage 固化，切页/重载/重登保持）。
import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { MemoryRecord } from './types.ts';
import { filterAndPaged } from './memoryFilter.ts';
import { MemoryRow } from './MemoryRow.tsx';
import { ColResizeHandle, useColWidths } from '../shared/useColWidths.tsx';
import { PAGE_SIZES } from '../shared/paginate.ts';
import { PageNav } from '../shared/PageNav.tsx';

/** 列宽默认值（px）；内容列固定，剩余宽度让「内容」吃掉 */
const COL_DEFAULTS = [110, 110, 80, 90, 60, 60, 50, 44, 64, 76, 70, 84, 184] as const;
const COL_RESIZE_KEY = 'mtableColWidths';

export { PAGE_SIZES };
export type PageSize = (typeof PAGE_SIZES)[number];

export const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'fact', label: 'fact' },
  { value: 'decision', label: 'decision' },
  { value: 'pitfall', label: 'pitfall' },
  { value: 'preference', label: 'preference' },
  { value: 'project', label: 'project' },
  { value: 'feedback', label: 'feedback' },
];

export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: 'active' },
  { value: 'hibernating', label: 'hibernating' },
  { value: 'archived', label: 'archived' },
  { value: 'deprecated', label: 'deprecated' },
  { value: 'stale', label: 'stale' },
  { value: 'dormant', label: 'dormant' },
];

export const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部来源' },
  { value: 'collected', label: '⚡ 采集' },
  { value: 'manual', label: '✍️ 手动' },
];

export interface MemoryTableFilterState {
  search: string;
  type: string;
  status: string;
  source: string;
  /** 创建时间区间（ISO 日期/日期时间字符串，闭区间；空 = 不过滤） */
  createdFrom: string;
  createdTo: string;
  pageSize: number;
  page: number;
}

export function MemoryTable({
  memories,
  selectedId,
  onSelect,
  renderActions,
  filterState,
  onFilterChange,
}: {
  memories: MemoryRecord[];
  selectedId?: string | null;
  onSelect?: (r: MemoryRecord) => void;
  renderActions?: (r: MemoryRecord) => ReactNode;
  /** 过滤 + 分页状态（父组件持有，受控） */
  filterState?: MemoryTableFilterState;
  /** 过滤 + 分页状态变更回调 */
  onFilterChange?: (next: MemoryTableFilterState) => void;
}) {
  const fs: MemoryTableFilterState = filterState ?? {
    search: '', type: 'all', status: 'all', source: 'all',
    createdFrom: '', createdTo: '', pageSize: 20, page: 1,
  };

  /* ---------- 可拖拽列宽（表头把手；localStorage 固化） ---------- */
  const { widths: colW, startResize: onColMouseDown, reset: resetColWidths, isDefault } = useColWidths(COL_RESIZE_KEY, COL_DEFAULTS);
  const thWidth = (i: number): CSSProperties => ({ width: colW[i] });
  const update = (patch: Partial<MemoryTableFilterState>) => {
    if (!onFilterChange) return;
    // 任何过滤条件变更 → 重置到第 1 页（避免停在已越界页）
    const filterKeys: (keyof MemoryTableFilterState)[] = ['search', 'type', 'status', 'source', 'createdFrom', 'createdTo', 'pageSize'];
    const resetPage = filterKeys.some((k) => k in patch);
    onFilterChange({ ...fs, ...patch, ...(resetPage ? { page: 1 } : {}) });
  };

  const paged = useMemo(
    () =>
      filterAndPaged(memories, {
        search: fs.search,
        type: fs.type,
        status: fs.status,
        source: fs.source,
        createdFrom: fs.createdFrom,
        createdTo: fs.createdTo,
      }, { page: fs.page, pageSize: fs.pageSize }),
    [memories, fs.search, fs.type, fs.status, fs.source, fs.createdFrom, fs.createdTo, fs.page, fs.pageSize],
  );

  const showPagination = paged.totalPages > 1 || paged.total > fs.pageSize;

  return (
    <div>
      {/* 过滤栏 */}
      <div
        className="card"
        data-testid="filter-bar"
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
          padding: '10px 14px', marginBottom: 10,
        }}
      >
        {/* 全文搜索 */}
        <input
          type="search"
          data-testid="filter-search"
          placeholder="🔍 搜索内容 / ID / 标签…"
          value={fs.search}
          onChange={(e) => update({ search: e.target.value })}
          style={{
            flex: '1 1 220px', minWidth: 160, padding: '6px 10px',
            background: 'var(--panel2)', border: '1px solid var(--line)',
            borderRadius: 8, color: 'var(--txt)', fontSize: 12.5,
          }}
        />
        {/* 类型 */}
        <select
          data-testid="filter-type"
          value={fs.type}
          onChange={(e) => update({ type: e.target.value })}
          style={selStyle}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {/* 状态 */}
        <select
          data-testid="filter-status"
          value={fs.status}
          onChange={(e) => update({ status: e.target.value })}
          style={selStyle}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {/* 采集来源 */}
        <select
          data-testid="filter-source"
          value={fs.source}
          onChange={(e) => update({ source: e.target.value })}
          style={selStyle}
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {/* 创建时间区间 */}
        <input
          type="date"
          data-testid="filter-created-from"
          value={fs.createdFrom}
          onChange={(e) => update({ createdFrom: e.target.value })}
          style={selStyle}
          title="创建时间 ≥"
        />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
        <input
          type="date"
          data-testid="filter-created-to"
          value={fs.createdTo}
          onChange={(e) => update({ createdTo: e.target.value })}
          style={selStyle}
          title="创建时间 ≤"
        />
        {/* 每页条数 */}
        <select
          data-testid="filter-pagesize"
          value={String(fs.pageSize)}
          onChange={(e) => update({ pageSize: Number(e.target.value) })}
          style={selStyle}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>{n} 条/页</option>
          ))}
        </select>
        {/* 列宽已固化时提供回退入口（批次24） */}
        {!isDefault && (
          <button type="button" className="btn" data-testid="filter-col-reset" onClick={resetColWidths}>恢复默认列宽</button>
        )}
        {/* 计数（过滤后 / 总量） */}
        <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 'auto', whiteSpace: 'nowrap' }} data-testid="filter-count">
          {paged.total} / {memories.length} 条
        </span>
      </div>

      {/* 表格（只渲染当前页，横向滚动容器让表头始终横排） */}
      <div className="mtable-scroll">
      <table className="mtable" data-testid="memory-table">
        <thead>
          <tr>
            {['ID','内容','类型','标签','重要度','置信','访问/强化','标记','温度','状态','合并谱系','创建/更新'].map((h, i) => (
              <th key={h} style={thWidth(i)} data-testid={`th-${i}`}>
                {h}
                <ColResizeHandle col={i} onCol={onColMouseDown} />
              </th>
            ))}
            {renderActions && (
              <th style={thWidth(12)} data-testid="th-actions">
                操作
                <ColResizeHandle col={12} onCol={onColMouseDown} />
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {paged.items.length === 0 ? (
            <tr>
              <td colSpan={renderActions ? 13 : 12} style={{ textAlign: 'center', color: 'var(--muted)', padding: '24px 0' }}>
                {memories.length === 0 ? '暂无记忆' : '当前过滤条件下无记忆'}
              </td>
            </tr>
          ) : (
            paged.items.map((rec) => (
              <MemoryRow key={rec.id} rec={rec} selected={rec.id === selectedId} onSelect={onSelect} colWidths={colW}>
                {renderActions && renderActions(rec)}
              </MemoryRow>
            ))
          )}
        </tbody>
      </table>
      </div>

      {/* 分页控件（批次24 起与日志/审计页共用 shared/PageNav） */}
      {showPagination && (
        <PageNav paged={paged} onPage={(page) => onFilterChange?.({ ...fs, page })} />
      )}
    </div>
  );
}

const selStyle: CSSProperties = {
  padding: '6px 8px', background: 'var(--panel2)',
  border: '1px solid var(--line)', borderRadius: 8,
  color: 'var(--txt)', fontSize: 12, minWidth: 90,
};
