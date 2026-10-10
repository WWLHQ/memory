import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuditPage } from '../AuditPage.tsx';

describe('AuditPage 集成（T5，审计流来自内核）', () => {
  it('渲染过滤栏与列表（种子 8 条）', async () => {
    render(<AuditPage />);
    expect(screen.getByTestId('filter-bar')).toBeInTheDocument();
    expect(screen.getByTestId('audit-table')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(8));
  });

  it('查询 action=召回 → 只显示召回行', async () => {
    render(<AuditPage />);
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(8));
    fireEvent.change(screen.getByTestId('f-action'), { target: { value: 'recall' } });
    fireEvent.click(screen.getByTestId('query'));
    expect(screen.getAllByTestId(/row-req_/)).toHaveLength(1);
  });

  it('点 request_id → 展开同链路全行', async () => {
    render(<AuditPage />);
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(8));
    fireEvent.click(screen.getByTestId('rid-req_a1-0'));
    expect(screen.getAllByTestId(/row-req_a1-/)).toHaveLength(3);
    expect(screen.getByTestId('clear-chain')).toBeInTheDocument();
  });

  it('重置恢复全部', async () => {
    render(<AuditPage />);
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(8));
    fireEvent.change(screen.getByTestId('f-action'), { target: { value: 'write' } });
    fireEvent.click(screen.getByTestId('query'));
    expect(screen.getAllByTestId(/row-req_/)).toHaveLength(1);
    fireEvent.click(screen.getByTestId('reset'));
    expect(screen.getAllByTestId(/row-req_/)).toHaveLength(8);
  });

  it('导出按钮存在并可点击（toast 反馈）', async () => {
    render(<AuditPage />);
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(8));
    fireEvent.click(screen.getByTestId('export-csv'));
    expect(screen.getByTestId('toast')).toBeInTheDocument();
  });

  it('evidence_thin 行可见', async () => {
    render(<AuditPage />);
    await waitFor(() => expect(screen.getAllByTestId('ev-thin').length).toBeGreaterThan(0));
  });
});
