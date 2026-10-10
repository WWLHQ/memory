// REQ-012 T5 上下文面板（§4）：全文（cold 仅 L2 + 审计展开）/ 关联 / 参数只读 / 跳转
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
  return (
    <div className="card" data-testid="context-panel">
      <div className="row-head"><b>上下文 · {hit.memory_id}</b></div>
      <div data-testid="ctx-content" style={{ whiteSpace: 'pre-wrap' }}>
        {showL1 ? hit.content : `[L2 摘要占位 · ${hit.content}]`}
      </div>
      {hit.l2_only && !revealed && (
        <button type="button" className="btn" data-testid="ctx-reveal" onClick={() => setRevealed(true)}>展开原文（审计）</button>
      )}
      {kw && showL1 && hit.content.includes(kw) && (
        <div className="note" data-testid="ctx-highlight">命中片段：「…{kw}…」</div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <span className="dim">关联：{hit.merged_from?.length ? `合并自 ${hit.merged_from.join('、')}` : '—'}</span>
      </div>
      <div className="row" data-testid="ctx-params">
        <span className="dim">半衰期 {hit.half_life_days}d · confidence {hit.confidence} · importance {hit.importance}（只读）</span>
      </div>
      <div className="row">
        <button type="button" className="btn" data-testid="ctx-lifecycle" onClick={() => onLifecycle(hit.memory_id)}>在生命周期页调参</button>
        <button type="button" className="btn" data-testid="ctx-audit" onClick={() => onAudit(hit.memory_id)}>查该条审计</button>
      </div>
    </div>
  );
}
