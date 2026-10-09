// REQ-004 T6 ④ 老化 / 证据警示（内联 ⚠️ · 恒显示不可关）
// 来源：需求规格书_Agent界面内联记忆标识.md §2.4、§4（诚实约束）、设计/ui 原型 .warn-tag
// 恒显示：不受 attribution_level 影响（T9 上下文对其 isVisible 恒 true）。
import { useAttributionConfig } from './AttributionConfig.tsx';
import type { AgingWarnMark, FeedbackAction } from '../../types/inlineAttribution.ts';

export function AgingWarnTag({
  mark,
  onFeedback,
  onSwitchFactFirst,
}: {
  mark: AgingWarnMark;
  onFeedback?: (memory_id: string, action: FeedbackAction) => void;
  onSwitchFactFirst?: (req: string) => void;
}) {
  const { isVisible } = useAttributionConfig();
  // 诚实约束：aging / evidence_thin 必须显示，不被 off 关闭
  if (!isVisible('aging') && !isVisible('evidence_thin')) return null;

  if (mark.kind === 'aging') {
    return (
      <span className="warn-tag" data-kind="aging" title={mark.text}>
        ⚠️ {mark.text}
        <span className="warn-acts">
          <button onClick={() => onFeedback?.(mark.request_id, 'confirm')}>我确认仍有效 +0.1</button>
          <button onClick={() => onFeedback?.(mark.request_id, 'reject')}>确实过时 −0.05</button>
        </span>
      </span>
    );
  }
  return (
    <span className="warn-tag" data-kind="evidence_thin" title={mark.text}>
      ⚠️ {mark.text}
      <span className="warn-acts">
        <button onClick={() => onSwitchFactFirst?.(mark.request_id)}>切事实优先重试</button>
      </span>
    </span>
  );
}
