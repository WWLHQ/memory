// 当前会话（批次7）：跨 iframe 共享的 sessionId + home server /api/me 的真实上下文。
// 用于敏感操作的 UI 门禁展示（管理员/普通成员/未登录）——真正的权限判定在主进程 IPC 与后端。
import { useEffect, useState } from 'react';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';
import { homeBaseUrl } from '../backend.ts';
import type { TenantContext } from '../../types/home.ts';

export type SessionRole = 'admin' | 'member' | null;

export interface SessionState {
  sid: string | null;
  context: TenantContext | null;
  role: SessionRole;
  loading: boolean;
}

/** 直接读取本地 sessionId（preload/后端调用用；不触发网络） */
export function currentSessionId(): string | null {
  try {
    return getStoredSessionId();
  } catch {
    return null;
  }
}

/** 拉取 /api/me：未登录/后端不可达一律返回 null（绝不伪造身份） */
export async function fetchSessionContext(sid: string | null = currentSessionId()): Promise<TenantContext | null> {
  if (!sid) return null;
  try {
    const res = await fetch(`${homeBaseUrl()}/api/me`, { headers: { 'x-session-id': sid } });
    if (!res.ok) return null;
    const body = (await res.json()) as { context?: TenantContext };
    return body.context ?? null;
  } catch {
    return null;
  }
}

/** React 侧：订阅当前登录会话。壳层登录/登出写 localStorage（另一文档）→ 本 iframe 收到
 *  storage 事件 → 实时重读 sid 并重拉 /api/me，不再要求「登录后刷新页面才生效」。 */
export function useSessionContext(): SessionState {
  const [sid, setSid] = useState<string | null>(() => currentSessionId());
  const [context, setContext] = useState<TenantContext | null>(null);
  const [loading, setLoading] = useState(!!sid);

  useEffect(() => {
    const sync = () => setSid(currentSessionId());
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  useEffect(() => {
    if (!sid) {
      setContext(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchSessionContext(sid)
      .then((ctx) => { if (alive) setContext(ctx); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sid]);

  const role: SessionRole = context?.role === 'admin' ? 'admin' : context ? 'member' : null;
  return { sid, context, role, loading };
}
