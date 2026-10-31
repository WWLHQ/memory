// E2E 测试：生命周期页（REQ-006 / P4）自包含：静态服务（系统分配端口）serving dist/lifecycle.html。
// 数据真相 = 内核账本（浏览器为进程内单例）：空账本 → 诚实空态，不渲染表格/卡片/调参面板。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/lifecycle.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('生命周期页 · 真实账本', () => {
  test('空账本 → 诚实空态，无种子行/卡片/调参面板', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="lifecycle-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="lifecycle-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="lifecycle-empty"]')).toContainText('当前记忆账本为空');
    await expect(page.locator('[data-testid="lifecycle-table"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="lrow-"]')).toHaveCount(0);
    // 无记录 → 不渲染选中卡片与调参面板（不伪造）
    await expect(page.locator('[data-testid="status-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="param-panel"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('空账本无迁移/批量操作入口', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="mig-hibernating"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="batch-run"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="batch-target"]')).toHaveCount(0);
  });
});
