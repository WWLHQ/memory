// E2E 测试：同步中枢页（自包含，系统分配端口）
// 浏览器模式无宿主桥：真实读数给「未取数」，不伪造 pushed/pulled；
// 本轮只验「立即同步」与「中枢对账」两卡同宽同高（内容不足由卡内留白补足）。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist');
  APP = `http://localhost:${staticSrv.port}/sync.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('同步中枢页', () => {
  test('页面渲染：立即同步 + 中枢对账真实标题与读数（未取数如实展示）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="sync-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="btnSyncNow"]')).toBeVisible();
    await expect(page.locator('[data-testid="sync-pair"]')).toContainText('立即同步');
    await expect(page.locator('[data-testid="sync-pair"]')).toContainText('中枢对账 · team');
    // 未运行同步 → 读数写「未取数」，不用 0 冒充
    await expect(page.locator('[data-testid="pushed"]')).toHaveText('未取数');
    await expect(page.locator('[data-testid="pulled"]')).toHaveText('未取数');
    expect(errors).toEqual([]);
  });

  test('几何：立即同步 与 中枢对账 同宽同高同行（内部留白补足差异）', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="sync-pair"]')).toBeVisible();
    const m = await page.evaluate(() => {
      const pair = document.querySelector('[data-testid="sync-pair"]') as HTMLElement | null;
      if (!pair) return null;
      const panels = Array.from(pair.querySelectorAll(':scope > .af-panel')) as HTMLElement[];
      const rects = panels.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const cs = getComputedStyle(pair);
      return { rects, alignItems: cs.alignItems, gap: parseFloat(cs.columnGap || '0') };
    });
    expect(m).not.toBeNull();
    expect(m!.rects.length).toBe(2);
    const [a, b] = m!.rects;
    // 同排同宽同高（stretch，而不是 start 让高度参差）
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.w - b.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.h - b.h)).toBeLessThanOrEqual(1);
    expect(a.h).toBeGreaterThan(160);
    expect(m!.alignItems).toBe('stretch');
    expect(m!.gap).toBeGreaterThan(0);
  });

  test('几何：「立即同步」卡内按钮独占一行：主次分明、间距统一、不与说明文字挤压', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="sync-actions"]')).toBeVisible();
    const m = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="sync-actions"]') as HTMLElement | null;
      const note = document.querySelector('.sy-actions-note') as HTMLElement | null;
      if (!host || !note) return null;
      const btns = Array.from(host.querySelectorAll('button')) as HTMLElement[];
      const rect = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
      };
      const cs = getComputedStyle(host);
      return {
        actions: rect(host),
        display: cs.display,
        gap: parseFloat(cs.columnGap || '0'),
        btns: btns.map(rect),
        primaryW: btns.length ? parseFloat(getComputedStyle(btns[0]).minWidth) || btns[0].getBoundingClientRect().width : 0,
        allBtnW: btns.map((b) => b.getBoundingClientRect().width),
        note: rect(note),
        noteDisplay: getComputedStyle(note).display,
      };
    });
    expect(m).not.toBeNull();
    expect(m!.display).toBe('flex');
    expect(m!.btns.length).toBe(2);
    const [syncBtn, checkBtn] = m!.btns;
    // 同一行、同高
    expect(Math.abs(syncBtn.y - checkBtn.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(syncBtn.h - checkBtn.h)).toBeLessThanOrEqual(1);
    // 间距统一（8px），不挤在一起
    expect(m!.gap).toBeGreaterThanOrEqual(6);
    expect(m!.gap).toBeLessThanOrEqual(10);
    expect(checkBtn.x - syncBtn.right).toBeGreaterThanOrEqual(6);
    expect(checkBtn.x - syncBtn.right).toBeLessThanOrEqual(10);
    // 主次分明：主按钮（立即同步）不窄于次按钮（检查节点）
    expect(syncBtn.w).toBeGreaterThanOrEqual(checkBtn.w - 1);
    expect(m!.allBtnW[0]).toBeGreaterThanOrEqual(104 - 1);
    // 说明文字独占一行，位于按钮下方且与按钮留出空隙（不压字）
    expect(m!.noteDisplay).toBe('block');
    expect(m!.note.y).toBeGreaterThanOrEqual(Math.min(syncBtn.bottom, checkBtn.bottom) + 4);
    expect(Math.abs(m!.note.x - m!.actions.x)).toBeLessThanOrEqual(1);
    // 说明不与按钮区域重叠
    expect(m!.note.y).toBeGreaterThanOrEqual(m!.actions.bottom + 4);
  });
});
