// E2E 测试：记忆管理页（REQ-006 / P8）
// 自包含模式：自带静态服务（系统分配端口）serving dist/memory.html。
// 该页为独立入口（无登录门控）；审计上抛真接 /api/mirror/audit，未起 home 后端时失败提示可见但不影响页面数据。
// 注：种子数据已移除（见需求：真实账本无演示数据），测试覆盖空态渲染 + 页面无脚本异常。
// 写入流程由 e2e/write.spec.ts 独立覆盖（纯浏览器如实报 E_L0_LOCKED；真实加密写入在桌面主进程）。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/memory.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('记忆管理页', () => {
  test('空账本渲染空态提示，无表格，无脚本异常', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="memory-page"]')).toBeVisible();
    // 无种子数据 → 空态文案出现
    await expect(page.locator('[data-testid="memory-empty"]')).toBeVisible();
    // 表格不可见（空账本不渲染 table）
    await expect(page.locator('[data-testid="memory-table"]')).not.toBeVisible();
    // 跳转写入页按钮存在
    await expect(page.locator('[data-testid="goto-write"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('页面结构：h1 / sub / 空态文案关键元素', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('h1')).toContainText('记忆库管理页');
    await expect(page.locator('[data-testid="memory-empty"]')).toContainText('记忆账本还是空的');
    await expect(page.locator('[data-testid="memory-empty"]')).toContainText('去「✍️ 写入页」');
  });
});
