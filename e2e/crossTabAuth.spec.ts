// E2E 测试：登录态跨 iframe 共享（REQ-005 Bug #3 验证）
// 自包含模式：自带静态服务（8128）+ home 后端（8204），不依赖外部 dev 服务。
// 走 harness（CDP 外部浏览器），避免 browser.close() 挂起问题。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';
import { createServer, registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';
import type { Server } from 'node:http';

const STATIC_PORT = 8128; // 避开 app 8123 / home 8124 / overview 8125 / dbg 8126
const BACKEND_PORT = 8204; // 避开 app 8200 / home 8201 / overview 8202
const APP = `http://localhost:${STATIC_PORT}/overview.html?backend=http://localhost:${BACKEND_PORT}`;
const PWD = 'test_password';

let staticSrv: StaticServer;
let backend: Server;

test.beforeAll(async () => {
  const dataFile = join(tmpdir(), `e2e-xtab-${Date.now()}.json`);
  registerAccount('test_user', hashPassword(PWD), { enterprise_id: 'ent_x', team_id: 'team_x', perspective: 'team' });
  backend = createServer({ port: BACKEND_PORT, dataFile });
  await new Promise<void>((res) => backend.listen(BACKEND_PORT, () => res()));
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  console.error('[xtab] afterAll: closing backend');
  backend.closeAllConnections?.();
  await new Promise<void>((res) => backend.close(() => res()));
  console.error('[xtab] afterAll: backend closed, stopping static');
  await staticSrv.stop();
  console.error('[xtab] afterAll: static stopped, disconnecting browser');
  await disconnectBrowser();
  console.error('[xtab] afterAll: done');
});

test.describe('登录态跨 iframe 共享', () => {
  test('登录后切换页面不应重复登录', async ({ page }) => {
    const errors = collectErrors(page);
    // 打开通览页（顶层 ?backend= 透传给 iframe 内的首页）
    await page.goto(APP);

    // 初始在登录视图，iframe 内首页显示登录门控
    const iframe = page.frameLocator('#stage');
    await expect(iframe.locator('#authGate')).toBeVisible({ timeout: 10_000 });

    // 从门控进入登录卡，登录（打到本 spec 的独立后端）
    await iframe.locator('#btnOpenLoginFromGate').click();
    await expect(iframe.locator('#loginModal')).toBeVisible();
    await iframe.locator('#acc').fill('test_user');
    await iframe.locator('#pwd').fill(PWD);
    await iframe.locator('#btnLogin').click();

    // 登录成功：门控消失、顶栏已登录
    await expect(iframe.locator('#authGate')).not.toBeVisible({ timeout: 10_000 });
    await expect(iframe.locator('#hiAuth')).toBeVisible({ timeout: 10_000 });
    await expect(iframe.locator('#hiAuth')).toContainText('test_user');

    // localStorage 已写入 session（跨 iframe 共享的载体）
    const sessionId = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(sessionId).toBeTruthy();
    expect(sessionId!.length).toBeGreaterThan(0);

    // 切到 Agent 接入配置页：不应出现登录门控（session 共享生效）
    await page.locator('#nav .item').nth(1).click();
    const agentFrame = page.frameLocator('#stage');
    await expect(page.locator('#stage')).toHaveAttribute('src', /\/agentonboard\.html/);
    await expect(agentFrame.locator('.auth-gate')).toHaveCount(0, { timeout: 10_000 });

    // 切回首页：仍保持登录（不重复登录）
    await page.locator('#nav .item').nth(0).click();
    const homeFrame = page.frameLocator('#stage');
    await expect(homeFrame.locator('#hiAuth')).toBeVisible({ timeout: 10_000 });
    await expect(homeFrame.locator('#authGate')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('localStorage 中 session 存在', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`http://localhost:${STATIC_PORT}/index.html?backend=http://localhost:${BACKEND_PORT}`);

    // 未登录时应无 session
    const beforeSession = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(beforeSession).toBeFalsy();

    // 登录
    await page.locator('#btnOpenLogin').click();
    await page.locator('#acc').fill('test_user');
    await page.locator('#pwd').fill(PWD);
    await page.locator('#btnLogin').click();
    await expect(page.locator('#hiAuth')).toBeVisible({ timeout: 10_000 });

    // session 已写入
    const afterSession = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(afterSession).toBeTruthy();
    expect(afterSession!.length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});
