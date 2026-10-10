// E2E 测试：监控仪表盘（REQ-006 / P6）自包含 :8136
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8136;
const APP = `http://localhost:${STATIC_PORT}/monitor.html`;

let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('监控仪表盘', () => {
  test('14 指标卡渲染 + crit/warn 徽标', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="monitor-page"]')).toBeVisible();
    await expect(page.locator('.mcard')).toHaveCount(14);
    await expect(page.locator('[data-testid="metric-熔断状态"]')).toHaveClass(/crit/);
    expect(errors).toEqual([]);
  });

  test('告警时间线 request_id 可点 → toast', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="alert-req-0"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('req_m1');
  });

  test('筛选级别=严重 → 只剩 2 条', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="f-level"]').selectOption('crit');
    await expect(page.locator('[data-testid^="alert-"]').filter({ hasNot: page.locator('div') }).first()).toBeVisible();
    await expect(page.locator('[data-testid="alert-2"]')).toHaveCount(0);
  });

  test('宿主 Agent 筛选联动', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="f-agent"]').selectOption('sync-00');
    await expect(page.locator('[data-testid="alert-0"]')).toContainText('哈希校验');
  });
});
