// 导航计数回传通道（第一轮个人记忆）：中心区页面把「真实待确认数」回传给壳层左侧导航。
//
// 口径：
// - 只回传页面从内核真实读到的计数；读失败/未登录时回传 0（壳层不显示角标），不回传推测值；
// - 页面与壳同源，targetOrigin 固定自身 origin；顶层窗口（非嵌入）调用为空操作。
export const NAV_COUNT_MSG = '__memagent_nav_count__';

export interface NavCountPayload {
  v: 1;
  /** 壳层导航项 id（如 ledger-personal） */
  id: string;
  /** ≥0 的真实计数；0 = 不显示角标 */
  count: number;
}

export function parseNavCount(raw: unknown): NavCountPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || typeof o.id !== 'string' || !o.id) return null;
  if (typeof o.count !== 'number' || !Number.isFinite(o.count) || o.count < 0) return null;
  return { v: 1, id: o.id, count: Math.floor(o.count) };
}

export function publishNavCount(id: string, count: number): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.parent === window) return;
    const payload: NavCountPayload = { v: 1, id, count: Math.max(0, Math.floor(count)) };
    window.parent.postMessage({ [NAV_COUNT_MSG]: payload }, window.location.origin);
  } catch {
    /* 回传失败不影响页面自身功能 */
  }
}
