// E2E 测试：用户注册功能（REQ-005 新增）
import { test, expect } from '@playwright/test';

test.describe('用户注册功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8127/index.html?backend=http://localhost:8200');
    await page.waitForLoadState('networkidle');
  });

  test('注册新用户并登录', async ({ page }) => {
    await page.locator('#btnOpenLogin').click();
    await expect(page.locator('#loginModal')).toBeVisible();

    // 切换到注册模式
    await page.locator('button:has-text("注册")').click();
    await expect(page.locator('#btnRegister')).toBeVisible();

    // 等待验证码加载
    await page.waitForTimeout(500);

    // 获取页面上显示的验证码
    const captchaBtn = page.locator('button:has-text("换")');
    const captchaText = await captchaBtn.textContent();
    const captchaCode = captchaText?.match(/(\d{6})/)?.[1] ?? '';

    // 填写注册表单
    await page.locator('#acc').fill('13800138001');
    await page.locator('#pwd').fill('password123');
    await page.locator('#confirmPwd').fill('password123');
    await page.locator('#captcha').fill(captchaCode);
    await page.locator('#btnRegister').click();

    // 等待注册成功提示
    await expect(page.locator('#toast')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('注册成功');

    // 验证回到了登录界面
    await expect(page.locator('#loginModal h3')).toContainText('登录');

    // 现在用新账号登录
    await page.locator('#acc').fill('13800138001');
    await page.locator('#pwd').fill('password123');
    await page.locator('#btnLogin').click();

    // 登录成功
    await expect(page.locator('#hiAuth')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#hiAuth')).toContainText('13800138001');

    console.log('✅ 注册并登录测试通过');
  });

  test('密码少于6位应提示错误', async ({ page }) => {
    await page.locator('#btnOpenLogin').click();
    await page.locator('button:has-text("注册")').click();

    await page.waitForTimeout(500);
    const captchaBtn = page.locator('button:has-text("换")');
    const captchaText = await captchaBtn.textContent();
    const captchaCode = captchaText?.match(/(\d{6})/)?.[1] ?? '';

    await page.locator('#acc').fill('13900139001');
    await page.locator('#pwd').fill('123');  // 少于6位
    await page.locator('#confirmPwd').fill('123');
    await page.locator('#captcha').fill(captchaCode);
    await page.locator('#btnRegister').click();

    await expect(page.locator('#loginErr')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#loginErr')).toContainText('至少 6 位');

    console.log('✅ 密码长度校验测试通过');
  });

  test('账号格式错误应提示错误', async ({ page }) => {
    await page.locator('#btnOpenLogin').click();
    await page.locator('button:has-text("注册")').click();

    await page.locator('#acc').fill('invalid_account');  // 不是手机号或邮箱
    await page.locator('#pwd').fill('password123');
    await page.locator('#confirmPwd').fill('password123');
    await page.locator('#captcha').fill('123456');
    await page.locator('#btnRegister').click();

    await expect(page.locator('#loginErr')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#loginErr')).toContainText('手机号或邮箱');

    console.log('✅ 账号格式校验测试通过');
  });

  test('两次密码不一致应提示错误', async ({ page }) => {
    await page.locator('#btnOpenLogin').click();
    await page.locator('button:has-text("注册")').click();

    await page.locator('#acc').fill('13900139002');
    await page.locator('#pwd').fill('password123');
    await page.locator('#confirmPwd').fill('different123');  // 不一致
    await page.locator('#captcha').fill('123456');
    await page.locator('#btnRegister').click();

    await expect(page.locator('#loginErr')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#loginErr')).toContainText('不一致');

    console.log('✅ 密码一致性校验测试通过');
  });

  test('验证码错误应提示错误', async ({ page }) => {
    await page.locator('#btnOpenLogin').click();
    await page.locator('button:has-text("注册")').click();

    await page.locator('#acc').fill('13900139003');
    await page.locator('#pwd').fill('password123');
    await page.locator('#confirmPwd').fill('password123');
    await page.locator('#captcha').fill('000000');  // 错误验证码
    await page.locator('#btnRegister').click();

    await expect(page.locator('#loginErr')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#loginErr')).toContainText('验证码错误');

    console.log('✅ 验证码错误提示测试通过');
  });
});
