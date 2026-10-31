// 列表分页纯函数（批次24）：记忆库 / 日志记录 / 审计日志共用同一口径。
// 约定：页码 1-based，越界自动 clamp（>末页回末页，<1 回第 1 页）；pageSize 至少 1；空列表 totalPages=1。
export interface PageParams {
  page: number;
  pageSize: number;
}

export interface Paged<T> {
  items: T[];
  /** 过滤后总条数 */
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
}

/** 预设每页条数（用户口径：默认 10 条） */
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;

export function paginate<T>(items: readonly T[], p: PageParams): Paged<T> {
  const total = items.length;
  const rawSize = Math.floor(p.pageSize);
  const pageSize = Number.isFinite(rawSize) && rawSize >= 1 ? rawSize : 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rawPage = Math.floor(p.page);
  const page = Math.min(Math.max(1, Number.isFinite(rawPage) ? rawPage : 1), totalPages);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, totalPages, page, pageSize };
}
