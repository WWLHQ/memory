// E2E 测试：记忆管理页（REQ-006 / P8）
// 自包含模式：自带静态服务（系统分配端口）serving dist/memory.html。
// 当前入口挂 MemoryManagementPage（六页签版），旧单表版 MemoryPage 已不在路由上。
// 注：账本无种子数据（真实账本诚实空态），测试覆盖空态渲染 + 六页签结构 + 无脚本异常。
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
  test('空账本渲染诚实空态，无表格，无脚本异常', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="mm-page"]')).toBeVisible();
    // 无种子数据 → 空态文案出现（真实 0 条，不注入演示条目）
    await expect(page.locator('[data-testid="mm-empty-ledger"]')).toBeVisible();
    await expect(page.locator('[data-testid="mm-empty-ledger"]')).toContainText('账本暂无记忆（真实 0 条）');
    // 表格不可见（空账本不渲染 table）
    await expect(page.locator('[data-testid="memory-table"]')).not.toBeVisible();
    // 真源条：说明空态不是读取失败，也不是演示数据
    await expect(page.locator('[data-testid="mm-truthbar"]')).toContainText('记忆管理');
    expect(errors).toEqual([]);
  });

  test('页面结构：六页签 + 筛选条可用 + 切页签不报错', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('.mm-tabstrip')).toHaveAttribute('aria-label', '记忆管理标签');
    for (const id of ['all', 'personal', 'layers', 'conflict', 'review', 'l0']) {
      await expect(page.locator(`[data-testid="mm-tab-${id}"]`)).toBeVisible();
    }
    // 默认「全部记忆」页签带筛选条
    await expect(page.locator('[data-testid="mm-filter"]')).toBeVisible();
    await expect(page.getByLabel('搜索记忆')).toBeVisible();

    // 切到「分层 L1–L6」应渲染分层矩阵（真实层策略），再切回全部
    await page.locator('[data-testid="mm-tab-layers"]').click();
    await expect(page.locator('[data-testid="mm-layer-matrix"]')).toBeVisible();
    await page.locator('[data-testid="mm-tab-all"]').click();
    await expect(page.locator('[data-testid="mm-empty-ledger"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
