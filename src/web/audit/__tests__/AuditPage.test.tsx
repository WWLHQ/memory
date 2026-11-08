import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { AuditPage } from '../AuditPage.tsx';
import { resetKernelForTests } from '../../kernel.ts';
import { seedAuditLedger } from './fixtures.ts';
import type { AuditEntry } from '../types.ts';

/** 追加样本：把账本推到 14 条，验证「每页 10 条」的分页口径 */
const EXTRA_AUDIT: AuditEntry[] = Array.from({ length: 6 }, (_, i) => ({
  enterprise_id: 'ent_001', user_id: 'u1', ip_address: '10.0.0.5', device_info: 'desktop/Claude Code',
  action: 'recall', resource_type: 'memory', resource_id: `mem_x${i}`,
  request_id: `req_x${i}`, payload_tokens: 10, pipeline_llm_tokens: 0,
  created_at: `2026-10-08T09:2${i}:00.000Z`,
}));

describe('AuditPage 集成（T5，审计流来自内核）', () => {
  beforeEach(async () => {
    localStorage.clear();
    resetKernelForTests();
    await seedAuditLedger();
  });

  it('渲染过滤栏与列表（账本 8 条）', async () => {
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

  // 批次24 #4：分页（预设每页 10 条）+ 可调表头固化
  it('分页：14 条 → 每页 10 条，翻页看余下 4 条，换 100 条/页一次看全', async () => {
    await seedAuditLedger(EXTRA_AUDIT);
    render(<AuditPage />);
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(10));
    expect(screen.getByTestId('pg-info').textContent).toContain('/ 2 页 · 共 14 条');
    expect(screen.getByTestId('pg-note').textContent).toContain('每页 10 条 · 当前视图 14 条');
    expect(screen.getByTestId('pg-goto-input')).toHaveValue(1);

    fireEvent.click(screen.getByTestId('pg-next'));
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(4));
    expect(screen.getByTestId('pg-goto-input')).toHaveValue(2);
    expect(screen.getByTestId('pg-next')).toBeDisabled();

    fireEvent.change(screen.getByTestId('pg-size'), { target: { value: '100' } });
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(14));
    expect(screen.getByTestId('pg-goto-input')).toHaveValue(1);
  });

  it('分页：链路视图同样走分页口径（进链路回第 1 页，退出恢复总数）', async () => {
    await seedAuditLedger(EXTRA_AUDIT);
    render(<AuditPage />);
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(10));
    fireEvent.click(screen.getByTestId('pg-last'));
    await waitFor(() => expect(screen.getByTestId('pg-goto-input')).toHaveValue(2));

    // 第 2 页点 req_c3 链路 → 页码回第 1 页，只显示该链路 2 行
    fireEvent.click(screen.getByTestId('rid-req_c3-11'));
    await waitFor(() => expect(screen.getByTestId('pg-goto-input')).toHaveValue(1));
    expect(screen.getAllByTestId(/row-req_c3-/)).toHaveLength(2);
    expect(screen.getByTestId('pg-info').textContent).toContain('/ 1 页 · 共 2 条');

    fireEvent.click(screen.getByTestId('clear-chain'));
    expect(screen.getByTestId('pg-info').textContent).toContain('/ 2 页 · 共 14 条');
  });

  it('表头：9 列固定表头 + 拖把手调宽固化（重新挂载仍保持）', async () => {
    render(<AuditPage />);
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeInTheDocument());
    expect(screen.getAllByTestId(/^audit-th-\d+$/)).toHaveLength(9);
    expect(screen.getByTestId('audit-th-0')).toHaveAttribute('data-w', '80');
    expect(screen.queryByTestId('audit-col-reset')).toBeNull();

    fireEvent.mouseDown(screen.getByTestId('col-resize-0'), { clientX: 80 });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 190 });
      fireEvent.mouseUp(document);
    });
    expect(screen.getByTestId('audit-th-0')).toHaveAttribute('data-w', '190');
    expect(JSON.parse(localStorage.getItem('auditColWidths') ?? '[]')[0]).toBe(190);
    expect(screen.getByTestId('audit-col-reset')).toBeInTheDocument();

    cleanup();
    render(<AuditPage />);
    await waitFor(() => expect(screen.getByTestId('audit-th-0')).toHaveAttribute('data-w', '190'));

    fireEvent.click(screen.getByTestId('audit-col-reset'));
    expect(screen.getByTestId('audit-th-0')).toHaveAttribute('data-w', '80');
  });
});
