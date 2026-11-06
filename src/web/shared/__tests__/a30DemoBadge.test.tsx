// 批次48 A30：演示标识组件（inline 演示页与浮层共用）
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DemoBadge } from '../DemoBadge.tsx';

describe('DemoBadge 演示标识', () => {
  it('完整形态：显著标注「演示」且带明确 testid', () => {
    render(<DemoBadge />);
    const badge = screen.getByTestId('demo-badge');
    expect(badge).toHaveTextContent('演示页（DEMO）');
    expect(badge).toHaveTextContent('不是正式功能入口');
  });

  it('紧凑形态（悬浮窗）：同样标注演示，不省略', () => {
    render(<DemoBadge compact />);
    const badge = screen.getByTestId('demo-badge');
    expect(badge).toHaveTextContent('演示（DEMO）');
    expect(badge).toHaveTextContent('非正式功能入口');
  });
});
