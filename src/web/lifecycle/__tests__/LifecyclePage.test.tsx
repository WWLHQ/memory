import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LifecyclePage } from '../LifecyclePage.tsx';
import { resetKernelForTests } from '../../kernel.ts';
import { seedLifecycleLedger } from './fixtures.ts';

describe('LifecyclePage 集成（T5）', () => {
  beforeEach(async () => {
    resetKernelForTests();
    await seedLifecycleLedger();
  });

  it('渲染列表 + 选中联动卡片/调参面板', async () => {
    render(<LifecyclePage />);
    expect(screen.getByTestId('lifecycle-page')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('lifecycle-table')).toBeInTheDocument());
    expect(screen.getByTestId('status-card')).toBeInTheDocument();
    expect(screen.getByTestId('param-panel')).toBeInTheDocument();
    // 真实账本 7 条（默认每页 5 → 切 20/页 全量可见）
    fireEvent.change(screen.getByTestId('filter-pagesize'), { target: { value: '20' } });
    await waitFor(() => expect(screen.getAllByTestId(/^lrow-mem_/)).toHaveLength(7));
  });

  it('点击行切换选中', async () => {
    render(<LifecyclePage />);
    await waitFor(() => expect(screen.getByTestId('lrow-mem_011')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('lrow-mem_011'));
    expect(screen.getByTestId('status-card')).toHaveTextContent('mem_011');
  });

  it('单选迁移：active→hibernating 生效 + toast（经内核 migrate）', async () => {
    render(<LifecyclePage />);
    // 默认选中 mem_001（active）
    await waitFor(() => expect(screen.getByTestId('mig-hibernating')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mig-hibernating'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('mem_001 → hibernating'));
    expect(screen.getByTestId('status-chip')).toHaveTextContent('hibernating');
  });

  it('锁定记忆调参被拒（G4）', async () => {
    render(<LifecyclePage />);
    await waitFor(() => expect(screen.getByTestId('lifecycle-table')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('filter-pagesize'), { target: { value: '20' } });
    await waitFor(() => expect(screen.getByTestId('lrow-mem_016')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('lrow-mem_016')); // locked dormant
    expect(screen.getByTestId('param-panel').className).toContain('locked');
    // 滑杆禁用
    expect((screen.getByTestId('sl-confidence') as HTMLInputElement).disabled).toBe(true);
  });

  it('批量迁移：勾选 stale→archived 生效（锁定/已目标态内核跳过）', async () => {
    render(<LifecyclePage />);
    // 勾选 mem_015（冷态可→archived）与 mem_016（locked 内核拒绝）
    await waitFor(() => expect(screen.getByTestId('lifecycle-table')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('filter-pagesize'), { target: { value: '20' } });
    await waitFor(() => expect(screen.getByTestId('chk-mem_015')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('chk-mem_015'));
    fireEvent.click(screen.getByTestId('chk-mem_016'));
    const target = screen.getByTestId('batch-target');
    fireEvent.change(target, { target: { value: 'archived' } });
    fireEvent.click(screen.getByTestId('batch-run'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('批量迁移 1 条 → archived'));
  });

  it('request_id 展示（内核同一 ULID 口径）', async () => {
    render(<LifecyclePage />);
    await waitFor(() => expect(screen.getAllByText(/req_lc_/).length).toBeGreaterThanOrEqual(1));
  });
});
