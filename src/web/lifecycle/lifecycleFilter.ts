// 生命周期页（REQ-006 / P4）· 分页纯逻辑
// 分页口径单一真源在 shared/paginate（记忆库/日志/审计/层级共用）；此处只做类型转发与默认值。
// 默认每页 5 条（用户要求）。无过滤（生命周期页暂不做过滤栏，仅分页）。
import type { PageParams, Paged } from '../shared/paginate.ts';
import { paginate } from '../shared/paginate.ts';

/** 默认每页条数（用户要求 5） */
export const LIFECYCLE_DEFAULT_PAGE_SIZE = 5;
/** 可选每页条数（与记忆库管理页 PAGE_SIZES 口径一致，默认选 5） */
export const LIFECYCLE_PAGE_SIZES = [5, 10, 20, 50] as const;
export type LifecyclePageSize = (typeof LIFECYCLE_PAGE_SIZES)[number];

export type { PageParams as LifecyclePageParams, Paged as LifecyclePaged };

/** 分页（纯函数，不改原数组；page 越界自动 clamp 回末页 / 第 1 页） */
export function pagedList<T>(list: readonly T[], p: PageParams): Paged<T> {
  return paginate(list, p);
}
