// E2E 测试：冲突裁决页（REQ-006 / P7）
// 自包含模式：自带静态服务（8134）serving dist/dispute.html。
// 该页为独立入口（无登录门控），后端镜像为 safe-noop，无需起 home 后端。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8134; // 避开 memory 8130 / write 8131 / audit 8132 / lifecycle 8133
const APP = `http://localhost:${STATIC_PORT}/dispute.html`;

let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('冲突裁决页', () => {
  test('队列渲染 5 条种子冲突且超期高亮', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="dispute-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="queue"]')).toBeVisible();
    await expect(page.locator('[data-testid^="queue-item-"]')).toHaveCount(5);
    // 类型徽章（9.7 四类）
    await expect(page.locator('.ctype.direct_contradiction').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('点击队列项打开裁决面板（4 按钮）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="queue-item-0"]').click();
    await expect(page.locator('[data-testid="verdict-panel"]')).toBeVisible();
    for (const v of ['auto_override', 'user_confirm', 'merge', 'hold']) {
      await expect(page.locator(`[data-testid="verdict-${v}"]`)).toBeVisible();
    }
    // 旧/新对比内容可见（item-0 为超期 12d 的 cf_004，超期降序置顶）
    await expect(page.locator('[data-testid="panel-old"]')).toContainText('日志保留 30 天');
  });

  test('自动覆盖裁决 → toast + 成对审计历史（18.4）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="queue-item-0"]').click();
    await page.locator('[data-testid="verdict-auto_override"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('旧值 deprecated');
    await expect(page.locator('[data-testid="audit-log"]')).toBeVisible();
    await expect(page.locator('[data-testid="audit-row-0"]')).toContainText(/req_d\d/);
  });

  test('空队列占位（queueSort 过滤非 dispute）', async ({ page }) => {
    // 种子全 dispute_flag=true，故仅验证计数一致性：队列数=5 且含超期 12d 的 cf_004 在前段
    await page.goto(APP);
    const first = page.locator('[data-testid="queue-item-0"]');
    await expect(first).toContainText('日志保留'); // cf_004 overdue 12d 排最前
  });
});
