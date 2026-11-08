// E2E 测试：用户注册（REQ-005）
// 诚实口径：旧首页 LoginModal 的「注册」表单随首页下线（现行入口只有 login.html，页面无注册按钮），
//   注册能力仍真实存在于 home 后端：GET /api/captcha（本机直出验证码）+ POST /api/register。
// 因此本 spec 走真实数据面：API 注册 → login.html 真登录；四类失败按后端真实 reason/message 断言，
//   同时断言「登录页不提供注册入口」这一现状（不伪造 UI 能力）。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';

let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let APP = '';
// 账号表是 home 服务进程内全局 Map：每次运行用唯一 11 位手机号，确保可重复执行（409 已存在）。
const ACC = `138${String(Date.now()).slice(-8)}`;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  const dataFile = join(tmpdir(), `e2e-register-${Date.now()}.json`);
  backend = await startHomeBackend({ dataFile, allowedOrigins: [`http://localhost:${staticSrv.port}`] });
  APP = `http://localhost:${staticSrv.port}/login.html?backend=http://localhost:${backend.port}`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

/** 取真实验证码（本机无短信/邮件通道，后端直出 id + code） */
async function fetchCaptcha(page: import('playwright-core').Page): Promise<{ id: string; code: string }> {
  return page.evaluate(async (port) => {
    const r = await fetch(`http://localhost:${port}/api/captcha`);
    return (await r.json()) as { id: string; code: string };
  }, backend!.port);
}

/** 直接调用真实注册端点，返回 status + body */
async function postRegister(
  page: import('playwright-core').Page,
  body: Record<string, string>,
): Promise<{ status: number; body: { ok?: boolean; reason?: string; message?: string; team_id?: string } }> {
  return page.evaluate(async ({ port, payload }) => {
    const r = await fetch(`http://localhost:${port}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    return { status: r.status, body: await r.json() };
  }, { port: backend!.port, payload: body });
}

test.describe('用户注册功能', () => {
  test('注册新用户并登录（真实 API 注册 → login.html 登录）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
    // 诚实态：现行登录页没有注册表单（旧首页 LoginModal 已下线）
    await expect(page.locator('#btnRegister')).toHaveCount(0);

    const cap = await fetchCaptcha(page);
    // 批次48 A10：注册按已持久化密码策略校验（默认要求大写/小写/数字/特殊字符，min_len 8）
    const PWD = 'Password123!';
    const reg = await postRegister(page, {
      account: ACC, password: PWD, confirmPassword: PWD, captchaCode: cap.code, captchaId: cap.id,
    });
    expect(reg.status).toBe(200);
    expect(reg.body.ok).toBe(true);
    expect(reg.body.team_id).toBe(`personal-${ACC}`);

    // 用新账号在真实登录页登录
    await page.locator('#loginAccount').fill(ACC);
    await page.locator('#loginPassword').fill(PWD);
    await page.getByRole('button', { name: /^登录$/ }).click();
    await expect(page.locator('[data-testid="login-session-valid"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="login-session-valid"]')).toContainText(ACC);
    expect(await page.evaluate(() => localStorage.getItem('session:realpage'))).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('密码少于 6 位应被真实后端拒绝', async ({ page }) => {
    await page.goto(APP);
    const r = await postRegister(page, {
      account: '13900139001', password: '123', confirmPassword: '123', captchaCode: '123456', captchaId: 'n/a',
    });
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('weak_password');
    expect(r.body.message).toContain('至少 6 位');
  });

  test('账号格式错误应被真实后端拒绝', async ({ page }) => {
    await page.goto(APP);
    const r = await postRegister(page, {
      account: 'invalid_account', password: 'password123', confirmPassword: 'password123', captchaCode: '123456', captchaId: 'n/a',
    });
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('invalid_account');
    expect(r.body.message).toContain('手机号或邮箱');
  });

  test('两次密码不一致应被真实后端拒绝', async ({ page }) => {
    await page.goto(APP);
    const r = await postRegister(page, {
      account: '13900139002', password: 'password123', confirmPassword: 'different123', captchaCode: '123456', captchaId: 'n/a',
    });
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('password_mismatch');
    expect(r.body.message).toContain('不一致');
  });

  test('验证码错误应被真实后端拒绝（一次性消费）', async ({ page }) => {
    await page.goto(APP);
    const cap = await fetchCaptcha(page);
    const wrong = cap.code === '000000' ? '000001' : '000000';
    const r = await postRegister(page, {
      account: '13900139003', password: 'password123', confirmPassword: 'password123', captchaCode: wrong, captchaId: cap.id,
    });
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('invalid_captcha');
    expect(r.body.message).toContain('验证码错误');
  });
});
