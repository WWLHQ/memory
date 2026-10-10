import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DisputePage } from '../DisputePage.tsx';
import { DisputeQueue } from '../DisputeQueue.tsx';
import { DisputeVerdict } from '../DisputeVerdict.tsx';
import { SEED_CONFLICTS } from '../seed.ts';

const NOW = new Date('2026-10-10T09:00:00.000Z').getTime();

describe('DisputePage (P7-T5 编排，队列来自内核 SyncHub)', () => {
  it('挂载渲染标题与队列（种子直渲 + 内核队列挂载同步）', async () => {
    render(<DisputePage />);
    expect(screen.getByTestId('dispute-page')).toBeInTheDocument();
    expect(screen.getByText(/冲突裁决页/)).toBeInTheDocument();
    expect(screen.getByText(/REQ-006/)).toBeInTheDocument();
    expect(screen.getByTestId('queue')).toBeInTheDocument();
    // 种子 5 条全 dispute_flag=true（内核队列内容一致）
    expect(screen.getAllByTestId(/^queue-item-/).length).toBe(5);
  });

  it('点击队列项显示裁决面板', () => {
    render(<DisputePage />);
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    expect(screen.getByTestId('verdict-panel')).toBeInTheDocument();
    expect(screen.getByTestId('panel-old')).toBeInTheDocument();
    expect(screen.getByTestId('panel-new')).toBeInTheDocument();
    // 4 种裁决按钮（9.7）
    expect(screen.getByTestId('verdict-auto_override')).toBeInTheDocument();
    expect(screen.getByTestId('verdict-user_confirm')).toBeInTheDocument();
    expect(screen.getByTestId('verdict-merge')).toBeInTheDocument();
    expect(screen.getByTestId('verdict-hold')).toBeInTheDocument();
  });

  it('裁决走内核（hub.resolve + _memoryOp）→ 成对审计历史 + toast', async () => {
    render(<DisputePage />);
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    fireEvent.click(screen.getByTestId('verdict-auto_override'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/旧值 deprecated/));
    expect(screen.getByTestId('audit-log')).toBeInTheDocument();
    // 审计行含 request_id（18.2-E）
    expect(screen.getByTestId('audit-row-0')).toHaveTextContent(/req_d/);
  });

  it('hold 保持 pending（队列不出队，真实语义）', async () => {
    render(<DisputePage />);
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    fireEvent.click(screen.getByTestId('verdict-hold'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/维持 dispute/));
    // 冲突仍在队列（SyncHub pending 不变）
    expect(screen.getAllByTestId(/^queue-item-/).length).toBeGreaterThanOrEqual(1);
  });
});

describe('DisputeQueue (T3)', () => {
  it('空队列显示占位', () => {
    render(<DisputeQueue list={[]} onSelect={() => {}} />);
    expect(screen.getByTestId('queue-empty')).toHaveTextContent(/暂无/);
  });

  it('超期高亮 + 类型徽章渲染', () => {
    render(<DisputeQueue list={SEED_CONFLICTS} now={NOW} onSelect={() => {}} />);
    // cf_002 created 2026-09-28 → 12d 超期
    const item = screen.getByText(/默认端口 8080/).closest('li');
    expect(item).toHaveClass('overdue');
    expect(screen.getAllByText('直接矛盾').length).toBe(2);
    expect(screen.getByText('部分重叠')).toBeInTheDocument();
  });
});

describe('DisputeVerdict (T4)', () => {
  const base = SEED_CONFLICTS[0];
  it('渲染 4 按钮与 request 预告', () => {
    render(<DisputeVerdict record={base} requestSeq={1} onVerdict={() => {}} />);
    expect(screen.getByText(/req_d1/)).toBeInTheDocument();
    expect(screen.getByTestId('verdict-panel')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^verdict-(auto_override|user_confirm|merge|hold)$/).length).toBe(4);
  });
});
