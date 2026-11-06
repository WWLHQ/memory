// E2E 测试：用户注册功能（REQ-005 新增）
// 自包含模式：静态服务 + home 后端（均系统分配端口，含 /api/captcha /api/register）。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';

let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let APP = '';
// 账号表是 home 服务进程内全局 Map（跨 spec 共享）：固定手机号会与上次运行/其它 spec 冲突（409 已存在）。
// 每次运行生成唯一 11 位手机号，确保注册用例可重复执行。
const ACC = `138${String(Date.now()).slice(-8)}`;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  const dataFile = join(tmpdir(), `e2e-register-${Date.now()}.json`);
  backend = await startHomeBackend({ dataFile, allowedOrigins: [`http://localhost:${staticSrv.port}`] });
  APP = `http://localhost:${staticSrv.port}/index.html?backend=http://localhost:${backend.port}`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await staticSrv?.stop();
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

    // 验证码异步加载：等到按钮文案出现 6 位数字再读取
    const captchaBtn = page.locator('button:has-text("换")');
    await expect(captchaBtn).toHaveText(/\d{6}/, { timeout: 5000 });
    const captchaText = await captchaBtn.textContent();
    const captchaCode = captchaText?.match(/(\d{6})/)?.[1] ?? '';

    // 填写注册表单。批次48 A10：注册按已持久化密码策略校验（默认策略要求大写/小写/数字/特殊字符，
    // min_len 8），旧用 password123 会被 400 weak_password 拒绝 → 这里用符合默认策略的真实密码。
    const PWD = 'Password123!';
    await page.locator('#acc').fill(ACC);
    await page.locator('#pwd').fill(PWD);
    await page.locator('#confirmPwd').fill(PWD);
    await page.locator('#captcha').fill(captchaCode);
    await page.locator('#btnRegister').click();

    // 等待注册成功提示
    await expect(page.locator('#toast')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('注册成功');

    // 验证回到了登录界面
    await expect(page.locator('#loginModal h3')).toContainText('登录');

    // 现在用新账号登录
    await page.locator('#acc').fill(ACC);
    await page.locator('#pwd').fill(PWD);
    await page.locator('#btnLogin').click();

    // 登录成功
    await expect(page.locator('#hiAuth')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#hiAuth')).toContainText(ACC);
    expect(errors).toEqual([]);
  });

  test('密码少于6位应提示错误', async ({ page }) => {
    await page.goto(APP);
    await page.locator('#btnOpenLogin').click();
    await page.locator('button:has-text("注册")').click();

    const captchaBtn = page.locator('button:has-text("换")');
    await expect(captchaBtn).toHaveText(/\d{6}/, { timeout: 5000 });
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
