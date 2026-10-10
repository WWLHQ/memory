import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryPage } from '../MemoryPage.tsx';

describe('MemoryPage 集成（T5）', () => {
  it('渲染列表与全部种子行', () => {
    render(<MemoryPage />);
    expect(screen.getByTestId('memory-page')).toBeInTheDocument();
    expect(screen.getByTestId('memory-table')).toBeInTheDocument();
    expect(screen.getByTestId('row-mem_001')).toBeInTheDocument();
    expect(screen.getByTestId('row-mem_007')).toBeInTheDocument();
  });

  it('点击「记住」弹出 17.3 toast（经内核 ma._memoryOp）', async () => {
    render(<MemoryPage />);
    const row = screen.getByTestId('row-mem_001');
    fireEvent.click(within(row).getByTestId('op-remember'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('已提升这条信息的优先级。'));
  });

  it('点击「忘记」弹出 17.3 toast', async () => {
    render(<MemoryPage />);
    const row = screen.getByTestId('row-mem_001');
    fireEvent.click(within(row).getByTestId('op-forget'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('这条信息已降权'));
  });

  it('点击行打开详情抽屉', () => {
    render(<MemoryPage />);
    fireEvent.click(screen.getByTestId('row-mem_002'));
    expect(screen.getByTestId('memory-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-close')).toBeInTheDocument();
  });

  it('locked 行记住按钮禁用（G4）', () => {
    render(<MemoryPage />);
    const row = screen.getByTestId('row-mem_005'); // locked
    expect(within(row).getByTestId('op-remember')).toBeDisabled();
    expect(within(row).getByTestId('op-unlock')).not.toBeDisabled();
  });

  it('点击记住后该行仍渲染且内核回执生效（importance 钳制上界内）', async () => {
    render(<MemoryPage />);
    const row = screen.getByTestId('row-mem_002');
    expect(within(row).getByText('pitfall')).toBeInTheDocument();
    fireEvent.click(within(row).getByTestId('op-remember'));
    // 内核异步回执后：该行仍渲染（未被删除），toast 出现
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('已提升这条信息的优先级。'));
    expect(screen.getByTestId('row-mem_002')).toBeInTheDocument();
  });
});
