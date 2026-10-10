// E2E 测试：生命周期页（REQ-006 / P4）自包含：静态服务（8133）serving dist/lifecycle.html。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8133; // 避开 audit 8132 / write 8131 / memory 8130 / register 8129
const APP = `http://localhost:${STATIC_PORT}/lifecycle.html`;

let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('生命周期页', () => {
  test('页面渲染与种子行', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="lifecycle-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="lifecycle-table"]')).toBeVisible();
    await expect(page.locator('[data-testid^="lrow-mem_"]')).toHaveCount(7);
    expect(errors).toEqual([]);
  });

  test('选中联动卡片/调参面板', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="status-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="param-panel"]')).toBeVisible();
  });

  test('单选迁移 active→hibernating', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="mig-hibernating"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('mem_001 → hibernating');
  });

  test('批量迁移 stale→archived', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="chk-mem_015"]').check();
    await page.locator('[data-testid="chk-mem_016"]').check(); // locked 跳过
    await page.locator('[data-testid="batch-target"]').selectOption('archived');
    await page.locator('[data-testid="batch-run"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('批量迁移 1 条 → archived');
  });
});
