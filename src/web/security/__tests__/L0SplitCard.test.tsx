// 批次37-C：安全页「L0 存量拆分迁移卡」单测。
// 口径：只调真实 IPC（l0:splitPreview / l0:splitRun + l0:status 取写密钥态），浏览器环境诚实不可用，
// 非管理员不给入口；有明文却没解锁写密钥时不给点执行（绝不把明文当 L0 存）；口令不逐字不给点执行；
// 主进程拒绝/抛错原样展示，绝不显示成功回执；断链与孤儿必须如实点名，不粉饰成「已拆干净」。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 's_test',
  useSessionContext: () => ({ sid: 's_test', context: { role: 'admin' }, role: 'admin' as const, loading: false }),
  fetchSessionContext: async () => null,
}));

import { L0SplitCard } from '../L0SplitCard.tsx';
import type { SplitPreview, SplitReport } from '../../../core/memagent/l0Split.ts';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

const PREVIEW: SplitPreview = {
  total: 1642, tombstones: 0, plaintext_orig: 1641, on_row_cipher: 0,
  on_row_cipher_v: { v2: 0, legacy_v1: 0 }, invalid_envelope: 1, already_split: 0,
  to_move: 1641, l0_count: 0, l0_bytes: 0, orphan_blobs: 0, broken_links: 0,
  broken_link_ids: [], sample_ids: ['mem_p1', 'mem_p2'],
};
const REPORT: SplitReport = {
  ...PREVIEW, plaintext_orig: 0, already_split: 1641, to_move: 0,
  l0_count: 1641, l0_bytes: 5_800_000,
  moved: 1641, sealed_from_plaintext: 1641, cipher_moved: 0, failed: 0, failed_ids: [],
};

/** 装上桌面壳：window.api.l0.{splitPreview,splitRun,status} */
function mockHost(opts: { preview?: unknown; run?: unknown; writeUnlocked?: boolean } = {}) {
  w.__ELECTRON__ = true;
  const splitPreview = vi.fn(() => Promise.resolve(opts.preview ?? { ok: true, preview: PREVIEW }));
  const splitRun = vi.fn(() => Promise.resolve(opts.run ?? {
    ok: true, report: REPORT, backup_dir: 'D:\\backups\\l0-split-x',
  }));
  const status = vi.fn(() => Promise.resolve({ ok: true, has_admin_wrap: true, write_unlocked: opts.writeUnlocked ?? true }));
  w.api = { l0: { splitPreview, splitRun, status } };
  return { splitPreview, splitRun, status };
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

describe('L0SplitCard（批次37-C 存量拆分迁移）', () => {
  it('浏览器环境（无桌面壳）：如实说明不可用，不给执行入口', () => {
    render(<L0SplitCard enabled />);
    expect(screen.getByTestId('l0-split-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('l0-split-run')).toBeNull();
    expect(screen.queryByTestId('l0-split-preview-report')).toBeNull();
  });

  it('非管理员：只给「需管理员」说明，不起预览（真实校验仍在主进程）', () => {
    const { splitPreview } = mockHost();
    render(<L0SplitCard enabled={false} />);
    expect(screen.getByTestId('l0-split-need-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('l0-split-run')).toBeNull();
    expect(splitPreview).not.toHaveBeenCalled();
  });

  it('管理员挂载即只读预览：两个库文件各有什么、本轮搬多少按主进程真值展示', async () => {
    const { splitPreview } = mockHost();
    render(<L0SplitCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-split-preview-report')).toBeInTheDocument());
    expect(splitPreview).toHaveBeenCalledWith('s_test');
    const text = screen.getByTestId('l0-split-preview-report').textContent ?? '';
    expect(text).toContain('1642');
    expect(text).toContain('1641');
    expect(text).toContain('本轮搬入 L0 原数据库 1641 条');
    expect(text).toContain('0 条 / 0.0 KB');
    expect(text).toContain('mem_p1');
  });

  it('有明文行但 L0 写密钥未解锁：点名提示需解锁，按钮禁用，绝不偷跑（也不把明文塞进 L0 库）', async () => {
    const { splitRun } = mockHost({ writeUnlocked: false });
    render(<L0SplitCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-split-confirm')).toBeInTheDocument());
    expect(screen.getByTestId('l0-split-need-write-key')).toHaveTextContent('请先在上方解锁 L0 写密钥');
    fireEvent.change(screen.getByTestId('l0-split-word'), { target: { value: 'SPLIT' } });
    expect(screen.getByTestId('l0-split-run')).toBeDisabled();
    fireEvent.click(screen.getByTestId('l0-split-run'));
    expect(splitRun).not.toHaveBeenCalled();
  });

  it('确认口令门禁：没逐字输入 SPLIT 时按钮禁用', async () => {
    const { splitRun } = mockHost();
    render(<L0SplitCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-split-run')).toBeInTheDocument());
    expect(screen.getByTestId('l0-split-run')).toBeDisabled();
    fireEvent.click(screen.getByTestId('l0-split-run'));
    expect(splitRun).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('l0-split-word'), { target: { value: 'split' } });
    await waitFor(() => expect(screen.getByTestId('l0-split-run')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('l0-split-run'));
    await waitFor(() => expect(splitRun).toHaveBeenCalledWith('split', 's_test'));
  });

  it('执行成功：回显真实搬运数、搬后两库现状与备份路径，并写明两类审计留痕', async () => {
    const { splitRun } = mockHost();
    render(<L0SplitCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-split-run')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-split-word'), { target: { value: 'SPLIT' } });
    fireEvent.click(screen.getByTestId('l0-split-run'));
    await waitFor(() => expect(screen.getByTestId('l0-split-report')).toBeInTheDocument());
    expect(splitRun).toHaveBeenCalledWith('SPLIT', 's_test');
    const text = screen.getByTestId('l0-split-report').textContent ?? '';
    expect(text).toContain('已搬走 1641');
    expect(text).toContain('明文封存 1641');
    expect(text).toContain('失败 0');
    expect(text).toContain('明文 0 条');
    expect(text).toContain('5664.1 KB');
    expect(text).toContain('D:\\backups\\l0-split-x');
    expect(text).toContain('l0_split');
  });

  it('行上只有遗留信封（无需写密钥）：照常可执行，不误报「需解锁」', async () => {
    mockHost({
      preview: {
        ok: true,
        preview: {
          ...PREVIEW, plaintext_orig: 0, on_row_cipher: 3, invalid_envelope: 0,
          on_row_cipher_v: { v2: 1, legacy_v1: 2 }, to_move: 3,
        },
      },
      writeUnlocked: false,
    });
    render(<L0SplitCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-split-run')).toBeInTheDocument());
    expect(screen.queryByTestId('l0-split-need-write-key')).toBeNull();
    const text = screen.getByTestId('l0-split-preview-report').textContent ?? '';
    expect(text).toContain('v2 1 · 遗留 v1 2');
    fireEvent.change(screen.getByTestId('l0-split-word'), { target: { value: 'SPLIT' } });
    expect(screen.getByTestId('l0-split-run')).not.toBeDisabled();
  });

  it('主进程拒绝（备份失败/口令不符/未解锁）：原样显示真实原因，绝不显示成功回执', async () => {
    const { splitRun } = mockHost({ run: { ok: false, error: '拆分前备份失败：EPERM' } });
    render(<L0SplitCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-split-run')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-split-word'), { target: { value: 'SPLIT' } });
    fireEvent.click(screen.getByTestId('l0-split-run'));
    await waitFor(() => expect(screen.getByTestId('l0-split-error')).toHaveTextContent('拆分前备份失败：EPERM'));
    expect(screen.queryByTestId('l0-split-report')).toBeNull();
    expect(splitRun).toHaveBeenCalledTimes(1);
  });

  it('库已拆干净（本轮无搬运）：显示干净态，不给执行按钮', async () => {
    mockHost({ preview: { ok: true, preview: { ...PREVIEW, plaintext_orig: 0, on_row_cipher: 0, invalid_envelope: 0, to_move: 0, already_split: 1642, sample_ids: [] } } });
    render(<L0SplitCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-split-clean')).toBeInTheDocument());
    expect(screen.queryByTestId('l0-split-run')).toBeNull();
  });

  it('断链如实点名：报出行数与样本 id，不粉饰成「已拆干净」', async () => {
    mockHost({
      preview: {
        ok: true,
        preview: {
          ...PREVIEW, plaintext_orig: 0, on_row_cipher: 0, invalid_envelope: 0, to_move: 0,
          already_split: 1642, broken_links: 2, broken_link_ids: ['mem_bad1', 'mem_bad2'], sample_ids: [],
        },
      },
    });
    render(<L0SplitCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-split-preview-report')).toBeInTheDocument());
    expect(screen.getByTestId('l0-split-preview-report')).toHaveTextContent('断链 2 条');
    expect(screen.getByTestId('l0-split-preview-report')).toHaveTextContent('mem_bad1');
    await waitFor(() => expect(screen.getByTestId('l0-split-clean')).toHaveTextContent('但仍有断链行'));
  });

  it('IPC 抛错：显示抛错原因，不假装库为空或干净', async () => {
    mockHost({ preview: Promise.reject(new Error('主进程未注册 l0:splitPreview')) });
    render(<L0SplitCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-split-error')).toHaveTextContent('主进程未注册 l0:splitPreview'));
    expect(screen.queryByTestId('l0-split-clean')).toBeNull();
    expect(screen.queryByTestId('l0-split-preview-report')).toBeNull();
  });
});
