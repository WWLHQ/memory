// 本地开发后端：登录服务(:8200) + 预置演示账号，供人工测试真实首页
// 用法：node tools/dev-backend.mjs
import { createServer, registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';

const PORT = Number(process.env.PORT || 8200);
const DATA = '.data/dev-backend.json';

// 预置演示账号（team_id 由"管理员"分配，只读）
registerAccount('user_001', hashPassword('demo1234'), {
  enterprise_id: 'ent_001', team_id: 'team_001', perspective: 'team',
});

createServer({ port: PORT, dataFile: DATA }).listen(PORT, () => {
  console.log(`[backend] http://localhost:${PORT}  演示账号 user_001 / demo1234`);
});
