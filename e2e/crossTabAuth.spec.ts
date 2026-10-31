// E2E 测试：登录态跨 iframe 共享（REQ-005 Bug #3 验证）
// 自包含模式：静态服务 + home 后端（均系统分配端口），不依赖外部 dev 服务。
// 走 harness（CDP 外部浏览器），避免 browser.close() 挂起问题。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';

const PWD = 'test_password';

let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let APP = '';
let HOME_APP = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  const dataFile = join(tmpdir(), `e2e-xtab-${Date.now()}.json`);
  registerAccount('test_user', hashPassword(PWD), { enterprise_id: 'ent_x', team_id: 'team_x', perspective: 'team' });
  backend = await startHomeBackend({ dataFile, allowedOrigins: [`http://localhost:${staticSrv.port}`] });
  APP = `http://localhost:${staticSrv.port}/overview.html?backend=http://localhost:${backend.port}`;
  HOME_APP = `http://localhost:${staticSrv.port}/index.html?backend=http://localhost:${backend.port}`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
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
    await page.goto(HOME_APP);

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
