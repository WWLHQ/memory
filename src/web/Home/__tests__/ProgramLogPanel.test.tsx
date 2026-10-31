// 批次17：程序运行日志窗口（批次19 起渲染于日志记录页；批次24 起人话化 + 可上下滚动的 50 条窗口）。
// 覆盖：真实尾读 actions.log / 人话与原文两种视图 / 滚动窗口全量渲染 / 错误反馈提示 / 诚实不可用。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ProgramLogPanel } from '../ProgramLogPanel.tsx';
import type { ActionLogTailResult } from '../../../shared/actionLog.ts';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

const LINE = (i: number, level = 'info') =>
  `[2026-10-30T16:00:0${i}.000Z] [${level}] [ui:step${i}] {"i":${i}}`;

function mockTail(result: ActionLogTailResult | (() => ActionLogTailResult)) {
  w.__ELECTRON__ = true;
  const tail = vi.fn(() => Promise.resolve(typeof result === 'function' ? result() : result));
  w.api = { log: { tail } };
  return tail;
}

beforeEach(() => {
  delete w.__ELECTRON__;
  delete w.api;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});

afterEach(() => {
  delete w.__ELECTRON__;
  delete w.api;
  vi.restoreAllMocks();
});

describe('ProgramLogPanel', () => {
  it('无桌面壳能力：明确提示不可用，不调用尾读、不伪造日志', () => {
    render(<ProgramLogPanel pollMs={0} />);
    expect(screen.getByTestId('program-log')).toBeInTheDocument();
    expect(screen.getByText(/非桌面壳环境：无法读取本机程序日志/)).toBeInTheDocument();
    expect(screen.queryByTestId('program-log-line')).toBeNull();
  });

  it('默认人话视图：窗口内全部行都渲染（可上下回看），error 高亮并出现反馈提示', async () => {
    const tail = mockTail({
      ok: true,
      path: 'C:\\data\\actions.log',
      lines: Array.from({ length: 7 }, (_, i) => LINE(i, i === 5 ? 'error' : 'info')),
    });
    render(<ProgramLogPanel pollMs={0} />);

    await waitFor(() => expect(screen.getAllByTestId('program-log-line')).toHaveLength(7));
    // 不再截断成 5 行：最早的 step0 也在滚动区内可回看
    expect(screen.getByText('界面操作：step0')).toBeInTheDocument();
    expect(screen.getByText('界面操作：step5')).toBeInTheDocument();
    expect(tail).toHaveBeenCalledWith(50);
    // 北京时间 00:00:05（UTC+8）
    expect(screen.getByText('00:00:05')).toBeInTheDocument();
    // 中文说明同时保留原始 scope:action，便于反馈维护者
    expect(screen.getByText('ui:step5')).toBeInTheDocument();
    expect(screen.getByTestId('program-log-feedback').textContent).toContain('7 条程序日志中有 1 条错误');
    expect(screen.getByTitle('C:\\data\\actions.log')).toBeInTheDocument();
    expect(screen.getByTestId('pl-mode-human')).toHaveAttribute('aria-pressed', 'true');
  });

  it('切到原文视图：显示原始 scope:action 与未加工的 detail 正文', async () => {
    mockTail({ ok: true, path: 'C:\\data\\actions.log', lines: [LINE(1)] });
    render(<ProgramLogPanel pollMs={0} />);
    await waitFor(() => expect(screen.getAllByTestId('program-log-line')).toHaveLength(1));
    expect(screen.getByText('界面操作：step1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pl-mode-raw'));
    expect(screen.queryByText('界面操作：step1')).toBeNull();
    expect(screen.getByText('ui:step1')).toBeInTheDocument();
    expect(screen.getByText('{"i":1}')).toBeInTheDocument();
    expect(screen.getByTestId('pl-mode-raw')).toHaveAttribute('aria-pressed', 'true');
  });

  it('空日志：显示真实空态，不显示反馈提示', async () => {
    mockTail({ ok: true, path: 'C:\\data\\actions.log', lines: [] });
    render(<ProgramLogPanel pollMs={0} />);
    await waitFor(() => expect(screen.getByText(/暂无程序日志/)).toBeInTheDocument());
    expect(screen.queryByTestId('program-log-feedback')).toBeNull();
  });

  it('尾读失败：显示真实原因，不显示旧日志', async () => {
    mockTail({ ok: false, path: null, lines: [], error: '程序日志尚未初始化（数据根未就绪）' });
    render(<ProgramLogPanel pollMs={0} />);
    await waitFor(() => expect(screen.getByText(/读取失败：程序日志尚未初始化/)).toBeInTheDocument());
    expect(screen.queryByTestId('program-log-line')).toBeNull();
  });

  it('刷新按钮重新尾读并更新行', async () => {
    let n = 1;
    const tail = mockTail(() => ({
      ok: true,
      path: 'C:\\data\\actions.log',
      lines: Array.from({ length: n }, (_, i) => LINE(i)),
    }));
    render(<ProgramLogPanel pollMs={0} />);
    await waitFor(() => expect(screen.getAllByTestId('program-log-line')).toHaveLength(1));

    n = 3;
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(screen.getAllByTestId('program-log-line')).toHaveLength(3));
    expect(tail).toHaveBeenCalledTimes(2);
  });

  it('复制诊断信息：包含路径与原始日志；按钮反馈已复制', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mockTail({
      ok: true,
      path: 'C:\\data\\actions.log',
      lines: [LINE(1, 'error'), LINE(2)],
    });
    render(<ProgramLogPanel pollMs={0} />);

    await waitFor(() => expect(screen.getByTestId('program-log-feedback')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '📋 复制诊断信息' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '✅ 已复制' })).toBeInTheDocument());
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('MultiAgent Memory 程序诊断信息');
    expect(text).toContain('日志文件: C:\\data\\actions.log');
    expect(text).toContain('[ui:step1]');
  });
});
