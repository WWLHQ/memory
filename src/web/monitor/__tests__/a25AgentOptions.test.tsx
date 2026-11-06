// 批次48 A25：监控页宿主 Agent 下拉只由真实账本派生（空账本 = 仅「全部」），不内置占位 agent 名。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { agentOptionsFromLedger } from '../options.ts';
import { MonitorPage } from '../MonitorPage.tsx';
import { resetKernelForTests } from '../../kernel.ts';

describe('agentOptionsFromLedger', () => {
  it('空账本 → 仅「全部」', () => {
    expect(agentOptionsFromLedger([], [])).toEqual(['all']);
    expect(agentOptionsFromLedger([], [undefined, '  '])).toEqual(['all']);
  });

  it('合并告警 agent 与记忆 created_by_agent：去重、排序、排除 all', () => {
    expect(agentOptionsFromLedger(
      [{ agent: 'sync-00' }, { agent: 'cred-03' }, { agent: 'all' }, { agent: ' sync-00 ' }],
      ['coder-01', undefined, 'sync-00'],
    )).toEqual(['all', 'coder-01', 'cred-03', 'sync-00']);
  });
});

describe('MonitorPage 下拉（A25）', () => {
  beforeEach(() => resetKernelForTests());
  afterEach(() => vi.restoreAllMocks());

  it('空账本只渲染「全部」一项（没有 coder-01 / writer-02 / sync-00）', async () => {
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getByTestId('f-agent')).toBeInTheDocument());
    const opts = [...(screen.getByTestId('f-agent') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opts).toEqual(['全部']);
  });

  it('账本有真实 agent 时选项随之出现；筛选后命中 0 条且空态可见', async () => {
    vi.spyOn(await import('../useMonitorReal.ts'), 'loadRealMonitorData').mockResolvedValue({
      available: true, memCount: 1, auditCount: 1, metrics: [], alerts: [],
      agentOptions: ['all', 'sync-00'],
    });
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getByTestId('f-agent')).toBeInTheDocument());
    const opts = [...(screen.getByTestId('f-agent') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opts).toEqual(['全部', 'sync-00']);
    fireEvent.change(screen.getByTestId('f-agent'), { target: { value: 'sync-00' } });
    expect(screen.getByTestId('monitor-page')).toHaveTextContent('命中 0 条');
    expect(screen.getByTestId('alerts-empty')).toBeInTheDocument();
  });
});
