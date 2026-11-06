// REQ-005 T4：首页 Dashboard 数据聚合（纯函数，§0.2）
// 职责：把后端/镜像原始 feed 组装成首页四区块（功劳/异常/活跃记忆/待办）。
// 未登录（ctx=null）→ 返回 null，UI 据此整体灰置（.gain.off / .off-placeholder）。
// 不变量：request_id 只能透传真实值；账本没给就留空串，绝不合成 `anom_1/todo_1` 之类假链路
// （2026-11 审计：旧实现 ensureId 会给缺 id 的项编造 id，首页因此出现「可点但查无」的假溯源）。
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

/** 透传真实 request_id：缺失/空白一律留空串（'' = 账本无链路，UI 不渲染可点 rid） */
function keepRealId<T extends RawItem>(items: T[] | undefined): Array<T & { request_id: string }> {
  return (items ?? []).map((it) => ({
    ...it,
    request_id: typeof it.request_id === 'string' && it.request_id.trim() ? it.request_id : '',
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
  const anomalies = sortAnomalies(keepRealId(raw.anomalies));
  const activeMemories = keepRealId(raw.activeMemories) as ActiveMemory[];
  const todos = keepRealId(raw.todos) as TodoItem[];

  return { gains, anomalies, activeMemories, todos };
}
