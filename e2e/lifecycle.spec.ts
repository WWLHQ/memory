// E2E 测试：生命周期页（REQ-006 / P4）自包含：静态服务（系统分配端口）serving dist/lifecycle.html。
// 数据真相 = 内核账本（浏览器为进程内单例）：空账本 → 诚实空态，不渲染表格/卡片/调参面板。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/lifecycle.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('生命周期页 · 真实账本', () => {
  test('空账本 → 诚实空态，无种子行/卡片/调参面板', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="lifecycle-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="lifecycle-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="lifecycle-empty"]')).toContainText('当前记忆账本为空');
    await expect(page.locator('[data-testid="lifecycle-table"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="lrow-"]')).toHaveCount(0);
    // 无记录 → 不渲染选中卡片与调参面板（不伪造）
    await expect(page.locator('[data-testid="status-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="param-panel"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('2026-11-22 首页版式：摘要真实读数 + 四阶段分组 + 流转规则/待处理', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="lifecycle-page"]')).toBeVisible();

    // 顶部摘要：空账本 → 0，真实读数（不造数）
    const sum = page.locator('[data-testid="lifecycle-summary"]');
    await expect(sum).toBeVisible();
    await expect(sum).toContainText('生命周期摘要');
    await expect(sum).toContainText('活跃');
    await expect(sum).toContainText('待处理');

    // 产生 → 降温 → 归档 → 弃用 四阶段卡
    for (const k of ['active', 'cooling', 'archived', 'deprecated']) {
      const card = page.locator(`[data-testid="stage-card-${k}"]`);
      await expect(card).toBeVisible();
      await expect(card).toContainText('条');
    }

    // 流转规则（含真实时间窗口）+ 待处理项
    await expect(page.locator('[data-testid="lifecycle-flow"]')).toContainText('流转规则与时间窗口');
    await expect(page.locator('[data-testid="lifecycle-flow"]')).toContainText(`90 天`);
    await expect(page.locator('[data-testid="lifecycle-flow"]')).toContainText(`180 天`);
    await expect(page.locator('[data-testid="lifecycle-pending"]')).toContainText('当前没有');

    // 版式令牌：af-panel 已生效
    await expect(page.locator('.lifecycle-page .af-panel').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('空账本无迁移/批量操作入口', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="mig-hibernating"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="batch-run"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="batch-target"]')).toHaveCount(0);
  });

  test('几何：回退后的旧版式（阶段 4 列；内容区 3 列，宽卡跨 2 列、窄卡 1 列）', async ({ page }) => {
    await page.goto(APP);
    // 等阶段卡与待处理项渲染完成再量几何（否则 evaluate 取到 null）
    await expect(page.locator('[data-testid="stage-card-active"]')).toBeVisible();
    await expect(page.locator('[data-testid="lifecycle-pending"]')).toBeVisible();
    await expect(page.locator('[data-testid="lifecycle-flow"]')).toBeVisible();
    const m = await page.evaluate(() => {
      const rect = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const tracks = (el: Element | null) => {
        if (!el) return { cols: [] as number[], gap: 0 };
        const cs = getComputedStyle(el as HTMLElement);
        return {
          cols: cs.gridTemplateColumns.trim().split(/\s+/).map((v) => parseFloat(v)),
          gap: parseFloat(cs.columnGap || '0'),
        };
      };
      return {
        stage: rect('[data-testid="stage-card-active"]'),
        pending: rect('[data-testid="lifecycle-pending"]'),
        flow: rect('[data-testid="lifecycle-flow"]'),
        selected: rect('[data-testid="lifecycle-selected"]'),
        batch: rect('[data-testid="lifecycle-batch"]'),
        stageGrid: tracks(document.querySelector('[data-testid="lifecycle-stages"]')),
        flowGrid: tracks(document.querySelector('[data-testid="lifecycle-flow"]')?.parentElement ?? null),
      };
    });
    expect(m.stage).not.toBeNull();
    expect(m.pending).not.toBeNull();
    expect(m.flow).not.toBeNull();
    // 阶段卡仍是 4 列等宽轨道（这部分不在回退范围）
    expect(m.stageGrid.cols.length).toBe(4);
    for (const t of m.stageGrid.cols) expect(Math.abs(t - m.stageGrid.cols[0])).toBeLessThanOrEqual(1);
    // 内容区回退为 3 列：待处理项占 1 列，流转规则跨 2 列（2 列宽 + 1 个间距）
    expect(m.flowGrid.cols.length).toBe(3);
    for (const t of m.flowGrid.cols) expect(Math.abs(t - m.flowGrid.cols[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(m.pending!.w - m.flowGrid.cols[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(m.flow!.w - (m.flowGrid.cols[0] * 2 + m.flowGrid.gap))).toBeLessThanOrEqual(1.5);
    // 有数据时：选中项处理 / 批量迁移 均为 3 列网格里的单列宽（与待处理项一致）
    if (m.selected) expect(Math.abs(m.selected.w - m.pending!.w)).toBeLessThanOrEqual(1);
    if (m.batch) expect(Math.abs(m.batch.w - m.pending!.w)).toBeLessThanOrEqual(1);
  });

  test('几何：摘要四卡与阶段四卡同宽同列并填满整行（两行对齐，≤1px）', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="stage-card-active"]')).toBeVisible();
    await expect(page.locator('[data-testid="lifecycle-summary"]')).toBeVisible();
    const m = await page.evaluate(() => {
      const rect = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right };
      };
      const summaryGrid = document.querySelector('[data-testid="lifecycle-summary"] .af-g4');
      const stageGrid = document.querySelector('[data-testid="lifecycle-stages"]');
      const summary = Array.from(summaryGrid?.children ?? []).map(rect);
      const stages = Array.from(stageGrid?.children ?? []).map(rect);
      return {
        summary,
        stages,
        summaryGrid: summaryGrid ? rect(summaryGrid) : null,
        stageGrid: stageGrid ? rect(stageGrid) : null,
      };
    });
    expect(m.summary.length).toBe(4);
    expect(m.stages.length).toBe(4);
    expect(m.summaryGrid).not.toBeNull();
    expect(m.stageGrid).not.toBeNull();
    // 两行轨道同宽同列：逐列宽度一致（卡片宽度差 ≤1px）
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(m.summary[i].w - m.stages[i].w)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.summary[i].x - m.stages[i].x)).toBeLessThanOrEqual(2);
    }
    // 摘要行不再内缩：两行网格外沿（左边/右边）对齐（面板 1px 边框容差）
    expect(Math.abs(m.summaryGrid!.x - m.stageGrid!.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.summaryGrid!.w - m.stageGrid!.w)).toBeLessThanOrEqual(2);
    // 填满整行：末卡右沿贴齐网格右沿（不是只占 2/3）
    expect(Math.abs(m.summary[3].right - m.summaryGrid!.right)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.stages[3].right - m.stageGrid!.right)).toBeLessThanOrEqual(2);
    // 同行等高（stretch），长宽一致
    for (let i = 1; i < 4; i++) {
      expect(Math.abs(m.summary[i].h - m.summary[0].h)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.stages[i].h - m.stages[0].h)).toBeLessThanOrEqual(1);
    }
  });
});
