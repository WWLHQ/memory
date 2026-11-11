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
    // 修复轮3 版式：masthead 在 tab 栏上方（无英文缀标，写密钥状态并入右侧）
    const masthead = page.locator('.wf-masthead');
    await expect(masthead).toContainText('写入记忆');
    await expect(masthead).not.toContainText('WRITE');
    await expect(masthead).not.toContainText('INGEST');
    await expect(masthead.locator('[data-testid="write-key-status"]')).toBeVisible();
    await expect(page.locator('[data-testid="recent-writes-empty"]')).toContainText('真实 0 条');
    await expect(page.locator('.wf-unlock')).toBeVisible();
    // 修复轮3：project_id 用户可修改（不再是 readonly）
    await expect(page.locator('[data-testid="f-project"]')).not.toHaveAttribute('readonly');
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
    // 批次41-W：写密钥锁定不再甩原始 `E_L0_LOCKED`，而是就地出「解锁写密钥」提示（正文见 L0WriteUnlock 卡），
    // toast 改为面向人的措辞。断言打在「L0 写密钥未解锁」这句上（真锁定的稳定信号），不再要求原始错误码字面量。
    await expect(page.locator('[data-testid="toast"]')).toContainText('L0 写密钥未解锁');
    await expect(page.locator('[data-testid="receipt"]')).toHaveCount(0);
  });
});
