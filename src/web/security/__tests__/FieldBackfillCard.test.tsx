// 批次41-T：安全页「存量字段回填卡」单测（会话只读预览 → 管理员执行 → 主进程回填 → 真实回执）。
// 口径：只调真实 IPC（ledger:fieldsPreview / ledger:fieldsBackfill），浏览器环境诚实不可用，
// 非管理员不给入口，无可补行不给点执行，失败原因原样展示；补不出的行只计数、绝不显示成「已全部补齐」。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 's_test',
  useSessionContext: () => ({ sid: 's_test', context: { role: 'admin' }, role: 'admin' as const, loading: false }),
  fetchSessionContext: async () => null,
}));

import { FieldBackfillCard } from '../FieldBackfillCard.tsx';
import type { BackfillPreview, BackfillReport } from '../../../core/memagent/fieldBackfill.ts';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

const PREVIEW: BackfillPreview = {
  total: 1532, tombstones: 0, missing_sha256: 533, missing_embedding: 1,
  fillable_rows: 533, protected_rows: 1, unfillable_sha256: 0, unfillable_embedding: 0,
  already_complete: 999, by_layer: { L1: 533 },
  sample: [
    {
      mem_id: 'mem_h1', layer: 'L1', need_sha256: true, need_embedding: false,
      fill_sha256: true, fill_embedding: false, protected: false,
      sha_matches_content: null, codes: [],
    },
    {
      mem_id: 'mem_h2', layer: 'L1', need_sha256: true, need_embedding: true,
      fill_sha256: true, fill_embedding: true, protected: true,
      sha_matches_content: null, codes: [],
    },
  ],
};
const REPORT: BackfillReport = {
  ...PREVIEW, sha256_filled: 533, embedding_filled: 1, indexed: 1, failed: 0, failed_ids: [],
};

/** 装上桌面壳：window.api.ledgerFields.{preview,run} */
function mockHost(opts: { preview?: unknown; run?: unknown } = {}) {
  w.__ELECTRON__ = true;
  const previewFn = vi.fn(() => Promise.resolve(opts.preview ?? { ok: true, preview: PREVIEW }));
  const runFn = vi.fn(() =>
    Promise.resolve(opts.run ?? { ok: true, report: REPORT, backup_dir: 'D:\\backups\\field-backfill-x' }),
  );
  w.api = { ledgerFields: { preview: previewFn, run: runFn } };
  return { previewFn, runFn };
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

describe('FieldBackfillCard（批次41-T 存量字段回填）', () => {
  it('浏览器环境（无桌面壳）：如实说明不可用，不给执行入口', () => {
    render(<FieldBackfillCard enabled />);
    expect(screen.getByTestId('fields-backfill-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('fields-backfill-run')).toBeNull();
    expect(screen.queryByTestId('fields-backfill-preview-report')).toBeNull();
  });

  it('非管理员：只给「需管理员」说明，不起预览（真实校验仍在主进程）', () => {
    const { previewFn } = mockHost();
    render(<FieldBackfillCard enabled={false} />);
    expect(screen.getByTestId('fields-backfill-need-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('fields-backfill-run')).toBeNull();
    expect(previewFn).not.toHaveBeenCalled();
  });

  it('管理员挂载即只读预览：缺口按字段分列、可补行数与层级分布都按主进程真值展示', async () => {
    const { previewFn } = mockHost();
    render(<FieldBackfillCard enabled />);
    await waitFor(() => expect(previewFn).toHaveBeenCalledTimes(1));
    const box = screen.getByTestId('fields-backfill-preview-report');
    expect(box).toHaveTextContent('1532');
    expect(box).toHaveTextContent('缺 sha256 533 条');
    expect(box).toHaveTextContent('缺 embedding 1 条');
    expect(box).toHaveTextContent('本轮会写盘 533 条');
    expect(box).toHaveTextContent('含 pinned/locked 1 条');
    expect(box).toHaveTextContent('L1 × 533');
    // 本通道不删行、不改正文 → 卡面必须明写「没有逐字口令」这条区别
    expect(screen.getByTestId('fields-backfill-confirm')).toHaveTextContent('不删行、不改正文');
  });

  it('样本行只报字段缺口：正文一个字不上屏，受保护行单独标注', async () => {
    mockHost();
    render(<FieldBackfillCard enabled />);
    await waitFor(() => expect(screen.getByTestId('fields-backfill-sample')).toBeInTheDocument());
    const sample = screen.getByTestId('fields-backfill-sample');
    expect(sample).toHaveTextContent('mem_h1');
    expect(sample).toHaveTextContent('缺 sha256');
    expect(sample).toHaveTextContent('受保护');
    // 缺口里出现的是字段名与层名，不是任何正文内容
    expect(sample.textContent).not.toMatch(/SolidWorks|需求|正文内容/);
  });

  it('执行走 ledger:fieldsBackfill：回执按主进程真值显示补了多少、进了多少索引、备份在哪', async () => {
    const { runFn } = mockHost();
    render(<FieldBackfillCard enabled />);
    await waitFor(() => expect(screen.getByTestId('fields-backfill-run')).toBeEnabled());
    fireEvent.click(screen.getByTestId('fields-backfill-run'));
    await waitFor(() => expect(runFn).toHaveBeenCalledTimes(1));
    const report = screen.getByTestId('fields-backfill-report');
    expect(report).toHaveTextContent('已补 sha256 533 条');
    expect(report).toHaveTextContent('已补 embedding 1 条');
    expect(report).toHaveTextContent('进向量索引 1 条');
    expect(report).toHaveTextContent('field-backfill-x');
    expect(report).toHaveTextContent('op=field_backfill');
  });

  it('无可补行（fillable_rows=0）：给「保持原样」的诚实结论，不给执行按钮', async () => {
    mockHost({ preview: { ok: true, preview: { ...PREVIEW, fillable_rows: 0, sample: [], by_layer: {} } } });
    render(<FieldBackfillCard enabled />);
    await waitFor(() => expect(screen.getByTestId('fields-backfill-clean')).toBeInTheDocument());
    expect(screen.getByTestId('fields-backfill-clean')).toHaveTextContent('补不出的行');
    expect(screen.queryByTestId('fields-backfill-run')).toBeNull();
    expect(screen.queryByTestId('fields-backfill-confirm')).toBeNull();
  });

  it('主进程拒绝（非管理员 / 备份失败）：原样显示原因，绝不显示成功回执', async () => {
    mockHost({ run: { ok: false, error: '回填前备份失败：数据目录不可写' } });
    render(<FieldBackfillCard enabled />);
    await waitFor(() => expect(screen.getByTestId('fields-backfill-run')).toBeEnabled());
    fireEvent.click(screen.getByTestId('fields-backfill-run'));
    await waitFor(() => expect(screen.getByTestId('fields-backfill-error')).toHaveTextContent('回填前备份失败'));
    expect(screen.queryByTestId('fields-backfill-report')).toBeNull();
  });

  it('IPC 抛错（通道未注册）：错误原因原样上屏', async () => {
    mockHost({ preview: Promise.reject(new Error('主进程未注册 ledger:fieldsPreview')) });
    render(<FieldBackfillCard enabled />);
    await waitFor(() => expect(screen.getByTestId('fields-backfill-error')).toHaveTextContent('主进程未注册 ledger:fieldsPreview'));
    expect(screen.queryByTestId('fields-backfill-preview-report')).toBeNull();
  });
});
