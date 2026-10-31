// 批次24：三页共用分页纯函数单测（记忆库 / 日志记录 / 审计日志同一口径）。
import { describe, it, expect } from 'vitest';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, paginate } from '../paginate.ts';

const LIST = Array.from({ length: 25 }, (_, i) => i + 1);

describe('paginate', () => {
  it('默认口径：每页 10 条，预设档位 10/20/50/100', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(10);
    expect([...PAGE_SIZES]).toEqual([10, 20, 50, 100]);
    const p = paginate(LIST, { page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(p.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(p).toMatchObject({ total: 25, totalPages: 3, page: 1 });
  });

  it('中间页与末页：末页只回剩余条数', () => {
    expect(paginate(LIST, { page: 2, pageSize: 10 }).items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const last = paginate(LIST, { page: 3, pageSize: 10 });
    expect(last.items).toEqual([21, 22, 23, 24, 25]);
    expect(last.pageSize).toBe(10);
  });

  it('页码越界回夹：>末页回末页，<1 回第 1 页，非数字回第 1 页', () => {
    expect(paginate(LIST, { page: 99, pageSize: 10 }).page).toBe(3);
    expect(paginate(LIST, { page: 99, pageSize: 10 }).items[0]).toBe(21);
    expect(paginate(LIST, { page: 0, pageSize: 10 }).page).toBe(1);
    expect(paginate(LIST, { page: Number.NaN, pageSize: 10 }).page).toBe(1);
  });

  it('页大小非法回 1，绝不返回空页；换档后总页数同步', () => {
    expect(paginate(LIST, { page: 1, pageSize: 0 }).items).toEqual([1]);
    expect(paginate(LIST, { page: 1, pageSize: Number.NaN }).pageSize).toBe(1);
    expect(paginate(LIST, { page: 1, pageSize: 50 })).toMatchObject({ items: LIST, totalPages: 1 });
  });

  it('空列表：totalPages 仍为 1（界面显示「第 1 / 1 页 · 共 0 条」而不是「除以 0」）', () => {
    const p = paginate([], { page: 7, pageSize: 10 });
    expect(p).toEqual({ items: [], total: 0, totalPages: 1, page: 1, pageSize: 10 });
  });

  it('indexOffset 口径：翻页后行号连续不串位', () => {
    const p2 = paginate(LIST, { page: 2, pageSize: 10 });
    expect((p2.page - 1) * p2.pageSize).toBe(10);
    expect(p2.items[0]).toBe(11);
  });
});
