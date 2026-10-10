import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LogsPage } from '../LogsPage.tsx';
import { LogTable } from '../LogCards.tsx';
import { SEED_LOGS } from '../seed.ts';
import { ensureRequestId } from '../logic.ts';

describe('LogsPage (P15-T4 编排，审计流来自内核)', () => {
  it('挂载渲染：全动作可见（验收用例①）+ n/a 告警卡（R-LOG2）', async () => {
    render(<LogsPage />);
    expect(screen.getByTestId('logs-page')).toBeInTheDocument();
    // 全动作：清理归档/团队分配等在动作多选区与列表均可见（列表为异步加载）
    await waitFor(() => expect(screen.getAllByText('清理归档').length).toBeGreaterThanOrEqual(1));
    expect(screen.getAllByText('团队分配').length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(screen.getByTestId('missing-warn')).toHaveTextContent(/1 条日志缺少 request_id/));
  });

  it('error 置顶（R-LOG1）+ 红底行', async () => {
    render(<LogsPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^log-\d+$/).length).toBeGreaterThan(0));
    const first = screen.getAllByTestId(/^log-\d+$/)[0];
    expect(first).toHaveClass('err-row');
  });

  it('仅异常开关（验收用例②）', async () => {
    render(<LogsPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^log-\d+$/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId('lf-abnormal'));
    expect(screen.getAllByTestId(/^log-\d+$/).every((el) => !el.textContent?.includes('info'))).toBe(true);
  });

  it('查阅审计 → 弹出 modal（R-LOG6 非常驻）→ 关闭收起', async () => {
    render(<LogsPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^audit-\d+$/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTestId(/^audit-\d+$/)[0]);
    expect(screen.getByTestId('audit-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(screen.queryByTestId('audit-modal')).toBeNull();
  });

  it('L0 授权走内核 browse：错密码已记审计；对密码解锁 + 样例回填', async () => {
    render(<LogsPage />);
    fireEvent.change(screen.getByTestId('l0-pwd'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByTestId('l0-submit'));
    expect(screen.getByTestId('l0-msg')).toHaveTextContent('已记审计');
    fireEvent.change(screen.getByTestId('l0-pwd'), { target: { value: 'l0pass' } });
    fireEvent.click(screen.getByTestId('l0-submit'));
    await waitFor(() => expect(screen.getByTestId('l0-msg')).toHaveTextContent('l0_view'));
    await waitFor(() => expect(screen.getByTestId('l0-sample')).toHaveTextContent('tcp://prod-db:5432/app'));
  });

  it('详情展开 extra', async () => {
    render(<LogsPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^detail-\d+$/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTestId(/^detail-\d+$/)[0]);
    expect(screen.getAllByTestId(/^extra-\d+$/)[0]).toBeInTheDocument();
  });
});

describe('LogTable (T3)', () => {
  it('n/a 行无审计链接', () => {
    const { fixed } = ensureRequestId(SEED_LOGS);
    render(<LogTable logs={fixed} onAudit={() => {}} />);
    expect(screen.getAllByTestId(/^na-\d+$/).length).toBe(1);
  });
  it('空结果显示占位', () => {
    render(<LogTable logs={[]} onAudit={() => {}} />);
    expect(screen.getByTestId('log-empty')).toBeInTheDocument();
  });
});
