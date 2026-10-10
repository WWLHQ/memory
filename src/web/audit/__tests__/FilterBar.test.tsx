import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from '../FilterBar.tsx';
import type { AuditFilter } from '../types.ts';

const base: AuditFilter = {};

describe('FilterBar (T3)', () => {
  it('渲染各过滤输入', () => {
    render(<FilterBar filter={base} onChange={vi.fn()} onQuery={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByTestId('f-ent')).toBeInTheDocument();
    expect(screen.getByTestId('f-action')).toBeInTheDocument();
    expect(screen.getByTestId('query')).toBeInTheDocument();
  });

  it('action 下拉含 4.3 全部枚举可读名', () => {
    render(<FilterBar filter={base} onChange={vi.fn()} onQuery={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByText('召回')).toBeInTheDocument();
    expect(screen.getByText('召回超支')).toBeInTheDocument();
    expect(screen.getByText('模式分流')).toBeInTheDocument();
  });

  it('修改输入 → onChange 回调', () => {
    const onChange = vi.fn();
    render(<FilterBar filter={base} onChange={onChange} onQuery={vi.fn()} onReset={vi.fn()} />);
    fireEvent.change(screen.getByTestId('f-user'), { target: { value: 'u2' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u2' }));
  });

  it('点击查询 / 重置 → 对应回调', () => {
    const onQuery = vi.fn();
    const onReset = vi.fn();
    render(<FilterBar filter={base} onChange={vi.fn()} onQuery={onQuery} onReset={onReset} />);
    fireEvent.click(screen.getByTestId('query'));
    expect(onQuery).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('reset'));
    expect(onReset).toHaveBeenCalled();
  });
});
