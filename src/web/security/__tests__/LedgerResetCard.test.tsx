// 批次35：安全页「记忆库清空重采卡」单测（管理员预览 → 逐字口令 → 主进程清空+重采 → 真实回执与追采进度）。
// 口径：只调真实 IPC（ledger:resetPreview / ledger:resetRecollect / collector:status），
// 浏览器环境诚实不可用，非管理员不给入口，口令不符不给点执行，失败原样展示，绝不显示成功回执。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 's_test',
  useSessionContext: () => ({ sid: 's_test', context: { role: 'admin' }, role: 'admin' as const, loading: false }),
  fetchSessionContext: async () => null,
}));

import { LedgerResetCard } from '../LedgerResetCard.tsx';
import type { LedgerPurgeReport, LedgerResetPreview } from '../../../core/memagent/ledgerReset.ts';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

const PREVIEW: LedgerResetPreview = {
  total: 1642, by_layer: { L1: 1641, L2: 1 }, by_source: { 'claude-code': 1600, '<未知>': 42 },
  with_l0_cipher: 5, llm_refined: 1, tombstones: 0, sample_ids: ['mem_0001'],
};
const REPORT: LedgerPurgeReport = { ...PREVIEW, purged: 1642, failed: 0, failed_ids: [] };
const STATUS = {
  ok: true, running: true, recollecting: false,
  last: { collected: 50, deduped: 12, roleSkipped: 380, ts: 1_800_000_000_000 },
  apply: { written: 31, filtered: 19, failed: 0, ts: 1_800_000_000_000 },
};

/** 装上桌面壳：window.api.ledgerReset.{preview,run} + api.collector.status */
function mockHost(opts: {
  preview?: unknown;
  run?: unknown;
  status?: unknown;
  trigger?: unknown;
} = {}) {
  w.__ELECTRON__ = true;
  const previewFn = vi.fn(() => Promise.resolve(opts.preview ?? {
    ok: true, preview: PREVIEW, collector: { sourceCount: 5, recollecting: false, maxPerRound: 50 },
  }));
  const runFn = vi.fn(() => Promise.resolve(opts.run ?? {
    ok: true, report: REPORT, backup_dir: 'D:\\backups\\ledger-reset-x', cursor_reset: true, recollecting: true,
  }));
  const statusFn = vi.fn(() => Promise.resolve(opts.status ?? STATUS));
  const triggerFn = vi.fn(() => Promise.resolve(opts.trigger ?? {
    ok: true, advanced: true, collected: 50, deduped: 12, roleSkipped: 380,
    consecutiveFails: 0, autoRetryStopped: false, skipped: [], ts: 1_800_000_000_000,
  }));
  w.api = { ledgerReset: { preview: previewFn, run: runFn }, collector: { status: statusFn, triggerNow: triggerFn } };
  return { previewFn, runFn, statusFn, triggerFn };
}

beforeEach(() => {
  delete w.__ELECTRON__;
  delete w.api;
});

afterEach(() => {
  delete w.__ELECTRON__;
  delete w.api;
  vi.restoreAllMocks();
});

describe('LedgerResetCard（批次35 清空重采）', () => {
  it('浏览器环境（无桌面壳）：如实说明不可用，不预览、不伪造计数', () => {
    render(<LedgerResetCard enabled />);
    expect(screen.getByTestId('ledger-reset-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('ledger-reset-run')).toBeNull();
    expect(screen.queryByTestId('ledger-reset-preview-report')).toBeNull();
  });

  it('非管理员：只给「需管理员」说明，不自动预览（真实校验仍在主进程）', () => {
    const { previewFn } = mockHost();
    render(<LedgerResetCard enabled={false} />);
    expect(screen.getByTestId('ledger-reset-need-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('ledger-reset-run')).toBeNull();
    expect(previewFn).not.toHaveBeenCalled();
  });

  it('管理员挂载即只读预览：条数/层级/来源/L0 密文/真实 LLM 产物都按主进程真值展示', async () => {
    const { previewFn } = mockHost();
    render(<LedgerResetCard enabled />);
    await waitFor(() => expect(screen.getByTestId('ledger-reset-preview-report')).toBeInTheDocument());
    expect(previewFn).toHaveBeenCalledWith('s_test');
    const text = screen.getByTestId('ledger-reset-preview-report').textContent ?? '';
    expect(text).toContain('1642');
    expect(text).toContain('L1 × 1641');
    expect(text).toContain('claude-code × 1600');
    expect(text).toContain('5 条带 L0 密文原文');
    expect(text).toContain('真实 LLM 精炼产物');
    // 批次41-O：带 L0 原文的行给硬警告（连带销毁、不能重建找回、唯一退路是备份目录）
    const warn = screen.getByTestId('ledger-reset-l0-warn').textContent ?? '';
    expect(warn).toContain('5');
    expect(warn).toContain('L0');
    expect(warn).toContain('备份目录');
  });

  it('确认口令门禁：没逐字输入 RESET 时按钮禁用，绝不偷跑清空', async () => {
    const { runFn } = mockHost();
    render(<LedgerResetCard enabled />);
    await waitFor(() => expect(screen.getByTestId('ledger-reset-run')).toBeInTheDocument());
    expect(screen.getByTestId('ledger-reset-run')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ledger-reset-run'));
    expect(runFn).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('ledger-reset-word'), { target: { value: 'reset' } });
    await waitFor(() => expect(screen.getByTestId('ledger-reset-run')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('ledger-reset-run'));
    await waitFor(() => expect(runFn).toHaveBeenCalledWith('reset', 's_test'));
  });

  it('执行成功：回显真实删除数、备份路径、游标已归零，并拉一次采集状态显示追采口径', async () => {
    const { runFn, statusFn } = mockHost();
    render(<LedgerResetCard enabled />);
    await waitFor(() => expect(screen.getByTestId('ledger-reset-run')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('ledger-reset-word'), { target: { value: 'RESET' } });
    fireEvent.click(screen.getByTestId('ledger-reset-run'));
    await waitFor(() => expect(screen.getByTestId('ledger-reset-report')).toBeInTheDocument());
    expect(runFn).toHaveBeenCalledWith('RESET', 's_test');
    const text = screen.getByTestId('ledger-reset-report').textContent ?? '';
    expect(text).toContain('已删除');
    expect(text).toContain('1642');
    expect(text).toContain('D:\\backups\\ledger-reset-x');
    expect(text).toContain('security_change');
    expect(screen.queryByTestId('ledger-reset-cursor-warn')).toBeNull();

    await waitFor(() => expect(screen.getByTestId('ledger-reset-progress')).toBeInTheDocument());
    expect(statusFn).toHaveBeenCalled();
    const prog = screen.getByTestId('ledger-reset-progress').textContent ?? '';
    expect(prog).toContain('追采已收敛');
    expect(prog).toContain('入库 31 条');
    expect(prog).toContain('质量门拦下 19 条');
    expect(prog).toContain('5 分钟周期');
  });

  it('游标文件写不进去：如实警告「重启后退回旧游标可能漏采」，不假装全部就绪', async () => {
    mockHost({
      run: { ok: true, report: REPORT, backup_dir: 'D:\\backups\\ledger-reset-y', cursor_reset: false, cursor_error: 'EBUSY' },
    });
    render(<LedgerResetCard enabled />);
    await waitFor(() => expect(screen.getByTestId('ledger-reset-run')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('ledger-reset-word'), { target: { value: 'RESET' } });
    fireEvent.click(screen.getByTestId('ledger-reset-run'));
    await waitFor(() => expect(screen.getByTestId('ledger-reset-cursor-warn')).toBeInTheDocument());
    expect(screen.getByTestId('ledger-reset-cursor-warn')).toHaveTextContent('重启后会退回旧游标');
  });

  it('主进程拒绝（备份失败/口令不符）：原样显示真实原因，绝不显示成功回执', async () => {
    const { runFn, statusFn } = mockHost({ run: { ok: false, error: '清空前备份失败：EPERM' } });
    render(<LedgerResetCard enabled />);
    await waitFor(() => expect(screen.getByTestId('ledger-reset-run')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('ledger-reset-word'), { target: { value: 'RESET' } });
    fireEvent.click(screen.getByTestId('ledger-reset-run'));
    await waitFor(() => expect(screen.getByTestId('ledger-reset-error')).toHaveTextContent('清空前备份失败：EPERM'));
    expect(screen.queryByTestId('ledger-reset-report')).toBeNull();
    expect(statusFn).not.toHaveBeenCalled(); // 没清空就不开始追采轮询
    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it('库已空（total=0）：显示空态，不给清空按钮', async () => {
    mockHost({ preview: { ok: true, preview: { ...PREVIEW, total: 0, by_layer: {}, by_source: {}, sample_ids: [] }, collector: { sourceCount: 5, recollecting: false, maxPerRound: 50 } } });
    render(<LedgerResetCard enabled />);
    await waitFor(() => expect(screen.getByTestId('ledger-reset-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('ledger-reset-run')).toBeNull();
    // 批次41-V：旧文案让用户去点一个界面上根本不存在的「采集状态」入口，这条钉住它不复发
    expect(screen.queryByText(/「采集状态」/)).toBeNull();
  });

  it('批次41-V：空态里的「立即采集一轮」真走 collector:triggerNow，推进了就读回计数', async () => {
    const { triggerFn } = mockHost({
      preview: { ok: true, preview: { ...PREVIEW, total: 0, by_layer: {}, by_source: {}, sample_ids: [] } },
      trigger: { ok: true, advanced: true, collected: 50, deduped: 12, roleSkipped: 380, consecutiveFails: 0, autoRetryStopped: false, skipped: [] },
    });
    render(<LedgerResetCard enabled />);
    await waitFor(() => expect(screen.getByTestId('ledger-reset-trigger')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('ledger-reset-trigger'));
    await waitFor(() => expect(triggerFn).toHaveBeenCalled());
    expect(await screen.findByTestId('ledger-reset-trigger-outcome')).toHaveTextContent('本轮采到 50 条');
    expect(screen.queryByTestId('ledger-reset-trigger-error')).toBeNull();
  });

  it('批次41-V：本轮没推进（写失败）→ 明写原因码并指路 L0 解锁，不报成功', async () => {
    mockHost({
      preview: { ok: true, preview: { ...PREVIEW, total: 0, by_layer: {}, by_source: {}, sample_ids: [] } },
      trigger: {
        ok: true, advanced: false, collected: 50, deduped: 0, roleSkipped: 0,
        consecutiveFails: 2, autoRetryStopped: false,
        skipped: ['采集异常: collector:round-not-advanced(write_failed)'],
      },
    });
    render(<LedgerResetCard enabled />);
    fireEvent.click(await screen.findByTestId('ledger-reset-trigger'));
    const outcome = await screen.findByTestId('ledger-reset-trigger-outcome');
    expect(outcome).toHaveTextContent('本轮没推进');
    expect(outcome).toHaveTextContent('write_failed');
    expect(outcome).toHaveTextContent('连续失败 2 轮');
    expect(outcome).toHaveTextContent('E_L0_LOCKED');
    expect(outcome).toHaveTextContent('L0 管理');
  });

  it('批次41-V：采集状态说「自动重试已停」就显出来（拉一次 collector:status，不编造）', async () => {
    const { statusFn } = mockHost({
      preview: { ok: true, preview: { ...PREVIEW, total: 0, by_layer: {}, by_source: {}, sample_ids: [] } },
      status: { ...STATUS, consecutiveFails: 6, autoRetryStopped: true },
    });
    render(<LedgerResetCard enabled />);
    await waitFor(() => expect(screen.getByTestId('ledger-reset-blocked')).toHaveTextContent('连续失败 6 轮'));
    expect(statusFn).toHaveBeenCalled();
  });

  it('IPC 抛错：显示抛错原因，不假装库为空', async () => {
    mockHost({ preview: Promise.reject(new Error('主进程未注册 ledger:resetPreview')) });
    render(<LedgerResetCard enabled />);
    await waitFor(() => expect(screen.getByTestId('ledger-reset-error')).toHaveTextContent('主进程未注册 ledger:resetPreview'));
    expect(screen.queryByTestId('ledger-reset-empty')).toBeNull();
  });
});
