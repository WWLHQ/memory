import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LifecycleCard } from '../LifecycleCard.tsx';
import type { LifecycleRecord } from '../types.ts';

const rec = (over: Partial<LifecycleRecord>): LifecycleRecord => ({
  id: 'm', content: 'c', status: 'active', ageDays: 0, half_life_days: 30,
  confidence: 0.5, importance: 0.5, access_count: 1, reinforce_count: 0,
  pinned: false, locked: false, decay_class: 'hot', ...over,
});

describe('LifecycleCard (T3)', () => {
  it('渲染六态徽标与状态', () => {
    render(<LifecycleCard rec={rec({})} onMigrate={vi.fn()} />);
    expect(screen.getByTestId('status-chip')).toHaveTextContent('active');
    expect(screen.getByTestId('status-chip').className).toContain('active');
  });

  it('可执行迁移按钮按 STATUS_FLOW 渲染', () => {
    render(<LifecycleCard rec={rec({ status: 'active' })} onMigrate={vi.fn()} />);
    expect(screen.getByTestId('mig-hibernating')).toBeInTheDocument();
    expect(screen.getByTestId('mig-archived')).toBeInTheDocument();
    expect(screen.queryByTestId('mig-active')).toBeNull(); // 同态不可迁
  });

  it('deprecated 显示替代链接', () => {
    render(<LifecycleCard rec={rec({ status: 'deprecated', replaced_by: 'mem_014', replaced_at: '2026-09-01T08:00:00.000Z' })} onMigrate={vi.fn()} />);
    expect(screen.getByTestId('replaced-link')).toHaveAttribute('href', '/memory.html');
    expect(screen.getByText(/已被/)).toBeInTheDocument();
  });

  it('非 deprecated 无替代链接', () => {
    render(<LifecycleCard rec={rec({})} onMigrate={vi.fn()} />);
    expect(screen.queryByTestId('replaced-link')).toBeNull();
  });

  it('N/M 参数展示默认 90/180', () => {
    render(<LifecycleCard rec={rec({})} onMigrate={vi.fn()} />);
    expect(screen.getByText(/hibernating 触发 90d/)).toBeInTheDocument();
    expect(screen.getByText(/archived 触发 180d/)).toBeInTheDocument();
  });

  it('点击迁移按钮 → onMigrate 回调', () => {
    const onMigrate = vi.fn();
    render(<LifecycleCard rec={rec({ status: 'archived' })} onMigrate={onMigrate} />);
    fireEvent.click(screen.getByTestId('mig-active'));
    expect(onMigrate).toHaveBeenCalledWith('active');
  });
});
