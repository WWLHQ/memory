// REQ-004 T5 ③ 背景免重复标记（会话头部 📎 N 条 + 展开）
// 来源：需求规格书_Agent界面内联记忆标识.md §2.3、设计/ui 原型 .bgmark
// 消费 T9：off 级别不渲染。
import { useState } from 'react';
import { useAttributionConfig } from './AttributionConfig.tsx';
import type { BackgroundMark } from '../../types/inlineAttribution.ts';

const KIND_LABEL: Record<BackgroundMark['items'][number]['kind'], string> = {
  stack: '技术栈',
  constraint: '约束',
  decision: '决策',
  pitfall: '踩坑',
};

export function BackgroundChip({ mark }: { mark: BackgroundMark }) {
  const { isVisible } = useAttributionConfig();
  const [open, setOpen] = useState(false);
  if (!isVisible('background')) return null;

  return (
    <div className="bgmark">
      📎 已带项目背景 <b>{mark.count}</b> 条
      <span className="more" onClick={() => setOpen((v) => !v)}>{open ? '收起' : '展开'}</span>
      {open && (
        <ul>
          {mark.items.map((it) => (
            <li key={it.id}>{KIND_LABEL[it.kind]}：{it.text}（{it.id}）</li>
          ))}
        </ul>
      )}
    </div>
  );
}
