import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DedupCard } from '../DedupCard.tsx';
import type { DedupResult } from '../types.ts';

const make = (over: Partial<DedupResult>): DedupResult => ({
  dims: { semantic: 0.9, keyword: 0.85, entity: 0.8, structure: 0.7, llm_judge: 0.88 },
  composite: 0.85,
  threshold: 0.8,
  is_duplicate: true,
  ...over,
});

describe('DedupCard (T4)', () => {
  it('渲染五维进度条', () => {
    render(<DedupCard result={make({})} onAction={vi.fn()} />);
    expect(screen.getByText('semantic（35%）')).toBeInTheDocument();
    expect(screen.getByText('llm_judge（20%）')).toBeInTheDocument();
  });

  it('is_duplicate 为 true → 标记命中重复', () => {
    render(<DedupCard result={make({ is_duplicate: true })} onAction={vi.fn()} />);
    expect(screen.getByTestId('dedup-card').className).toContain('dup');
    expect(screen.getByTestId('composite')).toHaveTextContent('命中重复');
  });

  it('非重复 → 不标记 dup 高亮', () => {
    render(<DedupCard result={make({ is_duplicate: false, composite: 0.5 })} onAction={vi.fn()} />);
    expect(screen.getByTestId('dedup-card').className).toBe('card dedup');
    expect(screen.getByTestId('composite')).toHaveTextContent('未命中');
  });

  it('命中既有记忆 → 展示跳转链接', () => {
    render(<DedupCard result={make({ matched: { id: 'mem_001', content: 'x' } })} onAction={vi.fn()} />);
    expect(screen.getByTestId('matched-link')).toHaveAttribute('href', '/memory.html');
  });

  it('三模式按钮触发对应 onAction', () => {
    const onAction = vi.fn();
    render(<DedupCard result={make({})} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('op-merge'));
    expect(onAction).toHaveBeenCalledWith('merge');
    fireEvent.click(screen.getByTestId('op-overwrite'));
    expect(onAction).toHaveBeenCalledWith('overwrite');
    fireEvent.click(screen.getByTestId('op-keep'));
    expect(onAction).toHaveBeenCalledWith('keep');
  });
});
