// E2E 测试：日志记录页（REQ-011 / P15）自包含（系统分配端口）
// 数据真相 = 内核审计账本：空账本 → 无事件流；纯浏览器无登录会话 → L0 授权如实提示需登录（批次9 起）。
// 批次19：程序运行日志卡从首页迁入本页顶部，纯浏览器如实标注不可用。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/logs.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('日志记录页 · 真实账本', () => {
  test('空账本：事件流为空态，无 n/a 告警、无红底错误行', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="logs-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="log-empty"]')).toContainText('无匹配日志');
    await expect(page.locator('tr[data-testid^="log-"]')).toHaveCount(0);
    await expect(page.locator('tr.err-row')).toHaveCount(0);
    // 无日志 → 无缺 request_id 的 n/a 告警（R-LOG2 只在真实日志缺链时出现）
    await expect(page.locator('[data-testid="missing-warn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="log-count"]')).toContainText('命中 0 条');
    expect(errors).toEqual([]);
  });

  test('程序运行日志卡（批次19 从首页迁入）：纯浏览器如实不可用，不渲染假日志', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="program-log"]')).toBeVisible();
    await expect(page.locator('#programLogUnavailable')).toContainText('非桌面壳环境');
    await expect(page.locator('#programLog [data-testid="program-log-line"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('L0 授权：未登录 → 不渲染密码输入，如实提示需登录（不伪造解锁）', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="l0-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="l0-sample"]')).toContainText('[L0 已加密 · 需授权]');
    await expect(page.locator('[data-testid="l0-card"]')).toContainText('未登录（登录后生效）');
    await expect(page.locator('[data-testid="l0-pwd"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="l0-submit"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="l0-grant-id"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="l0-request"]')).toHaveCount(0);
  });

  test('过滤与仅异常开关：空账本仍为空（无错误聚合）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="lf-form"]').selectOption('web');
    await expect(page.locator('[data-testid="log-count"]')).toContainText('命中 0 条');
    await page.locator('[data-testid="lf-abnormal"]').check();
    await expect(page.locator('[data-testid="log-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-aggr"]')).toHaveCount(0);
    await page.locator('[data-testid="lf-kw"]').fill('req_l03');
    await expect(page.locator('tr[data-testid^="log-"]')).toHaveCount(0);
  });

  test('空账本无可查阅审计的行（R-LOG6 需真实记录）', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid^="audit-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="audit-modal"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="modal-close"]')).toHaveCount(0);
  });

  test('审计区无普通删除按钮（R-LOG8）', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="logs-page"]')).not.toContainText('删除审计');
  });
});
