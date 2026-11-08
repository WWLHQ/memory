// 记忆层级管理页（19.11）· 每层 L0-L6 的过滤 + 分页纯逻辑
// 过滤原理与记忆管理页一致（memoryFilter.filterMemories / Paged），
// 但额外按「该层是否有内容」过滤（层级页特有语义：L2 层只列有 L2 摘要的记忆）。
// 默认每页 5 条。
import type { MemoryRecord } from './types.ts';
import { filterMemories } from './memoryFilter.ts';
import type { Paged, PageParams, MemoryFilter } from './memoryFilter.ts';
import { paginate } from '../shared/paginate.ts';

/** 每层默认每页 5 条（用户可改） */
export const LAYER_DEFAULT_PAGE_SIZE = 5;
export const LAYER_PAGE_SIZES = [5, 10, 20, 50] as const;

export interface LayerFilterState {
  search: string;
  type: string;
  status: string;
  source: string;
  /** 创建时间区间（ISO 日期，闭区间；空 = 不过滤） */
  createdFrom: string;
  createdTo: string;
  pageSize: number;
  page: number;
}

export const LAYER_DEFAULT_FILTER: LayerFilterState = {
  search: '', type: 'all', status: 'all', source: 'all',
  createdFrom: '', createdTo: '',
  pageSize: LAYER_DEFAULT_PAGE_SIZE, page: 1,
};

/**
 * D4：从 `?source=manual|collected` 解析层级页初值。
 * 其余值回 all（不强行套一个不存在的来源）。
 */
export function initialLayerSource(search: string): string {
  const raw = new URLSearchParams(search).get('source') ?? 'all';
  return ['manual', 'collected', 'webhook', 'mcp'].includes(raw) ? raw : 'all';
}

/**
 * 按过滤条件 + 「该层有内容」过滤，并分页（纯函数）。
 * @param list      全部记忆
 * @param f         过滤条件
 * @param p         分页参数
 * @param hasContent 该层是否有内容判定（层级页特有：c?.trim().length>0）
 * @param pageContent 该层每条内容（用于"该层暂无内容"占位展示）
 */
export function filterLayerPaged(
  list: MemoryRecord[],
  f: LayerFilterState,
  p: PageParams,
  hasContent: (m: MemoryRecord) => boolean,
): Paged<MemoryRecord> {
  const base = filterMemories(list, f as MemoryFilter);
  const withContent = base.filter(hasContent);
  // 分页口径单一真源：shared/paginate（越界 clamp、pageSize 至少 1）
  return paginate(withContent, p);
}
