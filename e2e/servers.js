// E2E 用：进程内静态文件服务器 + 复用 T13 真实后端，避免 Playwright webServer 子进程在 Windows 上卡 teardown。
import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

export function startStatic(port = 8123) {
  const srv = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let p = normalize(join(ROOT, urlPath));
    if (!p.startsWith(ROOT)) { res.statusCode = 403; res.end(); return; }
    try {
      const st = statSync(p);
      if (st.isDirectory()) p = join(p, 'index.html');
      const buf = readFileSync(p);
      res.setHeader('Content-Type', MIME[extname(p)] || 'application/octet-stream');
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  return new Promise((resolve) => srv.listen(port, () => resolve({
    server: srv,
    // 必须强制断开 keep-alive 连接：浏览器保持的长连接会让 srv.close() 的回调永不触发，导致 teardown 卡死。
    stop: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }),
  })));
}
