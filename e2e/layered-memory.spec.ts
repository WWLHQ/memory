// 记忆层级管理页 E2E（REQ-006 / P8 · 19.11）
// 自包含模式：自带静态服务（系统分配端口）serving dist/layered.html。
// 该页为独立入口（无登录门控）；审计上抛真接 /api/mirror/audit，未起 home 后端时失败提示可见但不影响页面数据。
// 注：种子数据已移除（见需求：真实账本无演示数据），测试覆盖空态渲染 + L0 授权结构。
// 纯浏览器无 home 会话/主进程密钥环：L0 输入不渲染、写入不可用，页面如实降级（批次9 起）。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/memory-layered.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('记忆层级管理页', () => {
  test('空账本渲染空态提示，L0 授权框可见，无脚本异常', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="layered-memory-page"]')).toBeVisible();
    // 无种子数据 → 空态文案出现
    await expect(page.locator('[data-testid="memory-empty"]')).toBeVisible();
    // 跳转写入页按钮存在
    await expect(page.locator('[data-testid="goto-write"]')).toBeVisible();
    // L0 授权框始终可见（即使空账本）
    await expect(page.locator('[data-testid="l0-bar"]')).toBeVisible();
    // L0 内容卡不存在（不是隐藏，是不渲染）
    await expect(page.locator('.layer[data-layer="L0"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('未登录：L0 授权框只读提示，不渲染密码/grant 输入（不伪造身份）', async ({ page }) => {
    await page.goto(APP);
    // L0 授权框始终可见
    await expect(page.locator('[data-testid="l0-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="l0-bar"]')).toContainText('未登录 · 登录后生效');
    await expect(page.locator('[data-testid="l0-bar"]')).toContainText('已锁定');
    // 未登录不渲染密码/grant 输入与解锁按钮
    await expect(page.locator('[data-testid="l0-pwd"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="l0-grant-id"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="l0-unlock"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="l0-lock"]')).toHaveCount(0);
  });

  test('L0 固定 5 分钟连续会话：无自定义超时/本地口令配置', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="l0-timeout"]')).toHaveCount(0);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).not.toContain('l0_auto_lock_minutes');
    expect(keys).not.toContain('l0_pwd');
  });
});
