// E2E 测试：自我净化与生长页（REQ-009 / P14）自包含（系统分配端口）
// 数据真相 = 内核账本（浏览器空账本）：指标/判重/Δ 空态诚实展示；
// 手动触发/调度开关 = 真实写 growth_op 审计（同页内可观察到账本变化）。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/growth.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('自我净化与生长页 · 真实账本', () => {
  test('页面渲染：五维卡 + 短路嫁接 + 指标卡 + 优化表 + Δ 面板 + 调度', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="growth-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="dedup-card"]')).toContainText('五维判重');
    await expect(page.locator('[data-testid="sc-flow"]')).toContainText('写入');
    await expect(page.locator('[data-testid="growth-cards"]')).toContainText('检索命中率');
    await expect(page.locator('[data-testid="opt-rows"] tbody tr')).toHaveCount(5);
    await expect(page.locator('[data-testid="delta-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="sched-decay"]')).toContainText('每日 02:00');
    await expect(page.locator('[data-testid="sched-decay"]')).toContainText('记忆衰减（遗忘曲线推进）（不可停）');
    // 批次48 A23.4：调度架构只能说明「调度由桌面端执行」，Web 端不呈现任何「已调度」状态；
    // 运行信息只来自真实审计 —— 浏览器端没有主进程调度记录，必须显示「尚未运行」。
    await expect(page.locator('[data-testid="sched-arch"]')).toContainText('调度由桌面端执行');
    await expect(page.locator('[data-testid="sched-arch"]')).toContainText('本页不执行调度');
    await expect(page.locator('[data-testid="sched-run-self_growth"]')).toContainText('尚未运行');
    await expect(page.locator('[data-testid="sched-run-self_growth"]')).toContainText('schedule_run 记录');
    await expect(page.locator('[data-testid="sched-next-self_growth"]')).toContainText('无记录');
    await expect(page.locator('[data-testid="sched-host-self_growth"]')).toContainText('Web 端不执行调度');
    await expect(page.locator('[data-testid="schedule-timeline"]')).not.toContainText('已调度');
    // 批次48 A23.3：无回归记录 = 未到运行时间，不能显示「无变化」也不能伪造结论
    await expect(page.locator('[data-testid="regression-status"]')).toContainText('未到运行时间');
    expect(errors).toEqual([]);
  });

  test('空账本指标 → ①② 触发、③④⑤ 待命（诚实口径：hit_rate/L6 为 0）', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="opt-state-lower_threshold"]')).toHaveText('已触发');
    await expect(page.locator('[data-testid="opt-state-refine_keyword"]')).toHaveText('已触发');
    await expect(page.locator('[data-testid="opt-state-accelerate_decay"]')).toHaveText('待命');
    await expect(page.locator('[data-testid="opt-state-pre_index"]')).toHaveText('待命');
    await expect(page.locator('[data-testid="opt-state-regress_weights"]')).toHaveText('待命');
    // 账本无数据 → 指标显示「—」/0，不伪造演示数字
    await expect(page.locator('[data-testid="m-hit-rate"]')).toContainText('—');
    await expect(page.locator('[data-testid="m-lowq"]')).toContainText('0.00');
  });

  test('C4/R3：Δ 空态 + 无触发点（真实 7 日反馈为 0）', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="delta-value"]')).toContainText('+0.000');
    await expect(page.locator('[data-testid="delta-panel"]')).toContainText('取自真实 7 日反馈');
    await expect(page.locator('[data-testid="delta-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="delta-chart"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="tuned-point"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="growth-audit"]')).toHaveCount(0);
  });

  test('C3/R4：手动触发自生长 → 冷启动如实 no-op（样本不足，不伪造 weight_tuned）', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="tuned-point"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="regression-status"]')).toContainText('未到运行时间');
    await page.locator('[data-testid="manual-trigger"]').click();
    // 真实回归在没有 dedup_eval 样本时只会写 insufficient_samples 审计：
    // 页面必须如实提示「样本不足 · 正在积累样本」，且不产生任何 weight_tuned 点/曲线
    await expect(page.locator('[data-testid="toast"]')).toContainText('样本不足');
    await expect(page.locator('[data-testid="regression-status"]')).toContainText('样本不足');
    await expect(page.locator('[data-testid="regression-status"]')).toContainText('积累样本，非故障');
    await expect(page.locator('[data-testid="tuned-point"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="delta-chart"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="growth-audit"]')).toHaveCount(0);
  });

  test('判重样本空态：无样本时不伪造综合分；重新判重按钮可用', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="dedup-empty"]')).toContainText('当前记忆账本为空');
    await expect(page.locator('[data-testid="sample-label"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="dedup-score"]')).toHaveCount(0);
    // 空样本下点重新判重不报错、保持空态（样本来自真实记忆）
    await page.locator('[data-testid="resample-btn"]').click();
    await expect(page.locator('[data-testid="dedup-empty"]')).toBeVisible();
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

  test('C6/R5：停用衰减复选框被禁用；其余可停并写真实审计', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="sched-check-decay"]')).toBeDisabled();
    await page.locator('[data-testid="sched-check-archive"]').uncheck();
    await expect(page.locator('[data-testid="toast"]')).toContainText('schedule_changed');
    await expect(page.locator('[data-testid="redline-status"]')).toContainText('合法 ✓');
  });
});
