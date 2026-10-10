import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParamPanel } from '../ParamPanel.tsx';
import type { LifecycleRecord } from '../types.ts';

const rec = (over: Partial<LifecycleRecord>): LifecycleRecord => ({
  id: 'm', content: 'c', status: 'active', ageDays: 30, half_life_days: 30,
  confidence: 0.5, importance: 0.5, access_count: 3, reinforce_count: 1,
  pinned: false, locked: false, decay_class: 'warm', ...over,
});

describe('ParamPanel (T4)', () => {
  it('滑杆 onChange → onParam 带对应 key', () => {
    const onParam = vi.fn();
    render(<ParamPanel rec={rec({})} onParam={onParam} />);
    fireEvent.change(screen.getByTestId('sl-confidence'), { target: { value: '0.8' } });
    expect(onParam).toHaveBeenCalledWith({ confidence: 0.8 });
    fireEvent.change(screen.getByTestId('sl-half_life_days'), { target: { value: '60' } });
    expect(onParam).toHaveBeenCalledWith({ half_life_days: 60 });
  });

  it('freshness 预览随参数实时刷新（age=30, hl=30 → 0.5）', () => {
    render(<ParamPanel rec={rec({ ageDays: 30, half_life_days: 30 })} onParam={vi.fn()} />);
    expect(screen.getByTestId('freshness')).toHaveTextContent('0.50');
  });

  it('locked → 全部滑杆/置顶禁用 + 提示文案（G4）', () => {
    const onParam = vi.fn();
    render(<ParamPanel rec={rec({ locked: true })} onParam={onParam} />);
    expect((screen.getByTestId('sl-confidence') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('sw-pinned') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('locked-hint')).toHaveTextContent('已锁定');
    // locked 开关本身不禁用
    expect((screen.getByTestId('sw-locked') as HTMLInputElement).disabled).toBe(false);
    // 点解锁
    fireEvent.click(screen.getByTestId('sw-locked'));
    expect(onParam).toHaveBeenCalledWith({ locked: false });
  });

  it('非 locked 无提示、滑杆可用', () => {
    render(<ParamPanel rec={rec({})} onParam={vi.fn()} />);
    expect(screen.queryByTestId('locked-hint')).toBeNull();
    expect((screen.getByTestId('sl-importance') as HTMLInputElement).disabled).toBe(false);
  });

  it('access/reinforce 分家只读展示', () => {
    render(<ParamPanel rec={rec({ access_count: 7, reinforce_count: 2 })} onParam={vi.fn()} />);
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('decay 徽标渲染', () => {
    render(<ParamPanel rec={rec({ decay_class: 'hot' })} onParam={vi.fn()} />);
    expect(screen.getByTestId('param-panel').textContent).toContain('hot');
  });
});
