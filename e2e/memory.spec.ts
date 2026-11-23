// E2E 测试：记忆管理页（REQ-006 / P8）
// 自包含模式：自带静态服务（系统分配端口）serving dist/memory.html。
// 当前入口挂 MemoryManagementPage（六页签版），旧单表版 MemoryPage 已不在路由上。
// 注：账本无种子数据（真实账本诚实空态），测试覆盖空态渲染 + 六页签结构 + 无脚本异常。
// 写入流程由 e2e/write.spec.ts 独立覆盖（纯浏览器如实报 E_L0_LOCKED；真实加密写入在桌面主进程）。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/memory.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('记忆管理页', () => {
  test('空账本渲染诚实空态，无表格，无脚本异常', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="mm-page"]')).toBeVisible();
    // 无种子数据 → 空态文案出现（真实 0 条，不注入演示条目）
    await expect(page.locator('[data-testid="mm-empty-ledger"]')).toBeVisible();
    await expect(page.locator('[data-testid="mm-empty-ledger"]')).toContainText('账本暂无记忆（真实 0 条）');
    // 表格不可见（空账本不渲染 table）
    await expect(page.locator('[data-testid="memory-table"]')).not.toBeVisible();
    // 重复副条已删除（与页头同源信息），筛选条下直接是表格主体，不留空白占位
    await expect(page.locator('[data-testid="mm-truthbar"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="mm-page"]')).not.toContainText('六标签');
    // 2026-11-22：tagline 描述文字删除；标题下只剩一行真实读数（两个红框合成一行）
    await expect(page.locator('.p0-tagline')).toHaveCount(0);
    await expect(page.locator('[data-testid="mm-page"]')).not.toContainText('六个视图同源');
    const truth = page.locator('[data-testid="mm-truthline"]');
    await expect(truth).toHaveCount(1);
    for (const t of ['0 条记忆', '账本', '会话', 'L0', '冲突', '快照']) {
      await expect(truth).toContainText(t);
    }
    // 不再有第二条元信息行：页头只有这一行读数
    await expect(page.locator('[data-testid="mm-head"] .p0-ph-meta')).toHaveCount(0);
    await expect(page.locator('[data-testid="mm-head"] .p0-ph-sep')).toHaveCount(0);
    // 删掉重复副条后：筛选条与表格主体之间没有残留占位/空行
    const gapPx = await page.evaluate(() => {
      const f = document.querySelector('[data-testid="mm-filter"]');
      const body = document.querySelector('.mm-body');
      if (!f || !body) return -1;
      return body.getBoundingClientRect().top - f.getBoundingClientRect().bottom;
    });
    expect(gapPx, '筛选条与主体之间存在残留空白').toBeGreaterThanOrEqual(0);
    expect(gapPx).toBeLessThan(16);
    expect(errors).toEqual([]);
  });

  test('页面结构：六页签（批次57 精简版）+ 筛选条可用 + 切页签不报错', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('.mm-tabstrip')).toHaveAttribute('aria-label', '记忆管理标签');
    for (const id of ['all', 'active', 'dormant', 'archived', 'deprecated', 'layers']) {
      await expect(page.locator(`[data-testid="mm-tab-${id}"]`)).toBeVisible();
    }
    // 批次57：冲突/待重放/L0密文/个人记忆 页签已删除（裁决在 dispute.html、L0 在 security.html、个人记忆在 personal.html）
    for (const id of ['personal', 'conflict', 'review', 'l0']) {
      await expect(page.locator(`[data-testid="mm-tab-${id}"]`)).toHaveCount(0);
    }
    // 默认「全部记忆」页签带筛选条
    await expect(page.locator('[data-testid="mm-filter"]')).toBeVisible();
    await expect(page.getByLabel('搜索记忆')).toBeVisible();

    // 切到「分层 L1–L6」应渲染分层矩阵（真实层策略），再切回全部
    await page.locator('[data-testid="mm-tab-layers"]').click();
    await expect(page.locator('[data-testid="mm-layer-matrix"]')).toBeVisible();
    await page.locator('[data-testid="mm-tab-all"]').click();
    await expect(page.locator('[data-testid="mm-empty-ledger"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('几何：标题与真实读数按字体下边基线对齐，标题区留白压缩', async ({ page }) => {
    await page.goto(APP);
    const m = await page.evaluate(() => {
      const h1 = document.querySelector('[data-testid="mm-head"] .p0-ph-title h1') as HTMLElement | null;
      const t = document.querySelector('[data-testid="mm-truthline"]') as HTMLElement | null;
      const head = document.querySelector('[data-testid="mm-head"]') as HTMLElement | null;
      const btn = document.querySelector('[data-testid="mm-head"] .p0-ph-actions button') as HTMLElement | null;
      if (!h1 || !t || !head || !btn) return null;
      const a = h1.getBoundingClientRect();
      const b = t.getBoundingClientRect();
      const c = btn.getBoundingClientRect();
      const cs = getComputedStyle(head);
      const titleCs = getComputedStyle(h1.parentElement as HTMLElement);
      return {
        bottomDelta: Math.abs(a.bottom - b.bottom),
        btnBottomDelta: Math.abs(a.bottom - c.bottom),
        sameLine: Math.abs(a.top - b.top) <= 8,
        titleTop: a.top,
        headTop: head.getBoundingClientRect().top,
        marginBottom: parseFloat(cs.marginBottom),
        alignItems: titleCs.alignItems,
        headAlign: cs.alignItems,
        gap: parseFloat(titleCs.rowGap || '0'),
      };
    });
    expect(m).not.toBeNull();
    expect(m!.alignItems).toBe('baseline');
    // 2026-11-22：标题底边与右侧按钮底边对齐（同一底边）
    expect(m!.headAlign).toBe('flex-end');
    expect(m!.btnBottomDelta).toBeLessThanOrEqual(3);
    if (m!.sameLine) {
      // 同一视觉行：标题与小字字体下边（基线）差 ≤ 4px
      expect(m!.bottomDelta).toBeLessThanOrEqual(4);
    } else {
      // 窄宽度换行时：行距压到 ≤ 4px，不留大段空白
      expect(m!.gap).toBeLessThanOrEqual(4);
    }
    // 页头下边距收敛（原来 12px）
    expect(m!.marginBottom).toBeLessThanOrEqual(6);
    // 标题紧贴页头顶部，不留大段上留白
    expect(m!.titleTop - m!.headTop).toBeLessThanOrEqual(8);
  });
});
