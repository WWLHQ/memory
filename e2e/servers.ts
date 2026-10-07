// E2E 用：进程内静态文件服务器 + 复用 T13 真实后端，避免 Playwright webServer 子进程在 Windows 上卡 teardown。
import http from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  /** 强制断开 keep-alive 后关闭：否则浏览器长连接会让 close() 回调永不触发，teardown 卡死。 */
  stop: () => Promise<void>;
}

/**
 * @param port 端口
 * @param subdir 相对仓库根的服务子目录（如 'dist'）；缺省则服务整个仓库
 */
export function startStatic(port = 8123, subdir = ''): Promise<StaticServer> {
  const base = normalize(join(ROOT, subdir));
  const srv = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let p = normalize(join(base, urlPath));
    if (!p.startsWith(base)) { res.statusCode = 403; res.end(); return; }
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
    stop: () => new Promise<void>((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }),
  })));
}