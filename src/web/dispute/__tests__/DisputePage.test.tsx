import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DisputePage } from '../DisputePage.tsx';
import { DisputeQueue } from '../DisputeQueue.tsx';
import { DisputeVerdict } from '../DisputeVerdict.tsx';
import { SEED_CONFLICTS } from './fixtures.ts';

const NOW = new Date('2026-10-10T09:00:00.000Z').getTime();

// 页面接真：队列 = 真实账本（jsdom/浏览器 = 内存态空账本 → 诚实空态，绝不伪造种子冲突）。
// SEED_CONFLICTS 仅作单元测试夹具（DisputeQueue/DisputeVerdict 组件直渲用法），页面不渲染。
describe('DisputePage (P7-T5 编排·真实账本接真版)', () => {
  it('空账本（jsdom 内存态）→ 诚实空态（不渲染种子冲突）', async () => {
    render(<DisputePage />);
    await waitFor(() => expect(screen.getByTestId('dispute-empty')).toBeInTheDocument());
    expect(screen.getByTestId('dispute-empty')).toHaveTextContent('当前账本无待裁决冲突');
    // 诚实口径：无真实冲突 → 不渲染种子 cf_001~cf_005 队列项
    expect(screen.queryByTestId('queue')).toBeNull();
  });

  it('有真实冲突（coreConflicts 返回非空）→ 渲染队列 + 裁决面板', async () => {
    // 注入 1 条真实冲突（模拟账本有 pending 冲突）
    const live = [SEED_CONFLICTS[0]];
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockResolvedValue(live);
    render(<DisputePage />);
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(1));
    expect(screen.getAllByTestId(/^queue-item-/)[0]).toHaveTextContent(SEED_CONFLICTS[0].old_content);
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    expect(screen.getByTestId('verdict-panel')).toBeInTheDocument();
    expect(screen.getByTestId('panel-old')).toBeInTheDocument();
    expect(screen.getByTestId('panel-new')).toBeInTheDocument();
  });

  it('裁决走内核（_memoryOp + 成对审计）→ 审计历史 + toast', async () => {
    const live = [SEED_CONFLICTS[0]];
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockResolvedValue(live);
    render(<DisputePage />);
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(1));
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    fireEvent.click(screen.getByTestId('verdict-auto_override'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/旧值 deprecated/));
    expect(screen.getByTestId('audit-log')).toBeInTheDocument();
    expect(screen.getByTestId('audit-row-0')).toHaveTextContent(/req_/);
  });

  // 批次25 P0-7：内核读不到 ≠ 无待裁决冲突（原来 catch 里保持空列表 → 被说成「无冲突」）
  it('内核不可达 → 显示内核原因与重试，绝不显示「无待裁决冲突」', async () => {
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockRejectedValue(new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'));
    render(<DisputePage />);
    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());
    expect(screen.getByTestId('kernel-error-reason')).toHaveTextContent('E_IPC_TIMEOUT');
    expect(screen.queryByTestId('dispute-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('queue')).not.toBeInTheDocument();
  });
});

describe('DisputeQueue (T3)', () => {
  it('空队列显示占位', () => {
    render(<DisputeQueue list={[]} onSelect={() => {}} />);
    expect(screen.getByTestId('queue-empty')).toHaveTextContent(/暂无/);
  });

  it('超期高亮 + 类型徽章渲染（测试夹具 SEED_CONFLICTS，仅组件单测用）', () => {
    render(<DisputeQueue list={SEED_CONFLICTS} now={NOW} onSelect={() => {}} />);
    const item = screen.getByText(/默认端口 8080/).closest('li');
    expect(item).toHaveClass('overdue');
    expect(screen.getAllByText('直接矛盾').length).toBe(2);
    expect(screen.getByText('部分重叠')).toBeInTheDocument();
  });
});

describe('DisputeVerdict (T4)', () => {
  const base = SEED_CONFLICTS[0];
  it('渲染 4 按钮，且不预生成假 request_id（真实 id 只能由内核裁决返回，批次48 A19）', () => {
    render(<DisputeVerdict record={base} onVerdict={() => {}} />);
    expect(screen.queryByText(/req_[0-9A-Za-z]+/)).toBeNull();
    expect(screen.getByTestId('req-hint')).toHaveTextContent('内核裁决返回');
    expect(screen.getByTestId('verdict-panel')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^verdict-(auto_override|user_confirm|merge|hold)$/).length).toBe(4);
  });
});
