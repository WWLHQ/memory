// 批次48 A30：演示页强制标识。inline 演示页（inlineattribution.html）与悬浮覆盖层（floatattribution.html）
// 仍保留且生产构建可达，但必须在页面显著位置标明「演示」，且不进入通览页主导航。
// 标识是页面级常量（不随登录态/账本数据开关），默认常显，不提供关闭入口。
import type { CSSProperties } from 'react';

export interface DemoBadgeProps {
  /** 悬浮窗（280px 宽）用紧凑形态；演示页用完整形态 */
  compact?: boolean;
}

const baseStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: '8px 10px',
  padding: '8px 12px',
  background: 'rgba(255, 196, 0, 0.14)',
  border: '1px solid rgba(255, 196, 0, 0.55)',
  borderRadius: 8,
  color: '#ffd479',
  fontSize: 12.5,
  lineHeight: 1.5,
  flexWrap: 'wrap',
};

const compactStyle: CSSProperties = {
  ...baseStyle,
  margin: '4px 8px',
  padding: '4px 8px',
  gap: 6,
  fontSize: 10.5,
};

export function DemoBadge({ compact = false }: DemoBadgeProps) {
  return (
    <div
      data-testid="demo-badge"
      role="note"
      aria-label="演示标识"
      style={compact ? compactStyle : baseStyle}
    >
      <b>{compact ? '演示（DEMO）' : '演示页（DEMO）'}</b>
      <span>
        {compact
          ? '形态演示，非正式功能入口'
          : '本页用于演示 Agent 界面内联标识的形态，不是正式功能入口；数据来自本机真实账本。'}
      </span>
    </div>
  );
}
