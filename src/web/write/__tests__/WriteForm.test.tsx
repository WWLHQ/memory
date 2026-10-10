import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WriteForm } from '../WriteForm.tsx';
import type { MemoryDraft } from '../types.ts';

const base: MemoryDraft = {
  content: 'abc', category: 'fact', tags: [], source: 'conversation', session_id: 's1', project_id: 'p1',
};

describe('WriteForm (T3)', () => {
  it('有效草稿 → 提交按钮可用', () => {
    render(<WriteForm draft={base} onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('submit')).not.toBeDisabled();
  });

  it('content 空 → 提交禁用并提示', () => {
    const onChange = vi.fn();
    render(<WriteForm draft={{ ...base, content: '   ' }} onChange={onChange} onSubmit={vi.fn()} />);
    const submit = screen.getByTestId('submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId('form-errors')).toHaveTextContent('内容不能为空');
  });

  it('project_id 空 → 提交禁用（R2）', () => {
    const onChange = vi.fn();
    render(<WriteForm draft={{ ...base, project_id: '' }} onChange={onChange} onSubmit={vi.fn()} />);
    expect((screen.getByTestId('submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('form-errors')).toHaveTextContent('project_id 必填');
  });

  it('content ≥500 字 → 精炼提示出现', () => {
    render(<WriteForm draft={{ ...base, content: '字'.repeat(500) }} onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('refine-hint')).toHaveTextContent('将精炼为 L1–L6');
  });

  it('类别预览随类别变化', () => {
    const { rerender } = render(<WriteForm draft={base} onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('cat-preview')).toHaveTextContent('90 天'); // fact
    rerender(<WriteForm draft={{ ...base, category: 'decision' }} onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('cat-preview')).toHaveTextContent('180 天'); // decision
  });

  it('切换类别 → 触发 onChange', () => {
    const onChange = vi.fn();
    render(<WriteForm draft={base} onChange={onChange} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId('f-category'), { target: { value: 'decision' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ category: 'decision' }));
  });

  it('点击联想标签 → 加入 tags', () => {
    const onChange = vi.fn();
    render(<WriteForm draft={base} onChange={onChange} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('suggest-pitfall'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['pitfall'] }));
  });

  it('点击「写入记忆」→ 触发 onSubmit', () => {
    const onSubmit = vi.fn();
    render(<WriteForm draft={base} onChange={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('submit'));
    expect(onSubmit).toHaveBeenCalled();
  });
});
