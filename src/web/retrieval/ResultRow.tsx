// REQ-012 T4 结果行（§3.1 字段 + §3.2 操作）
import type { RetrievalHit } from './types.ts';

interface Props {
  hit: RetrievalHit;
  index: number;
  selected: boolean;
  onView: (id: string) => void;
  onRemember: (id: string) => void;
  onForget: (id: string) => void;
  onFeedback: (id: string) => void;
}

export function ResultRow({ hit, index, selected, onView, onRemember, onForget, onFeedback }: Props) {
  return (
    <tr
      className={selected ? 'sel' : ''}
      data-testid={`hit-${index}`}
      data-mid={hit.memory_id}
      onClick={() => onView(hit.memory_id)}
      style={{ cursor: 'pointer' }}
    >
      <td>
        <span className="mid">{hit.memory_id}</span>
        {hit.pinned && ' 📌'}{hit.locked && ' 🔒'}
      </td>
      <td>
        <div data-testid={`hit-content-${index}`}>
          {hit.l2_only ? `[L2 摘要占位 · ${hit.content}]` : hit.content}
        </div>
        <div className="note" style={{ marginTop: 2 }}>
          {hit.tags.map((t) => <span key={t} className="mid" style={{ marginRight: 6 }}>#{t}</span>)}
          {hit.merged_from && hit.merged_from.length > 0 && <span className="dim">合并自 {hit.merged_from.length} 条</span>}
          {hit.conflict_note && <span className="status hibernating" data-testid={`hit-conflict-${index}`}>⚡ {hit.conflict_note}</span>}
        </div>
      </td>
      <td><span className={`temp ${hit.decay_class}`}>{hit.decay_class}</span>{hit.l2_only && <span className="dim"> 补查</span>}</td>
      <td>
        <div className="bar"><div style={{ width: `${hit.freshness * 100}%` }} /></div>
        <div className="bar"><div style={{ width: `${hit.importance * 100}%` }} /></div>
        <div className="bar"><div style={{ width: `${hit.confidence * 100}%` }} /></div>
      </td>
      <td><b>{hit.score.toFixed(2)}</b></td>
      <td onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn" data-testid={`remember-${index}`} onClick={() => onRemember(hit.memory_id)}>📌 记住</button>{' '}
        <button type="button" className="btn" data-testid={`forget-${index}`} onClick={() => onForget(hit.memory_id)}>⌫ 忘记</button>{' '}
        <button type="button" className="btn" data-testid={`fb-${index}`} onClick={() => onFeedback(hit.memory_id)}>☆</button>
      </td>
    </tr>
  );
}
