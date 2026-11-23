// E2E 测试：自我净化与生长页（REQ-009 / P14）自包含（系统分配端口）
// 数据真相 = 内核账本（浏览器空账本）：指标/判重/Δ 空态诚实展示；
// 手动触发/调度开关 = 真实写 growth_op 审计（同页内可观察到账本变化）。
// 现行结构：3 个页签（gtab-0 判重与嫁接 / gtab-1 回归评估 / gtab-2 调度），只渲染当前页签；
//   「红线自检」卡已并入判重与嫁接页签（2026-11-22 用户要求），不再有独立页签；
//   「开发者模式」开关与校验错误横幅在页头，任何页签都可见。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';
import type { Page } from 'playwright-core';

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

/** 切到指定页签（0 判重与嫁接 / 1 回归评估 / 2 调度） */
async function gtab(page: Page, i: 0 | 1 | 2): Promise<void> {
  await page.locator(`[data-testid="gtab-${i}"]`).click();
  await expect(page.locator(`[data-testid="gtab-${i}"]`)).toHaveAttribute('aria-selected', 'true');
}

test.describe('自我净化与生长页 · 真实账本', () => {
  test('页面渲染：五维卡 + 短路嫁接 + 指标卡 + 优化表 + Δ 面板 + 调度', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="growth-page"]')).toBeVisible();
    // 判重与嫁接页
    await expect(page.locator('[data-testid="dedup-card"]')).toContainText('五维判重');
    await expect(page.locator('[data-testid="sc-flow"]')).toContainText('写入');
    // 回归评估页
    await gtab(page, 1);
    await expect(page.locator('[data-testid="growth-cards"]')).toContainText('检索命中率');
    await expect(page.locator('[data-testid="opt-rows"] tbody tr')).toHaveCount(5);
    await expect(page.locator('[data-testid="delta-panel"]')).toBeVisible();
    // 批次48 A23.3：无回归记录 = 未到运行时间，不能显示「无变化」也不能伪造结论
    await expect(page.locator('[data-testid="regression-status"]')).toContainText('未到运行时间');
    // 调度页
    await gtab(page, 2);
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
    expect(errors).toEqual([]);
  });

  test('空账本指标 → ①② 触发、③④⑤ 待命（诚实口径：hit_rate/L6 未取数）', async ({ page }) => {
    await page.goto(APP);
    await gtab(page, 1);
    await expect(page.locator('[data-testid="opt-state-lower_threshold"]')).toHaveText('已触发');
    await expect(page.locator('[data-testid="opt-state-refine_keyword"]')).toHaveText('已触发');
    await expect(page.locator('[data-testid="opt-state-accelerate_decay"]')).toHaveText('待命');
    await expect(page.locator('[data-testid="opt-state-pre_index"]')).toHaveText('待命');
    await expect(page.locator('[data-testid="opt-state-regress_weights"]')).toHaveText('待命');
    // 账本无数据 → 命中率显示「未取数」（不写死 0 冒充读数），低质占比真实 0.00
    await expect(page.locator('[data-testid="m-hit-rate"]')).toContainText('未取数');
    await expect(page.locator('[data-testid="m-lowq"]')).toContainText('0.00');
  });

  test('C4/R3：Δ 空态 + 无触发点（真实 7 日反馈为 0）', async ({ page }) => {
    await page.goto(APP);
    await gtab(page, 1);
    // 2026-11-14 假改善修复后：无基线写「Δ 无基线」，不再用 +0.000 冒充真实变化
    await expect(page.locator('[data-testid="delta-value"]')).toContainText('无基线');
    await expect(page.locator('[data-testid="delta-panel"]')).toContainText('取自真实 7 日反馈');
    await expect(page.locator('[data-testid="delta-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="delta-chart"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="tuned-point"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="growth-audit"]')).toHaveCount(0);
  });

  test('C3/R4：手动触发自生长 → 冷启动如实 no-op（样本不足，不伪造 weight_tuned）', async ({ page }) => {
    await page.goto(APP);
    await gtab(page, 1);
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
    // 开发者模式开关在页头，调参面板在「判重与嫁接」页签
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
    // 调度页签
    await gtab(page, 2);
    await expect(page.locator('[data-testid="sched-check-decay"]')).toBeDisabled();
    await page.locator('[data-testid="sched-check-archive"]').uncheck();
    await expect(page.locator('[data-testid="toast"]')).toContainText('schedule_changed');
    // 红线自检卡已并入「判重与嫁接」页签（不再有独立页签）
    await gtab(page, 0);
    await expect(page.locator('[data-testid="growth-sec-check"]')).toBeVisible();
    await expect(page.locator('[data-testid="redline-status"]')).toContainText('合法 ✓');
  });

  test('结构：红线自检卡在「判重与嫁接」页签内，且不存在第 4 个页签', async ({ page }) => {
    await page.goto(APP);
    // 只有 3 个页签
    await expect(page.locator('[data-testid^="gtab-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="gtab-3"]')).toHaveCount(0);
    // 判重与嫁接页签内可见红线自检卡（真值来自 wCheck/tCheck/sCheck 校验）
    await gtab(page, 0);
    await expect(page.locator('[data-testid="growth-sec-check"]')).toBeVisible();
    await expect(page.locator('[data-testid="growth-sec-check"]')).toContainText('红线自检');
    await expect(page.locator('[data-testid="redline-status"]')).toContainText('合法 ✓');
    // 切到其它页签时该卡不挂载（不是重复渲染到每个页签）
    await gtab(page, 1);
    await expect(page.locator('[data-testid="growth-sec-check"]')).toHaveCount(0);
    await gtab(page, 2);
    await expect(page.locator('[data-testid="growth-sec-check"]')).toHaveCount(0);
  });

  test('新增：顶部摘要读数条 + 四个真实场景分组（空账本诚实，无审计写未采样）', async ({ page }) => {
    await page.goto(APP);
    // 摘要条：账本规模 / 命中率 / 回归 / growth 审计 四项读数
    const summary = page.locator('[data-testid="growth-summary"]');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('账本记忆');
    await expect(summary).toContainText('最近回归');
    await expect(summary).toContainText('未到运行时间');
    // 空账本无召回审计 → 命中率卡必须写「未采样」，不许写 0 冒充读数
    await expect(page.locator('[data-testid="growth-stat-hitrate"]')).toContainText('未采样');
    // 四个场景分组：净化处置 / 指标回归 / 参数范围 / 审计留痕
    for (const id of ['dedup', 'metrics', 'params', 'audit']) {
      await expect(page.locator(`[data-testid="growth-group-${id}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid="growth-group-dedup"]')).toContainText('判重样本');
    await expect(page.locator('[data-testid="growth-group-params"]')).toContainText('权重和');
    await expect(page.locator('[data-testid="growth-group-audit"]')).toContainText('growth_op 条目');
    // 场景卡动作真跳转到原面板（能力未丢）
    await page.locator('[data-testid="growth-jump-dedup"]').click();
    await expect(page.locator('[data-testid="dedup-card"]')).toBeVisible();
    await page.locator('[data-testid="growth-jump-metrics"]').click();
    await expect(page.locator('[data-testid="growth-cards"]')).toBeVisible();
  });

  test('几何：四组卡 2×2 同宽同排等高；页签卡片两列等高、无空网格', async ({ page }) => {
    await page.goto(APP);
    // 等四组卡渲染完成再量几何（否则 evaluate 取到 null）
    for (const id of ['dedup', 'metrics', 'params', 'audit']) {
      await expect(page.locator(`[data-testid="growth-group-${id}"]`)).toBeVisible();
    }
    const g = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom };
      };
      return {
        dedup: r('[data-testid="growth-group-dedup"]'),
        metrics: r('[data-testid="growth-group-metrics"]'),
        params: r('[data-testid="growth-group-params"]'),
        audit: r('[data-testid="growth-group-audit"]'),
      };
    });
    for (const k of ['dedup', 'metrics', 'params', 'audit'] as const) expect(g[k]).not.toBeNull();
    // 2×2：同排左边界一致，宽度相等
    expect(Math.abs(g.dedup!.x - g.params!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.metrics!.x - g.audit!.x)).toBeLessThanOrEqual(1);
    for (const k of ['metrics', 'params', 'audit'] as const) {
      expect(Math.abs(g[k]!.w - g.dedup!.w)).toBeLessThanOrEqual(1);
    }
    // 同一行等高
    expect(Math.abs(g.dedup!.h - g.metrics!.h)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.params!.h - g.audit!.h)).toBeLessThanOrEqual(1);

    // 判重页签：两列卡片同排等高，调参卡跨两列填满，不留空网格
    await gtab(page, 0);
    // 调参面板仅在开发者模式开启后渲染（真实行为），这里显式打开再量几何
    await page.locator('[data-testid="dev-mode"]').check();
    await expect(page.locator('[data-testid="dev-tune-panel"]')).toBeVisible();
    const t = await page.evaluate(() => {
      // 量外层网格单元（卡片内部各自有标题/padding，直接量内层会得到不同 y）
      const cell = (sel: string) => {
        const el = document.querySelector(sel);
        const c = el ? el.closest('.gt-cell') : null;
        if (!c) return null;
        const b = c.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      return {
        dedup: cell('[data-testid="dedup-card"]'),
        flow: cell('[data-testid="sc-flow"]'),
        tune: cell('[data-testid="dev-tune-panel"]'),
      };
    });
    expect(t.dedup).not.toBeNull();
    expect(t.flow).not.toBeNull();
    expect(t.tune).not.toBeNull();
    expect(Math.abs(t.dedup!.y - t.flow!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.dedup!.w - t.flow!.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.dedup!.h - t.flow!.h)).toBeLessThanOrEqual(1);
    // 调参卡占满两列（宽度 ≈ 两张卡 + 间距），且换行在下一排
    expect(t.tune!.w).toBeGreaterThan(t.dedup!.w * 1.8);
    expect(t.tune!.y).toBeGreaterThanOrEqual(t.dedup!.y + t.dedup!.h - 1);
  });

  test('白底：三个页签内的卡片底色 = --surface（浅色 #FFFFFF / 深色 #0C1424）', async ({ page }) => {
    await page.goto(APP);
    const readBg = () => page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.af-page .card'))
        .filter((el) => (el as HTMLElement).offsetParent !== null);
      return cards.map((el) => getComputedStyle(el as HTMLElement).backgroundColor);
    });
    for (const i of [0, 1, 2] as const) {
      await gtab(page, i);
      const bgs = await readBg();
      expect(bgs.length).toBeGreaterThan(0);
      for (const bg of bgs) expect(bg).toBe('rgb(255, 255, 255)');
    }
    // 深色主题：同一批卡切到对应深色 surface（#0C1424），不是写死白底
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const dark = await readBg();
    expect(dark.length).toBeGreaterThan(0);
    for (const bg of dark) expect(bg).toBe('rgb(12, 20, 36)');
  });
});
