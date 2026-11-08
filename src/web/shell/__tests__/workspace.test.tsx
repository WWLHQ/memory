// 壳层渲染行为（批次48 S1）：导航、不可用态、状态栏诚实口径、底部标签。
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Workspace } from '../Workspace.tsx';

beforeEach(() => {
  localStorage.clear();
});

describe('工作台壳层', () => {
  it('默认打开概览，中心区嵌入真实 index.html（iframe 而非假内容）', () => {
    const { container } = render(<Workspace />);
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0);
    const frames = container.querySelectorAll('iframe.page-frame');
    expect(frames.length).toBe(1);
    expect((frames[0] as HTMLIFrameElement).getAttribute('src')).toContain('/index.html');
  });

  it('演示通览不进主导航', () => {
    render(<Workspace />);
    expect(screen.queryByText(/通览/)).toBeNull();
  });

  it('个人记忆为不可用态：不出现 iframe，不显示任何计数，只给原因', () => {
    const { container } = render(<Workspace />);
    const node = screen.getByRole('treeitem', { name: /个人记忆/ });
    fireEvent.click(node);
    expect(screen.getAllByText(/个人记忆 · 不可用/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/程序暂无个人记忆数据模型/).length).toBeGreaterThan(0);
    // 仍只有概览那个 iframe，个人记忆没有被包装成空壳页面
    expect(container.querySelectorAll('iframe.page-frame').length).toBe(1);
    const empty = container.querySelector('.shell-empty');
    expect(empty?.textContent ?? '').not.toMatch(/\d/);
  });

  it('工具栏不可用命令被禁用并给出原因，不伪造结果', () => {
    render(<Workspace />);
    const help = screen.getByRole('button', { name: /快捷键/ });
    expect(help).toBeDisabled();
    expect(help.getAttribute('title')).toContain('未提供快捷键清单页');
  });

  it('底部终端标签如实说明不可用', () => {
    render(<Workspace />);
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(screen.getByText(/程序未提供终端命令通道/)).toBeInTheDocument();
  });

  it('状态栏只写未接入，不用「—」冒充真实读数', () => {
    const { container } = render(<Workspace />);
    const bar = container.querySelector('.statusbar');
    expect(bar?.textContent ?? '').not.toMatch(/—/);
    expect(bar?.textContent ?? '').toContain('未接入');
  });

  it('主题切换会写到 html[data-theme]，并被状态栏按钮反映', () => {
    render(<Workspace />);
    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: '深色' })).toHaveAttribute('aria-pressed', 'true');
  });
});
