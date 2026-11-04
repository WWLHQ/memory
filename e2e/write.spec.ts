// E2E 测试：写入页（REQ-006 / P2）
// 自包含模式：自带静态服务（系统分配端口）serving dist/write.html。
// 批次9 起 L0 落盘必须由主进程密钥环加密：纯浏览器无 L0 端口 → 写入如实报 E_L0_LOCKED，绝不落明文。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/write.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
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

  test('空内容 → 提交禁用', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="submit"]')).toBeDisabled();
  });

  test('纯浏览器无主进程密钥环 → 写入如实报 E_L0_LOCKED，不产生回执/明文落库', async ({ page }) => {
    await page.goto(APP);
    // 批次40-B 起入库门槛会先拦「短且无硬事实」，这句话带 120 秒/504 状态码这类硬事实，
    // 因此能过质量门、把断言打在真正要观测的 E_L0_LOCKED 上。
    await page.locator('[data-testid="f-content"]').fill('部署前必须检查数据库迁移脚本，上次回滚耗时 120 秒，网关报 504 状态码');
    await expect(page.locator('[data-testid="submit"]')).toBeEnabled();
    await page.locator('[data-testid="submit"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('E_L0_LOCKED');
    await expect(page.locator('[data-testid="receipt"]')).toHaveCount(0);
  });
});
