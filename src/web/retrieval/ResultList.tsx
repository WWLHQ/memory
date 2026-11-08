// REQ-012 T4 结果列表（定稿结果行）：分数 + 正文/元信息 + 行内操作；Top 5 默认，加载更多至 10。
import { useState } from 'react';
import type { RetrievalHit } from './types.ts';
import { sortHits } from './logic.ts';
import { ResultRow } from './ResultRow.tsx';

interface Props {
  hits: RetrievalHit[];
  selectedId: string | null;
  onView: (id: string) => void;
  onRemember: (id: string) => void;
  onForget: (id: string) => void;
  onFeedback: (id: string) => void;
  /** 导出真实结果（前端 CSV；无后端导出接口时按钮旁须注明） */
  onExport?: () => void;
}

export function ResultList({ hits, selectedId, onView, onRemember, onForget, onFeedback, onExport }: Props) {
  const [expanded, setExpanded] = useState(false);
  const sorted = sortHits(hits);
  const shown = expanded ? sorted.slice(0, 10) : sorted.slice(0, 5);

  return (
    <div className="p0-card" data-testid="result-list">
      <div className="p0-hd">
        <h3>检索结果（{sorted.length}）</h3>
        <span className="p0-sub">Top K = {shown.length}{!expanded && sorted.length > 5 ? ' · 可加载至 10' : ''}</span>
        <span className="p0-right">
          {onExport && (
            <>
              <button type="button" className="p0-btn" data-testid="export-results" onClick={onExport}>导出 CSV</button>
              <span className="p0-note">前端生成 · 无后端导出接口</span>
            </>
          )}
        </span>
      </div>

      <div className="p0-reslist">
        {shown.map((h, i) => (
          <ResultRow
            key={h.memory_id}
            hit={h}
            index={i}
            selected={selectedId === h.memory_id}
            onView={onView}
            onRemember={onRemember}
            onForget={onForget}
            onFeedback={onFeedback}
          />
        ))}
        {shown.length === 0 && <div className="p0-empty">本次无命中。</div>}
      </div>

      {!expanded && sorted.length > 5 && (
        <button type="button" className="p0-btn" data-testid="load-more" onClick={() => setExpanded(true)} style={{ marginTop: 6 }}>
          加载更多（至 Top 10）
        </button>
      )}
    </div>
  );
}
