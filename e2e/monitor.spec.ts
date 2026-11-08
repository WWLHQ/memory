// E2E 测试：监控仪表盘（REQ-006 / P6）自包含（系统分配端口）
// 指标卡 = 真实账本实算：空账本时 14 卡全部「未采集」（值位不显示数字，不伪造 crit/warn）；
// 告警时间线 = 真实 monitor_alert 审计，空账本 → 诚实空态。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/monitor.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('监控仪表盘 · 真实账本', () => {
  test('14 指标卡渲染：未采集显「未采集」，不伪造 crit/warn', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="monitor-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="metric-grid"]')).toBeVisible();
    await expect(page.locator('.p0-mcard')).toHaveCount(14);
    // 熔断状态无真实探活采样 → 「未采集」且级别 ok（诚实：不伪造严重告警）
    await expect(page.locator('[data-testid="metric-熔断状态"]')).toHaveClass(/ok/);
    await expect(page.locator('[data-testid="metric-熔断状态"]')).toContainText('未采集');
    await expect(page.locator('[data-testid="metric-连通成功率(5min)"]')).toContainText('未采集');
    await expect(page.locator('.p0-mcard.crit')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('告警时间线：空账本 → 诚实空态，无种子告警行', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="alerts-empty"]')).toContainText('当前真实账本无 monitor_alert 告警记录');
    await expect(page.locator('[data-testid^="alert-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="alert-req-"]')).toHaveCount(0);
  });

  test('筛选级别=严重 → 命中 0 条（无告警可筛）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="f-level"]').selectOption('crit');
    await expect(page.locator('[data-testid="monitor-page"]')).toContainText('命中 0 条');
    await expect(page.locator('[data-testid="alerts-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="alert-2"]')).toHaveCount(0);
  });

  test('宿主 Agent 筛选：选项由真实账本派生，空账本只保留「全部」', async ({ page }) => {
    await page.goto(APP);
    const opts = page.locator('[data-testid="f-agent"] option');
    // 批次48 A25：不再内置 coder-01 / writer-02 / sync-00 之类占位名；空账本 = 仅「全部」
    await expect(opts).toHaveCount(1);
    await expect(page.locator('[data-testid="f-agent"]')).toContainText('全部');
    await expect(page.locator('[data-testid="f-agent"]')).not.toContainText('sync-00');
    await expect(page.locator('[data-testid="f-agent"]')).not.toContainText('coder-01');
    await page.locator('[data-testid="f-agent"]').selectOption('all');
    await expect(page.locator('[data-testid="monitor-page"]')).toContainText('命中 0 条');
    await expect(page.locator('[data-testid="alerts-empty"]')).toBeVisible();
  });
});
