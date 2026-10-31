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

/** home server 基址：?backend= 优先（空串=关闭，白名单外回落），默认 HOME_BASE；SSR 返回空串 */
export function homeBaseUrl(): string {
  if (typeof location === 'undefined') return '';
  const q = backendParam();
  if (q === null) return HOME_BASE;
  const v = sanitizeBase(q, 'backend');
  return v === undefined ? HOME_BASE : v;
}

/** agentOnboard 基址：?agentBackend= → ?backend= → ONBOARD_BASE（白名单外逐级回落）；SSR 返回空串 */
export function onboardBaseUrl(): string {
  if (typeof location === 'undefined') return '';
  const a = agentBackendParam();
  if (a !== null) {
    const v = sanitizeBase(a, 'agentBackend');
    if (v !== undefined) return v;
  }
  const b = backendParam();
  if (b !== null) {
    const v = sanitizeBase(b, 'backend');
    if (v !== undefined) return v;
  }
  return ONBOARD_BASE;
}
