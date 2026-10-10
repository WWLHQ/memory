import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryTable } from '../MemoryTable.tsx';
import { SEED_MEMORIES } from '../seed.ts';
import type { MemoryRecord } from '../types.ts';

const mk = (over: Partial<MemoryRecord>): MemoryRecord => ({
  id: 'x', content: 'c', type: 'fact', tags: [],
  importance: 0.5, confidence: 0.5, access_count: 1, reinforce_count: 0,
  pinned: false, locked: false, archived: false, status: 'active',
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  ageDays: 0, halfLifeDays: 30, ...over,
});

describe('MemoryTable (T3)', () => {
  it('渲染全部种子行', () => {
    render(<MemoryTable memories={SEED_MEMORIES} />);
    for (const m of SEED_MEMORIES) expect(screen.getByTestId(`row-${m.id}`)).toBeInTheDocument();
  });

  it('cold 记忆仅显示 L2 占位符（G3）', () => {
    const cold = mk({ id: 'cold1', ageDays: 300, content: '原始 L1 原文' });
    render(<MemoryTable memories={[cold]} />);
    expect(screen.getByTestId('row-cold1')).toHaveTextContent('L2 占位符');
    expect(screen.getByTestId('row-cold1')).not.toHaveTextContent('原始 L1 原文');
  });

  it('pinned 行带 pinned 类并置顶', () => {
    const list = [mk({ id: 'a', pinned: false, confidence: 0.9 }), mk({ id: 'b', pinned: true, confidence: 0.1 })];
    const { container } = render(<MemoryTable memories={list} />);
    const firstRow = container.querySelector('tbody tr')!;
    expect(firstRow.className).toContain('pinned');
  });

  it('locked 行渲染 🔒、archived 渲染 🗄️', () => {
    render(<MemoryTable memories={[mk({ id: 'l', locked: true }), mk({ id: 'ar', archived: true })]} />);
    expect(screen.getByTestId('row-l')).toHaveTextContent('🔒');
    expect(screen.getByTestId('row-ar')).toHaveTextContent('🗄️');
  });

  it('合并谱系渲染', () => {
    render(<MemoryTable memories={[mk({ id: 'm', merged_from: ['a', 'b'] })]} />);
    expect(screen.getByTestId('row-m')).toHaveTextContent('合并自 2 条');
  });

  it('空列表显示暂无记忆', () => {
    render(<MemoryTable memories={[]} />);
    expect(screen.getByText('暂无记忆')).toBeInTheDocument();
  });
});
