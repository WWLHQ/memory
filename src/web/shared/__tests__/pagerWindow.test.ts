// v5 pager 数字窗口（批次 B）单测：首尾常驻、当前 ±1 常驻、缺口 '…'、小页数平铺、越界钳制。
import { describe, it, expect } from 'vitest';
import { pagerWindow } from '../pagerWindow.ts';

describe('pagerWindow（v5 表底紧凑分页窗口）', () => {
  it('小页数（≤7）：全部平铺，无省略号', () => {
    expect(pagerWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pagerWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('单页：返回 [1]', () => {
    expect(pagerWindow(1, 1)).toEqual([1]);
  });

  it('大页数中间：首尾常驻 + 当前 ±1，两侧缺口', () => {
    expect(pagerWindow(50, 257)).toEqual([1, '…', 49, 50, 51, '…', 257]);
  });

  it('贴近首页：首页与当前窗口连成一片，只在尾部留缺口', () => {
    expect(pagerWindow(1, 257)).toEqual([1, 2, '…', 257]);
    expect(pagerWindow(2, 257)).toEqual([1, 2, 3, '…', 257]);
  });

  it('贴近尾页：对称地在头部留缺口', () => {
    expect(pagerWindow(257, 257)).toEqual([1, '…', 256, 257]);
    expect(pagerWindow(256, 257)).toEqual([1, '…', 255, 256, 257]);
  });

  it('越界钳制：page 超界按边界页计算', () => {
    expect(pagerWindow(999, 10)).toEqual([1, '…', 9, 10]);
    expect(pagerWindow(0, 10)).toEqual([1, 2, '…', 10]);
  });

  it('totalPages 为 0 时钳制为单页 [1]（不出负窗口）', () => {
    expect(pagerWindow(1, 0)).toEqual([1]);
  });
});
