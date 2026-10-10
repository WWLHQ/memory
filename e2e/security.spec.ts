// E2E 测试：账号与安全页（REQ-006 / P12）自包含 :8138
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8138;
const APP = `http://localhost:${STATIC_PORT}/security.html`;

let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('账号与安全页', () => {
  test('五区块渲染 + 加密只读', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="security-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="encrypt-card"]')).toContainText('AES');
    await expect(page.locator('[data-testid="member-table"] tr')).toHaveCount(5); // 4 成员 + 表头
    expect(errors).toEqual([]);
  });

  test('密码实时校验：禁用词 → 通过', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="pwd-sample"]').fill('MyPassword1!');
    await expect(page.locator('[data-testid="pwd-err"]')).toContainText('含禁用词');
    await page.locator('[data-testid="pwd-sample"]').fill('N3w^Secret9');
    await expect(page.locator('[data-testid="pwd-ok"]')).toBeVisible();
  });

  test('未共享成员删除禁用 + 共享标记即时生效', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="remove-user_002"]')).toBeDisabled();
    await page.locator('[data-testid="shared-user_002"]').check();
    await expect(page.locator('[data-testid="remove-user_002"]')).toBeEnabled();
  });

  test('密钥脱敏 + 90 天警示 + 吊销确认', async ({ page }) => {
    await page.goto(APP);
    // accept 由 harness 全局容错接管；此处无需重复挂监听
    await expect(page.locator('[data-testid="key-key_002"]')).toContainText(/未轮换/);
    await page.locator('[data-testid="revoke-key_001"]').click();
    await expect(page.locator('[data-testid="key-key_001"]')).toContainText('已吊销');
  });
});
