// 启动一个 detached 的 Chromium（headless，开 CDP 端口），供 E2E 用 connectOverCDP 连接。
// detached + unref：runner 不拥有该进程，因此 teardown 不会卡在 browser.close()。
import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.E2E_CDP_PORT || 9222);
const CDE_FILE = join(dirname(fileURLToPath(import.meta.url)), '.cde.json');

function waitForCDP(timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/json/version' }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`CDP 端口 ${PORT} 未就绪`));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

export default async function globalSetup() {
  const exe = chromium.executablePath();
  const child = spawn(exe, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    'about:blank',
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  await waitForCDP();
  writeFileSync(CDE_FILE, JSON.stringify({ wsEndpoint: `http://127.0.0.1:${PORT}`, pid: child.pid }, null, 2));
  console.error(`[e2e] Chromium CDP 就绪：http://127.0.0.1:${PORT} (pid=${child.pid})`);
}
