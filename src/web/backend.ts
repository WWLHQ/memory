// 本机后端地址单一真源（与 src/electron/main.ts 的 MIRROR_PORT / AGENT_ONBOARD_PORT 对齐）。
// 任何页面都不得再硬编码端口：默认值只出现在本文件；URL 参数仍可覆盖：
//   ?backend=      → home server（登录/审计镜像）
//   ?agentBackend= → agentOnboard 服务（未给则回落 ?backend=）
// 显式空值（?backend= 或 ?backend=%20）表示「关闭后端」，返回空串，调用方应跳过网络。
//
// 批次26-B P1-1：URL 参数不再原样用作请求基址（诱导打开带参 URL 可把登录明文密码 POST 到外部主机）。
// 白名单 = http + 回环主机（localhost / 127.0.0.1 / [::1]）+ 显式端口 + 无路径/查询/凭据。
// 不锁 82xx 端口段：E2E 用系统分配的随机回环端口、批次24 备用端口 8211–8215 都要可用；
// 对外部主机 / https / 无端口 / 带 path 一律拒绝，回落默认值并写 ui:backend_param_rejected（只记 host，不记完整 URL）。
import { uiLog } from './shared/actionLog.ts';

export const HOME_BASE = 'http://localhost:8201';
export const ONBOARD_BASE = 'http://localhost:8200';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// 批次27：?backend= 只活在 URL 上，标签页内跳转到其它页面就丢，回落默认 8201
// （8201 被不授信的桌面端占用时表现为「来源未被信任」）。校验通过的值记入 sessionStorage：
// 同标签页后续页面无参打开时继续用；换新标签页/关浏览器即失效，不钉死旧端口。
const STORE_BACKEND = 'mam.backend.session.v1';
const STORE_AGENT_BACKEND = 'mam.agentBackend.session.v1';

function storeBase(key: string, v: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.setItem(key, v); } catch { /* 隐私模式/配额满：仅当前 URL 生效 */ }
}

function readStoredBase(key: string): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function clearStoredBase(key: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.removeItem(key); } catch { /* 同上 */ }
}

/** 白名单校验：合法返回归一化 origin；'' = 显式关闭；undefined = 白名单外（调用方回落默认值） */
function sanitizeBase(raw: string, param: 'backend' | 'agentBackend'): string | undefined {
  if (raw === '') return '';
  try {
    const u = new URL(raw);
    const ok = u.protocol === 'http:'
      && LOOPBACK_HOSTS.has(u.hostname)
      && u.port !== ''
      && u.pathname === '/'
      && u.search === ''
      && u.hash === ''
      && u.username === ''
      && u.password === '';
    if (!ok) throw new Error('not_loopback_http');
    return u.origin;
  } catch {
    let host = raw;
    try { host = new URL(raw).host; } catch { /* 非法 URL：记原始片段 */ }
    uiLog('ui', 'backend_param_rejected', {
      param,
      host: String(host).slice(0, 80),
      fallback: param === 'backend' ? HOME_BASE : undefined,
    }, { level: 'error' });
    return undefined;
  }
}

/** ?backend= 原始值；未设置返回 null，空串表示显式关闭 */
export function backendParam(): string | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search).get('backend');
  return q === null ? null : q.trim();
}

/** ?agentBackend= 原始值；未设置返回 null，空串表示显式关闭 */
export function agentBackendParam(): string | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search).get('agentBackend');
  return q === null ? null : q.trim();
}

/** home server 基址：?backend= 优先（空串=关闭；白名单外回落会话值→默认）；无参用会话值；SSR 返回空串 */
export function homeBaseUrl(): string {
  if (typeof location === 'undefined') return '';
  const q = backendParam();
  if (q !== null) {
    const v = sanitizeBase(q, 'backend');
    if (v === '') { clearStoredBase(STORE_BACKEND); return ''; }
    if (v !== undefined) { storeBase(STORE_BACKEND, v); return v; }
  }
  const stored = readStoredBase(STORE_BACKEND);
  if (stored) return stored;
  return HOME_BASE;
}

/** agentOnboard 基址：?agentBackend= → ?backend= → 会话值（agent → home）→ 默认（白名单外逐级回落）；SSR 返回空串 */
export function onboardBaseUrl(): string {
  if (typeof location === 'undefined') return '';
  const a = agentBackendParam();
  if (a !== null) {
    const v = sanitizeBase(a, 'agentBackend');
    if (v === '') { clearStoredBase(STORE_AGENT_BACKEND); return ''; }
    if (v !== undefined) { storeBase(STORE_AGENT_BACKEND, v); return v; }
  }
  const b = backendParam();
  if (b !== null) {
    const v = sanitizeBase(b, 'backend');
    if (v === '') { clearStoredBase(STORE_BACKEND); return ''; }
    if (v !== undefined) return v;
  }
  const storedAgent = readStoredBase(STORE_AGENT_BACKEND);
  if (storedAgent) return storedAgent;
  const storedHome = readStoredBase(STORE_BACKEND);
  if (storedHome) return storedHome;
  return ONBOARD_BASE;
}

// ── 批次27：dev 备用端口自动发现（免手动重跑 npm run dev） ──
// 8201 被不授信进程（安装版桌面端）占用时，`npm run dev` 的受信后端在 8211–8215。
// 页面侧用 CORS fetch 探测：不放行当前来源的服务器 fetch 直接抛错（CORS 拦截），
// 只有受信 dev 后端可读 /api/health 响应 —— 命中即记忆会话值，登录与镜像自动切换。

/** dev 备用端口（与 tools/dev.mjs 的 FALLBACK_PORTS 对齐） */
export const DEV_FALLBACK_PORTS = [8211, 8212, 8213, 8214, 8215] as const;

/** 把已验证合法的 home 基址记入会话（供自动发现与登录成功路径调用）；非法返回 null */
export function rememberHomeBase(base: string): string | null {
  const v = sanitizeBase(base, 'backend');
  if (v === undefined || v === '') return null;
  storeBase(STORE_BACKEND, v);
  return v;
}

/** 探测受信 dev 后端：返回放行当前来源的 home 服务基址；全未命中返回 null（不猜、不造） */
export async function discoverTrustedDevBackend(timeoutMs = 1200): Promise<string | null> {
  if (typeof location === 'undefined') return null;
  for (const port of DEV_FALLBACK_PORTS) {
    const base = `http://127.0.0.1:${port}`;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      // 不放行本来源的服务器：浏览器 CORS 拦截 → fetch reject；受信 dev 后端 → 200 + {ok,service:'home'}
      const r = await fetch(`${base}/api/health`, {
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!r.ok) continue;
      const j = (await r.json().catch(() => null)) as { ok?: unknown; service?: unknown } | null;
      if (j?.ok === true && j?.service === 'home') return base;
    } catch {
      /* 不可达 / 不放行本来源：继续探测下一个 */
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  return null;
}
