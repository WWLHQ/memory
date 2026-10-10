// E2E 测试：写入页（REQ-006 / P2）
// 自包含模式：自带静态服务（8131）serving dist/write.html。
// 该页为独立入口（无登录门控），后端镜像为 safe-noop，无需起 home 后端。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8131; // 避开 memory 8130 / register 8129 / xtab 8128 / overview 8125 / app 8123
const APP = `http://localhost:${STATIC_PORT}/write.html`;

let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('写入页', () => {
  test('页面与表单渲染', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="write-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="write-form"]')).toBeVisible();
    // project_id 只读必填（R2）
    await expect(page.locator('[data-testid="f-project"]')).toHaveAttribute('readonly');
    expect(errors).toEqual([]);
  });

  test('空内容 → 提交禁用；填内容 → 提交出回执', async ({ page }) => {
    await page.goto(APP);
    const submit = page.locator('[data-testid="submit"]');
    await expect(submit).toBeDisabled();
    await page.locator('[data-testid="f-content"]').fill('一条新的记忆内容');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.locator('[data-testid="receipt"]')).toBeVisible();
    await expect(page.locator('[data-testid="receipt-id"]')).toHaveText(/^mem_/);
  });

  test('写入回执含 L1–L6 折叠', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="f-content"]').fill('某条新记忆用于回执演示');
    await page.locator('[data-testid="submit"]').click();
    for (const ln of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) {
      await expect(page.locator(`[data-testid="layer-${ln}"]`)).toBeVisible();
    }
  });
});
