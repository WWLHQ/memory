// E2E 测试：检索页（REQ-012）自包含（系统分配端口）
// 数据真相 = 内核账本：空账本 → EMPTY（无可靠证据），不渲染 RESULT 专属的记住/异常演示。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/retrieval.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('检索页 · 真实账本', () => {
  test('IDLE：空查询禁用检索；session 只读（R1）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="retrieval-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="q-submit"]')).toBeDisabled();
    await expect(page.locator('[data-testid="ctx-note"]')).toContainText('只读');
    expect(errors).toEqual([]);
  });

  test('短查询 → 极简提示 → 空账本 EMPTY（不伪造 pinned 命中）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="q-input"]').fill('修一下这个空指针');
    await expect(page.locator('[data-testid="minimal-hint"]')).toBeVisible();
    await page.locator('[data-testid="q-submit"]').click();
    await expect(page.locator('[data-testid="empty-panel"]')).toContainText('没有可靠的记忆证据');
    // 空账本无结果 → 不渲染 RESULT 专属区块（记住按钮/异常演示/预算面板）
    await expect(page.locator('[data-testid="mode-banner"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="hit-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="remember-0"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="demo-breach"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="budget-panel"]')).toHaveCount(0);
  });

  test('空态「切事实优先重试」→ 仍为空（真实账本无证据）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="q-input"]').fill('部署前检查清单');
    await page.locator('[data-testid="q-submit"]').click();
    await expect(page.locator('[data-testid="empty-panel"]')).toBeVisible();
    await page.locator('[data-testid="empty-fact-retry"]').click();
    await expect(page.locator('[data-testid="empty-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-panel"]')).toHaveCount(0);
  });

  test('critical 禁极简：切场景 → mode 下拉 minimal 置灰', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="q-scene"]').selectOption('critical');
    const opt = page.locator('[data-testid="q-mode"] option[value="minimal"]');
    await expect(opt).toBeDisabled();
    await expect(page.locator('[data-testid="rerank-chip"]')).toContainText('强制开');
  });
});
