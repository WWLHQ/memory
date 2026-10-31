// E2E 测试：用户反馈页（REQ-006 / P9）自包含（系统分配端口）
// 数据真相 = 内核账本：空账本 → 无 memory 候选；注入身份 = 真实租户（getTenant，非固定 user_001）。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/feedback.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('用户反馈页 · 真实账本', () => {
  test('表单与统计卡渲染，R1 注入为真实租户（只读）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="feedback-page"]')).toBeVisible();
    // 真实租户（内核 getTenant）：user_id 形如 u_xxx，企业 ent_local；无登录态时不冒充 user_001
    await expect(page.locator('[data-testid="ctx-user"]')).toContainText('u_');
    await expect(page.locator('[data-testid="ctx-enterprise"]')).toBeVisible();
    await expect(page.locator('[data-testid="injected-ctx"]')).toContainText('禁手填');
    await expect(page.locator('[data-testid="stat-confirm"]')).toBeVisible();
    // 空账本 → memory 下拉仅占位项（不注入种子记忆）
    await expect(page.locator('[data-testid="f-memory"] option')).toHaveCount(1);
    await expect(page.locator('[data-testid="f-memory"]')).toContainText('— 请选择 —');
    expect(errors).toEqual([]);
  });

  test('必填拦截：空 memory_id → toast 提示必填', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="fb-submit"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('请选择 memory_id（必填）');
    // 未提交任何反馈 → 统计仍为 0
    await expect(page.locator('[data-testid="stat-trust"]')).toContainText('+0');
  });

  test('disputed → P7 队列提示（未选记忆时不伪造提交成功）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="action-disputed"]').check();
    await expect(page.locator('[data-testid="disputed-hint"]')).toContainText('将进入 P7 冲突裁决队列');
    await page.locator('[data-testid="fb-submit"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('必填');
  });

  test('星级与统计联动（空账本统计恒为 0）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="star-5"]').click();
    await expect(page.locator('[data-testid="feedback-form"]')).toContainText('5/5');
    await expect(page.locator('[data-testid="stat-trust"]')).toContainText('+0');
    await expect(page.locator('[data-testid="stat-confirm"]')).toContainText('确认 0');
  });
});
