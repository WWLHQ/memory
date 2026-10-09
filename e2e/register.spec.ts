// E2E 测试：用户注册功能（REQ-005 新增）
// 自包含模式：自带静态服务（8129）+ home 后端（8205，含 /api/captcha /api/register）。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';
import { createServer } from '../src/home/server.ts';
import type { Server } from 'node:http';

const STATIC_PORT = 8129; // 避开 app 8123 / home 8124 / overview 8125 / xtab 8128
const BACKEND_PORT = 8205; // 避开 app 8200 / home 8201 / overview 8202 / xtab 8204
const APP = `http://localhost:${STATIC_PORT}/index.html?backend=http://localhost:${BACKEND_PORT}`;

let staticSrv: StaticServer;
let backend: Server;

test.beforeAll(async () => {
  const dataFile = join(tmpdir(), `e2e-register-${Date.now()}.json`);
  backend = createServer({ port: BACKEND_PORT, dataFile });
  await new Promise<void>((res) => backend.listen(BACKEND_PORT, () => res()));
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  backend.closeAllConnections?.();
  await new Promise<void>((res) => backend.close(() => res()));
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('用户注册功能', () => {
  test('注册新用户并登录', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);

    // 首页未登录 → 登录门控；从门控进入登录卡
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
    expect(errors).toEqual([]);
  });

  test('密码少于6位应提示错误', async ({ page }) => {
    await page.goto(APP);
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
  });

  test('账号格式错误应提示错误', async ({ page }) => {
    await page.goto(APP);
    await page.locator('#btnOpenLogin').click();
    await page.locator('button:has-text("注册")').click();

    await page.locator('#acc').fill('invalid_account');  // 不是手机号或邮箱
    await page.locator('#pwd').fill('password123');
    await page.locator('#confirmPwd').fill('password123');
    await page.locator('#captcha').fill('123456');
    await page.locator('#btnRegister').click();

    await expect(page.locator('#loginErr')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#loginErr')).toContainText('手机号或邮箱');
  });

  test('两次密码不一致应提示错误', async ({ page }) => {
    await page.goto(APP);
    await page.locator('#btnOpenLogin').click();
    await page.locator('button:has-text("注册")').click();

    await page.locator('#acc').fill('13900139002');
    await page.locator('#pwd').fill('password123');
    await page.locator('#confirmPwd').fill('different123');  // 不一致
    await page.locator('#captcha').fill('123456');
    await page.locator('#btnRegister').click();

    await expect(page.locator('#loginErr')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#loginErr')).toContainText('不一致');
  });

  test('验证码错误应提示错误', async ({ page }) => {
    await page.goto(APP);
    await page.locator('#btnOpenLogin').click();
    await page.locator('button:has-text("注册")').click();

    await page.locator('#acc').fill('13900139003');
    await page.locator('#pwd').fill('password123');
    await page.locator('#confirmPwd').fill('password123');
    await page.locator('#captcha').fill('000000');  // 错误验证码
    await page.locator('#btnRegister').click();

    await expect(page.locator('#loginErr')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#loginErr')).toContainText('验证码错误');
  });
});
