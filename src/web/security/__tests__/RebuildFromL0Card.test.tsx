// 批次37-E：安全页「按 L0 重建 L1–L6 卡」单测。
// 口径：只调真实 IPC（l0:rebuildPreview / l0:rebuildRun + l0:unlock / l0:lock），浏览器环境诚实不可用，
// 非管理员不给入口；密文未解锁（view_locked）时绝不给点执行——主进程本来也在备份前拒绝，页面不假装能动；
// 不勾 LLM 时必须把「L2–L6 会被清空」如实讲出来；口令不逐字不给点执行；主进程拒绝/抛错原样展示，
// 绝不显示成功回执；样本只记 id/处置/原因码/原文来源，正文一个字都不铺回页面。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 's_test',
  useSessionContext: () => ({ sid: 's_test', context: { role: 'admin' }, role: 'admin' as const, loading: false }),
  fetchSessionContext: async () => null,
}));

import { RebuildFromL0Card } from '../RebuildFromL0Card.tsx';
import type { RebuildPreview, RebuildReport } from '../../../core/memagent/rebuild.ts';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

const PREVIEW: RebuildPreview = {
  gate_version: 2, total: 1642, tombstones: 0,
  rebuild: 1585, rebuild_l1_changed: 42, rebuild_deep_cleared: 986,
  purge: 57, protected_total: 3,
  unavailable: 0, by_unavailable: {},
  by_code: { narration: 36, thin: 17, identity: 3, capability_list: 1 },
  by_layer: { L1: 57 },
  sample: [
    { mem_id: 'mem_b1', layer: 'L1', category: 'note', action: 'purge', code: 'narration', reason: '助手过程旁白/进度自述，无可用信息', source: 'row_plaintext', protected: false, l1_changed: false, has_deep: false },
    { mem_id: 'mem_b2', layer: 'L4', category: 'note', action: 'rebuild', reason: '新 L1 与现有 L1 不一致', source: 'l0_store', protected: false, l1_changed: true, has_deep: true },
  ],
  llm_available: false,
};
const REPORT: RebuildReport = {
  ...PREVIEW,
  rebuilt: 1585, rebuilt_l1_changed: 42, purged: 57,
  skipped_protected: 3, skipped_unavailable: 0,
  deep_cleared: 986, deep_generated: 0, llm_calls: 0, refine_failed: 0,
  failed: 0, failed_ids: [],
};
/** 密文未解锁：绝大多数行判 view_locked，本轮一行都不能动 */
const LOCKED: RebuildPreview = {
  ...PREVIEW, rebuild: 1, rebuild_l1_changed: 0, rebuild_deep_cleared: 0, purge: 0,
  unavailable: 1641, by_unavailable: { view_locked: 1641 }, by_code: {}, by_layer: {}, sample: [],
};

/** 装上桌面壳：window.api.l0.{rebuildPreview,rebuildRun,unlock,lock} */
function mockHost(opts: {
  previews?: unknown[]; run?: unknown; unlock?: unknown;
} = {}) {
  w.__ELECTRON__ = true;
  const queue = opts.previews ?? [{ ok: true, llm_ready: false, preview: PREVIEW }];
  const rebuildPreview = vi.fn(() => Promise.resolve(queue.length > 1 ? queue.shift() : queue[0]));
  const rebuildRun = vi.fn(() => Promise.resolve(opts.run ?? {
    ok: true, report: REPORT, backup_dir: 'D:\\backups\\l0-rebuild-x',
  }));
  const unlock = vi.fn(() => Promise.resolve(opts.unlock ?? {
    ok: true, l0_session_id: 'l0s_test', expires_at: Date.now() + 300_000, idle_timeout_ms: 300_000,
  }));
  const lock = vi.fn(() => Promise.resolve({ ok: true }));
  w.api = { l0: { rebuildPreview, rebuildRun, unlock, lock } };
  return { rebuildPreview, rebuildRun, unlock, lock };
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

describe('RebuildFromL0Card（批次37-E 按 L0 重建）', () => {
  it('浏览器环境（无桌面壳）：如实说明不可用，不给执行入口', () => {
    render(<RebuildFromL0Card enabled />);
    expect(screen.getByTestId('l0-rebuild-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('l0-rebuild-run')).toBeNull();
    expect(screen.queryByTestId('l0-rebuild-preview-report')).toBeNull();
  });

  it('非管理员：只给「需管理员」说明，不起预览（真实校验仍在主进程）', () => {
    const { rebuildPreview } = mockHost();
    render(<RebuildFromL0Card enabled={false} />);
    expect(screen.getByTestId('l0-rebuild-need-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('l0-rebuild-run')).toBeNull();
    expect(rebuildPreview).not.toHaveBeenCalled();
  });

  it('管理员挂载即预览：重炼/正文变化/应删/受保护/清空深层都按主进程真值展示', async () => {
    const { rebuildPreview } = mockHost();
    render(<RebuildFromL0Card enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-preview-report')).toBeInTheDocument());
    expect(rebuildPreview).toHaveBeenCalledWith({ l0_session_id: undefined, use_llm: false }, 's_test');
    const text = screen.getByTestId('l0-rebuild-preview-report').textContent ?? '';
    expect(text).toContain('1642');
    expect(text).toContain('按原文重炼 1585 条');
    expect(text).toContain('正文真的会变 42');
    expect(text).toContain('应删 57 条');
    expect(text).toContain('pinned/locked 受保护 3');
    expect(text).toContain('narration × 36');
    // 不勾 LLM 就必须把「深层会被清空」讲出来
    expect(screen.getByTestId('l0-rebuild-preview-report')).toHaveTextContent('986 行当前带着 L2–L6 正文，重建后会被清空');
    // 样本只给 id / 处置 / 码 / 原文来源
    const sample = screen.getByTestId('l0-rebuild-sample').textContent ?? '';
    expect(sample).toContain('mem_b1');
    expect(sample).toContain('purge · narration');
    expect(sample).toContain('原文 l0_store');
  });

  it('没有可运行引擎：LLM 复选框禁用并说明只能重建到 L1', async () => {
    mockHost();
    render(<RebuildFromL0Card enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-use-llm')).toBeInTheDocument());
    expect(screen.getByTestId('l0-rebuild-use-llm')).toBeDisabled();
    expect(screen.getByTestId('l0-rebuild-llm-note')).toHaveTextContent('只能重建到 L1');
  });

  it('原文是密文且未解锁：即使输入口令也禁止执行，并点名 view_locked 行数', async () => {
    mockHost({ previews: [{ ok: true, llm_ready: false, preview: LOCKED }] });
    render(<RebuildFromL0Card enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-run')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-rebuild-word'), { target: { value: 'REBUILD' } });
    expect(screen.getByTestId('l0-rebuild-run')).toBeDisabled();
    expect(screen.getByTestId('l0-rebuild-confirm')).toHaveTextContent('有 1641 行原文是 L0 密文');
    expect(screen.getByTestId('l0-rebuild-preview-report')).toHaveTextContent('view_locked × 1641');
  });

  it('解锁 L0 查阅会话：口令走 l0:unlock，拿到会话后自动重新预览并放行', async () => {
    const { unlock, rebuildPreview, rebuildRun } = mockHost({
      previews: [
        { ok: true, llm_ready: false, preview: LOCKED },
        { ok: true, llm_ready: false, preview: { ...LOCKED, rebuild: 1642, unavailable: 0, by_unavailable: {}, purge: 0 } },
      ],
    });
    render(<RebuildFromL0Card enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-view-unlock')).toBeInTheDocument());
    expect(screen.queryByTestId('l0-rebuild-view-on')).toBeNull();
    fireEvent.change(screen.getByTestId('l0-rebuild-view-pw'), { target: { value: 'Admin@123456' } });
    fireEvent.click(screen.getByTestId('l0-rebuild-view-unlock'));
    await waitFor(() => expect(unlock).toHaveBeenCalledWith({ password: 'Admin@123456' }, 's_test'));
    // 解锁成功后输入框整块换成「会话已解锁」，管理密码不再留在页面上
    expect(screen.queryByTestId('l0-rebuild-view-pw')).toBeNull();
    expect(screen.getByTestId('l0-rebuild-view-on')).toBeInTheDocument();
    await waitFor(() => expect(rebuildPreview).toHaveBeenLastCalledWith({ l0_session_id: 'l0s_test', use_llm: false }, 's_test'));
    fireEvent.change(screen.getByTestId('l0-rebuild-word'), { target: { value: 'REBUILD' } });
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-run')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('l0-rebuild-run'));
    await waitFor(() => expect(rebuildRun).toHaveBeenCalledWith(
      { confirm_text: 'REBUILD', l0_session_id: 'l0s_test', use_llm: false }, 's_test',
    ));
    // 主动锁上：会话交还主进程，页面态清零（密码框回来但值是空的）
    fireEvent.click(screen.getByTestId('l0-rebuild-view-lock'));
    await waitFor(() => expect(rebuildPreview).toHaveBeenLastCalledWith({ l0_session_id: undefined, use_llm: false }, 's_test'));
    expect(screen.getByTestId('l0-rebuild-view-pw')).toHaveValue('');
  });

  it('解锁失败：原样显示主进程原因，绝不假装已经能读原文', async () => {
    mockHost({
      previews: [{ ok: true, llm_ready: false, preview: LOCKED }],
      unlock: { ok: false, error: 'E_AUTH_L0: 管理密码不对（还剩 3 次机会）' },
    });
    render(<RebuildFromL0Card enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-view-unlock')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-rebuild-view-pw'), { target: { value: 'wrong-pw' } });
    fireEvent.click(screen.getByTestId('l0-rebuild-view-unlock'));
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-error')).toHaveTextContent('管理密码不对'));
    expect(screen.queryByTestId('l0-rebuild-view-on')).toBeNull();
  });

  it('确认口令门禁：没逐字输入 REBUILD 时按钮禁用，绝不偷跑覆盖', async () => {
    const { rebuildRun } = mockHost();
    render(<RebuildFromL0Card enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-run')).toBeInTheDocument());
    expect(screen.getByTestId('l0-rebuild-run')).toBeDisabled();
    fireEvent.click(screen.getByTestId('l0-rebuild-run'));
    expect(rebuildRun).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('l0-rebuild-word'), { target: { value: 'rebui' } });
    expect(screen.getByTestId('l0-rebuild-run')).toBeDisabled();
  });

  it('执行成功：回显真实重炼/删除/清空/跳过数与备份路径，并写明三类审计留痕', async () => {
    const { rebuildRun } = mockHost();
    render(<RebuildFromL0Card enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-run')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-rebuild-word'), { target: { value: 'rebuild' } });
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-run')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('l0-rebuild-run'));
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-report')).toBeInTheDocument());
    expect(rebuildRun).toHaveBeenCalledWith({ confirm_text: 'rebuild', l0_session_id: undefined, use_llm: false }, 's_test');
    const text = screen.getByTestId('l0-rebuild-report').textContent ?? '';
    expect(text).toContain('已重炼 1585');
    expect(text).toContain('已删除 57');
    expect(text).toContain('被清空 L2–L6 986');
    expect(text).toContain('受保护跳过 3');
    expect(text).toContain('写盘失败 0');
    expect(text).toContain('D:\\backups\\l0-rebuild-x');
    expect(text).toContain('l0_rebuild_row');
    expect(text).toContain('rebuild_purge');
    expect(text).toContain('layers_rebuild');
    // 回执不出现任何正文
    expect(text).not.toContain('助手过程旁白');
  });

  it('主进程拒绝（备份失败/view_locked）：原样显示真实原因，绝不显示成功回执', async () => {
    const { rebuildRun } = mockHost({ run: { ok: false, error: '重建前备份失败：EPERM' } });
    render(<RebuildFromL0Card enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-run')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-rebuild-word'), { target: { value: 'REBUILD' } });
    fireEvent.click(screen.getByTestId('l0-rebuild-run'));
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-error')).toHaveTextContent('重建前备份失败：EPERM'));
    expect(screen.queryByTestId('l0-rebuild-report')).toBeNull();
    expect(rebuildRun).toHaveBeenCalledTimes(1);
  });

  it('本轮无事可做（重炼 0 且应删 0）：显示干净态，不给执行按钮', async () => {
    mockHost({
      previews: [{
        ok: true, llm_ready: false,
        preview: { ...PREVIEW, rebuild: 0, rebuild_l1_changed: 0, rebuild_deep_cleared: 0, purge: 0, by_code: {}, by_layer: {}, sample: [] },
      }],
    });
    render(<RebuildFromL0Card enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-clean')).toBeInTheDocument());
    expect(screen.queryByTestId('l0-rebuild-run')).toBeNull();
  });

  it('IPC 抛错：显示抛错原因，不假装库为空或干净', async () => {
    mockHost({ previews: [Promise.reject(new Error('主进程未注册 l0:rebuildPreview'))] });
    render(<RebuildFromL0Card enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-rebuild-error')).toHaveTextContent('主进程未注册 l0:rebuildPreview'));
    expect(screen.queryByTestId('l0-rebuild-clean')).toBeNull();
    expect(screen.queryByTestId('l0-rebuild-preview-report')).toBeNull();
  });
});
