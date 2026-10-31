// 一键开发：同时拉起本机登录后端（默认 127.0.0.1:8201）与 Vite（127.0.0.1:5180）。
// `npm run dev` 即开即用：浏览器页面登录不再要求另开终端执行 dev:backend。
// 端口 8201 已有可服务 5180 来源的后端（例如上一次 dev 未退出）时直接复用，不重复起进程。
// 批次24：8201 被「不信任 5180 来源」的进程占用（实测是安装版桌面端自带的登录后端）时
// 不再要求用户先关桌面端——自动改用备用端口起一份受信后端，并把 ?backend= 直接开进浏览器。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const DEV_ORIGIN = `http://${HOST}:5180`;
const HOME_PORT = 8201;
// 8201 被占时的备用端口（与 home server 默认端口错开，仍在本机回环段）
const FALLBACK_PORTS = [8211, 8212, 8213, 8214, 8215];
const DEV_PAGE = '/overview.html';
const backendScript = fileURLToPath(new URL('./dev-backend.mjs', import.meta.url));
const require = createRequire(import.meta.url);
// vite 的 exports 不暴露 bin/vite.js，先定位 package.json 再拼 bin 路径
const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

let backend = null;
let vite = null;
let shuttingDown = false;
const children = [];

function log(msg) {
  console.log(`[dev] ${msg}`);
}

const base = (port) => `http://${HOST}:${port}`;

/** 探活：返回是否可达 + 是否放行 5180 来源（ACAO 头精确匹配） */
async function probeBackend(port) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch(`${base(port)}/api/health`, { headers: { Origin: DEV_ORIGIN }, signal: ctl.signal });
    const acao = r.headers.get('access-control-allow-origin');
    return { reachable: true, devOriginAllowed: r.ok && acao === DEV_ORIGIN };
  } catch {
    return { reachable: false, devOriginAllowed: false };
  } finally {
    clearTimeout(timer);
  }
}

/** 端口能否 listen（能被 listen 才算真空闲，避免和别的进程抢端口） */
function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, HOST);
  });
}

async function waitBackendReady(port, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probeBackend(port)).devOriginAllowed) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function stopChildren() {
  for (const child of children) {
    if (child && child.exitCode === null && !child.killed) {
      try { child.kill(); } catch { /* 已退出 */ }
    }
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopChildren();
  process.exit(code);
}

/** 选一个能用的后端端口：8201 空闲就用它，否则顺延到备用端口；全被占返回 null */
async function pickBackendPort() {
  for (const port of [HOME_PORT, ...FALLBACK_PORTS]) {
    if (await portFree(port)) return port;
  }
  return null;
}

async function startBackend(port) {
  log(`启动本机登录后端 ${base(port)}…`);
  backend = spawn(process.execPath, [backendScript], { stdio: 'inherit', env: { ...process.env, PORT: String(port) } });
  children.push(backend);
  backend.on('exit', (code) => {
    backend = null;
    if (!shuttingDown) log(`登录后端已退出（code=${code ?? 0}）；Vite 继续运行，登录不可用。`);
  });
  if (await waitBackendReady(port)) log(`登录后端就绪：${base(port)}（演示账号 user_001 / demo1234）`);
  else log('登录后端 6 秒内未就绪；请查看上方错误输出。');
  return backend !== null;
}

async function main() {
  const existing = await probeBackend(HOME_PORT);
  let backendPort = HOME_PORT;
  if (existing.devOriginAllowed) {
    log(`复用已在运行的登录后端 ${base(HOME_PORT)}（允许 ${DEV_ORIGIN}）`);
  } else {
    if (existing.reachable) {
      log(`${HOME_PORT} 已有服务但不允许 ${DEV_ORIGIN} 来源（多半是安装版桌面端自带的登录后端）；`
        + '无需关闭桌面端，本次自动改用备用端口。');
    }
    const picked = existing.reachable ? await pickBackendPort() : (await portFree(HOME_PORT) ? HOME_PORT : await pickBackendPort());
    if (picked === null) {
      log(`备用端口 ${FALLBACK_PORTS.join('/')} 也全部被占用，本次不起登录后端（浏览器登录不可用）。`);
    } else {
      backendPort = picked;
      await startBackend(picked);
    }
  }

  // 后端不在默认 8201 时，页面必须知道地址：直接以 ?backend= 打开（vite --open 走自身 opener，不经过 shell）。
  // 同时置 DEV_NO_OPEN，避免配置里的 open 先把无参地址开出来。
  const args = [];
  const env = { ...process.env };
  const viaQuery = backendPort !== HOME_PORT;
  if (viaQuery) {
    const url = `${DEV_PAGE}?backend=${base(backendPort)}&agentBackend=${base(8200)}`;
    env.DEV_NO_OPEN = '1';
    args.push('--open', url);
    log(`浏览器入口（登录后端在备用端口）：${DEV_ORIGIN}${url}`);
    log('若浏览器未自动打开，请手动复制上面的地址；其它页面同样带上 ?backend= 即可。');
  }

  log(`启动 Vite：${DEV_ORIGIN}`);
  vite = spawn(process.execPath, [viteBin, ...args], { stdio: 'inherit', env });
  children.push(vite);
  vite.on('exit', (code) => {
    backend?.kill();
    shutdown(code ?? 0);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main().catch((e) => {
  console.error(`[dev] 启动失败：${String(e?.message ?? e)}`);
  shutdown(1);
});
