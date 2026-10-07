// E2E 启动器：① 构建被测产物（vite build → dist/）② 以空 NODE_OPTIONS 拉起 Playwright。
// 清NODE_OPTIONS 的原因：宿主（如 WorkBuddy）会注入 safe-delete shim 拦截 fs.rm，
// 导致 Playwright 清理 test-results 时超时抛错。E2E 无需回收站语义。
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'node_modules', '@playwright', 'test', 'cli.js');

const build = spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit', shell: true });
if (build.status !== 0) {
  console.error('[e2e] vite build 失败（被测产物未生成）');
  process.exit(1);
}

const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: '' },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});