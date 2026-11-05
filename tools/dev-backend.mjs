// 本地开发后端：登录服务 + 预置演示账号，供 `npm run dev` / `npm run dev:backend` 使用。
// 默认监听 127.0.0.1:8201（与 src/web/backend.ts 的 HOME_BASE 一致），PORT 可覆盖
// （批次24：8201 被安装版桌面端占用且不信任 5180 来源时，npm run dev 会用 PORT 换备用端口另起一份）。
// 允许 Vite dev 源（5180）跨源调用；生产桌面端仍只信任自身静态端口，不放宽。
// 批次28-A：自动以只读镜像挂上真实记忆账本（memories.db.json）——浏览器页面经
// /api/kernel/invoke 直读桌面端数据；桌面端持有写锁时 dev 后端绝不抢锁（只读 +
// mtime 变化自动重载），写入会得到诚实的 E_STORAGE_LOCKED 提示。
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer, registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';
import { FileStorage } from '../src/core/memagent/fileStorage.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8201);
const DATA = '.data/dev-backend.json';
const DEV_PAGE = '/overview.html';

// 预置演示账号（team_id 由"管理员"分配，只读）：凭据从环境变量注入，缺省回退保持本地 dev 一键可跑；源码不再硬编码明文
const DEV_SEED_USER = process.env.DEV_SEED_USER || 'user_001';
const DEV_SEED_PASSWORD = process.env.DEV_SEED_PASSWORD || 'demo1234';
const DEV_SEED_ENTERPRISE = process.env.DEV_SEED_ENTERPRISE || 'ent_001';
const DEV_SEED_TEAM = process.env.DEV_SEED_TEAM || 'team_001';
registerAccount(DEV_SEED_USER, hashPassword(DEV_SEED_PASSWORD), {
  enterprise_id: DEV_SEED_ENTERPRISE, team_id: DEV_SEED_TEAM, perspective: 'team',
});

// 真实数据根定位：%APPDATA%/MultiAgent Memory/data-root.json 指针 → <root>/memories.db.json。
// 指针/账本不存在（从未跑过桌面端）就不挂内核，页面如实显示「账本为空」而不是报错。
function resolveRealDbPath() {
  const fallback = join(homedir(), 'AppData', 'Roaming', 'MultiAgent Memory');
  let root = null;
  try {
    const pointer = JSON.parse(readFileSync(join(fallback, 'data-root.json'), 'utf8'));
    if (typeof pointer.root === 'string' && pointer.root) root = pointer.root;
  } catch { /* 无指针 → 用默认根 */ }
  const dir = root ?? fallback;
  const db = join(dir, 'memories.db.json');
  return existsSync(db) ? db : null;
}

const dbPath = resolveRealDbPath();
let kernelStorage = null;
let kernelInfo = null;
if (dbPath) {
  kernelStorage = new FileStorage(dbPath, { readonly: true, reloadOnMtime: true });
  kernelInfo = { readonly: true, db_path: dbPath };
  console.log(`[backend] 内核只读镜像：${dbPath}`);
} else {
  console.log('[backend] 未找到真实记忆账本（先运行一次桌面端），浏览器内核将为空账本');
}

const server = createServer({
  port: PORT,
  dataFile: DATA,
  allowDevOrigins: true,
  kernelStorage,
  kernelInfo,
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[backend] ${HOST}:${PORT} 已被占用（可能是桌面端或另一个 dev:backend）。`);
    console.error('[backend] `npm run dev` 会自动改用备用端口；单独跑 dev:backend 请设 PORT=其它端口，或先关闭占用进程。');
  } else {
    console.error(`[backend] 启动失败：${e.message}`);
  }
  process.exitCode = 1;
});
server.listen(PORT, HOST, () => {
  console.log(`[backend] http://${HOST}:${PORT}  演示账号 ${DEV_SEED_USER} / ${DEV_SEED_PASSWORD}`);
  // 非默认端口时页面不会自动发现后端，必须带 ?backend=（npm run dev 已代为拼接）
  if (PORT !== 8201) console.log(`[backend] 页面需显式指定：${DEV_PAGE}?backend=http://${HOST}:${PORT}`);
});

function shutdown() {
  // 只读模式 close() 不落盘不抢写；持有锁时释放锁文件
  void kernelStorage?.close();
}
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
