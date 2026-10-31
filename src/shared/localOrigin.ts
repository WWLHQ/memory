// 本机 HTTP 服务的跨源闸门：只信任明确放行的页面来源。
// 背景：home/agentOnboard 原先回 Access-Control-Allow-Origin: *，任意网页都能跨域驱动本机服务
// （注册、撤销密钥、写记忆）。本模块把 CORS 收口为白名单，并对带 Origin 的请求做硬校验。
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Vite dev server 默认源（`npm run dev` 打开页面时仍可调本机后端） */
export const DEV_ORIGINS: readonly string[] = ['http://127.0.0.1:5180', 'http://localhost:5180'];

export interface OriginPolicy {
  allowed: ReadonlySet<string>;
}

export interface OriginPolicyOptions {
  /**
   * 是否并入 Vite dev server 源（`npm run dev` 页面）。
   * 生产（Electron 打包态）默认 false：dev 源不是本应用页面，不得成为可写来源。
   * 仅 `tools/dev-backend.mjs` 等本地开发入口显式开启。
   */
  allowDev?: boolean;
}

function normalizeOrigin(o: string): string {
  return o.trim().replace(/\/+$/, '');
}

/** 构建白名单：只放行显式传入的精确来源；dev server 源需 allowDev 显式开启 */
export function createOriginPolicy(extra: readonly string[] = [], opts: OriginPolicyOptions = {}): OriginPolicy {
  const allowed = new Set<string>();
  for (const o of [...(opts.allowDev ? DEV_ORIGINS : []), ...extra]) {
    const n = normalizeOrigin(o);
    if (n) allowed.add(n);
  }
  return { allowed };
}

/**
 * 浏览器跨源闸门：带 Origin 的请求必须命中白名单，否则 403。
 * 返回 true 表示已写出拒绝响应，调用方应立即 return。
 * 无 Origin（本机 CLI / 单测 / 非浏览器调用）放行——服务只监听 127.0.0.1，且此类调用不受浏览器 CSRF 面影响。
 */
export function rejectUntrustedOrigin(
  req: IncomingMessage,
  res: ServerResponse,
  policy: OriginPolicy,
): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (origin !== 'null' && policy.allowed.has(normalizeOrigin(origin))) return false;
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'origin_not_allowed' }));
  return true;
}

/** 仅对白名单来源回显 CORS；绝不使用 '*' */
export function applyCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  policy: OriginPolicy,
): void {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return;
  if (!policy.allowed.has(normalizeOrigin(origin))) return;
  res.setHeader('Access-Control-Allow-Origin', normalizeOrigin(origin));
  res.setHeader('Vary', 'Origin');
}

/**
 * 批次26-B P2-16：Host 头绑定（防 DNS rebinding）。
 * DNS rebinding 后恶意网页解析到 127.0.0.1，请求仍会命中本机服务，但 Host 是恶意域名 ——
 * 这里要求 Host 恰好为「本机回环主机名 + 本服务实际监听端口」，否则 403。
 * 无 Host（HTTP/1.0 CLI / 部分单测客户端）放行：浏览器请求必带 Host，Origin 闸门继续兜底浏览器面。
 * 返回 true 表示已写出 403，调用方应立即 return。
 */
export function rejectUntrustedHost(
  req: IncomingMessage,
  res: ServerResponse,
  ports: readonly number[],
): boolean {
  const raw = req.headers.host;
  const host = Array.isArray(raw) ? raw[0] : raw;
  if (host === undefined) return false;
  const allowed = new Set<string>();
  for (const p of ports) {
    allowed.add(`127.0.0.1:${p}`);
    allowed.add(`localhost:${p}`);
    allowed.add(`[::1]:${p}`);
  }
  if (allowed.has(host.trim().toLowerCase())) return false;
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'host_not_allowed' }));
  return true;
}
