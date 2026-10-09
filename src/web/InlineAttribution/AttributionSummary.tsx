// REQ-004 T8 每回答贡献摘要 + 💾 写入沉淀标记（均展示，实际写入属 REQ-007）
// 来源：需求规格书_Agent界面内联记忆标识.md §3（每回答 1 行）、设计/ui 原型 .savebar
// 消费 T9：off 级别不渲染。
import { useAttributionConfig } from './AttributionConfig.tsx';
import { summarizeAttribution } from '../../inlineAttribution/decay.ts';
import type { MemoryInjectionMark, TokenSaving, WriteBackMark } from '../../types/inlineAttribution.ts';

export function AttributionSummary({
  injections,
  saving,
  writeBack,
  onOpenAudit,
}: {
  injections: MemoryInjectionMark[];
  saving: TokenSaving | null;
  writeBack: WriteBackMark | null;
  onOpenAudit?: (req: string) => void;
}) {
  const { isVisible } = useAttributionConfig();
  if (!isVisible('writeback')) return null;
  return (
    <div className="attr-summary">
      <span className="attr-summary-line">{summarizeAttribution(injections, saving, writeBack)}</span>
      {writeBack && (
        <span className="savebar" onClick={() => onOpenAudit?.(writeBack.request_id)}>
          💾 会话中识别到 1 条新结论，已自动 write_memory（{writeBack.memory_id} · {writeBack.request_id}）
        </span>
      )}
    </div>
  );
}
