// 批次24：安全页「遗留账本清理卡」单测（管理员预览 → 二次确认 → 主进程降级 → 真实回执）。
// 口径：只调真实 IPC（legacy:scan / legacy:demote），浏览器环境诚实不可用，非管理员不给入口，失败原样展示。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 's_test',
  useSessionContext: () => ({ sid: 's_test', context: { role: 'admin' }, role: 'admin' as const, loading: false }),
  fetchSessionContext: async () => null,
}));

import { LegacyLedgerCard } from '../LegacyLedgerCard.tsx';
import type { LegacyDemoteReport, LegacyScan } from '../../../core/memagent/legacyLayers.ts';
const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

const SCAN: LegacyScan = { scanned: 1642, hits: 986, missing_l1: 2, by_layer: { L2: 986, L3: 986, L6: 4 } };
const REPORT: LegacyDemoteReport = {
  ...SCAN, demoted: 984, skipped: 2, sample_ids: ['mem_0001', 'mem_0002'],
};

/** 装上桌面壳：window.api.legacy.{scan,demote} 即 preload → 宿主桥 native 分支 */
function mockHost(scan: unknown = { ok: true, scan: SCAN }, demote: unknown = { ok: true, report: REPORT, backup_dir: 'D:\\backups\\legacy-demote-x' }) {
  w.__ELECTRON__ = true;
  const scanFn = vi.fn(() => Promise.resolve(scan));
  const demoteFn = vi.fn(() => Promise.resolve(demote));
  w.api = { legacy: { scan: scanFn, demote: demoteFn } };
  return { scanFn, demoteFn };
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

describe('LegacyLedgerCard', () => {
  it('浏览器环境（无桌面壳）：如实说明不可用，不预览、不伪造计数', () => {
    render(<LegacyLedgerCard enabled />);
    expect(screen.getByTestId('legacy-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-scan')).toBeNull();
    expect(screen.queryByTestId('legacy-scan-report')).toBeNull();
  });

  it('非管理员：只给「需管理员」说明，不自动预览（真实校验仍在主进程）', () => {
    const { scanFn } = mockHost();
    render(<LegacyLedgerCard enabled={false} />);
    expect(screen.getByTestId('legacy-need-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-scan')).toBeNull();
    expect(scanFn).not.toHaveBeenCalled();
  });

  it('管理员：挂载即只读预览，报告显示层级分布与「缺 L1 将被跳过」', async () => {
    const { scanFn } = mockHost();
    render(<LegacyLedgerCard enabled />);
    await waitFor(() => expect(screen.getByTestId('legacy-scan-report')).toBeInTheDocument());
    expect(scanFn).toHaveBeenCalledWith('s_test');
    const text = screen.getByTestId('legacy-scan-report').textContent ?? '';
    expect(text).toContain('扫描 1642 条');
    expect(text).toContain('986');
    expect(text).toContain('L2 × 986');
    expect(text).toContain('2');
    expect(text).toContain('将被跳过（不伪造内容）');
  });

  it('二次确认后才执行：确认走 legacy:demote 并回显真实降级数与备份路径', async () => {
    const { demoteFn } = mockHost();
    render(<LegacyLedgerCard enabled />);
    await waitFor(() => expect(screen.getByTestId('legacy-demote')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('legacy-demote'));
    expect(screen.getByTestId('legacy-confirm')).toBeInTheDocument();
    expect(demoteFn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('legacy-demote-yes'));
    await waitFor(() => expect(screen.getByTestId('legacy-report')).toBeInTheDocument());
    expect(demoteFn).toHaveBeenCalledWith('s_test');
    const text = screen.getByTestId('legacy-report').textContent ?? '';
    expect(text).toContain('已降级');
    expect(text).toContain('984');
    expect(text).toContain('跳过 2');
    expect(text).toContain('D:\\backups\\legacy-demote-x');
    expect(text).toContain('security_change');
    // 执行后不再显示「可清理」按钮（扫描态已作废，需重新预览）
    expect(screen.queryByTestId('legacy-demote')).toBeNull();
  });

  it('取消确认：不执行任何改写', async () => {
    const { demoteFn } = mockHost();
    render(<LegacyLedgerCard enabled />);
    await waitFor(() => expect(screen.getByTestId('legacy-demote')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('legacy-demote'));
    fireEvent.click(screen.getByTestId('legacy-demote-no'));
    expect(screen.queryByTestId('legacy-confirm')).toBeNull();
    expect(demoteFn).not.toHaveBeenCalled();
  });

  it('账本干净（hits=0）：显示干净态，不给清理按钮', async () => {
    mockHost({ ok: true, scan: { scanned: 30, hits: 0, missing_l1: 0, by_layer: {} } });
    render(<LegacyLedgerCard enabled />);
    await waitFor(() => expect(screen.getByTestId('legacy-clean')).toBeInTheDocument());
    expect(screen.queryByTestId('legacy-demote')).toBeNull();
  });

  it('主进程拒绝（越权/备份失败）：原样显示真实原因，绝不显示成功回执', async () => {
    mockHost({ ok: true, scan: SCAN }, { ok: false, error: '需要管理员权限（主进程校验）' });
    render(<LegacyLedgerCard enabled />);
    await waitFor(() => expect(screen.getByTestId('legacy-demote')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('legacy-demote'));
    fireEvent.click(screen.getByTestId('legacy-demote-yes'));
    await waitFor(() => expect(screen.getByTestId('legacy-error')).toHaveTextContent('需要管理员权限'));
    expect(screen.queryByTestId('legacy-report')).toBeNull();
    // 拒绝后确认条仍在，允许管理员修正后重试
    expect(screen.getByTestId('legacy-confirm')).toBeInTheDocument();
  });

  it('IPC 抛错：显示抛错原因，不假装账本干净', async () => {
    mockHost(Promise.reject(new Error('主进程未注册 legacy:scan')));
    render(<LegacyLedgerCard enabled />);
    await waitFor(() => expect(screen.getByTestId('legacy-error')).toHaveTextContent('主进程未注册 legacy:scan'));
    expect(screen.queryByTestId('legacy-clean')).toBeNull();
  });
});
