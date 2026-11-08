// REQ-012 T4 结果行（定稿）：score / 正文 / 元信息（id · 层 · 重要度 · 来源项目 · 温度） / 操作
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
  const decay = hit.decay_class;
  return (
    <div
      className={`p0-res-row${selected ? ' sel' : ''}`}
      data-testid={`hit-${index}`}
      data-mid={hit.memory_id}
      onClick={() => onView(hit.memory_id)}
      style={{ cursor: 'pointer' }}
    >
      <div className="p0-score" title="score">{hit.score.toFixed(2)}</div>

      <div className="p0-res-main">
        <div className="p0-res-t" data-testid={`hit-content-${index}`}>
          {hit.l2_only ? `[L2 摘要占位 · ${hit.content}]` : hit.content}
          {hit.pinned && ' 📌'}{hit.locked && ' 🔒'}
        </div>
        <div className="p0-res-m">
          <span className="mono">{hit.memory_id}</span>
          {hit.layer && <span className="mono">{hit.layer}</span>}
          <span>重要度 {(hit.importance * 100).toFixed(0)}%</span>
          {hit.project_id && <span className="p0-tag info" data-testid={`hit-project-${index}`}>{hit.project_id}</span>}
          <span className={`p0-tag ${decay === 'hot' ? 'ok' : decay === 'cold' || decay === 'dormant' || decay === 'archived' ? 'warn' : ''}`}>{decay}</span>
          {hit.l2_only && <span>补查 · 仅 L2</span>}
          {hit.tags.map((t) => <span key={t}>#{t}</span>)}
          {hit.merged_from && hit.merged_from.length > 0 && <span>合并自 {hit.merged_from.length} 条</span>}
          {hit.conflict_note && (
            <span className="p0-tag warn" data-testid={`hit-conflict-${index}`}>⚡ {hit.conflict_note}</span>
          )}
        </div>
      </div>

      <div className="p0-res-a" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="p0-btn" data-testid={`remember-${index}`} onClick={() => onRemember(hit.memory_id)}>📌 记住</button>
        <button type="button" className="p0-btn" data-testid={`forget-${index}`} onClick={() => onForget(hit.memory_id)}>⌫ 忘记</button>
        <button type="button" className="p0-btn" data-testid={`fb-${index}`} onClick={() => onFeedback(hit.memory_id)}>☆</button>
      </div>
    </div>
  );
}
