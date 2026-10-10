// E2E 测试：用户反馈页（REQ-006 / P9）自包含 :8137
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8137;
const APP = `http://localhost:${STATIC_PORT}/feedback.html`;

let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('用户反馈页', () => {
  test('表单与统计卡渲染，R1 注入只读', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="feedback-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="injected-ctx"]')).toContainText('user_001');
    await expect(page.locator('[data-testid="stat-confirm"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('必填拦截 + confirm 提交 trust_delta toast', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="fb-submit"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('必填');
    await page.locator('[data-testid="f-memory"]').selectOption('mem_001');
    await page.locator('[data-testid="fb-submit"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('+0.1');
  });

  test('disputed → P7 提示', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="f-memory"]').selectOption('mem_020');
    await page.locator('[data-testid="action-disputed"]').check();
    await expect(page.locator('[data-testid="disputed-hint"]')).toContainText('P7');
    await page.locator('[data-testid="fb-submit"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('P7');
  });

  test('星级与统计联动', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="star-5"]').click();
    await expect(page.locator('[data-testid="feedback-form"]')).toContainText('5/5');
    await expect(page.locator('[data-testid="stat-trust"]')).toContainText('+0.25');
  });
});
