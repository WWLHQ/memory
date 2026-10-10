// E2E 测试：审计日志页（REQ-006 / P11）自包含：静态服务（8132）serving dist/audit.html。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8132; // 避开 write 8131 / memory 8130 / register 8129 / xtab 8128
const APP = `http://localhost:${STATIC_PORT}/audit.html`;

let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('审计日志页', () => {
  test('页面渲染与种子行', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="audit-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="audit-table"]')).toBeVisible();
    await expect(page.locator('[data-testid^="rid-req_a1"]').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('过滤 → 查询只显示匹配行', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="f-action"]').selectOption('write');
    await page.locator('[data-testid="query"]').click();
    await expect(page.locator('tr[data-testid^="row-req_"]')).toHaveCount(1);
  });

  test('点 request_id 展开链路全行', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid^="rid-req_a1"]').first().click();
    await expect(page.locator('tr[data-testid^="row-req_a1-"]')).toHaveCount(3);
  });

  test('导出按钮存在', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="export-csv"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-json"]')).toBeVisible();
  });
});
