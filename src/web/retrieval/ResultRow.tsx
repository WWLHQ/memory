// REQ-012 T4 结果行（定稿·紧凑版）：分数徽标 + 命中正文（默认一行）+ 元信息（id · 温度 · 新鲜/重要/置信）
// 右侧「展开」切换完整正文；记住/忘记/反馈 收在行内悬浮操作组（悬停或展开时出现），行为一字未改。
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

/** 温度枚举一律译中文（UI 铁律：不把原始枚举值打到界面上） */
const DECAY_ZH: Record<RetrievalHit['decay_class'], string> = {
  hot: '热', warm: '温', cold: '冷', archived: '已归档', dormant: '休眠',
};

export function ResultRow({ hit, index, selected, onView, onRemember, onForget, onFeedback }: Props) {
  const decay = hit.decay_class;
  const text = hit.l2_only ? `[L2 摘要占位 · ${hit.content}]` : hit.content;
  const toggle = () => onView(hit.memory_id);
  return (
    <div
      className={`ret-res-row${selected ? ' sel' : ''}`}
      data-testid={`hit-${index}`}
      data-mid={hit.memory_id}
      onClick={toggle}
      style={{ cursor: 'pointer' }}
    >
      <span className="ret-score" title={`score ${hit.score.toFixed(3)}`}>{hit.score.toFixed(2)}</span>

      <div className="ret-res-main">
        <div
          className={`ret-res-t${hit.l2_only ? ' placeholder' : ''}${selected ? ' full' : ''}`}
          data-testid={`hit-content-${index}`}
        >
          {text}{hit.pinned && ' 📌'}{hit.locked && ' 🔒'}
        </div>

        <div className="ret-res-m">
          <span className="mono ret-mid">{hit.memory_id}</span>
          <span className={`ret-tempo ${decay}`}>{DECAY_ZH[decay]}</span>
          <span>新鲜 {hit.freshness.toFixed(2)}</span>
          <span>重要 {hit.importance.toFixed(2)}</span>
          <span>置信 {hit.confidence.toFixed(2)}</span>
          {hit.layer && <span className="ret-tag layer">{hit.layer}</span>}
          {hit.project_id && <span className="ret-tag info" data-testid={`hit-project-${index}`}>{hit.project_id}</span>}
          {hit.l2_only && <span className="ret-tag cold">补查 · 仅 L2</span>}
          {hit.tags.map((t) => <span key={t} className="ret-tag kw">#{t}</span>)}
          {hit.merged_from && hit.merged_from.length > 0 && <span className="ret-tag">合并自 {hit.merged_from.length} 条</span>}
          {hit.conflict_note && (
            <span className="ret-tag warn" data-testid={`hit-conflict-${index}`}>⚡ {hit.conflict_note}</span>
          )}
        </div>
      </div>

      <div className="ret-res-act" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ret-icon-btn" title="记住：提升这条的权重" data-testid={`remember-${index}`} onClick={() => onRemember(hit.memory_id)}>📌</button>
        <button type="button" className="ret-icon-btn" title="忘记：降低这条的权重" data-testid={`forget-${index}`} onClick={() => onForget(hit.memory_id)}>⌫</button>
        <button type="button" className="ret-icon-btn" title="反馈：去反馈页" data-testid={`fb-${index}`} onClick={() => onFeedback(hit.memory_id)}>☆</button>
      </div>

      <button
        type="button"
        className="ret-more"
        data-testid={`expand-${index}`}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
      >
        {selected ? '收起' : '展开'}
      </button>
    </div>
  );
}
