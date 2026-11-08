// REQ-005 首页与登录 · 端到端验收（真浏览器点击级）
// 现行结构（旧首页 HomePage/LoginModal 已下线，首页换 OverviewPage、登录独立成 login.html）：
//   ① 首屏不阻塞：index.html 直接渲染概览页（真实账本读数），无登录门控遮罩
//   ② 登录入口：首页不再弹登录卡，登录在 login.html（无注册入口）
//   ③ 密码错 → 后端真实 401；连续 6 次 → 423（直连真实后端）
//   ④ 登录成功 → 会话落本机 + 概览页范围行「已登录」+ 4 张统计卡
//   ⑤ request_id 溯源：旧 `.rid` 审计弹窗已迁至审计页链路视图（audit.html?chain=），未命中如实「账本无链路」
//   ⑥ 登出 → 清本机会话 → 概览页回「未登录 · 只读」
//   ⑦ L1–L6 关系图谱：旧首页 Dashboard 下线后无任何页面挂载该图谱 → 断诚实态（无图谱 DOM），
//      真实分层界面改为 memory-layered.html 的 L6→L1 层卡片（空账本如实空态）
// 后端 = home server（src/home/server.ts），E2E 进程内起服并预置测试账号。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';
import type { Page } from 'playwright-core';

const PWD = 'e2e_pwd';

let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let BACKEND_PORT = 0;
let HOME = '';
let LOGIN = '';
let AUDIT = '';
let LAYERED = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用

  const dataFile = join(tmpdir(), `e2e-home-${Date.now()}.json`);
  // 预置测试账号（T3 registerAccount，团队只读 team_id 由"管理员"分配）
  registerAccount('e2e_user', hashPassword(PWD), { enterprise_id: 'ent_001', team_id: 'team_001', perspective: 'team' });
  registerAccount('e2e_lock', hashPassword(PWD), { enterprise_id: 'ent_002', team_id: 'team_002', perspective: 'team' });
  registerAccount('e2e_lock2', hashPassword(PWD), { enterprise_id: 'ent_003', team_id: 'team_003', perspective: 'team' });

  backend = await startHomeBackend({ dataFile, allowedOrigins: [`http://localhost:${staticSrv.port}`] });
  BACKEND_PORT = backend.port;
  const q = `backend=http://localhost:${BACKEND_PORT}`;
  HOME = `http://localhost:${staticSrv.port}/index.html?${q}`;
  LOGIN = `http://localhost:${staticSrv.port}/login.html?${q}`;
  AUDIT = `http://localhost:${staticSrv.port}/audit.html`;
  LAYERED = `http://localhost:${staticSrv.port}/memory-layered.html`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

async function login(page: Page, account = 'e2e_user', pwd = PWD): Promise<void> {
  await page.goto(LOGIN);
  await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
  await page.locator('#loginAccount').fill(account);
  await page.locator('#loginPassword').fill(pwd);
  await page.getByRole('button', { name: /^登录$/ }).click();
}

test.describe('REQ-005 首页与登录 · 点击级 E2E', () => {
  test('① 首屏进入不阻塞登录（概览页直接出真实读数，无门控遮罩）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(HOME);
    await expect(page.locator('[data-testid="overview-page"]')).toBeVisible();
    // 一句话结论 + 4 张统计卡（真实账本读取）
    await expect(page.locator('.ovx-concl')).toBeVisible();
    await expect(page.locator('.ovx-stats .ovx-stat')).toHaveCount(4);
    await expect(page.locator('.ovx-scope')).toContainText('未登录');
    // 未登录仍可读本地账本（诚实口径），并给出「去登录」快捷入口
    await expect(page.getByRole('button', { name: '去登录' })).toBeVisible();
    // 旧首页的门控遮罩 / 仪表盘 / 程序日志窗已随旧首页下线
    await expect(page.locator('#authGate')).toHaveCount(0);
    await expect(page.locator('#dashGrid')).toHaveCount(0);
    await expect(page.locator('#programLog')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('② 登录入口：首页不再弹登录卡，登录走独立 login.html（且无注册入口）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(HOME);
    await expect(page.locator('#loginModal')).toHaveCount(0);
    await expect(page.locator('#btnOpenLogin')).toHaveCount(0);

    await page.goto(LOGIN);
    await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
    await expect(page.locator('#loginAccount')).toBeVisible();
    await expect(page.locator('#loginPassword')).toBeVisible();
    await expect(page.getByRole('button', { name: /^登录$/ })).toBeVisible();
    // 诚实态：注册表单随旧首页 LoginModal 下线（注册能力在 home 后端，见 register.spec）
    await expect(page.locator('#btnRegister')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('③ 密码错 → 后端真实 401；连续 6 次 → 423 锁定', async ({ page }) => {
    const errors = collectErrors(page);
    const calls: string[] = [];
    page.on('request', (r) => { if (r.url().includes(`:${BACKEND_PORT}`)) calls.push(`${r.method()} ${r.url()}`); });

    await login(page, 'e2e_lock', 'wrong-password');
    // 真实后端确实被调用（T11 镜像写审计 action=login_fail）
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.includes('/api/login'))).toBeTruthy();
    // 登录页按后端真实原因提示（401 密码错误）
    await expect(page.locator('[data-testid="login-error"]')).toContainText('HTTP 401');
    await expect(page.locator('[data-testid="login-error"]')).toContainText('密码错误');

    // 后端锁定策略生效：连续 6 次错 → 第 6 次 423 Locked（e2e_lock2 独立账号，恰好 6 次）
    const sixth = await page.evaluate(async (port) => {
      const body = { account: 'e2e_lock2', password: 'wrong', form: 'desktop' };
      let last = 0;
      for (let i = 0; i < 6; i++) {
        const r = await fetch(`http://localhost:${port}/api/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        last = r.status;
      }
      return last;
    }, BACKEND_PORT);
    expect(sixth).toBe(423);
    expect(errors).toEqual([]);
  });

  test('④ 登录成功 → 会话落本机 + 概览页「已登录」+ 四卡为真实账本指标', async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);
    await expect(page.locator('[data-testid="login-session-valid"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="login-session-valid"]')).toContainText('e2e_user');
    await expect(page.locator('[data-testid="login-session-valid"]')).toContainText('team_001');

    const sid = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(sid).toBeTruthy();

    // 概览页读同一份会话：范围行如实「已登录」，且不再显示「去登录」
    await page.goto(HOME);
    await expect(page.locator('.ovx-scope')).toContainText('已登录', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: '去登录' })).toHaveCount(0);
    // 四卡为真实账本读数（空账本 = 0 条，不伪造演示数字）
    await expect(page.locator('.ovx-stats .ovx-stat')).toHaveCount(4);
    await expect(page.locator('.ovx-stats')).toContainText('记忆条目');
    await expect(page.locator('.ovx-stats')).toContainText('今日写入');
    await expect(page.locator('.ovx-stats')).toContainText('今日召回');
    await expect(page.locator('.ovx-stats')).toContainText('今日成本');
    await expect(page.locator('.ovx-stats .ovx-stat').first().locator('.v')).toContainText('0');
    await expect(page.locator('.ovx-stats .ovx-stat').first().locator('.v')).toContainText('条');
    await expect(page.locator('[data-testid="overview-page"]')).not.toContainText('-58%');
    expect(errors).toEqual([]);
  });

  test('⑤ request_id 溯源：审计页链路视图真查账本，未命中如实「账本无链路」', async ({ page }) => {
    const errors = collectErrors(page);
    // 旧首页的 `.rid` + 审计弹窗已下线（功能迁至审计页链路视图）；如实确认现行首页无该弹窗
    await page.goto(HOME);
    await expect(page.locator('#auditModal')).toHaveCount(0);
    await expect(page.locator('#auditRid')).toHaveCount(0);

    // 审计页按 ?chain= 真查内核账本：该 id 不存在 → 5 段链路全为「账本无链路」，不补造证据
    await page.goto(`${AUDIT}?chain=e2e_real_1`);
    await expect(page.locator('[data-testid="audit-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="chain-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="chain-view"]')).toContainText('e2e_real_1');
    await expect(page.locator('[data-testid="chain-view"]')).toContainText('共 0 行真实审计');
    await expect(page.locator('[data-testid="chain-view"]')).toContainText('账本无链路');
    await expect(page.locator('[data-testid="chain-view"]')).not.toContainText('模拟');
    await expect(page.locator('tr[data-testid^="row-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="clear-chain"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('⑥ 登出 → 清本机会话 → 概览页回「未登录 · 只读」', async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);
    await expect(page.locator('[data-testid="login-session-valid"]')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /登出（清除本机会话）/ }).click();
    await expect(page.locator('#loginAccount')).toBeVisible();
    await expect(page.locator('[data-testid="login-session-valid"]')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('session:realpage'))).toBeFalsy();

    await page.goto(HOME);
    await expect(page.locator('.ovx-scope')).toContainText('未登录', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: '去登录' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('⑦ L1–L6 图谱：旧首页图谱未挂载（诚实态），真实分层界面在 memory-layered.html', async ({ page }) => {
    const errors = collectErrors(page);
    // 旧 `#layerGraph` 及其六层锚点/缩放控件随 Dashboard 下线，现行首页不渲染图谱 DOM
    await page.goto(HOME);
    await expect(page.locator('#layerGraph')).toHaveCount(0);
    await expect(page.locator('[data-graph-hub]')).toHaveCount(0);
    await expect(page.locator('#lgZoomValue')).toHaveCount(0);

    // 真实分层界面：L6→L1 层卡片由账本派生；空账本如实空态（不展示 6 层卡片，不伪造节点）
    await page.goto(LAYERED);
    await expect(page.locator('[data-testid="layered-memory-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="memory-empty"]')).toContainText('记忆账本还是空的');
    await expect(page.locator('[data-layer]')).toHaveCount(0);
    await expect(page.locator('[data-testid="layered-memory-page"]')).toContainText('L6→L1');
    expect(errors).toEqual([]);
  });
});
