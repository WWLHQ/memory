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
    expect(screen.getByTestId('refine-hint')).toHaveTextContent('将清洗脱敏为 L1');
  });

  it('质量门预判随内容实算：无硬事实短文 → 拦截码；带具体技术信息 → 豁免字数门槛', () => {
    const { rerender } = render(<WriteForm draft={base} onChange={vi.fn()} onSubmit={vi.fn()} />);
    // abc：有效字 <30 且无硬事实 → 实算出拦截码（short_low_signal），不抄演示值
    expect(screen.getByTestId('write-form')).toHaveTextContent('将被质量门拦截');
    // 批次40-B 豁免口径：有具体技术名词就放行
    rerender(<WriteForm draft={{ ...base, content: 'PostgreSQL 16 的逻辑复制槽在主库切换后会失效' }} onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('write-form')).toHaveTextContent('豁免字数门槛');
  });

  it('切换类别 → 触发 onChange', () => {
    const onChange = vi.fn();
    render(<WriteForm draft={base} onChange={onChange} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId('f-category'), { target: { value: 'decision' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ category: 'decision' }));
  });

  it('标签联想随内容提取：技术名词成候选、点击加入 tags（不再预置词表）', () => {
    const onChange = vi.fn();
    const draft = {
      ...base,
      content: 'PostgreSQL 16 的逻辑复制槽在主库切换后会失效，注意 replication slot 清理',
    };
    render(<WriteForm draft={draft} onChange={onChange} onSubmit={vi.fn()} />);
    // 预置词表已删除：tech-stack / pitfall 等常驻 chip 不再出现
    expect(screen.queryByTestId('suggest-pitfall')).not.toBeInTheDocument();
    // 候选来自内容：PostgreSQL / replication / slot（数字 16 不配）
    expect(screen.getByTestId('suggest-PostgreSQL')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('suggest-PostgreSQL'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['PostgreSQL'] }));
  });

  it('标签联想：无技术名词的纯中文内容 → 不出候选 chip，给诚实说明', () => {
    const draft = { ...base, content: '今天天气不错，心情很好，随便写点日常感受记录一下' };
    render(<WriteForm draft={draft} onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('tags-empty')).toHaveTextContent('输入包含技术名词的内容后');
    expect(screen.queryByTestId(/^suggest-/)).not.toBeInTheDocument();
  });

  it('点击「写入记忆」→ 触发 onSubmit', () => {
    const onSubmit = vi.fn();
    render(<WriteForm draft={base} onChange={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('submit'));
    expect(onSubmit).toHaveBeenCalled();
  });
});
