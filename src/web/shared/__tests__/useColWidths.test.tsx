// 批次24：表头列宽「拖一次、永久固化」单测（记忆库 / 日志记录 / 审计日志共用）。
// 覆盖：读取回退（缺项/坏 JSON/非法值）· 拖拽后落 localStorage · 重新挂载仍保持 · 恢复默认清掉固化值 · 最小宽度。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useState } from 'react';
import {
  ColResizeHandle,
  MIN_COL_WIDTH,
  loadColWidths,
  saveColWidths,
  useColWidths,
} from '../useColWidths.tsx';

const KEY = 'testColWidths';
const DEFAULTS = [100, 200, 300] as const;

/** 探针组件：把手渲染成可点击控件，宽度写进 data-* 便于断言 */
function Probe({ onWidths }: { onWidths?: (w: number[]) => void }) {
  const [tick, setTick] = useState(0);
  const { widths, startResize, reset, isDefault } = useColWidths(KEY, [...DEFAULTS]);
  onWidths?.(widths);
  return (
    <table>
      <thead>
        <tr>
          {widths.map((w, i) => (
            <th key={i} data-testid={`th-${i}`} style={{ width: w }} data-w={w}>
              h{i}
              <ColResizeHandle col={i} onCol={startResize} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colSpan={3}>
            {!isDefault && (
              <button type="button" data-testid="col-reset" onClick={() => { reset(); setTick((t) => t + 1); }}>
                恢复默认列宽 {tick}
              </button>
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

const drag = (col: number, from: number, to: number) => {
  fireEvent.mouseDown(screen.getByTestId(`col-resize-${col}`), { clientX: from });
  act(() => {
    fireEvent.mouseMove(document, { clientX: to });
    fireEvent.mouseUp(document);
  });
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadColWidths / saveColWidths', () => {
  it('无固化值：逐项回退默认宽度', () => {
    expect(loadColWidths(KEY, DEFAULTS)).toEqual([100, 200, 300]);
  });

  it('坏 JSON / 非数组：不炸，回退默认', () => {
    localStorage.setItem(KEY, '{oops');
    expect(loadColWidths(KEY, DEFAULTS)).toEqual([100, 200, 300]);
    localStorage.setItem(KEY, JSON.stringify({ 0: 500 }));
    expect(loadColWidths(KEY, DEFAULTS)).toEqual([100, 200, 300]);
  });

  it('缺项或非法项（<30 / 非数字）逐项回退，长度始终对齐默认列数', () => {
    localStorage.setItem(KEY, JSON.stringify([450, 10]));
    expect(loadColWidths(KEY, DEFAULTS)).toEqual([450, 200, 300]);
    localStorage.setItem(KEY, JSON.stringify([500, 'x', 999]));
    expect(loadColWidths(KEY, DEFAULTS)).toEqual([500, 200, 999]);
  });

  it('空数组（reset 写入）等于全部回退默认', () => {
    saveColWidths(KEY, []);
    expect(loadColWidths(KEY, DEFAULTS)).toEqual([100, 200, 300]);
  });

  it('localStorage 抛错（隐私模式/配额）不影响本次会话使用', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() => saveColWidths(KEY, [120])).not.toThrow();
    spy.mockRestore();
  });
});

describe('useColWidths（拖拽固化）', () => {
  it('拖把手改变列宽并固化；重新挂载（刷新/重登）仍保持', () => {
    render(<Probe />);
    expect(screen.getByTestId('th-1')).toHaveAttribute('data-w', '200');
    expect(screen.queryByTestId('col-reset')).toBeNull();

    drag(1, 200, 260);
    expect(screen.getByTestId('th-1')).toHaveAttribute('data-w', '260');
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual([100, 260, 300]);
    expect(screen.getByTestId('col-reset')).toBeInTheDocument();

    cleanup();
    render(<Probe />);
    expect(screen.getByTestId('th-1')).toHaveAttribute('data-w', '260');
  });

  it('往窄拖过最小值：夹在 MIN_COL_WIDTH，绝不留 0 宽列', () => {
    render(<Probe />);
    drag(0, 100, -900);
    expect(screen.getByTestId('th-0')).toHaveAttribute('data-w', String(MIN_COL_WIDTH));
    expect(loadColWidths(KEY, DEFAULTS)[0]).toBe(MIN_COL_WIDTH);
  });

  it('恢复默认列宽：清掉固化值，界面回到默认', () => {
    render(<Probe />);
    drag(2, 300, 500);
    expect(screen.getByTestId('th-2')).toHaveAttribute('data-w', '500');

    fireEvent.click(screen.getByTestId('col-reset'));
    expect(screen.getByTestId('th-2')).toHaveAttribute('data-w', '300');
    expect(localStorage.getItem(KEY)).toBe('[]');
    expect(screen.queryByTestId('col-reset')).toBeNull();
  });

  it('拖拽中只改目标列，其它列宽度不受影响', () => {
    const seen: number[][] = [];
    render(<Probe onWidths={(w) => seen.push(w)} />);
    drag(0, 100, 180);
    const last = seen[seen.length - 1];
    expect(last).toEqual([180, 200, 300]);
  });
});
