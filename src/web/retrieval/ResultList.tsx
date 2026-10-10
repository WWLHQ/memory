// REQ-012 T4 结果列表（§3：Top K 默认 3-5，加载更多至 10）
import { useState } from 'react';
import type { RetrievalHit } from './types.ts';
import { sortHits } from './logic.ts';
import { ResultRow } from './ResultRow.tsx';
import './bars.css';

interface Props {
  hits: RetrievalHit[];
  selectedId: string | null;
  onView: (id: string) => void;
  onRemember: (id: string) => void;
  onForget: (id: string) => void;
  onFeedback: (id: string) => void;
}

export function ResultList({ hits, selectedId, onView, onRemember, onForget, onFeedback }: Props) {
  const [expanded, setExpanded] = useState(false);
  const sorted = sortHits(hits);
  const shown = expanded ? sorted.slice(0, 10) : sorted.slice(0, 5);

  return (
    <div className="card" data-testid="result-list">
      <div className="row-head"><b>检索结果（{sorted.length}）</b><span className="dim">Top K = {shown.length}{!expanded && sorted.length > 5 ? ' · 可加载至 10' : ''}</span></div>
      <table className="ltable">
        <thead>
          <tr><th>记忆</th><th>内容</th><th>温度</th><th>新鲜/重要/置信</th><th>score</th><th>操作</th></tr>
        </thead>
        <tbody>
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
        </tbody>
      </table>
      {!expanded && sorted.length > 5 && (
        <button type="button" className="btn" data-testid="load-more" onClick={() => setExpanded(true)}>加载更多（至 Top 10）</button>
      )}
    </div>
  );
}
