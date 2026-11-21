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

  // 2026-11-21 用户打回：空账本原来是「双栏对比 / 裁决方式 / 裁决历史」被条件渲染整块吞掉。
  // 现在锁定四块结构常驻：只有行与选中态随数据变化，面板、表头、禁用原因必须都在。
  test('空队列：四块结构常驻（筛选行 / 双栏占位 / 裁决方式禁用 / 历史表头+空态行）', async ({ page }) => {
    await page.goto(APP);
    // ① 待裁决队列：筛选行 + 计数 + 表头骨架
    await expect(page.locator('[data-testid="dispute-filter"]')).toBeVisible();
    await expect(page.locator('[data-testid="dispute-filter-all"]')).toContainText('待裁决队列（0）');
    await expect(page.locator('[data-testid="dispute-filter-overdue"]')).toContainText('超期 >7 天（0）');
    await expect(page.locator('[data-testid="dispute-filter-type"]')).toBeDisabled();
    await expect(page.locator('[data-testid="dispute-empty"]')).toContainText('conflict_id');
    // ② 双栏对比：标题与未选中占位常驻，两侧面板不出现
    await expect(page.locator('[data-testid="compare-panel"]')).toContainText('双栏对比');
    await expect(page.locator('[data-testid="compare-empty"]')).toContainText('在队列中选择一条冲突查看对照');
    await expect(page.locator('[data-testid="panel-old"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="panel-new"]')).toHaveCount(0);
    // ③ 裁决方式与动作：人工可用、AI 禁用写原因、四项动作常驻但禁用
    await expect(page.locator('[data-testid="dispute-mode-human"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="dispute-mode-ai"]')).toBeDisabled();
    await expect(page.locator('[data-testid="dispute-mode-ai"]')).toHaveAttribute('title', /内核未提供 AI 裁决通道/);
    await expect(page.locator('[data-testid="verdict-panel"]')).toBeVisible();
    for (const v of ['auto_override', 'user_confirm', 'merge', 'hold']) {
      await expect(page.locator(`[data-testid="verdict-${v}"]`)).toBeDisabled();
    }
    // ④ 裁决历史：表头常驻，无记录时一行如实空态
    await expect(page.locator('[data-testid="audit-log"]')).toContainText('request_id');
    await expect(page.locator('[data-testid="audit-log"]')).toContainText('动作');
    await expect(page.locator('[data-testid="audit-log"]')).toContainText('note');
    await expect(page.locator('[data-testid="history-empty"]')).toContainText('暂无裁决记录');
    await expect(page.locator('[data-testid^="audit-row-"]')).toHaveCount(0);
  });
});
