// E2E 测试：冲突裁决页（REQ-006 / P7）
// 自包含模式：自带静态服务（系统分配端口）serving dist/dispute.html。
// 队列只反映真实账本 pending 冲突（浏览器空账本 → 诚实空态，不灌种子冲突）。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/dispute.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('冲突裁决页 · 真实账本', () => {
  test('空账本 → 无待裁决冲突（诚实空态）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="dispute-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="dispute-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="dispute-empty"]')).toContainText('当前账本无待裁决冲突');
    await expect(page.locator('[data-testid="queue"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="queue-item-"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('空队列无裁决面板与裁决历史', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="verdict-panel"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="panel-old"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="audit-log"]')).toHaveCount(0);
    for (const v of ['auto_override', 'user_confirm', 'merge', 'hold']) {
      await expect(page.locator(`[data-testid="verdict-${v}"]`)).toHaveCount(0);
    }
  });
});
