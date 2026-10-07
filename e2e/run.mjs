// E2E 启动器：清掉 NODE_OPTIONS 后再跑 Playwright。
// 原因：宿主（如 WorkBuddy）会注入 safe-delete shim 拦截 fs.rm，导致 Playwright 清理
// test-results 时超时抛错。E2E 无需回收站语义，故在此剥离该注入。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'node_modules', '@playwright', 'test', 'cli.js');

const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: '' },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});