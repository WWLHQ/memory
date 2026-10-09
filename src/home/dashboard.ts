// REQ-005 T4：首页 Dashboard 数据聚合（纯函数，§0.2）
// 职责：把后端/镜像原始 feed 组装成首页四区块（功劳/异常/活跃记忆/待办）。
// 未登录（ctx=null）→ 返回 null，UI 据此整体灰置（.gain.off / .off-placeholder）。
// 不变量：每个异常/记忆/待办项必须带非空 request_id 以便溯源（数字可点 → 审计 modal）。
// 异常列表按 level=error 置顶（熔断 OPEN / 同步失败最前）；活跃记忆保留 decay_class；
// 待办含 9.7 待裁决（kind=dispute）与反代理额度（kind=proxy_budget）。
// 零依赖纯函数，不直连 UI/后端（边界：仅 src/home/）。
import type {
  TenantContext,
  HomeDashboard,
  AnomalyItem,
  ActiveMemory,
  TodoItem,
} from '../types/home.ts';
import type { Gain } from '../types/agentOnboard.ts';

/** 原始 feed（来自后端/镜像，request_id 可能缺失，组装时按需兜底溯源） */
type RawItem = { request_id?: string };
export interface RawHomeFeed {
  gains?: Gain[];
  anomalies?: Array<Omit<AnomalyItem, 'request_id'> & RawItem>;
  activeMemories?: Array<Omit<ActiveMemory, 'request_id'> & RawItem>;
  todos?: Array<Omit<TodoItem, 'request_id'> & RawItem>;
}

/** 为缺失 request_id 的项兜底生成溯源 id，保证输出可溯源不变量 */
function ensureId<T extends RawItem>(items: T[] | undefined, prefix: string): Array<T & { request_id: string }> {
  return (items ?? []).map((it, i) => ({
    ...it,
    request_id: it.request_id && it.request_id.length > 0 ? it.request_id : `${prefix}_${i}`,
  }));
}

/** 异常按 error 置顶（稳定排序：error 在前，warn 在后，组间保持原序） */
function sortAnomalies(items: AnomalyItem[]): AnomalyItem[] {
  return [...items].sort((a, b) => {
    const av = a.level === 'error' ? 0 : 1;
    const bv = b.level === 'error' ? 0 : 1;
    return av - bv;
  });
}

/**
 * 组装首页 Dashboard。
 * @param ctx 全局租户上下文；为 null（未登录）→ 返回 null，UI 整体灰置。
 * @param raw 后端/镜像原始 feed。
 */
export function buildDashboard(ctx: TenantContext | null, raw: RawHomeFeed): HomeDashboard | null {
  if (!ctx) return null;

  const gains: Gain[] = raw.gains ?? [];
  const anomalies = sortAnomalies(ensureId(raw.anomalies, 'anom'));
  const activeMemories = ensureId(raw.activeMemories, 'mem') as ActiveMemory[];
  const todos = ensureId(raw.todos, 'todo') as TodoItem[];

  return { gains, anomalies, activeMemories, todos };
}
