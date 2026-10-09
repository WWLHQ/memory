// E2E 测试：登录态跨 iframe 共享（REQ-005 Bug #3 验证）
import { test, expect } from '@playwright/test';

test.describe('登录态跨 iframe 共享', () => {
  test('登录后切换页面不应重复登录', async ({ page }) => {
    // 打开通览页
    await page.goto('http://localhost:8127/overview.html');
    await page.waitForLoadState('networkidle');

    // 确认初始在登录视图
    await expect(page.locator('iframe').first()).toBeAttached();
    const iframe = page.frameLocator('iframe').first();

    // 检查首页是否显示登录门控（未登录状态）
    await expect(iframe.locator('#authGate')).toBeVisible({ timeout: 5000 });

    // 点击登录按钮
    await iframe.locator('#btnOpenLoginFromGate').click();
    await expect(iframe.locator('#loginModal')).toBeVisible();

    // 填写登录表单
    await iframe.locator('#acc').fill('test_user');
    await iframe.locator('#pwd').fill('test_password');
    await iframe.locator('#btnLogin').click();

    // 等待登录成功（门控消失）
    await expect(iframe.locator('#authGate')).not.toBeVisible({ timeout: 5000 });
    await expect(iframe.locator('#hiAuth')).toBeVisible({ timeout: 5000 });

    // 验证 localStorage 中有 session
    const sessionId = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(sessionId).toBeTruthy();
    expect(sessionId!.length).toBeGreaterThan(0);

    // 切换到 Agent 接入配置页
    await page.locator('#nav .item').nth(1).click();
    await page.waitForTimeout(1000); // 等待 iframe 加载

    // 验证 AgentOnboard 页面已登录（不显示登录门控）
    const agentFrame = page.frameLocator('iframe').first();
    await expect(agentFrame.locator('#auth-gate, .auth-gate')).not.toBeVisible({ timeout: 5000 });

    // 切回首页，验证仍然保持登录状态
    await page.locator('#nav .item').nth(0).click();
    await page.waitForTimeout(1000);
    const homeFrame = page.frameLocator('iframe').first();
    await expect(homeFrame.locator('#hiAuth')).toBeVisible({ timeout: 5000 });
    await expect(homeFrame.locator('#authGate')).not.toBeVisible({ timeout: 5000 });

    // 切换到内联标识页
    await page.locator('#nav .item').nth(2).click();
    await page.waitForTimeout(1000);

    // 验证内联标识页正常渲染
    const inlineFrame = page.frameLocator('iframe').first();
    await expect(inlineFrame.locator('.agentframe')).toBeVisible({ timeout: 5000 });

    console.log('✅ 登录态跨 iframe 共享测试通过');
  });

  test('localStorage 中 session 存在', async ({ page }) => {
    await page.goto('http://localhost:8127/index.html');
    await page.waitForLoadState('networkidle');

    // 未登录时应该没有 session
    const beforeSession = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(beforeSession).toBeFalsy();

    // 点击登录
    await page.locator('#btnOpenLogin').click();
    await page.locator('#acc').fill('test_user_2');
    await page.locator('#pwd').fill('test_password');
    await page.locator('#btnLogin').click();

    // 等待登录成功
    await expect(page.locator('#hiAuth')).toBeVisible({ timeout: 5000 });

    // 验证 session 已写入
    const afterSession = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(afterSession).toBeTruthy();
    expect(afterSession!.length).toBeGreaterThan(0);

    console.log('✅ localStorage session 写入测试通过');
  });
});
