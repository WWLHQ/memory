// E2E 测试：网页端接入页（自动采集 + 自带插件导出卡）自包含（系统分配端口）
// 浏览器静态环境没有主进程隐藏浏览器/落盘通道 → 自动采集如实显示「不可用」，
// 摘要条与场景分组必须存在且不伪造「已就绪」；导出卡原样保留。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist');
  APP = `http://localhost:${staticSrv.port}/webonboard.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('网页端接入页', () => {
  test('页面渲染：自动采集卡 + 导出卡（浏览器模式如实降级）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="webonboard-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="webonboard-head"]')).toContainText('网页端接入');
    await expect(page.locator('[data-testid="webonboard-page"]')).toContainText('自动采集');
    expect(errors).toEqual([]);
  });

  test('新增：顶部接入摘要 + 四个场景分组（不可用给原因，不伪造读数）', async ({ page }) => {
    await page.goto(APP);
    const summary = page.locator('[data-testid="webonboard-summary"]');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('定时采集');
    await expect(summary).toContainText('不可用');
    await expect(summary).toContainText('采集站点');
    await expect(summary).toContainText('上次采集');
    // 四个场景分组：入口 / 结果去重 / 来源时间 / 导出卡
    for (const id of ['entry', 'result', 'source', 'export']) {
      await expect(page.locator(`[data-testid="webonboard-group-${id}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid="webonboard-group-result"]')).toContainText('去重跳过');
    await expect(page.locator('[data-testid="webonboard-group-source"]')).toContainText('最近导入');
    await expect(page.locator('[data-testid="webonboard-group-export"]')).toContainText('导出卡');
    // 浏览器模式无主进程通道：立即采一轮必须禁用（不给假成功）
    await expect(page.locator('[data-testid="webonboard-run"]')).toBeDisabled();
  });

  test('几何：自动采集卡与导出卡同排对齐，宽度占两列、右边缘与网格齐平', async ({ page }) => {
    await page.goto(APP);
    const m = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right };
      };
      const grid = document.querySelector('[data-testid="webonboard-groups"]') as HTMLElement | null;
      const gr = grid ? grid.getBoundingClientRect() : null;
      const cs = grid ? getComputedStyle(grid) : null;
      return {
        entry: r('[data-testid="webonboard-group-entry"]'),
        source: r('[data-testid="webonboard-group-source"]'),
        exp: r('[data-testid="webonboard-group-export"]'),
        auto: r('[data-testid="webchat-auto-card"]'),
        grid: gr ? { x: gr.x, w: gr.width, right: gr.right, gap: parseFloat(cs?.columnGap || '0') } : null,
      };
    });
    expect(m.auto).not.toBeNull();
    expect(m.exp).not.toBeNull();
    expect(m.source).not.toBeNull();
    expect(m.grid).not.toBeNull();
    // 自动采集卡与导出卡同一排，且靠右摆放（导出卡在左）
    expect(Math.abs(m.auto!.y - m.exp!.y)).toBeLessThanOrEqual(1);
    expect(m.auto!.x).toBeGreaterThan(m.exp!.x);
    // 宽度 = 2 列 + 1 间距，右边缘贴齐网格
    const expectW = m.source!.w * 2 + m.grid!.gap;
    expect(Math.abs(m.auto!.w - expectW)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(m.auto!.right - m.grid!.right)).toBeLessThanOrEqual(1.5);
  });
});
