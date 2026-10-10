// E2E 测试：自我净化与生长页（REQ-009 / P14）自包含 :8142
// 覆盖：C1/C2/C5 优化触发、C3 手动自生长+weight_tuned、C4/R3 Δ 只读、C6/R5 停衰减拒、R1 权重校验
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8142;
const APP = `http://localhost:${STATIC_PORT}/growth.html`;

let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('自我净化与生长页', () => {
  test('页面渲染：五维卡 + 短路嫁接 + 指标卡 + 优化表 + Δ 曲线 + 调度', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="growth-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="dedup-card"]')).toContainText('五维判重');
    await expect(page.locator('[data-testid="sc-flow"]')).toContainText('写入');
    await expect(page.locator('[data-testid="growth-cards"]')).toContainText('检索命中率');
    await expect(page.locator('[data-testid="opt-rows"] tbody tr')).toHaveCount(5);
    await expect(page.locator('[data-testid="delta-chart"]')).toBeVisible();
    await expect(page.locator('[data-testid="sched-decay"]')).toContainText('每日 02:00');
    expect(errors).toEqual([]);
  });

  test('C2：种子 hit_rate=0.28 → ① 降阈值触发；C5：L6=0.42 → ② 触发', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="opt-state-lower_threshold"]')).toHaveText('已触发');
    await expect(page.locator('[data-testid="opt-state-refine_keyword"]')).toHaveText('已触发');
    await expect(page.locator('[data-testid="opt-state-accelerate_decay"]')).toHaveText('已触发');
    await expect(page.locator('[data-testid="opt-state-pre_index"]')).toHaveText('待命');
  });

  test('C4/R3：Δ 取自真实反馈只读展示', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="delta-value"]')).toContainText('+0.050');
    await expect(page.locator('[data-testid="delta-panel"]')).toContainText('取自真实 7 日反馈');
  });

  test('C3/R4：手动触发自生长 → 曲线追加触发点 + weight_tuned 审计', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="tuned-point"]')).toHaveCount(1); // 种子周日点
    await page.locator('[data-testid="manual-trigger"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('weight_tuned');
    await expect(page.locator('[data-testid="tuned-point"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="growth-audit"]')).toContainText('weight_tuned');
    await expect(page.locator('[data-testid="growth-audit"]')).toContainText('manual');
  });

  test('「重新判重」换样本：综合分与判定联动', async ({ page }) => {
    await page.goto(APP);
    const first = await page.locator('[data-testid="sample-label"]').textContent();
    await page.locator('[data-testid="resample-btn"]').click();
    await expect(page.locator('[data-testid="sample-label"]')).not.toHaveText(first ?? '');
    await expect(page.locator('[data-testid="dedup-score"]')).toBeVisible();
  });

  test('R1：开发者模式改权重和≠1 → 报错；改阈值破坏单调 → 报错', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="dev-mode"]').check();
    await expect(page.locator('[data-testid="dev-tune-panel"]')).toBeVisible();
    await page.locator('[data-testid="w-semantic"]').fill('0.40');
    await expect(page.locator('[data-testid="tune-errors"]')).toContainText('R1');
    await expect(page.locator('[data-testid="tune-errors"]')).toContainText('1.0500');
    // 恢复权重，破坏阈值单调（L3 低于 L2）
    await page.locator('[data-testid="w-semantic"]').fill('0.35');
    await expect(page.locator('[data-testid="tune-errors"]')).toHaveCount(0);
    await page.locator('[data-testid="th-L3"]').fill('0.72');
    await expect(page.locator('[data-testid="tune-errors"]')).toContainText('单调不减');
  });

  test('C6/R5：停用衰减复选框被禁用；其余可停', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="sched-check-decay"]')).toBeDisabled();
    await page.locator('[data-testid="sched-check-archive"]').uncheck();
    await expect(page.locator('[data-testid="toast"]')).toContainText('schedule_changed');
    await expect(page.locator('[data-testid="redline-status"]')).toContainText('合法 ✓');
  });
});
