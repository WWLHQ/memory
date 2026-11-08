// E2E 测试：登录态跨页共享（REQ-005 Bug #3 验证）
// 现行架构：login.html 独立登录页（登录成功后写 localStorage session:realpage），
// index.html 由 OverviewPage 承载（读同一份 localStorage 会话，不再有旧首页的登录门控/登录弹窗）。
// 自包含：静态服务 + home 后端（均系统分配端口），不依赖外部 dev 服务；走 harness（CDP 外部浏览器）。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';

const PWD = 'test_password';

let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let LOGIN_APP = '';
let HOME_APP = '';
let ONBOARD_APP = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  const dataFile = join(tmpdir(), `e2e-xtab-${Date.now()}.json`);
  registerAccount('test_user', hashPassword(PWD), { enterprise_id: 'ent_x', team_id: 'team_x', perspective: 'team' });
  backend = await startHomeBackend({ dataFile, allowedOrigins: [`http://localhost:${staticSrv.port}`] });
  const q = `backend=http://localhost:${backend.port}`;
  LOGIN_APP = `http://localhost:${staticSrv.port}/login.html?${q}`;
  HOME_APP = `http://localhost:${staticSrv.port}/index.html?${q}`;
  ONBOARD_APP = `http://localhost:${staticSrv.port}/agentonboard.html?${q}`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

async function login(page: import('playwright-core').Page) {
  await page.goto(LOGIN_APP);
  await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
  await page.locator('#loginAccount').fill('test_user');
  await page.locator('#loginPassword').fill(PWD);
  await page.getByRole('button', { name: /^登录$/ }).click();
  await expect(page.locator('[data-testid="login-session-valid"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="login-session-valid"]')).toContainText('test_user');
}

test.describe('登录态跨页共享', () => {
  test('登录页登录后切到首页/接入页，不重复登录（同一 localStorage 会话）', async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);

    // 会话已写入（跨页共享的载体）
    const sid = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(sid).toBeTruthy();

    // 首页（OverviewPage）：读同一份会话 → 范围行如实显示「已登录」，且不出现登录门控
    await page.goto(HOME_APP);
    await expect(page.locator('[data-testid="overview-page"]')).toBeVisible();
    await expect(page.locator('.ovx-scope')).toContainText('已登录', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: /去登录/ })).toHaveCount(0);

    // 接入页：同样无登录门控（会话共享）
    await page.goto(ONBOARD_APP);
    await expect(page.locator('[data-testid="agent-onboard-page"]')).toBeVisible();
    await expect(page.locator('.auth-gate')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('未登录时 localStorage 无 session；登录后才写入', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(LOGIN_APP);
    await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
    const before = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(before).toBeFalsy();
    await expect(page.locator('[data-testid="login-session-valid"]')).toHaveCount(0);

    await page.locator('#loginAccount').fill('test_user');
    await page.locator('#loginPassword').fill(PWD);
    await page.getByRole('button', { name: /^登录$/ }).click();
    await expect(page.locator('[data-testid="login-session-valid"]')).toBeVisible({ timeout: 10_000 });

    const after = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(after).toBeTruthy();
    expect(after!.length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});
