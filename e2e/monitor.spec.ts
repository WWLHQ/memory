// E2E 测试：监控仪表盘（REQ-006 / P6）自包含（系统分配端口）
// 指标卡 = 真实账本实算：空账本时 14 卡全部「—」未采集（ok，不伪造 crit/warn）；
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
  test('14 指标卡渲染：未采集显「—」，不伪造 crit/warn', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="monitor-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="metric-grid"]')).toBeVisible();
    await expect(page.locator('.mcard')).toHaveCount(14);
    // 熔断状态无真实探活采样 → 「—」且级别 ok（诚实：不伪造严重告警）
    await expect(page.locator('[data-testid="metric-熔断状态"]')).toHaveClass(/ok/);
    await expect(page.locator('[data-testid="metric-熔断状态"]')).toContainText('—');
    await expect(page.locator('[data-testid="metric-连通成功率(5min)"]')).toContainText('—');
    await expect(page.locator('.mcard.crit')).toHaveCount(0);
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

  test('宿主 Agent 筛选：选项来自真实宿主清单，空账本仍 0 条', async ({ page }) => {
    await page.goto(APP);
    const opts = page.locator('[data-testid="f-agent"] option');
    await expect(opts).toHaveCount(4);
    await expect(page.locator('[data-testid="f-agent"]')).toContainText('sync-00');
    await page.locator('[data-testid="f-agent"]').selectOption('sync-00');
    await expect(page.locator('[data-testid="monitor-page"]')).toContainText('命中 0 条');
    await expect(page.locator('[data-testid="alerts-empty"]')).toBeVisible();
  });
});
