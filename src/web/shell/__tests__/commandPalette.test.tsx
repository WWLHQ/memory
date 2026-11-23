// v5 命令面板行为测试：Ctrl+K 打开、五分组、禁用项带原因、键盘导航、过滤。
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from '../CommandPalette.tsx';
import type { PaletteItem } from '../views.ts';

const base: PaletteItem[] = [
  { id: 'nav-home', group: '转到页面', label: '首页', icon: 'spark', run: vi.fn() },
  { id: 'nav-memory-bank', group: '转到页面', label: '记忆库', icon: 'db', kbd: 'Ctrl+2', run: vi.fn() },
  { id: 'refresh', group: '执行', label: '刷新', icon: 'refresh', kbd: 'F5', run: vi.fn() },
  { id: 'open-library', group: '执行', label: '打开记忆库…', icon: 'folder', disabled: true, reason: '程序未提供库切换指令' },
  { id: 'about', group: '帮助', label: '关于', icon: 'spark', run: vi.fn() },
];

describe('CommandPalette（v5）', () => {
  beforeEach(() => {
    for (const it of base) it.run = vi.fn();
  });

  it('关闭时不渲染；打开后显示输入框与条目', () => {
    const { container } = render(<CommandPalette open={false} items={base} onClose={() => {}} />);
    expect(container.querySelector('.pal-mask')).toBeNull();
    render(<CommandPalette open items={base} onClose={() => {}} />);
    expect(screen.getByTestId('shell-palette')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument();
    expect(screen.getByText('首页')).toBeInTheDocument();
    expect(screen.getByText('刷新')).toBeInTheDocument();
  });

  it('禁用项置灰并显示原因；点击禁用项不执行也不关闭', () => {
    const onClose = vi.fn();
    render(<CommandPalette open items={base} onClose={onClose} />);
    const row = screen.getByText('打开记忆库…').closest('.pal-row') as HTMLElement;
    expect(row.classList.contains('disabled')).toBe(true);
    expect(row.getAttribute('title')).toContain('程序未提供库切换指令');
    expect(screen.getByText('程序未提供库切换指令')).toBeInTheDocument();
    fireEvent.click(row);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('点击可用条目：执行 run 并关闭', () => {
    const onClose = vi.fn();
    const run = vi.fn();
    render(<CommandPalette open items={[{ id: 'x', group: '执行', label: '刷新', icon: 'refresh', run }]} onClose={onClose} />);
    fireEvent.click(screen.getByText('刷新'));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('过滤：按标签命中；无命中时显示空态', () => {
    const { rerender } = render(<CommandPalette open items={base} onClose={() => {}} />);
    const input = screen.getByLabelText('搜索命令') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '记忆' } });
    expect(screen.getByText('记忆库')).toBeInTheDocument();
    expect(screen.queryByText('刷新')).toBeNull();
    fireEvent.change(input, { target: { value: '不存在的命令xyz' } });
    expect(screen.getByText('没有匹配的页面或命令。')).toBeInTheDocument();
    rerender(<CommandPalette open items={base} onClose={() => {}} />);
  });

  it('键盘导航：↓/↑ 移动选中，Enter 执行，Esc 关闭', () => {
    const onClose = vi.fn();
    const run = vi.fn();
    render(<CommandPalette open items={[
      { id: 'a', group: '执行', label: '刷新', icon: 'refresh', run },
      { id: 'b', group: '帮助', label: '关于', icon: 'spark', run },
    ]} onClose={onClose} />);
    const input = screen.getByLabelText('搜索命令');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).toHaveBeenCalledWith();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
