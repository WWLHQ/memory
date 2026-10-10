// E2E 测试：检索页（REQ-012）自包含 :8139
// 链路：空查询禁用 → 输入 → RESULT → 记住 toast → 硬熔断 ERROR。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8139;
const APP = `http://localhost:${STATIC_PORT}/retrieval.html`;

let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('检索页', () => {
  test('IDLE：空查询禁用检索；session 只读（R1）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="retrieval-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="q-submit"]')).toBeDisabled();
    await expect(page.locator('[data-testid="ctx-note"]')).toContainText('只读');
    expect(errors).toEqual([]);
  });

  test('短查询 → 极简提示 → RESULT：pinned 置顶 + cold 占位', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="q-input"]').fill('修一下这个空指针');
    await expect(page.locator('[data-testid="minimal-hint"]')).toBeVisible();
    await page.locator('[data-testid="q-submit"]').click();
    await expect(page.locator('[data-testid="mode-banner"]')).toContainText('极简轻量');
    const first = page.locator('[data-testid^="hit-"][data-mid]').first();
    await expect(first).toHaveAttribute('data-mid', 'mem_p01'); // pinned 置顶（R3）
    await expect(page.locator('[data-testid="budget-panel"]')).toBeVisible();
  });

  test('记住 → toast（17.3 文案）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="q-input"]').fill('部署前检查清单');
    await page.locator('[data-testid="q-submit"]').click();
    await page.locator('[data-testid="remember-0"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('已提升这条信息的优先级。');
  });

  test('critical 禁极简：切场景 → mode 下拉 minimal 置灰', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="q-scene"]').selectOption('critical');
    const opt = page.locator('[data-testid="q-mode"] option[value="minimal"]');
    await expect(opt).toBeDisabled();
    await expect(page.locator('[data-testid="rerank-chip"]')).toContainText('强制开');
  });

  test('硬熔断 → ERROR + 禁用 3s（§6/R9）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="q-input"]').fill('缓存 TTL 是多少');
    await page.locator('[data-testid="q-submit"]').click();
    await page.locator('[data-testid="demo-breach"]').click();
    await expect(page.locator('[data-testid="error-panel"]')).toContainText('硬熔断');
    await expect(page.locator('[data-testid="q-submit"]')).toBeDisabled(); // 冷却
  });
});
