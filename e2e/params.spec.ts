// E2E 测试：全局参数页（REQ-006 / P5）自包含（系统分配端口）
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/params.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('全局参数页', () => {
  test('三区块渲染 + 默认档位（中/数月/开/重要）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="params-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="speed-mid"]')).toBeChecked();
    await expect(page.locator('[data-testid="retention-months"]')).toBeChecked();
    await expect(page.locator('[data-testid="kb-row-5"]')).toBeVisible(); // 六类知识库
    expect(errors).toEqual([]);
  });

  test('开发者模式展开：权重和/payload/NM 校验', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="dev-panel"] summary').click();
    await expect(page.locator('[data-testid="w-sum"]')).toContainText('和 = 1.00');
    await expect(page.locator('[data-testid="payload-check"]')).toContainText('递增 ✓');
    await expect(page.locator('[data-testid="nm-check"]')).toContainText('N<M ✓');
  });

  test('改遗忘速度 → 待保存 + 保存 toast（真实 req_ 回执）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="speed-fast"]').check();
    await expect(page.locator('[data-testid="changed-list"]')).toContainText('遗忘速度=快');
    await page.locator('[data-testid="save-btn"]').click();
    // 保存 = 内核真写 + param_save 审计，回执 request_id 为运行时生成（非固定种子）
    await expect(page.locator('[data-testid="toast"]')).toContainText(/已保存全局参数（req_/);
    await expect(page.locator('[data-testid="changed-list"]')).toHaveCount(0);
  });

  test('权重破坏 → 保存拦截', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="dev-panel"] summary').click();
    await page.locator('[data-testid="w-w_f"]').fill('0.5');
    await page.locator('[data-testid="save-btn"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('拦截');
  });
});
