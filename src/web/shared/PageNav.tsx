// 分页导航条（批次24 建，批次 E 起 v5 统一形态）：紧凑数字窗口（‹ 1 … 4 5 6 … 257 ›）+「第 x / y 页」。
// 记忆库、日志记录、审计日志、生命周期、层级卡片共用；控件 testid 与原有命名保持一致。
// 样式走 p0.css 的 .p0-pager（与首页/审计页表底同一基元）。
import type { Paged } from './paginate.ts';
import { PAGE_SIZES } from './paginate.ts';
import { pagerWindow } from './pagerWindow.ts';

const selStyle = {
  padding: '4px 8px', background: 'var(--panel2)',
  border: '1px solid var(--line)', borderRadius: 8,
  color: 'var(--txt)', fontSize: 12,
} as const;

export interface PageNavProps {
  paged: Paged<unknown>;
  onPage: (page: number) => void;
  /** 传入才渲染「每页 N 条」下拉（生命周期页把条数选择放在过滤口径里，故可选） */
  onPageSize?: (size: number) => void;
  /** 总数为 0 时是否仍渲染（默认 false） */
  always?: boolean;
  /** 左侧附加说明（如「命中 123 条」），位于 pager 左侧 */
  note?: string;
}

export function PageNav({ paged, onPage, onPageSize, always = false, note }: PageNavProps) {
  if (!always && paged.total === 0) return null;
  return (
    <div data-testid="pagination" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 auto', flexWrap: 'wrap', minWidth: 0 }}>
      {note && (
        <span data-testid="pg-note" style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>
          {note}
        </span>
      )}
      <div className="p0-pager">
        <button data-testid="pg-prev" disabled={paged.page <= 1} onClick={() => onPage(paged.page - 1)} title="上一页" type="button">‹</button>
        {pagerWindow(paged.page, paged.totalPages).map((cell, i) =>
          cell === '…' ? (
            <span key={`gap-${i}`} aria-hidden="true">…</span>
          ) : (
            <button
              key={cell}
              className={cell === paged.page ? 'on' : undefined}
              data-testid={`pg-page-${cell}`}
              onClick={() => onPage(cell)}
              title={`第 ${cell} 页`}
              type="button"
            >
              {cell}
            </button>
          ),
        )}
        <button data-testid="pg-next" disabled={paged.page >= paged.totalPages} onClick={() => onPage(paged.page + 1)} title="下一页" type="button">›</button>
        <span data-testid="pg-info" style={{ marginLeft: 6, whiteSpace: 'nowrap' }}>
          第 {paged.page} / {paged.totalPages} 页
        </span>
        {onPageSize && (
          <select
            data-testid="pg-size"
            value={String(paged.pageSize)}
            onChange={(e) => onPageSize(Number(e.target.value))}
            style={{ ...selStyle, marginLeft: 4 }}
            title="每页条数"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n} 条/页</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
