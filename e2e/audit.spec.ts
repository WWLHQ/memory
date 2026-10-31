// E2E 测试：审计日志页（REQ-006 / P11）自包含：静态服务（系统分配端口）serving dist/audit.html。
// 数据真相 = 内核审计账本（浏览器为进程内单例）：未产生审计 → 空态行，不伪造种子记录。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/audit.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('审计日志页 · 真实账本', () => {
  test('空账本：表结构渲染 + 空态行，无种子记录', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="audit-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="audit-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="audit-table"] tbody')).toContainText('无匹配审计记录');
    await expect(page.locator('tr[data-testid^="row-"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('过滤 → 查询仍为空（真实账本无匹配）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="f-action"]').selectOption('write');
    await page.locator('[data-testid="query"]').click();
    await expect(page.locator('tr[data-testid^="row-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="audit-table"] tbody')).toContainText('无匹配审计记录');
    // 重置后仍为空态（未产生任何真实审计）
    await page.locator('[data-testid="reset"]').click();
    await expect(page.locator('[data-testid="audit-table"] tbody')).toContainText('无匹配审计记录');
  });

  test('空账本无可点击的 request_id 链路', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid^="rid-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="clear-chain"]')).toHaveCount(0);
  });

  test('导出按钮存在（空集也可导出）', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="export-csv"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-json"]')).toBeVisible();
  });
});
