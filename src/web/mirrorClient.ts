// REQ-006 端壳 mirror 客户端（G6 审计上抛）：fire-and-forget，失败可观测。
// home server 端点：POST /api/mirror/audit（持久账本）；GET /api/mirror/audit（回填查询）。
// 端点在 src/home/server.ts 真实现并有服务端测试，不是「暂无端点」；?backend= 为空串（显式关闭）时跳过上抛。
// 阶段5-C：旧注释误称端点不存在、把上抛说成空操作，且只吞网络错误（HTTP 500/404 被当成成功）。
// 现在失败会 ① 记入模块状态并通知订阅者；② 派发 mam:mirror-failure 供全局提示条显示；
// ③ 经 uiLog 写主进程 actions.log（level:error）。页面交互永不因上抛失败而中断。
import { homeBaseUrl } from './backend.ts';
import { uiLog } from './shared/actionLog.ts';
import { currentSessionId } from './shared/session.ts';
import { MIRROR_FAILURE_EVENT, type MirrorFailure } from './shared/mirrorFailureEvent.ts';

export { MIRROR_FAILURE_EVENT } from './shared/mirrorFailureEvent.ts';
export type { MirrorFailure } from './shared/mirrorFailureEvent.ts';

/** home server 基址：?backend= 覆盖（对齐各 useXxxMirror）；SSR 返回空串跳过上报 */
export function mirrorBackendUrl(): string {
  return homeBaseUrl();
}

let lastFailure: MirrorFailure | null = null;
const listeners = new Set<(f: MirrorFailure) => void>();

/** 最近一次真实上抛/查询失败（null = 尚未失败或已复位） */
export function getLastMirrorFailure(): MirrorFailure | null { return lastFailure; }

/** 复位失败状态（测试与「恢复成功后清提示」用；不清空订阅者） */
export function resetMirrorFailures(): void { lastFailure = null; }

/** 订阅失败事件，返回取消订阅函数；订阅者异常不影响其它订阅者 */
export function subscribeMirrorFailure(cb: (f: MirrorFailure) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? 'unknown');
}

/** 记录一次真实失败：绝不抛错、绝不中断调用方 */
function recordFailure(source: string, action: string, reason: string): void {
  const f: MirrorFailure = { source, action, reason, at: Date.now() };
  lastFailure = f;
  for (const cb of listeners) {
    try { cb(f); } catch { /* 订阅者异常不影响其它订阅者 */ }
  }
  try {
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent(MIRROR_FAILURE_EVENT, { detail: f }));
    }
  } catch { /* 环境不支持 CustomEvent 时仍有订阅者与日志 */ }
  uiLog('mirror', 'report_failed', { source, action, reason }, { level: 'error' });
}

/** 上抛一条 mirror 审计（fire-and-forget，永不抛错；HTTP 非 2xx 与网络错误都记为可见失败） */
export function mirrorReport(source: string, action: string, requestId?: string, payload?: unknown): void {
  const base = mirrorBackendUrl();
  if (!base) return;
  try {
    // 批次47 P0-1：账本按登录会话归属；无会话时不伪造身份，交给服务端如实 401 → 记为可见失败。
    const sid = currentSessionId();
    fetch(`${base}/api/mirror/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(sid ? { 'x-session-id': sid } : {}) },
      body: JSON.stringify({ source, action, request_id: requestId, payload: payload ?? null }),
      keepalive: true,
    })
      .then((res) => { if (!res.ok) recordFailure(source, action, `HTTP ${res.status}`); })
      .catch((e) => recordFailure(source, action, reasonOf(e)));
  } catch (e) {
    recordFailure(source, action, reasonOf(e));
  }
}

/** 拉取回填（查询用；失败返回空并记录可见失败，绝不把「连不上」当成「查无」） */
export async function mirrorFetch(source?: string, limit = 50): Promise<{ items: unknown[]; total: number }> {
  const base = mirrorBackendUrl();
  if (!base) return { items: [], total: 0 };
  try {
    const u = new URL(`${base}/api/mirror/audit`);
    if (source) u.searchParams.set('source', source);
    u.searchParams.set('limit', String(limit));
    const sid = currentSessionId();
    const res = await fetch(u.toString(), { headers: sid ? { 'x-session-id': sid } : {} });
    if (!res.ok) {
      recordFailure(source ?? 'mirror', 'fetch', `HTTP ${res.status}`);
      return { items: [], total: 0 };
    }
    return (await res.json()) as { items: unknown[]; total: number };
  } catch (e) {
    recordFailure(source ?? 'mirror', 'fetch', reasonOf(e));
    return { items: [], total: 0 };
  }
}
