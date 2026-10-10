import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MonitorPage } from '../MonitorPage.tsx';
import { AlertTimeline } from '../AlertTimeline.tsx';
import { SEED_ALERTS } from '../seed.ts';
import { coreLoadAlerts } from '../coreMonitor.ts';

describe('MonitorPage (P6-T4 编排)', () => {
  it('挂载渲染指标网格与时间线（内核账本回放 5 条种子告警）', async () => {
    render(<MonitorPage />);
    expect(screen.getByTestId('monitor-page')).toBeInTheDocument();
    expect(screen.getByTestId('metric-grid')).toBeInTheDocument();
    // 14 张卡
    expect(screen.getAllByText(/跳 P7|跳 P10|跳 P1|跳 5\.|跳 2\.4/).length).toBeGreaterThan(10);
    // 触发样本
    expect(screen.getByTestId('metric-熔断状态')).toHaveClass('crit');
    expect(screen.getByTestId('metric-待裁决')).toHaveClass('warn');
    // 告警时间线 = 内核账本回放（种子 5 条）
    await waitFor(() => expect(screen.getAllByTestId(/^alert-\d+$/)).toHaveLength(5));
    expect(await coreLoadAlerts()).toHaveLength(5);
  });

  it('筛选 crit → 时间线只剩严重告警', async () => {
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^alert-\d+$/)).toHaveLength(5));
    fireEvent.change(screen.getByTestId('f-level'), { target: { value: 'crit' } });
    expect(screen.getAllByTestId(/^alert-\d+$/).length).toBe(2);
  });

  it('点 request_id → toast 跳审计', async () => {
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^alert-\d+$/)).toHaveLength(5));
    fireEvent.click(screen.getByTestId('alert-req-0'));
    expect(screen.getByTestId('toast')).toHaveTextContent(/req_m1/);
  });
});

describe('AlertTimeline (T3)', () => {
  it('空筛选显示占位', () => {
    render(<AlertTimeline alerts={[]} />);
    expect(screen.getByTestId('alert-empty')).toBeInTheDocument();
  });
  it('memory_id 可点', () => {
    render(<AlertTimeline alerts={SEED_ALERTS} />);
    expect(screen.getByTestId('alert-mem-0')).toBeInTheDocument();
  });
});
