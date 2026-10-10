// REQ-006 端壳 mirror 客户端（G6 审计上抛）：fire-and-forget，失败静默（safe-noop 语义保留）。
// home server 端点：POST /api/mirror/audit（持久账本）；GET /api/mirror/audit（回填查询）。
// 后端不在时（E2E/单测/离线演示）fetch 失败被吞掉，页面交互零影响。

/** ?backend= 覆盖地址（对齐各 useXxxMirror 的同名参数）；SSR/测试环境返回空串跳过上报 */
export function mirrorBackendUrl(): string {
  if (typeof location === 'undefined') return '';
  const q = new URLSearchParams(location.search).get('backend');
  if (q !== null) return q.trim();
  return 'http://localhost:8200';
}

/** 上抛一条 mirror 审计（fire-and-forget，永不抛错） */
export function mirrorReport(source: string, action: string, requestId?: string, payload?: unknown): void {
  const base = mirrorBackendUrl();
  if (!base) return;
  try {
    fetch(`${base}/api/mirror/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, action, request_id: requestId, payload: payload ?? null }),
      keepalive: true,
    }).catch(() => { /* safe-noop：后端不在时静默 */ });
  } catch {
    /* safe-noop */
  }
}

/** 拉取回填（查询用；失败返回空） */
export async function mirrorFetch(source?: string, limit = 50): Promise<{ items: unknown[]; total: number }> {
  const base = mirrorBackendUrl();
  if (!base) return { items: [], total: 0 };
  try {
    const u = new URL(`${base}/api/mirror/audit`);
    if (source) u.searchParams.set('source', source);
    u.searchParams.set('limit', String(limit));
    const res = await fetch(u.toString());
    if (!res.ok) return { items: [], total: 0 };
    return (await res.json()) as { items: unknown[]; total: number };
  } catch {
    return { items: [], total: 0 };
  }
}
