// REQ-004 T4 ② Token 节省标记（回答底部 ⚡ 一行 + 分解）
// 来源：需求规格书_Agent界面内联记忆标识.md §2.2、设计/ui 原型 .tokbar
// 消费 T9：off 级别不渲染。
import { useState } from 'react';
import { useAttributionConfig } from './AttributionConfig.tsx';
import type { TokenSaving } from '../../types/inlineAttribution.ts';

export function TokenSavingBar({ saving }: { saving: TokenSaving }) {
  const { isVisible } = useAttributionConfig();
  const [open, setOpen] = useState(false);
  if (!isVisible('token')) return null;

  return (
    <div className="tokbar" role="button" tabIndex={0} onClick={() => setOpen((v) => !v)}>
      ⚡ 本次召回 <span className="big">payload {saving.actual_payload}/{saving.full_baseline}</span>
      ，省 <span className="big">{saving.saved.toLocaleString()}</span> token
      <span className="tokbar-more">（分解 ▾）</span>
      {open && (
        <ul>
          {saving.breakdown.map((b, i) => (
            <li key={i}>{b.reason}：{b.tokens} token</li>
          ))}
        </ul>
      )}
    </div>
  );
}
