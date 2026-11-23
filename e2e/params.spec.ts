// E2E 测试：全局参数页（REQ-006 / P5）——批次63 起接真实 home 后端账本，
// 让「保存 → 刷新 → 仍读到内核快照」是可验证的真状态，而不是内存假持久。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD } from '../src/auth/loginService.ts';
import type { Page } from 'playwright-core';

const SESSION_KEY = 'session:realpage';
let APP = '';
let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let ADMIN_SID = '';

async function loginViaApi(account: string, password: string): Promise<string> {
  const r = await fetch(`http://localhost:${backend!.port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password, form: 'desktop' }),
  });
  const body = (await r.json()) as { sessionId?: string };
  if (!body.sessionId) throw new Error(`login failed for ${account}: ${r.status}`);
  return body.sessionId;
}

/** 页面加载前写入登录会话（内核数据面凭 x-session-id 直连真实账本） */
async function useSession(page: Page, sid: string): Promise<void> {
  await page.addInitScript(([key, value]) => {
    try { localStorage.setItem(key as string, value as string); } catch { /* about:blank */ }
  }, [SESSION_KEY, sid]);
}

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  backend = await startHomeBackend({
    dataFile: join(tmpdir(), `e2e-params-${Date.now()}.json`),
    allowedOrigins: [`http://localhost:${staticSrv.port}`],
  });
  ADMIN_SID = await loginViaApi(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD);
  APP = `http://localhost:${staticSrv.port}/params.html?backend=http://localhost:${backend.port}`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('全局参数页', () => {
  // 全部用例带真实登录会话：保存走 /api/kernel/invoke 写入后端账本（刷新不丢）
  test.beforeEach(async ({ page }) => { await useSession(page, ADMIN_SID); });

  test('三区块渲染 + 默认档位（中/数月/开/重要）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="params-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="speed-mid"]')).toBeChecked();
    await expect(page.locator('[data-testid="retention-months"]')).toBeChecked();
    await expect(page.locator('[data-testid="kb-row-5"]')).toBeVisible(); // 六类知识库
    // 2026-11-22 单价入口同源：成本单价是全局一份（不按引擎），首页成本卡读同一份
    const costNote = page.locator('[data-testid="cost-scope-note"]');
    await expect(costNote).toBeVisible();
    await expect(costNote).toContainText('全局一份');
    await expect(costNote).toContainText('不按引擎');
    await expect(costNote).toContainText('首页');
    await expect(costNote).toContainText('模型与成本');
    await expect(page.locator('[data-testid="cost-price"]')).toBeAttached();
    // 2026-11-21：LLM 精炼引擎整块已迁到「模型与成本 → 引擎」，参数页不再出现
    await expect(page.locator('[data-testid="llm-engine-card"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('场景分组 + 摘要：五组真实卡、摘要读数、默认/来源说明、改动即「已修改未保存」、保存后回执持久', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="speed-mid"]')).toBeChecked();

    // 五组：召回与注入 / 增长与遗忘 / 同步与团队 / 审计与安全 / 成本与配额（真实参数一个不少）
    for (const g of ['recall', 'growth', 'sync', 'audit', 'cost']) {
      await expect(page.locator(`[data-testid="param-group-${g}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid="param-group-recall"]')).toContainText('params:v1');
    await expect(page.locator('[data-testid="param-group-growth"]')).toContainText('growth:v1');
    await expect(page.locator('[data-testid="param-group-sync"]')).toContainText('只读');
    await expect(page.locator('[data-testid="param-group-cost"]')).toContainText('模型与成本');
    // 既有可编辑字段仍在（不丢参数）
    for (const id of ['speed-mid', 'retention-months', 'auto-organize', 'importance-normal', 'cost-price', 'proxy-price', 'proxy-quota']) {
      await expect(page.locator(`[data-testid="${id}"]`)).toBeAttached();
    }

    // 顶部摘要：参数量 / 最近保存 / 生效范围 / 未保存改动
    await expect(page.locator('[data-testid="sum-param-count"]')).toContainText('20');
    await expect(page.locator('[data-testid="sum-scope"]')).toContainText('本机');
    await expect(page.locator('[data-testid="sum-dirty"]')).toContainText('与内核快照一致');

    await page.locator('[data-testid="speed-fast"]').check();
    await expect(page.locator('[data-testid="sum-dirty"]')).toContainText('1');
    await expect(page.locator('[data-testid="sum-dirty"]')).toContainText('已修改未保存');
    await expect(page.locator('[data-testid="changed-list"]')).toContainText('已修改未保存');

    await page.locator('[data-testid="save-btn"]').click();
    await expect(page.locator('[data-testid="params-receipt"]')).toContainText(/req_/);
    await expect(page.locator('[data-testid="params-receipt"]')).toContainText('param_save');
    await expect(page.locator('[data-testid="sum-dirty"]')).toContainText('与内核快照一致');

    // 刷新后：回执/版本来自内核快照，不是内存里的假状态
    await page.reload();
    await expect(page.locator('[data-testid="params-receipt"]')).toContainText(/回填自内核快照：v\d+/);
    await expect(page.locator('[data-testid="speed-fast"]')).toBeChecked();
    expect(errors).toEqual([]);

    // 还原默认档，避免把 fast 留给后续用例（仍是真保存，不是 mock）
    await page.locator('[data-testid="speed-mid"]').check();
    await page.locator('[data-testid="save-btn"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('已保存全局参数');
  });

  test('开发者模式展开：权重和/payload/NM 校验', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="dev-panel"] summary').click();
    await expect(page.locator('[data-testid="w-sum"]')).toContainText('和 = 1.00');
    await expect(page.locator('[data-testid="payload-check"]')).toContainText('递增 ✓');
    await expect(page.locator('[data-testid="nm-check"]')).toContainText('N<M ✓');
  });

  test('改遗忘速度 → 待保存 + 保存 toast（真实 req_ 回执）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="speed-fast"]').check();
    await expect(page.locator('[data-testid="changed-list"]')).toContainText('遗忘速度=快');
    await page.locator('[data-testid="save-btn"]').click();
    // 保存 = 内核真写 + param_save 审计，回执 request_id 为运行时生成（非固定种子）
    await expect(page.locator('[data-testid="toast"]')).toContainText(/已保存全局参数（req_/);
    await expect(page.locator('[data-testid="changed-list"]')).toHaveCount(0);
  });

  test('权重破坏 → 保存拦截', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="dev-panel"] summary').click();
    await page.locator('[data-testid="w-w_f"]').fill('0.5');
    await page.locator('[data-testid="save-btn"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('拦截');
  });

  test('几何：成本与配额 = 后台常驻同宽同排；增长在左、召回在右；开发者模式独立卡置末', async ({ page }) => {
    await page.goto(APP);
    const m = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom };
      };
      return {
        growth: r('[data-testid="param-group-growth"]'),
        recall: r('[data-testid="param-group-recall"]'),
        cost: r('[data-testid="param-group-cost"]'),
        shell: r('[data-testid="param-group-shell"]'),
        dev: r('[data-testid="param-group-dev"]'),
        devPanel: r('[data-testid="dev-panel"]'),
        recallDev: (document.querySelector('[data-testid="param-group-recall"] [data-testid="dev-panel"]') !== null),
      };
    });
    expect(m.growth).not.toBeNull();
    expect(m.recall).not.toBeNull();
    expect(m.cost).not.toBeNull();
    expect(m.shell).not.toBeNull();
    expect(m.dev).not.toBeNull();
    // 左右互换：增长在左、召回在右
    expect(m.recall!.x).toBeGreaterThan(m.growth!.x);
    // 成本与配额 = 后台常驻：同宽、同排
    expect(Math.abs(m.cost!.w - m.shell!.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.cost!.y - m.shell!.y)).toBeLessThanOrEqual(1);
    // 开发者模式已从召回卡抽出，独立成卡且在最后
    expect(m.recallDev).toBe(false);
    expect(m.devPanel).not.toBeNull();
    expect(m.dev!.bottom).toBeGreaterThan(m.shell!.bottom);
    expect(m.dev!.w).toBeGreaterThan(m.cost!.w);
  });

  test('几何：分组行间只剩正常 14px 间距（左侧卡不再因行高参差出现大片空白）', async ({ page }) => {
    await page.goto(APP);
    for (const g of ['growth', 'recall', 'sync', 'audit', 'cost', 'shell']) {
      await expect(page.locator(`[data-testid="param-group-${g}"]`)).toBeVisible();
    }
    const m = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { y: b.y, bottom: b.bottom, h: b.height };
      };
      const grid = document.querySelector('.params-groups') as HTMLElement | null;
      return {
        growth: r('[data-testid="param-group-growth"]'),
        recall: r('[data-testid="param-group-recall"]'),
        sync: r('[data-testid="param-group-sync"]'),
        audit: r('[data-testid="param-group-audit"]'),
        cost: r('[data-testid="param-group-cost"]'),
        shell: r('[data-testid="param-group-shell"]'),
        alignItems: grid ? getComputedStyle(grid).alignItems : '',
        rowGap: grid ? parseFloat(getComputedStyle(grid).rowGap || '0') : 0,
      };
    });
    expect(m.growth).not.toBeNull();
    expect(m.recall).not.toBeNull();
    expect(m.sync).not.toBeNull();
    expect(m.audit).not.toBeNull();
    expect(m.cost).not.toBeNull();
    expect(m.shell).not.toBeNull();
    // 同一行卡片等高（stretch），行与行之间就是网格 row-gap（14px）
    expect(m.alignItems).toBe('stretch');
    expect(Math.abs(m.rowGap - 14)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(m.audit!.y - (m.growth!.bottom + m.rowGap))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(m.shell!.y - m.cost!.y)).toBeLessThanOrEqual(1);
    // 卡内不再撑出大段空白：同一行三卡等高（第一行 growth/recall/sync，第二行 audit/cost/shell）
    for (const x of [m.recall!, m.sync!]) expect(Math.abs(m.growth!.h - x.h)).toBeLessThanOrEqual(1);
    for (const x of [m.cost!, m.shell!]) expect(Math.abs(m.audit!.h - x.h)).toBeLessThanOrEqual(1);
  });
});
