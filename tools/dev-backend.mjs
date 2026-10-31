// 本地开发后端：登录服务 + 预置演示账号，供 `npm run dev` / `npm run dev:backend` 使用。
// 默认监听 127.0.0.1:8201（与 src/web/backend.ts 的 HOME_BASE 一致），PORT 可覆盖
// （批次24：8201 被安装版桌面端占用且不信任 5180 来源时，npm run dev 会用 PORT 换备用端口另起一份）。
// 允许 Vite dev 源（5180）跨源调用；生产桌面端仍只信任自身静态端口，不放宽。
import { createServer, registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8201);
const DATA = '.data/dev-backend.json';
const DEV_PAGE = '/overview.html';

// 预置演示账号（team_id 由"管理员"分配，只读）
registerAccount('user_001', hashPassword('demo1234'), {
  enterprise_id: 'ent_001', team_id: 'team_001', perspective: 'team',
});

const server = createServer({ port: PORT, dataFile: DATA, allowDevOrigins: true });
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
  console.log(`[backend] http://${HOST}:${PORT}  演示账号 user_001 / demo1234`);
  // 非默认端口时页面不会自动发现后端，必须带 ?backend=（npm run dev 已代为拼接）
  if (PORT !== 8201) console.log(`[backend] 页面需显式指定：${DEV_PAGE}?backend=http://${HOST}:${PORT}`);
});
