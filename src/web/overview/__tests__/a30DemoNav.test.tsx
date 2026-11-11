// 批次48 A30 → 批次59：通览页既不能导航到 REQ-004 演示页，也不能再开悬浮层入口
// （REQ-004 整体作废，页面与浮层都已删除；本文件守住「不得回流」）
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Overview } from '../Overview.tsx';

describe('Overview 主导航（A30 → 批次59 作废）', () => {
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

  it('悬浮标识层入口已随作废一并删除（不再有任何按钮可开浮层）', () => {
    render(<Overview />);
    expect(screen.queryByRole('button', { name: /悬浮标识层/ })).toBeNull();
    expect(screen.queryByText(/悬浮标识层/)).toBeNull();
  });
});
