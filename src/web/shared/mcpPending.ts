// ① 三处落点共享「一键后待生效」信号（首页 / 接入页 / 壳层同源）。
// 存在 localStorage：跨文档共享；带时间戳 + TTL，过期自动丢弃，避免长期误报。
// 语义：一键已把配置里的禁用标记清掉，但客户端还没重读配置（需重开软件）——这段时间三处都必须显示「待生效」，
// 不能退回去显示「正常」，否则用户会以为已经好了。
export const MCP_PENDING_KEY = 'memdesk.mcp.pending.v1';
export const MCP_PENDING_EVENT = 'memdesk:mcp-pending';
/** 待生效有效期：超过即视为不再相关（客户端应当早已重开），自动清掉 */
export const MCP_PENDING_TTL_MS = 30 * 60_000;

type PendingMap = Record<string, number>;

function readMap(): PendingMap {
  try {
    const raw = globalThis.localStorage?.getItem(MCP_PENDING_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return {};
    const out: PendingMap = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function notify(): void {
  try { globalThis.dispatchEvent?.(new Event(MCP_PENDING_EVENT)); } catch { /* 忽略 */ }
}

function writeMap(m: PendingMap): void {
  try { globalThis.localStorage?.setItem(MCP_PENDING_KEY, JSON.stringify(m)); } catch { /* 忽略（隐私模式等） */ }
  notify();
}

/** 一键成功后登记该客户端为「待生效」。 */
export function markMcpPending(id: string, now = Date.now()): void {
  if (!id) return;
  const m = readMap();
  m[id] = now;
  writeMap(m);
}

/** 清掉待生效：传 id 只清一个；不传清全部（用户已重开软件 / 手动确认）。 */
export function clearMcpPending(id?: string): void {
  if (id === undefined) { writeMap({}); return; }
  const m = readMap();
  delete m[id];
  writeMap(m);
}

/** 返回未过期的待生效客户端 id（按登记时间升序，顺序稳定）。 */
export function listMcpPending(now = Date.now()): string[] {
  const m = readMap();
  const alive: PendingMap = {};
  let dropped = false;
  for (const [id, ts] of Object.entries(m)) {
    if (now - ts <= MCP_PENDING_TTL_MS) alive[id] = ts;
    else dropped = true;
  }
  if (dropped) writeMap(alive);
  return Object.keys(alive).sort((a, b) => alive[a] - alive[b]);
}

/** 订阅待生效变化（跨文档 storage 事件 + 同文档自定义事件）；返回取消订阅。 */
export function subscribeMcpPending(cb: () => void): () => void {
  const onStorage = (e: Event) => {
    const key = (e as StorageEvent).key;
    if (key === MCP_PENDING_KEY || key == null || key === undefined) cb();
  };
  const onLocal = () => cb();
  globalThis.addEventListener?.('storage', onStorage as EventListener);
  globalThis.addEventListener?.(MCP_PENDING_EVENT, onLocal as EventListener);
  return () => {
    globalThis.removeEventListener?.('storage', onStorage as EventListener);
    globalThis.removeEventListener?.(MCP_PENDING_EVENT, onLocal as EventListener);
  };
}
