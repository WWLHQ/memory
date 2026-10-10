import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryActions } from '../MemoryActions.tsx';
import type { MemoryRecord } from './../types.ts';

const mk = (over: Partial<MemoryRecord>): MemoryRecord => ({
  id: 'x', content: 'c', type: 'fact', tags: [],
  importance: 0.5, confidence: 0.5, access_count: 1, reinforce_count: 0,
  pinned: false, locked: false, archived: false, status: 'active',
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  ageDays: 0, halfLifeDays: 30, ...over,
});

describe('MemoryActions (T4)', () => {
  it('非锁定：点击「记住」上抛 remember', () => {
    const onAction = vi.fn();
    render(<MemoryActions rec={mk({})} onAction={onAction} />);
    screen.getByTestId('op-remember').click();
    expect(onAction).toHaveBeenCalledWith('remember');
  });

  it('锁定记忆：仅解锁可点，其余禁用（G4）', () => {
    const onAction = vi.fn();
    render(<MemoryActions rec={mk({ locked: true })} onAction={onAction} />);
    const locked = (s: string) => screen.getByTestId(s) as HTMLButtonElement;
    expect(locked('op-unlock').disabled).toBe(false);
    expect(locked('op-remember').disabled).toBe(true);
    expect(locked('op-forget').disabled).toBe(true);
    expect(locked('op-delete').disabled).toBe(true);
    // 禁用项点击不应上抛
    locked('op-remember').click();
    expect(onAction).not.toHaveBeenCalled();
    locked('op-unlock').click();
    expect(onAction).toHaveBeenCalledWith('unlock');
  });

  it('彻底删除需二次确认（确认则上抛 delete）', () => {
    const onAction = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryActions rec={mk({})} onAction={onAction} />);
    screen.getByTestId('op-delete').click();
    expect(onAction).toHaveBeenCalledWith('delete');
    confirmSpy.mockRestore();
  });

  it('彻底删除取消确认则不上抛', () => {
    const onAction = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MemoryActions rec={mk({})} onAction={onAction} />);
    screen.getByTestId('op-delete').click();
    expect(onAction).not.toHaveBeenCalled();
  });
});
