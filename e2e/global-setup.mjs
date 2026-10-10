// 启动一个 detached 的 Chromium（headless，开 CDP 端口），供 E2E 用 connectOverCDP 连接。
// detached + unref：runner 不拥有该进程，因此 teardown 不会卡在 browser.close()。
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
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

function portOpen(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/version' }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
  });
}

/** 找到监听指定端口的进程 pid（netstat -ano） */
function pidListeningOn(port) {
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      if (line.includes(`:${port} `) && line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isInteger(pid) && pid > 0) return pid;
      }
    }
  } catch {
    // netstat 不可用时忽略
  }
  return null;
}

/** 等 CDP 端口关闭 */
function waitPortClosed(port, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = async () => {
      if (!(await portOpen(port))) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`端口 ${port} 未释放`));
      setTimeout(tick, 300);
    };
    tick();
  });
}

export default async function globalSetup() {
  // 防端口劫持：上一轮 detached Chromium 会跨运行存活；若旧实例仍占着 CDP 端口，
  // 新 spawn 会因端口冲突静默失败，而 waitForCDP 探测到的却是旧实例
  // （旧实例可能被外部环境注入扩展 service worker，导致 connectOverCDP 崩溃）。
  // 故先按 netstat 找到占用 pid，taskkill 整棵进程树后再启动新实例。
  if (await portOpen(PORT)) {
    const stalePid = pidListeningOn(PORT);
    if (stalePid) {
      try {
        execSync(`taskkill /PID ${stalePid} /T /F`, { stdio: 'ignore' });
      } catch {
        // 已退出则忽略
      }
      await waitPortClosed(PORT);
    }
  }

  const exe = chromium.executablePath();
  const child = spawn(exe, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    // 组件扩展（如本机 Chromium 内置的 service worker 扩展）会污染 CDP 目标枚举，
    // connectOverCDP 偶发抛 "targetInfo: {...service_worker...}"，禁用之。
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    'about:blank',
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  await waitForCDP();
  // 预取 webSocketDebuggerUrl：Chromium 在首个 CDP 客户端断开后，
  // HTTP 发现端点（/json/version）会 404，后续 worker 必须直接走 ws:// 连接。
  const wsEndpoint = await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/json/version' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j.webSocketDebuggerUrl);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
  });
  writeFileSync(CDE_FILE, JSON.stringify({ wsEndpoint, pid: child.pid }, null, 2));
  console.error(`[e2e] Chromium CDP 就绪：${wsEndpoint} (pid=${child.pid})`);
}
