// 启动一个 detached 的 Chromium（headless，开 CDP 端口），供 E2E 用 connectOverCDP 连接。
// detached + unref：runner 不拥有该进程，因此 teardown 不会卡在 browser.close()。
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, readlinkSync } from 'node:fs';
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

/** 找到监听指定端口的进程 pid（Windows: netstat；POSIX: lsof） */
function pidListeningOn(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        if (line.includes(`:${port} `) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = Number(parts[parts.length - 1]);
          if (Number.isInteger(pid) && pid > 0) return pid;
        }
      }
    } else {
      const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
      const pid = Number(out.trim().split('\n')[0]);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
  } catch {
    // 工具不可用/无监听时忽略
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

/**
 * 批次41-G：解析某 pid 的可执行文件路径；无法确定时返回 null（宁可判「非本仓库」也不误杀）。
 * Windows 走 PowerShell 查 Win32_Process.ExecutablePath；POSIX 在 Linux 读 /proc/<pid>/exe，
 * 其它平台（macOS 无 /proc）返回 null。
 */
function exePathOfPid(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell', [
        '-NoProfile', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty ExecutablePath)`,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const line = out.trim().split('\n')[0].trim();
      return line || null;
    }
    return readlinkSync(`/proc/${pid}/exe`);
  } catch {
    return null;
  }
}

/** 判定某可执行路径是否属于本仓库 Playwright 的浏览器（而非用户系统里的 Chrome/Edge） */
function isPlaywrightExe(path) {
  if (!path) return false;
  try {
    const ours = chromium.executablePath();
    if (ours && path === ours) return true;
    // Playwright 缓存目录的两个常见形态：默认 ms-playwright、或 node_modules 内 .local-browsers
    return /ms-playwright|\.local-browsers/i.test(path);
  } catch {
    return false;
  }
}


export default async function globalSetup() {
  // 防端口劫持：上一轮 detached Chromium 会跨运行存活；若旧实例仍占着 CDP 端口，
  // 新 spawn 会因端口冲突静默失败，而 waitForCDP 探测到的却是旧实例
  // （旧实例可能被外部环境注入扩展 service worker，导致 connectOverCDP 崩溃）。
  // 故先按 netstat 找到占用 pid，确认是本仓库的 Playwright 浏览器后再 taskkill 整棵进程树。
  if (await portOpen(PORT)) {
    const stalePid = pidListeningOn(PORT);
    if (stalePid) {
      // 批次41-G：绝不「裸杀」——先确认可执行路径属于本仓库 Playwright 浏览器。
      // 若用户自己的 Chrome 恰好也开着 9222（或其它默认端口），这里判为「非本仓库」，
      // 宁可让本次 E2E 失败并给出释放/换端口的指引，也不连其标签页一起杀掉。
      const staleExe = exePathOfPid(stalePid);
      if (!isPlaywrightExe(staleExe)) {
        throw new Error(
          `CDP 端口 ${PORT} 被非本仓库的进程占用（pid=${stalePid}${staleExe ? '，' + staleExe : ''}）。` +
          `为避免误杀（例如你自己的 Chrome 恰好开了 ${PORT}），本次 E2E 不启动。` +
          `请释放该端口，或设 E2E_CDP_PORT 为空闲端口后重跑。`,
        );
      }
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(stalePid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(stalePid, 'SIGKILL');
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
