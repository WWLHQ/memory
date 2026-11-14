// REQ-014 / T6（C8）：侧栏真实状态回传通道。
//
// 口径（与 navCountChannel 一致，互不冲突）：
// - navCountChannel 只回传**角标计数**；本通道回传**进行中/需要关注**的状态摘要；
// - 只回传页面从宿主真实读到的状态（hostCall 的真实返回）；读不到、失败、未知一律不产出条目，
//   绝不用 0 或「空闲」冒充成功读数；
// - 页面与壳同源，targetOrigin 固定自身 origin；顶层窗口（非嵌入）调用为空操作。
//
// 明确不做：25s 长轮询（已有 hostCall 同步请求 + 事件驱动）、一键部署向导（Electron 自带服务）。
export const NAV_STATUS_MSG = '__memagent_nav_status__';

/** idle=空闲（通常不展示）/ busy=进行中 / warn=需要关注 */
export type NavStatusTone = 'idle' | 'busy' | 'warn';

export interface NavStatusItem {
  /** 稳定键：l0-pending / refine / collector / sync（壳层据此做位置与去重） */
  key: string;
  /** 面向用户的一句话，只能是真实状态的事实陈述 */
  label: string;
  tone: NavStatusTone;
  /** 真实计数（有就带，没有不编） */
  count?: number;
}

export interface NavStatusPayload {
  v: 1;
  /** 采集时间戳（壳层据此判断是否过期；不做长轮询，只做一次性回传） */
  at: number;
  items: NavStatusItem[];
}

const TONES = new Set<NavStatusTone>(['idle', 'busy', 'warn']);

/**
 * 校验外部消息：结构不全 / 版本不符 / 条目非法 → null。
 * 单个条目非法只丢该条，不整包拒绝（一条脏数据不该让整个状态区消失）。
 */
export function parseNavStatus(raw: unknown): NavStatusPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at <= 0) return null;
  if (!Array.isArray(o.items)) return null;
  const items: NavStatusItem[] = [];
  for (const raw2 of o.items) {
    if (!raw2 || typeof raw2 !== 'object') continue;
    const r = raw2 as Record<string, unknown>;
    if (typeof r.key !== 'string' || !r.key) continue;
    if (typeof r.label !== 'string' || !r.label) continue;
    if (typeof r.tone !== 'string' || !TONES.has(r.tone as NavStatusTone)) continue;
    const count = typeof r.count === 'number' && Number.isFinite(r.count) && r.count >= 0
      ? Math.floor(r.count)
      : undefined;
    items.push({ key: r.key, label: r.label, tone: r.tone as NavStatusTone, ...(count === undefined ? {} : { count }) });
  }
  return { v: 1, at: o.at, items };
}

/** 只用到 parent / location.origin——便于在单测里注入假窗口，不依赖 jsdom 全局属性可写性 */
export interface NavStatusWindowLike {
  parent: unknown;
  location: { origin: string };
}

/** 一次性回传给壳层侧栏（向父窗口 postMessage）；失败不影响页面自身功能 */
export function publishNavStatus(
  items: NavStatusItem[],
  at: number = Date.now(),
  win: NavStatusWindowLike | null = typeof window === 'undefined'
    ? null
    : window as unknown as NavStatusWindowLike,
): void {
  if (!win) return;
  try {
    if (win.parent === win) return;   // 顶层窗口没有壳层可回传
    const payload: NavStatusPayload = { v: 1, at, items };
    const parent = win.parent as { postMessage?: (m: unknown, o: string) => void };
    parent?.postMessage?.({ [NAV_STATUS_MSG]: payload }, win.location.origin);
  } catch {
    /* 回传失败不影响页面自身功能 */
  }
}

/**
 * 真实状态快照 → 状态条目（纯函数，零 IO）。
 * 字段缺失 = 不知道，不是"没有发生"；只有拿到明确布尔/计数才产出条目。
 */
export interface NavStatusSource {
  collector?: { running?: boolean; consecutiveFails?: number; autoRetryStopped?: boolean } | null;
  pendingWrites?: { count?: number } | null;
  refine?: { queued?: number; running?: boolean } | null;
  sync?: { active?: boolean; lastError?: string | null } | null;
}

export function buildNavStatus(src: NavStatusSource): NavStatusItem[] {
  const items: NavStatusItem[] = [];

  // 1) 写入兜底队列：pending ≠ 成功，有积压就必须让用户看见
  const pendingCount = src.pendingWrites?.count;
  if (typeof pendingCount === 'number' && Number.isFinite(pendingCount) && pendingCount > 0) {
    items.push({ key: 'l0-pending', label: `写入兜底 ${Math.floor(pendingCount)} 条待解冻`, tone: 'warn', count: Math.floor(pendingCount) });
  }

  // 2) L2–L6 补炼队列
  const refine = src.refine;
  if (refine?.running === true) {
    items.push({ key: 'refine', label: '精炼进行中', tone: 'busy' });
  } else if (typeof refine?.queued === 'number' && refine.queued > 0) {
    items.push({ key: 'refine', label: `精炼队列 ${Math.floor(refine.queued)} 条`, tone: 'busy', count: Math.floor(refine.queued) });
  }

  // 3) 采集器：运行中 / 停了自动重试 / 连续失败
  const c = src.collector;
  if (c?.running === true) {
    items.push({ key: 'collector', label: '采集进行中', tone: 'busy' });
  } else if (c?.autoRetryStopped === true) {
    items.push({ key: 'collector', label: '采集已停自动重试', tone: 'warn' });
  } else if (typeof c?.consecutiveFails === 'number' && c.consecutiveFails >= 3) {
    items.push({ key: 'collector', label: `采集连续失败 ${Math.floor(c.consecutiveFails)} 轮`, tone: 'warn', count: Math.floor(c.consecutiveFails) });
  }

  // 4) 同步中枢
  const s = src.sync;
  if (s?.active === true) {
    items.push({ key: 'sync', label: '同步进行中', tone: 'busy' });
  } else if (typeof s?.lastError === 'string' && s.lastError) {
    items.push({ key: 'sync', label: '上次同步失败', tone: 'warn' });
  }

  return items;
}
