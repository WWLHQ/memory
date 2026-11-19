// REQ-012 T5 命中上下文（§4）：片段 → 关联记忆 → 参数（只读）→ 跳转。
// 只展示真实命中字段；关联来自内核的合并谱系 / 标签，没有就写「无」，不编造。
import { useState } from 'react';
import type { RetrievalHit } from './types.ts';

interface Props {
  hit: RetrievalHit | null;
  query: string;
  onLifecycle: (id: string) => void;
  onAudit: (id: string) => void;
}

export function ContextPanel({ hit, query, onLifecycle, onAudit }: Props) {
  const [revealed, setRevealed] = useState(false);
  if (!hit) return null;
  const kw = query.trim().slice(0, 8);
  const showL1 = !hit.l2_only || revealed;
  const related = hit.merged_from ?? [];
  return (
    <div className="ret-ctx" data-testid="context-panel">
      <div className="ret-sec-hd">
        <h3>命中上下文</h3>
        <span className="ret-note">片段 → 关联记忆</span>
        <span className="ret-ctx-id mono">{hit.memory_id}</span>
      </div>

      <div className="ret-snippet" data-testid="ctx-content">
        {showL1 ? hit.content : `[L2 摘要占位 · ${hit.content}]`}
      </div>

      {hit.l2_only && !revealed && (
        <button type="button" className="ret-btn ret-mini-btn" data-testid="ctx-reveal" onClick={() => setRevealed(true)}>
          展开原文（审计）
        </button>
      )}

      {kw && showL1 && hit.content.includes(kw) && (
        <div className="ret-hitkw" data-testid="ctx-highlight">命中片段：「…{kw}…」</div>
      )}

      <div className="ret-chips">
        <span className="ret-chips-k">关联:</span>
        {related.length > 0
          ? related.map((id) => <span key={id} className="ret-chip mono">{id}</span>)
          : <span className="ret-note">无合并谱系</span>}
        {hit.tags.map((t) => <span key={t} className="ret-chip">#{t}</span>)}
      </div>

      <div className="ret-ctx-foot" data-testid="ctx-params">
        <span className="ret-note">
          半衰期 {hit.half_life_days}d · 置信 {hit.confidence} · 重要 {hit.importance} · 已过 {hit.age_days}d
        </span>
        <span className="ret-ctx-btns">
          <button type="button" className="ret-btn ret-mini-btn" data-testid="ctx-lifecycle" onClick={() => onLifecycle(hit.memory_id)}>在生命周期页调参</button>
          <button type="button" className="ret-btn ret-mini-btn" data-testid="ctx-audit" onClick={() => onAudit(hit.memory_id)}>查该条审计</button>
        </span>
      </div>
    </div>
  );
}
