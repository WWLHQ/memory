// E2E 用：进程内静态文件服务器 + 复用真实后端，避免 Playwright webServer 子进程在 Windows 上卡 teardown。
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createHomeServer } from '../src/home/server.ts';
import type { HomeServer } from '../src/home/server.ts';
import type { RunningServer } from '../src/agentOnboard/server.ts';
import { InMemoryStorage } from '../src/core/memagent/storage.ts';
import { InMemoryPersonalStore } from '../src/core/memagent/personalStore.ts';
import type { PersonalMemoryStore } from '../src/core/memagent/personalStore.ts';
import type { StorageBackend } from '../src/core/memagent/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

export interface StaticServer {
  server: http.Server;
  /** 实际监听端口（port 传 0 时由系统分配） */
  port: number;
  /** 强制断开 keep-alive 后关闭：否则浏览器长连接会让 close() 回调永不触发，teardown 卡死。 */
  stop: () => Promise<void>;
}

/**
 * @param port 监听端口（0 = 系统分配）
 * @param subdir 相对仓库根的服务子目录（如 'dist'）；缺省则服务整个仓库
 */
export function startStatic(port = 8123, subdir = ''): Promise<StaticServer> {
  const base = normalize(join(ROOT, subdir));
  // Windows 路径大小写不敏感：越界判定必须同口径比较，且前缀边界是目录分隔符
  const baseLower = base.toLowerCase();
  const inBase = (p: string) => {
    const q = p.toLowerCase();
    return q === baseLower || q.startsWith(baseLower + sep);
  };
  const srv = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let p = normalize(join(base, urlPath));
    if (!inBase(p)) { res.statusCode = 403; res.end(); return; }
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    try {
      const buf = readFileSync(p);
      res.setHeader('Content-Type', MIME[extname(p)] ?? 'application/octet-stream');
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  return new Promise((resolve) => srv.listen(port, () => resolve({
    server: srv,
    port: (srv.address() as AddressInfo).port,
    stop: () => new Promise<void>((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }),
  })));
}

/** 启动 home 后端（端口 0 = 系统分配，避免与桌面 8200/8201 及 MCP 8202/8204 冲突）。
 *  批次28-A：与生产同构地挂上内核账本（缺省内存账本）——浏览器页面带会话后会走
 *  /api/kernel/invoke 数据面，不挂账本会 501 让安全页等审计写入诚实失败。 */
export async function startHomeBackend(opts: {
  dataFile: string;
  allowedOrigins?: string[];
  kernelStorage?: StorageBackend;
  /** 第一轮个人记忆：缺省挂进程内独立存储（真实内核，非 mock）；用例可传共享实例做跨页断言 */
  personalStore?: PersonalMemoryStore;
}): Promise<{ server: http.Server; homeServer: HomeServer; port: number; stop: () => Promise<void> }> {
  const homeServer = createHomeServer({
    dataFile: opts.dataFile,
    allowedOrigins: opts.allowedOrigins,
    kernelStorage: opts.kernelStorage ?? new InMemoryStorage(),
    kernelInfo: { readonly: false, db_path: 'e2e-in-memory' },
    personalStore: opts.personalStore ?? new InMemoryPersonalStore(),
  });
  await new Promise<void>((resolve, reject) => {
    homeServer.once('error', reject);
    homeServer.listen(0, () => resolve());
  });
  const port = (homeServer.address() as AddressInfo).port;
  return {
    server: homeServer,
    homeServer,
    port,
    stop: async () => {
      homeServer.closeAllConnections?.();
      await new Promise<void>((r) => homeServer.close(() => r()));
    },
  };
}

/** 关闭 node:http Server（beforeAll 失败时变量可能未初始化） */
export async function closeServer(server?: http.Server): Promise<void> {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
}

/** 关闭 agentOnboard RunningServer（beforeAll 失败时变量可能未初始化） */
export async function stopRunningServer(backend?: RunningServer): Promise<void> {
  if (!backend) return;
  backend.server.closeAllConnections?.();
  await backend.stop();
}
