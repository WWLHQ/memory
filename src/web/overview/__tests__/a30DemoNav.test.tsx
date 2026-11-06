// 批次48 A30：通览页主导航不得包含演示页；浮层入口须显式标注「演示」
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Overview } from '../Overview.tsx';

describe('Overview 主导航（A30）', () => {
  it('主导航不含「Agent 界面内联标识」演示页', () => {
    render(<Overview />);
    const items = document.querySelectorAll('.nav .item');
    const labels = Array.from(items).map((el) => el.textContent ?? '');
    expect(labels.some((t) => t.includes('Agent 界面内联标识'))).toBe(false);
    expect(labels.some((t) => t.includes('首页 + 登录卡片'))).toBe(true);
  });

  it('演示页移出后已落地视图计数为 16，且不再宣称 REQ-004 在主视图列表', () => {
    render(<Overview />);
    expect(screen.getByText(/16 个已落地视图/)).toBeInTheDocument();
    expect(screen.queryByText(/REQ-004 内联标识/)).toBeNull();
  });

  it('悬浮标识层入口显式标注「演示」（保留可达但不伪装成正式功能）', () => {
    render(<Overview />);
    expect(screen.getByRole('button', { name: /悬浮标识层（演示）/ })).toBeInTheDocument();
  });
});
