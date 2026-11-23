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
    fireEvent.click(screen.getAllByTestId(/^rid-req_a1-/)[0]);
    expect(screen.getAllByTestId(/row-req_a1-/)).toHaveLength(3);
    expect(screen.getByTestId('clear-chain')).toBeInTheDocument();
  });

  it('事件流按时间倒序后分页：第 1 页最新在前，翻页为更早记录', async () => {
    await seedAuditLedger(EXTRA_AUDIT);
    render(<AuditPage />);
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(10));
    // 最新一条（10-09 18:40 归档）在首行；表底口径写明倒序
    expect(screen.getAllByTestId(/row-req_/)[0]).toHaveAttribute('data-testid', 'row-req_d4-0');
    expect(screen.getByTestId('audit-tblft').textContent).toContain('按时间倒序');

    fireEvent.click(screen.getByTestId('pg-next'));
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(4));
    // 第 2 页承接最早 4 条，末行是最早的 req_a1（09:12:00）
    const ids = screen.getAllByTestId(/row-req_/).map((e) => e.getAttribute('data-testid'));
    expect(ids[ids.length - 1]).toBe('row-req_a1-13');
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

  // 批次24 #4：分页（预设每页 10 条）+ 可调表头固化；批次 B：页头改 v5 page-head、表底改 v5 紧凑 pager
  it('分页：14 条 → 每页 10 条，翻页看余下 4 条，换 100 条/页一次看全', async () => {
    await seedAuditLedger(EXTRA_AUDIT);
    render(<AuditPage />);
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(10));
    // v5 页头：标题 + 元信息行（账本条数真实反映）
    expect(screen.getByTestId('audit-head').textContent).toContain('审计日志');
    expect(screen.getByTestId('audit-meta-count').textContent).toContain('账本 14 条');
    // v5 表底：左统计（显示/共） + 右紧凑 pager（数字窗口）
    expect(screen.getByTestId('audit-tblft').textContent).toContain('显示 10 行 / 共 14 行');
    expect(screen.getByTestId('pg-info').textContent).toContain('第 1 / 2 页');
    expect(screen.getByTestId('pg-page-2')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pg-next'));
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(4));
    expect(screen.getByTestId('pg-info').textContent).toContain('第 2 / 2 页');
    expect(screen.getByTestId('pg-next')).toBeDisabled();

    fireEvent.change(screen.getByTestId('pg-size'), { target: { value: '100' } });
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(14));
    expect(screen.getByTestId('pg-info').textContent).toContain('第 1 / 1 页');
  });

  it('分页：链路视图同样走分页口径（进链路回第 1 页，退出恢复总数）', async () => {
    await seedAuditLedger(EXTRA_AUDIT);
    render(<AuditPage />);
    await waitFor(() => expect(screen.getAllByTestId(/row-req_/)).toHaveLength(10));
    fireEvent.click(screen.getByTestId('pg-page-2'));
    await waitFor(() => expect(screen.getByTestId('pg-info').textContent).toContain('第 2 / 2 页'));

    // 第 2 页（倒序后为最早 4 条）点 req_a1 链路 → 页码回第 1 页，只显示该链路 3 行
    fireEvent.click(screen.getAllByTestId(/^rid-req_a1-/)[0]);
    await waitFor(() => expect(screen.getByTestId('pg-info').textContent).toContain('第 1 / 1 页'));
    expect(screen.getAllByTestId(/row-req_a1-/)).toHaveLength(3);
    expect(screen.getByTestId('audit-tblft').textContent).toContain('共 3 行');

    fireEvent.click(screen.getByTestId('clear-chain'));
    expect(screen.getByTestId('pg-info').textContent).toContain('第 1 / 2 页');
    expect(screen.getByTestId('audit-tblft').textContent).toContain('共 14 行');
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

  it('跟随壳层深色主题：挂载即设置 html[data-theme="dark"]', () => {
    // 批次55：深色主题适配正向断言
    localStorage.setItem('memdesk.shell.theme.v1', 'dark');
    try {
      render(<AuditPage />);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    } finally {
      localStorage.setItem('memdesk.shell.theme.v1', 'light');
      document.documentElement.removeAttribute('data-theme');
    }
  });
});
