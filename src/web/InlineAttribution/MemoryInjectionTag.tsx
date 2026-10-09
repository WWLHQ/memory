// REQ-004 T3 ① 记忆注入标记（答案段落内联 🧠 + hover/click 弹层）
// 来源：需求规格书_Agent界面内联记忆标识.md §2.1、设计/ui 原型 .mem-tag/showPop
// 消费 T9 配置：仅 full 级别渲染。弹层含 memory_id/L2/衰减/aging/request_id + 记住/忘记/标错。
import { useState } from 'react';
import { useAttributionConfig } from './AttributionConfig.tsx';
import { agingHintText, isEvidenceThin } from '../../inlineAttribution/decay.ts';
import type { MemoryInjectionMark, FeedbackAction } from '../../types/inlineAttribution.ts';

export function MemoryInjectionTag({
  mark,
  onFeedback,
  onOpenAudit,
}: {
  mark: MemoryInjectionMark;
  onFeedback?: (memory_id: string, action: FeedbackAction) => void;
  onOpenAudit?: (req: string) => void;
}) {
  const { isVisible } = useAttributionConfig();
  const [open, setOpen] = useState(false);
  if (!isVisible('injection')) return null;

  const aging = agingHintText(mark);
  const thin = isEvidenceThin(mark);

  return (
    <span className="mem-tag-wrap" data-mid={mark.memory_id} onMouseLeave={() => setOpen(false)}>
      <span className={`mem-tag ${mark.decay_class}`} role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
      >
        🧠
      </span>
      {open && (
        <span className="pop" role="dialog" onClick={(e) => e.stopPropagation()}>
          <h4>🧠 记忆注入 · {mark.memory_id}</h4>
          <div className="m">摘要：<b>{mark.summaryL2}</b></div>
          <div className="m">层：decay_class={mark.decay_class}（cold 仅 L2 占位符，15.3）</div>
          {aging && <div className="m warn">{aging}</div>}
          {thin && <div className="m warn">⚠ 证据不足，已补查 Cold 层 / 建议切事实优先重试（2.4.3）</div>}
          <div className="m">request_id：<a href="#" onClick={(e) => { e.preventDefault(); onOpenAudit?.(mark.request_id); }}>{mark.request_id}</a></div>
          <div className="acts">
            <button onClick={() => onFeedback?.(mark.memory_id, 'confirm')}>记住 +0.1</button>
            <button onClick={() => onFeedback?.(mark.memory_id, 'reject')}>忘记 −0.05</button>
            <button onClick={() => onFeedback?.(mark.memory_id, 'disputed')}>这条记错了</button>
          </div>
        </span>
      )}
    </span>
  );
}
