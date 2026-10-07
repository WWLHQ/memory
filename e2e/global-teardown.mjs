// 关闭 globalSetup 启动的 detached Chromium。taskkill 被安全策略拦截时静默失败：
// runner 本身不拥有该进程，不影响测试退出码。
import { readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const CDE_FILE = join(dirname(fileURLToPath(import.meta.url)), '.cde.json');

export default async function globalTeardown() {
  try {
    const { pid } = JSON.parse(readFileSync(CDE_FILE, 'utf-8'));
    try {
      execSync(`taskkill /F /PID ${pid} >NUL 2>&1`, { stdio: 'ignore' });
      console.error(`[e2e] 已关闭 Chromium (pid=${pid})`);
    } catch {
      console.error(`[e2e] 未能关闭 Chromium (pid=${pid})，已忽略（不影响退出码）`);
    }
  } catch {
    /* .cde.json 不存在：忽略 */
  }
  try { unlinkSync(CDE_FILE); } catch { /* 忽略 */ }
}