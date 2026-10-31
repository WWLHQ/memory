// 分页导航条（批次24）：首页/上一页/跳页输入/下一页/尾页 + 每页条数（默认 10）。
// 记忆库、日志记录、审计日志三页共用，控件 testid 与记忆页原有命名保持一致。
import type { Paged } from './paginate.ts';
import { PAGE_SIZES } from './paginate.ts';

const btnStyle = { padding: '4px 12px', fontSize: 12 } as const;
const selStyle = {
  padding: '4px 8px', background: 'var(--panel2)',
  border: '1px solid var(--line)', borderRadius: 8,
  color: 'var(--txt)', fontSize: 12,
} as const;
const inputStyle = {
  width: 40, padding: '2px 4px', background: 'var(--panel2)',
  border: '1px solid var(--line)', borderRadius: 4,
  color: 'var(--txt)', fontSize: 12, textAlign: 'center',
} as const;

export interface PageNavProps {
  paged: Paged<unknown>;
  onPage: (page: number) => void;
  /** 传入才渲染「每页 N 条」下拉（记忆页把它放在过滤栏里，故可选） */
  onPageSize?: (size: number) => void;
  /** 总数为 0 时是否仍渲染（默认 false） */
  always?: boolean;
  /** 左侧附加说明（如「命中 123 条」） */
  note?: string;
}

export function PageNav({ paged, onPage, onPageSize, always = false, note }: PageNavProps) {
  if (!always && paged.total === 0) return null;
  const goto = (raw: string) => {
    const v = parseInt(raw, 10);
    if (!Number.isNaN(v) && v >= 1 && v <= paged.totalPages) onPage(v);
  };
  return (
    <div
      data-testid="pagination"
      style={{
        display: 'flex', alignItems: 'center', gap: 6, marginTop: 10,
        fontSize: 12.5, color: 'var(--muted)', flexWrap: 'wrap',
      }}
    >
      {note && <span className="dim" data-testid="pg-note">{note}</span>}
      <button className="btn" data-testid="pg-first" disabled={paged.page <= 1} onClick={() => onPage(1)} style={btnStyle} title="首页">
        ⏮ 首页
      </button>
      <button className="btn" data-testid="pg-prev" disabled={paged.page <= 1} onClick={() => onPage(paged.page - 1)} style={btnStyle} title="上一页">
        ‹ 上一页
      </button>
      <span data-testid="pg-info">
        第
        <input
          type="number"
          min={1}
          max={paged.totalPages}
          data-testid="pg-goto-input"
          value={paged.page}
          style={{ ...inputStyle, margin: '0 4px' }}
          onChange={(e) => goto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') goto((e.target as HTMLInputElement).value);
          }}
        />
        / {paged.totalPages} 页 · 共 {paged.total} 条
      </span>
      <button
        className="btn"
        data-testid="pg-next"
        disabled={paged.page >= paged.totalPages}
        onClick={() => onPage(paged.page + 1)}
        style={btnStyle}
        title="下一页"
      >
        下一页 ›
      </button>
      <button
        className="btn"
        data-testid="pg-last"
        disabled={paged.page >= paged.totalPages}
        onClick={() => onPage(paged.totalPages)}
        style={btnStyle}
        title="尾页"
      >
        尾页 ⏭
      </button>
      {onPageSize && (
        <select
          data-testid="pg-size"
          value={String(paged.pageSize)}
          onChange={(e) => onPageSize(Number(e.target.value))}
          style={selStyle}
          title="每页条数"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>{n} 条/页</option>
          ))}
        </select>
      )}
    </div>
  );
}
