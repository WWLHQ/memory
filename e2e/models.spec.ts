// E2E 测试：大模型配置页（REQ-009 / P13）自包含（系统分配端口）
// 覆盖用例：C1 渲染 / C2 judge 温度锁 / C5 换维度重建提示+估时 / C6 重建中禁切换 / C7 auto 模拟(dry-run·无源回退本地) / C13 price_cap=0 仅免费可见
// 注：静态构建无宿主 LLM 网关 → 页面走「未配置引擎」诚实空态；反代理路由深逻辑由单测（logic.test.ts / coreModels.test.ts）覆盖。
// 现行结构：3 个页签（mtab-0 引擎 / mtab-1 计费 / mtab-2 反向代理），只渲染当前页签。
//   向量卡在引擎页；四用途表 / 保存 / 审计回显在计费页；来源映射 / price_cap / 模拟在反向代理页。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';
import type { Page } from 'playwright-core';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/models.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

/** 切到指定页签（0 引擎 / 1 计费 / 2 反向代理） */
async function gotoTab(page: Page, i: 0 | 1 | 2): Promise<void> {
  await page.locator(`[data-testid="mtab-${i}"]`).click();
  await expect(page.locator(`[data-testid="mtab-${i}"]`)).toHaveAttribute('aria-selected', 'true');
}

test.describe('大模型配置页', () => {
  test('C1 页面渲染：向量卡 384 维 + 4 用途表 + 反代理诚实空态（未配置引擎）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="models-page"]')).toBeVisible();
    // 引擎页：向量 384 维
    await expect(page.locator('[data-testid="vector-dims"]')).toContainText('384');
    // 计费页：四用途表
    await gotoTab(page, 1);
    await expect(page.locator('[data-testid="usage-write"]')).toBeVisible();
    await expect(page.locator('[data-testid="usage-judge"]')).toBeVisible();
    await expect(page.locator('[data-testid="usage-rerank"]')).toBeVisible();
    await expect(page.locator('[data-testid="usage-growth"]')).toBeVisible();
    // 反向代理页：无网关 → 诚实空态，绝不渲染假代理行（PROXY_CATALOG 已删）
    await gotoTab(page, 2);
    await expect(page.locator('[data-testid="proxy-empty-state"]')).toContainText('未配置引擎');
    await expect(page.locator('[data-testid="proxy-rows"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('LLM 精炼引擎整块在「引擎」页签（与向量卡同段），其它页签不挂载', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="models-sec-engine"] [data-testid="llm-engine-card"]')).toHaveCount(1);
    await gotoTab(page, 1);
    await expect(page.locator('[data-testid="llm-engine-card"]')).toHaveCount(0);
    await gotoTab(page, 2);
    await expect(page.locator('[data-testid="llm-engine-card"]')).toHaveCount(0);
  });

  test('C2/R4 judge 温度锁灰恒 0，其他用途可编辑', async ({ page }) => {
    await page.goto(APP);
    await gotoTab(page, 1);
    await expect(page.locator('[data-testid="usage-judge-temp"]')).toBeDisabled();
    await expect(page.locator('[data-testid="usage-judge-temp"]')).toHaveValue('0');
    await expect(page.locator('[data-testid="usage-write-temp"]')).toBeEnabled();
  });

  test('C5/C6 换维度 → 确认（含估时）→ 保存后真落盘，刷新仍生效', async ({ page }) => {
    await page.goto(APP);
    let dialogMsg = '';
    page.on('dialog', (d) => {
      // 只读文案；accept 由 harness 全局容错接管（重复 accept 会报 already handled）
      dialogMsg = d.message();
    });
    // 引擎页选模型 → 确认框含新维度与重嵌入估时
    await page.locator('[data-testid="vector-select"]').selectOption('bge-m3');
    expect(dialogMsg).toContain('1024');
    expect(dialogMsg).toContain('重嵌入');
    await expect(page.locator('[data-testid="vector-dims"]')).toContainText('1024');
    // 保存前不伪造重建进度：选择即可继续操作（R5 锁定仅在真实保存期间）
    await expect(page.locator('[data-testid="vector-select"]')).toBeEnabled();
    // 保存在计费页
    await gotoTab(page, 1);
    await page.locator('[data-testid="save-config"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('已持久化');
    await expect(page.locator('[data-testid="toast"]')).toContainText('1024 维');
    // 真落盘：刷新后配置仍在（localStorage）
    await page.reload();
    await expect(page.locator('[data-testid="vector-select"]')).toHaveValue('bge-m3');
    await expect(page.locator('[data-testid="vector-dims"]')).toContainText('1024');
  });

  test('R2 Key 脱敏：勾网络通道并输入 Key → 展示为 [API_KEY:xx****]', async ({ page }) => {
    await page.goto(APP);
    await gotoTab(page, 1);
    await page.locator('[data-testid="usage-write-net"]').check();
    await page.locator('[data-testid="usage-write-endpoint"]').fill('https://api.example.com/v1');
    await page.locator('[data-testid="usage-write-key"]').fill('sk-secret-123456');
    await expect(page.locator('[data-testid="usage-write-masked"]')).toContainText('[API_KEY:sk****]');
    await expect(page.locator('[data-testid="usage-write-masked"]')).not.toContainText('secret-123456');
  });

  test('C7 auto 模拟（dry-run）：无可用源 → 回退本地，不写账本、不扣余量', async ({ page }) => {
    await page.goto(APP);
    // 模拟按钮在反向代理页
    await gotoTab(page, 2);
    await page.locator('[data-testid="proxy-simulate"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('dry-run（未写账本）');
    await expect(page.locator('[data-testid="toast"]')).toContainText('回退本地');
    // 审计回显在计费页：模拟是 dry-run，不写账本
    await gotoTab(page, 1);
    await expect(page.locator('[data-testid="audit-echo"]')).toContainText('暂无本会话审计条目');
  });

  test('C8/R7 manual：无可用源时模拟 → 回退本地（dry-run，不伪造代理）', async ({ page }) => {
    await page.goto(APP);
    await gotoTab(page, 2);
    await page.locator('[data-testid="mode-manual"]').check();
    await page.locator('[data-testid="proxy-simulate"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('dry-run（未写账本）');
    await expect(page.locator('[data-testid="toast"]')).toContainText('回退本地');
  });

  test('C13 price_cap=0：仅免费提示可见；模拟 → 回退本地（无可用源）', async ({ page }) => {
    await page.goto(APP);
    await gotoTab(page, 2);
    await page.locator('[data-testid="price-cap"]').fill('0');
    await expect(page.locator('[data-testid="free-only-hint"]')).toBeVisible();
    await page.locator('[data-testid="proxy-simulate"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('dry-run（未写账本）');
    await expect(page.locator('[data-testid="toast"]')).toContainText('回退本地');
    await gotoTab(page, 1);
    await expect(page.locator('[data-testid="audit-echo"]')).toContainText('暂无本会话审计条目');
  });

  test('R1/C3 保存门禁：全不勾被拒；勾网络无端点被拒；合法保存写审计', async ({ page }) => {
    await page.goto(APP);
    await gotoTab(page, 1);
    // C3：write 勾网络、清空本地、无端点 → 保存被拒
    await page.locator('[data-testid="usage-write-net"]').check();
    await page.locator('[data-testid="usage-write-endpoint"]').fill('https://api.example.com/v1');
    await page.locator('[data-testid="usage-write-local"]').uncheck();
    await page.locator('[data-testid="usage-write-endpoint"]').fill('');
    await page.locator('[data-testid="save-config"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('保存被拒绝');
    await expect(page.locator('[data-testid="usage-errors"]')).toContainText('C3');
    // 恢复合法
    await page.locator('[data-testid="usage-write-local"]').check();
    await page.locator('[data-testid="usage-write-net"]').uncheck();
    await page.locator('[data-testid="save-config"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('已保存 model_config');
  });

  test('新增：顶部模型摘要读数条 + 四个场景分组（路由 / 单价配额 / 精炼引擎 / 连接测试）', async ({ page }) => {
    await page.goto(APP);
    const readout = page.locator('[data-testid="models-readout"]');
    await expect(readout).toBeVisible();
    await expect(readout).toContainText('向量模型');
    await expect(readout).toContainText('384 维');
    await expect(readout).toContainText('网关状态');
    // 浏览器静态环境无宿主网关 → 未配置，不伪造「可用」
    await expect(readout).toContainText('未配置');
    for (const id of ['route', 'billing', 'refine', 'conn']) {
      await expect(page.locator(`[data-testid="models-group-${id}"]`)).toBeVisible();
    }
    // LLM 精炼引擎归属：卡里明确指向本页引擎页签，不在全局参数页重复
    await expect(page.locator('[data-testid="models-group-refine"]')).toContainText('已迁入');
    // 真实动作：dry-run 模拟给出回执；跳精炼引擎真切到引擎页签
    await page.locator('[data-testid="models-dry-run"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('dry-run');
    await page.locator('[data-testid="models-jump-refine"]').click();
    await expect(page.locator('[data-testid="llm-engine-card"]')).toBeVisible();
  });

  test('几何：连接测试卡与 LLM 精炼引擎卡同宽并排（精炼在左、连接测试在右）', async ({ page }) => {
    await page.goto(APP);
    const m = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      return {
        route: r('[data-testid="models-group-route"]'),
        billing: r('[data-testid="models-group-billing"]'),
        refine: r('[data-testid="models-group-refine"]'),
        conn: r('[data-testid="models-group-conn"]'),
      };
    });
    expect(m.refine).not.toBeNull();
    expect(m.conn).not.toBeNull();
    // 同宽
    expect(Math.abs(m.conn!.w - m.refine!.w)).toBeLessThanOrEqual(1);
    // 同一排、连接测试在精炼引擎右侧
    expect(Math.abs(m.conn!.y - m.refine!.y)).toBeLessThanOrEqual(1);
    expect(m.conn!.x).toBeGreaterThan(m.refine!.x);
    // 四组构成 2×2，同排等宽；无 2/3 + 1/3 参差
    expect(Math.abs(m.route!.w - m.billing!.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.route!.w - m.refine!.w)).toBeLessThanOrEqual(1);
  });

  test('回退：引擎/计费页签内容恢复整宽纵向排列（不再页签内两列）', async ({ page }) => {
    await page.goto(APP);
    // 引擎页签：向量模型在上、LLM 精炼引擎在下，同左边界同宽
    const t0 = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el ? { x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height } : null;
      };
      return { vector: r('[data-testid="vector-card"]'), engine: r('[data-testid="llm-engine-card"]') };
    });
    expect(t0.vector).not.toBeNull();
    expect(t0.engine).not.toBeNull();
    expect(Math.abs(t0.engine!.x - t0.vector!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(t0.engine!.w - t0.vector!.w)).toBeLessThanOrEqual(1);
    expect(t0.engine!.y).toBeGreaterThanOrEqual(t0.vector!.y + t0.vector!.h - 1);
    // 计费页签：审计回显在上、保存卡在下，同宽纵向
    await gotoTab(page, 1);
    const t1 = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el ? { x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height } : null;
      };
      const audit = document.querySelector('[data-testid="audit-echo"]') as HTMLElement | null;
      const save = audit?.nextElementSibling as HTMLElement | null;
      return { audit: r('[data-testid="audit-echo"]'), save: save ? { x: save.getBoundingClientRect().x, y: save.getBoundingClientRect().y, w: save.getBoundingClientRect().width } : null };
    });
    expect(t1.audit).not.toBeNull();
    expect(t1.save).not.toBeNull();
    expect(Math.abs(t1.save!.x - t1.audit!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(t1.save!.w - t1.audit!.w)).toBeLessThanOrEqual(1);
    expect(t1.save!.y).toBeGreaterThanOrEqual(t1.audit!.y + t1.audit!.h - 1);
  });

  test('白底：引擎/计费/反向代理三个页签内的卡片底色 = --surface（浅色 #FFFFFF / 深色 #0C1424）', async ({ page }) => {
    await page.goto(APP);
    const readBg = () => page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="models-page"] .card'))
        .filter((el) => (el as HTMLElement).offsetParent !== null);
      return cards.map((el) => getComputedStyle(el as HTMLElement).backgroundColor);
    });
    for (const i of [0, 1, 2] as const) {
      await gotoTab(page, i);
      const bgs = await readBg();
      expect(bgs.length).toBeGreaterThan(0);
      for (const bg of bgs) expect(bg).toBe('rgb(255, 255, 255)');
    }
    // 深色主题：同一批卡切到对应深色 surface（#0C1424），不是写死白底
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    for (const i of [0, 1, 2] as const) {
      await gotoTab(page, i);
      const bgs = await readBg();
      expect(bgs.length).toBeGreaterThan(0);
      for (const bg of bgs) expect(bg).toBe('rgb(12, 20, 36)');
    }
  });
});
