// Playwright 配置：真浏览器点击级 E2E（REQ-003 接原型）。
// - 浏览器：globalSetup detached 启动 Chromium，测试用 connectOverCDP 连接（见 e2e/harness.js）
//   原因：本机受限 Windows 下 Playwright 持有浏览器时 browser.close() 挂起，导致 teardown 卡死。
// - 静态站点与真实后端：由 e2e/app.spec.js 在进程内 beforeAll 启动（见 e2e/servers.js）。
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.mjs',
  globalTeardown: './e2e/global-teardown.mjs',
  use: {
    trace: 'off',
  },
});