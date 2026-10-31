// 记忆管理页（REQ-006 / P8）· 过滤 + 分页纯逻辑
// 全部为纯函数，便于单测（与 logic.ts 同风格）。
import type { MemoryRecord } from './types.ts';
import { sortMemories } from './logic.ts';
import type { PageParams, Paged } from '../shared/paginate.ts';
import { paginate } from '../shared/paginate.ts';

/** 过滤条件（全部可选，留空 = 不过滤） */
export interface MemoryFilter {
  /** 全文搜索（匹配 content / id / tags，大小写不敏感） */
  search?: string;
  /** 类型过滤（六类之一） */
  type?: string;
  /** 状态过滤（六态之一） */
  status?: string;
  /** 采集来源：'all' | 'collected' | 'manual' | 具体 source_agent（与 MemoryLayeredPage 一致） */
  source?: string;
  /** 创建时间过滤（ISO 日期或日期时间字符串；留空 = 不过滤） */
  createdFrom?: string;
  createdTo?: string;
}

/** 分页参数（批次24 起口径单一真源在 shared/paginate，此处转发导出保持既有引用不变） */
export type { PageParams, Paged } from '../shared/paginate.ts';

/** 是否"采集来源"（source_agent 非空且非 manual）—— 与 MemoryLayeredPage.isCollected 同义 */
export function isCollected(m: MemoryRecord): boolean {
  const src = m.source_agent ?? '';
  return src !== '' && src !== 'manual';
}

/**
 * 按条件过滤记忆列表（纯函数，不改原数组）。
 * 过滤顺序：search → type → status → source（各维度 AND 组合）。
 */
export function filterMemories(list: MemoryRecord[], f: MemoryFilter): MemoryRecord[] {
  // 始终返回新数组（即使无过滤条件），避免调用方误改原账本
  let out = [...list];
  const q = (f.search ?? '').trim().toLowerCase();
  if (q) {
    out = out.filter((m) => {
      if (m.content.toLowerCase().includes(q)) return true;
      if (m.id.toLowerCase().includes(q)) return true;
      return m.tags.some((t) => t.toLowerCase().includes(q));
    });
  }
  if (f.type && f.type !== 'all') {
    out = out.filter((m) => m.type === f.type);
  }
  if (f.status && f.status !== 'all') {
    out = out.filter((m) => m.status === f.status);
  }
  if (f.source && f.source !== 'all') {
    if (f.source === 'collected') {
      out = out.filter(isCollected);
    } else if (f.source === 'manual') {
      out = out.filter((m) => !isCollected(m));
    } else {
      out = out.filter((m) => m.source_agent === f.source);
    }
  }
  // 创建时间区间过滤（createdFrom / createdTo 为 ISO 日期或日期时间，闭区间）
  const fromTs = f.createdFrom ? Date.parse(f.createdFrom) : NaN;
  const toTs = f.createdTo ? Date.parse(f.createdTo) : NaN;
  if (!Number.isNaN(fromTs) || !Number.isNaN(toTs)) {
    out = out.filter((m) => {
      const ts = Date.parse(m.created_at);
      if (Number.isNaN(ts)) return true; // 无法解析 → 不过滤（诚实保留）
      if (!Number.isNaN(fromTs) && ts < fromTs) return false;
      if (!Number.isNaN(toTs) && ts > toTs) return false;
      return true;
    });
  }
  return out;
}

/**
 * 过滤 + 排序 + 分页（一步到位，纯函数）。
 * 流程：filterMemories → sortMemories（pinned 置顶 + confidence 降序）→ 切片当前页。
 * page 越界自动 clamp（>totalPages → 回末页；<1 → 回第 1 页）。
 */
export function filterAndPaged(
  list: MemoryRecord[],
  f: MemoryFilter,
  p: PageParams,
): Paged<MemoryRecord> {
  return paginate(sortMemories(filterMemories(list, f)), p);
}
