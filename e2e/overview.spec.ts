// REQ-003 + REQ-005 通览页 · 真浏览器点击级 E2E（覆盖最新联合展示入口 overview.html）
// 验证：左导航切换「首页+登录卡片」/「Agent 接入配置页」，右侧 iframe 正确加载对应产物，无脚本异常。
// 被测对象 = Vite 构建产物（dist/overview.html）。iframe 内页面同源由本 spec 的静态服务承载。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';
import { createServer as createBackend, type RunningServer } from '../src/agentOnboard/server.ts';

const STATIC_PORT = 8125; // 避开 app.spec 的 8123 / home.spec 的 8124
const BACKEND_PORT = 8202; // 避开 app.spec 的 8200 / home.spec 的 8201，避免并发端口争用
let staticSrv: StaticServer;
let backend: RunningServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist'); // 服务 Vite 构建产物（含 overview/index/agentonboard）
  backend = await createBackend({ port: BACKEND_PORT, dataFile: join(tmpdir(), `e2e-overview-${Date.now()}.json`) });
});
test.afterAll(async () => {
  backend.server.closeAllConnections?.();
  await backend.stop();
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('REQ-003 + REQ-005 通览页 · 点击级 E2E', () => {
  test('左导航切换两视图，iframe 正确加载首页与接入页', async ({ page }) => {
    const errors = collectErrors(page);
    // ?backend= 透传给 iframe 内的子页面，使其指向本 spec 的独立后端
    await page.goto(`http://localhost:${STATIC_PORT}/overview.html?backend=http://localhost:${BACKEND_PORT}`);

    await expect(page.locator('.top .logo')).toContainText('记忆助手');

    // 默认视图：首页 + 登录卡片（REQ-005）
    await expect(page.locator('#stage')).toHaveAttribute('src', /\/index\.html/);
    await expect(page.frameLocator('#stage').locator('#btnOpenLogin')).toBeVisible();

    // 切到接入配置页（REQ-003）
    await page.click('.nav .item:has-text("Agent 接入配置页")');
    await expect(page.locator('#stage')).toHaveAttribute('src', /\/agentonboard\.html/);
    await expect(page.frameLocator('#stage').locator('#cards > .card')).toHaveCount(3);

    // 切到内联标识演示页（REQ-004，已从规划中提升为已落地）
    await page.click('.nav .item:has-text("Agent 界面内联标识")');
    await expect(page.locator('#stage')).toHaveAttribute('src', /\/inlineattribution\.html/);
    await expect(page.frameLocator('#stage').locator('.mem-tag')).toHaveCount(3);

    expect(errors).toEqual([]);
  });
});
