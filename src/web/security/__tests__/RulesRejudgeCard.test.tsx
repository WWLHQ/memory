// 批次36-C：安全页「规则重判存量卡」单测（管理员只读预览 → 逐字口令 REJUDGE → 主进程重判 → 真实回执）。
// 口径：只调真实 IPC（rules:rejudgePreview / rules:rejudgeRun），浏览器环境诚实不可用，
// 非管理员不给入口，口令不符不给点执行，失败原样展示；受保护行与缺 L1 行必须如实计数，绝不显示成功回执。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 's_test',
  useSessionContext: () => ({ sid: 's_test', context: { role: 'admin' }, role: 'admin' as const, loading: false }),
  fetchSessionContext: async () => null,
}));

import { RulesRejudgeCard } from '../RulesRejudgeCard.tsx';
import type { RejudgePreview, RejudgeReport } from '../../../core/memagent/rejudge.ts';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

const PREVIEW: RejudgePreview = {
  gate_version: 2, total: 1642, tombstones: 0, missing_l1: 1,
  purge: 57, purge_protected: 2, with_l0_cipher: 55, keep_restamp: 1584, keep_unchanged: 0,
  by_code: { narration: 36, thin: 17, identity: 3, capability_list: 1 },
  by_layer: { L1: 57 },
  by_row_gate_version: { v1: 1642 },
  sample: [
    { mem_id: 'mem_a1', layer: 'L1', action: 'purge', code: 'narration', reason: '助手过程旁白/进度自述，无可用信息', row_gate_v: 1, protected: false },
    { mem_id: 'mem_a2', layer: 'L1', action: 'purge', code: 'identity', reason: '助手身份自述段，无可用信息', row_gate_v: 1, protected: true },
  ],
};
const REPORT: RejudgeReport = {
  ...PREVIEW, purge: 57, purge_protected: 2, with_l0_cipher: 55,
  purged: 55, restamped: 1584, skipped_protected: 2, skipped_no_l1: 1, failed: 0, failed_ids: [],
};

/** 装上桌面壳：window.api.rulesRejudge.{preview,run} */
function mockHost(opts: { preview?: unknown; run?: unknown } = {}) {
  w.__ELECTRON__ = true;
  const previewFn = vi.fn(() => Promise.resolve(opts.preview ?? { ok: true, preview: PREVIEW }));
  const runFn = vi.fn(() => Promise.resolve(opts.run ?? {
    ok: true, report: REPORT, backup_dir: 'D:\\backups\\rules-rejudge-x',
  }));
  w.api = { rulesRejudge: { preview: previewFn, run: runFn } };
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

describe('RulesRejudgeCard（批次36-C 存量重判）', () => {
  it('浏览器环境（无桌面壳）：如实说明不可用，并指路命令行只读回放', () => {
    render(<RulesRejudgeCard enabled />);
    expect(screen.getByTestId('rules-rejudge-unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('rules-rejudge-unavailable')).toHaveTextContent('npm run rejudge');
    expect(screen.queryByTestId('rules-rejudge-run')).toBeNull();
    expect(screen.queryByTestId('rules-rejudge-preview-report')).toBeNull();
  });

  it('非管理员：只给「需管理员」说明，不起预览（真实校验仍在主进程）', () => {
    const { previewFn } = mockHost();
    render(<RulesRejudgeCard enabled={false} />);
    expect(screen.getByTestId('rules-rejudge-need-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('rules-rejudge-run')).toBeNull();
    expect(previewFn).not.toHaveBeenCalled();
  });

  it('管理员挂载即只读预览：总数/应删/受保护/码分布/行戳都按主进程真值展示', async () => {
    const { previewFn } = mockHost();
    render(<RulesRejudgeCard enabled />);
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-preview-report')).toBeInTheDocument());
    expect(previewFn).toHaveBeenCalledWith('s_test');
    const text = screen.getByTestId('rules-rejudge-preview-report').textContent ?? '';
    expect(text).toContain('1642');
    expect(text).toContain('应删 57 条');
    expect(text).toContain('2 条 pinned/locked 受保护');
    expect(text).toContain('重盖版本戳 1584');
    expect(text).toContain('narration × 36');
    expect(text).toContain('v1 × 1642');
    // 样本只给 id + 码 + 原因，不把整段正文铺回页面
    const sample = screen.getByTestId('rules-rejudge-sample').textContent ?? '';
    expect(sample).toContain('mem_a1');
    expect(sample).toContain('narration');
    expect(sample).toContain('受保护');
  });

  it('批次41-O：预览里带 L0 原文的待删行给硬警告（连带销毁 N 条 L0 原文，不能重建找回），无 L0 则不出现', async () => {
    // PREVIEW.with_l0_cipher=55 → 硬警告出现
    mockHost();
    const { unmount } = render(<RulesRejudgeCard enabled />);
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-l0-warn')).toBeInTheDocument());
    const warn = screen.getByTestId('rules-rejudge-l0-warn').textContent ?? '';
    expect(warn).toContain('55');
    expect(warn).toContain('L0 原文');
    expect(warn).toContain('备份目录');
    unmount();
    // with_l0_cipher=0 → 警告不出现
    mockHost({ preview: { ok: true, preview: { ...PREVIEW, with_l0_cipher: 0 } } });
    const { unmount: un2 } = render(<RulesRejudgeCard enabled />);
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-preview-report')).toBeInTheDocument());
    expect(screen.queryByTestId('rules-rejudge-l0-warn')).toBeNull();
    un2();
  });

  it('确认口令门禁：没逐字输入 REJUDGE 时按钮禁用，绝不偷跑删除', async () => {
    const { runFn } = mockHost();
    render(<RulesRejudgeCard enabled />);
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-run')).toBeInTheDocument());
    expect(screen.getByTestId('rules-rejudge-run')).toBeDisabled();
    fireEvent.click(screen.getByTestId('rules-rejudge-run'));
    expect(runFn).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('rules-rejudge-word'), { target: { value: 'rejudge' } });
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-run')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('rules-rejudge-run'));
    await waitFor(() => expect(runFn).toHaveBeenCalledWith('rejudge', 's_test'));
  });

  it('执行成功：回显真实删除/重盖/跳过数与备份路径，并写明两类审计留痕', async () => {
    const { runFn } = mockHost();
    render(<RulesRejudgeCard enabled />);
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-run')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('rules-rejudge-word'), { target: { value: 'REJUDGE' } });
    fireEvent.click(screen.getByTestId('rules-rejudge-run'));
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-report')).toBeInTheDocument());
    expect(runFn).toHaveBeenCalledWith('REJUDGE', 's_test');
    const text = screen.getByTestId('rules-rejudge-report').textContent ?? '';
    expect(text).toContain('已删除 55');
    expect(text).toContain('受保护跳过 2');
    expect(text).toContain('缺 L1 跳过 1');
    expect(text).toContain('重盖版本戳 1584');
    expect(text).toContain('失败 0');
    expect(text).toContain('D:\\backups\\rules-rejudge-x');
    expect(text).toContain('rejudge_purge');
    expect(text).toContain('rules_rejudge');
  });

  it('主进程拒绝（备份失败/口令不符）：原样显示真实原因，绝不显示成功回执', async () => {
    const { runFn } = mockHost({ run: { ok: false, error: '重判前备份失败：EPERM' } });
    render(<RulesRejudgeCard enabled />);
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-run')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('rules-rejudge-word'), { target: { value: 'REJUDGE' } });
    fireEvent.click(screen.getByTestId('rules-rejudge-run'));
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-error')).toHaveTextContent('重判前备份失败：EPERM'));
    expect(screen.queryByTestId('rules-rejudge-report')).toBeNull();
    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it('库已按当前规则干净（应删 0 且戳已最新）：显示干净态，不给执行按钮', async () => {
    mockHost({
      preview: {
        ok: true,
        preview: { ...PREVIEW, purge: 0, purge_protected: 0, with_l0_cipher: 0, missing_l1: 0, keep_restamp: 0, keep_unchanged: 1642, by_code: {}, by_layer: {}, sample: [] },
      },
    });
    render(<RulesRejudgeCard enabled />);
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-clean')).toBeInTheDocument());
    expect(screen.queryByTestId('rules-rejudge-run')).toBeNull();
  });

  it('只剩「重盖版本戳」没有删除行时仍可执行（戳盖全才有下一版可对账）', async () => {
    mockHost({
      preview: { ok: true, preview: { ...PREVIEW, purge: 0, purge_protected: 0, by_code: {}, by_layer: {}, sample: [] } },
      run: { ok: true, report: { ...REPORT, purge: 0, purged: 0, skipped_protected: 0 }, backup_dir: 'D:\\backups\\z' },
    });
    render(<RulesRejudgeCard enabled />);
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-run')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('rules-rejudge-word'), { target: { value: 'REJUDGE' } });
    fireEvent.click(screen.getByTestId('rules-rejudge-run'));
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-report')).toBeInTheDocument());
  });

  it('IPC 抛错：显示抛错原因，不假装库为空或干净', async () => {
    mockHost({ preview: Promise.reject(new Error('主进程未注册 rules:rejudgePreview')) });
    render(<RulesRejudgeCard enabled />);
    await waitFor(() => expect(screen.getByTestId('rules-rejudge-error')).toHaveTextContent('主进程未注册 rules:rejudgePreview'));
    expect(screen.queryByTestId('rules-rejudge-clean')).toBeNull();
    expect(screen.queryByTestId('rules-rejudge-preview-report')).toBeNull();
  });
});
