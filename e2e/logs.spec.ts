// E2E 测试：日志记录页（REQ-011 / P15）自包含 :8140
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8140;
const APP = `http://localhost:${STATIC_PORT}/logs.html`;

let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('日志记录页', () => {
  test('全动作事件流渲染 + error 置顶红底（R-LOG1）+ n/a 告警（R-LOG2）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="logs-page"]')).toBeVisible();
    await expect(page.locator('tr[data-testid^="log-"]').first()).toHaveClass(/err-row/);
    await expect(page.locator('[data-testid="missing-warn"]')).toContainText('缺少 request_id');
    expect(errors).toEqual([]);
  });

  test('仅异常开关（验收用例②）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="lf-abnormal"]').check();
    await expect(page.locator('[data-testid="error-aggr"]')).toBeVisible();
    await expect(page.locator('[data-testid="aggr-conflict_pending"]')).toContainText('P8');
  });

  test('查阅审计 → 弹 modal（R-LOG6）→ 关闭收起', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="audit-4"]').click();
    await expect(page.locator('[data-testid="audit-modal"]')).toContainText('审计全链路');
    await page.locator('[data-testid="modal-close"]').click();
    await expect(page.locator('[data-testid="audit-modal"]')).toHaveCount(0);
  });

  test('L0 授权：密码错 → 已记审计；对 → 解锁（R-LOG3）', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="l0-sample"]')).toContainText('[L0 已加密 · 需授权]');
    await page.locator('[data-testid="l0-pwd"]').fill('bad');
    await page.locator('[data-testid="l0-submit"]').click();
    await expect(page.locator('[data-testid="l0-msg"]')).toContainText('已记审计');
    await page.locator('[data-testid="l0-pwd"]').fill('l0pass');
    await page.locator('[data-testid="l0-submit"]').click();
    await expect(page.locator('[data-testid="l0-sample"]')).toContainText('tcp://prod-db:5432/app');
  });

  test('跨端对照：form=web（验收用例③）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="lf-form"]').selectOption('web');
    await expect(page.locator('[data-testid="log-count"]')).toContainText(/\d+/);
    await page.locator('[data-testid="lf-kw"]').fill('req_l03');
    await expect(page.locator('tr[data-testid^="log-"]')).toHaveCount(1);
  });

  test('审计区无普通删除按钮（R-LOG8）', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="logs-page"]')).not.toContainText('删除审计');
  });
});
