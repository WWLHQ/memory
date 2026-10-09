// 人工实页测试用：零依赖静态服务（镜像 e2e/servers.ts，端口 8127）
// 用途：node 直接编译执行（node --experimental-strip-types e2e/dev-server.ts），
// 把 dist/ 构建产物当作 http://localhost:8127/ 服务（REQ-003/004/005 三页 + overview 通览）。
// 用法：先 `npx vite build`，再 `node --experimental-strip-types e2e/dev-server.ts`。
import http from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8127);
const base = normalize(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let p = normalize(join(base, urlPath));
    if (!p.startsWith(base)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    try {
      const buf = readFileSync(p);
      res.setHeader('Content-Type', MIME[extname(p)] ?? 'application/octet-stream');
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  })
  .listen(PORT, () => {
    console.log(`[dev-server] dist/ → http://localhost:${PORT}/overview.html`);
    console.log(`[dev-server]   首页/REQ-005 : http://localhost:${PORT}/index.html`);
    console.log(`[dev-server]   接入页/REQ-003 : http://localhost:${PORT}/agentonboard.html`);
    console.log(`[dev-server]   内联标识/REQ-004 : http://localhost:${PORT}/inlineattribution.html`);
  });
