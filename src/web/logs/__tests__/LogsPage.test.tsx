import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LogsPage } from '../LogsPage.tsx';
import { LogTable } from '../LogCards.tsx';
import { SEED_LOGS } from '../seed.ts';
import { ensureRequestId } from '../logic.ts';

describe('LogsPage (P15-T4 编排)', () => {
  it('挂载渲染：全动作可见（验收用例①）+ n/a 告警卡（R-LOG2）', () => {
    render(<LogsPage />);
    expect(screen.getByTestId('logs-page')).toBeInTheDocument();
    // 全动作：清理归档/团队分配等在动作多选区与列表均可见
    expect(screen.getAllByText('清理归档').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('团队分配').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('missing-warn')).toHaveTextContent(/1 条日志缺少 request_id/);
  });

  it('error 置顶（R-LOG1）+ 红底行', () => {
    render(<LogsPage />);
    const first = screen.getAllByTestId(/^log-\d+$/)[0];
    expect(first).toHaveClass('err-row');
  });

  it('仅异常开关（验收用例②）', () => {
    render(<LogsPage />);
    fireEvent.click(screen.getByTestId('lf-abnormal'));
    expect(screen.getAllByTestId(/^log-\d+$/).every((el) => !el.textContent?.includes('info'))).toBe(true);
  });

  it('查阅审计 → 弹出 modal（R-LOG6 非常驻）→ 关闭收起', () => {
    render(<LogsPage />);
    fireEvent.click(screen.getAllByTestId(/^audit-\d+$/)[0]);
    expect(screen.getByTestId('audit-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(screen.queryByTestId('audit-modal')).toBeNull();
  });

  it('L0 授权：管理员密码错 → 已记审计；对 → 解锁', () => {
    render(<LogsPage />);
    fireEvent.change(screen.getByTestId('l0-pwd'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByTestId('l0-submit'));
    expect(screen.getByTestId('l0-msg')).toHaveTextContent('已记审计');
    fireEvent.change(screen.getByTestId('l0-pwd'), { target: { value: 'l0pass' } });
    fireEvent.click(screen.getByTestId('l0-submit'));
    expect(screen.getByTestId('l0-msg')).toHaveTextContent('l0_view');
    expect(screen.getByTestId('l0-sample')).toHaveTextContent('tcp://prod-db:5432/app');
  });

  it('详情展开 extra', () => {
    render(<LogsPage />);
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
