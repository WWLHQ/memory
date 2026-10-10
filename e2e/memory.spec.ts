// E2E 测试：记忆管理页（REQ-006 / P8）
// 自包含模式：自带静态服务（8130）serving dist/memory.html。
// 该页为独立入口（无登录门控），后端镜像为 safe-noop，无需起 home 后端。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8130; // 避开 register 8129 / xtab 8128 / overview 8125 / app 8123
const APP = `http://localhost:${STATIC_PORT}/memory.html`;

let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('记忆管理页', () => {
  test('列表渲染种子记忆', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="memory-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="memory-table"]')).toBeVisible();
    // 种子行
    await expect(page.locator('[data-testid="row-mem_001"]')).toBeVisible();
    await expect(page.locator('[data-testid="row-mem_007"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('点击「记住」弹出 17.3 toast', async ({ page }) => {
    await page.goto(APP);
    const row = page.locator('[data-testid="row-mem_001"]');
    await row.locator('[data-testid="op-remember"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('已提升这条信息的优先级。');
  });

  test('locked 行「记住」按钮禁用（G4）', async ({ page }) => {
    await page.goto(APP);
    const row = page.locator('[data-testid="row-mem_005"]'); // locked
    await expect(row.locator('[data-testid="op-remember"]')).toBeDisabled();
    await expect(row.locator('[data-testid="op-unlock"]')).toBeEnabled();
  });

  test('点击行打开详情抽屉：content 可编辑，重要度/置信只读（程序通道）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="row-mem_002"]').click();
    await expect(page.locator('[data-testid="memory-drawer"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-content"]')).toBeVisible();
    // importance/confidence 为只读进度条（17.4 程序通道），无滑杆
    await expect(page.locator('[data-testid="ro-importance"]')).toBeVisible();
    await expect(page.locator('[data-testid="ro-confidence"]')).toBeVisible();
    await expect(page.locator('[data-testid="memory-drawer"] input[type="range"]')).toHaveCount(0);
  });
});
