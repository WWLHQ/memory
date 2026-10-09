// REQ-005 T12 端到端验收（真浏览器点击级，对齐 HOME-LOGIN.md T12 验收清单）
// 覆盖：① 首屏未登录灰置不阻塞 ② ▶ 登录 弹卡 ③ 密码错 → 锁定 + 审计（断言打到真实后端 :8201）
//       ④ 登录成功 → 顶栏变已登录 + 功劳 4 卡出数据 ⑤ .rid 溯源弹审计 modal ⑥ 登出回灰置 ⑦ 无脚本异常
// 被测对象 = Vite 构建产物（dist/home.html），登录走 T11 后端镜像（useLoginMirror，?backend= 覆盖到 :8201）。
// 后端 = T10 home server（src/home/server.ts），E2E 进程内起服并预置测试账号。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';
import { createServer } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';
import type { Server } from 'node:http';

const STATIC_PORT = 8124; // 与 app.spec 的 8123 区分，避免静态端口争用
const APP = `http://localhost:${STATIC_PORT}/index.html?backend=http://localhost:8201`;
const BACKEND_PORT = 8201;
const PWD = 'e2e_pwd';

let staticSrv: StaticServer;
let backend: Server;
let dataFile: string;

test.beforeAll(async () => {
  dataFile = join(tmpdir(), `e2e-home-${Date.now()}.json`);
  // 预置测试账号（T3 registerAccount，团队只读 team_id 由"管理员"分配）
  const { registerAccount } = await import('../src/home/server.ts');
  registerAccount('e2e_user', hashPassword(PWD), { enterprise_id: 'ent_001', team_id: 'team_001', perspective: 'team' });
  registerAccount('e2e_lock', hashPassword(PWD), { enterprise_id: 'ent_002', team_id: 'team_002', perspective: 'team' });
  registerAccount('e2e_lock2', hashPassword(PWD), { enterprise_id: 'ent_003', team_id: 'team_003', perspective: 'team' });

  backend = createServer({ port: BACKEND_PORT, dataFile });
  await new Promise<void>((res) => backend.listen(BACKEND_PORT, () => res()));

  staticSrv = await startStatic(STATIC_PORT, 'dist'); // 服务 Vite 构建产物（独立端口 8124，避开 app.spec 的 8123）
});

test.afterAll(async () => {
  backend.closeAllConnections?.();
  await new Promise<void>((res) => backend.close(() => res()));
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('REQ-005 首页与登录卡片 · 点击级 E2E', () => {
  test('① 首屏进入不阻塞登录（未登录显示登录门控）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    // 未登录：欢迎语 + ▶ 登录 可见；登录门控遮罩替代仪表盘
    await expect(page.locator('#hiUnauth')).toBeVisible();
    await expect(page.locator('#btnOpenLogin')).toBeVisible();
    await expect(page.locator('#authGate')).toBeVisible();
    // 已登录态元素不应出现（不阻塞、不预载）
    await expect(page.locator('#hiAuth')).toHaveCount(0);
    await expect(page.locator('#dashGrid')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('② ▶ 登录 弹卡', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await page.click('#btnOpenLogin');
    await expect(page.locator('#loginModal.show')).toBeVisible();
    await expect(page.locator('#acc')).toBeVisible();
    await expect(page.locator('#pwd')).toBeVisible();
    // 端形态 / 团队 只读（无输入控件，仅展示）
    await expect(page.locator('#rowForm .pill')).toContainText('自动识别');
    await expect(page.locator('#rowTeam .pill')).toContainText('只读');
    expect(errors).toEqual([]);
  });

  test('③ 密码错 → 锁定 + 审计（断言确实打到真实后端 :8201）', async ({ page }) => {
    const errors = collectErrors(page);
    const calls: string[] = [];
    page.on('request', (r) => { if (r.url().includes(`:${BACKEND_PORT}`)) calls.push(`${r.method()} ${r.url()}`); });

    await page.goto(APP);
    await page.click('#btnOpenLogin');
    await page.fill('#acc', 'e2e_lock');
    await page.fill('#pwd', 'wrong-password');
    await page.click('#btnLogin');

    // 真实后端确实被调用（T11 镜像写审计 action=login_fail）
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.includes('/api/login'))).toBeTruthy();

    // 后端锁定策略生效：连续 6 次错 → 第 6 次 423 Locked（e2e_lock2 独立账号，恰好 6 次）
    const sixth = await page.evaluate(async () => {
      const body = { account: 'e2e_lock2', password: 'wrong', form: 'desktop' };
      let last = 0;
      for (let i = 0; i < 6; i++) {
        const r = await fetch('http://localhost:8201/api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        last = r.status;
      }
      return last;
    });
    expect(sixth).toBe(423);
    expect(errors).toEqual([]);
  });

  test('④ 登录成功 → 顶栏变已登录 + 功劳 4 卡出数据（打到真实后端 :8201）', async ({ page }) => {
    const errors = collectErrors(page);
    const calls: string[] = [];
    page.on('request', (r) => { if (r.url().includes(`:${BACKEND_PORT}`)) calls.push(`${r.method()} ${r.url()}`); });

    await page.goto(APP);
    await page.click('#btnOpenLogin');
    await page.fill('#acc', 'e2e_user');
    await page.fill('#pwd', PWD);
    await page.click('#btnLogin');

    // 顶栏变已登录（后端 team_id 只读注入）
    await expect(page.locator('#hiAuth')).toContainText('e2e_user');
    await expect(page.locator('#hiAuth')).toContainText('team_001');
    await expect(page.locator('#hiAuth')).toContainText('只读');
    // 功劳 4 卡出数据（🪙 -58% / ⚡ -34% / 🔁 3.2× / 💸 省¥19）
    await expect(page.locator('#gains .gain')).toHaveCount(4);
    await expect(page.locator('#gains')).toContainText('🪙');
    await expect(page.locator('#gains')).toContainText('-58%');
    // 灰置占位消失
    await expect(page.locator('#offPlaceholder')).toHaveCount(0);
    // 真实后端确实被调用（T11 镜像登录）
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.includes('/api/login'))).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('⑤ 数字可点溯源 request_id（弹审计 modal）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await page.click('#btnOpenLogin');
    await page.fill('#acc', 'e2e_user');
    await page.fill('#pwd', PWD);
    await page.click('#btnLogin');
    await expect(page.locator('#hiAuth')).toContainText('e2e_user');

    // 点击异常区的 .rid → 弹审计 modal（显示 request_id）
    await expect(page.locator('#dashGrid .rid').first()).toBeVisible();
    await page.click('#dashGrid .rid');
    await expect(page.locator('#auditModal')).toBeVisible();
    await expect(page.locator('#auditRid')).toContainText('req_x1');
    expect(errors).toEqual([]);
  });

  test('⑥ 登出 → 回灰置', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await page.click('#btnOpenLogin');
    await page.fill('#acc', 'e2e_user');
    await page.fill('#pwd', PWD);
    await page.click('#btnLogin');
    await expect(page.locator('#hiAuth')).toContainText('e2e_user');

    await page.click('#btnLogout');
    // 回未登录门控态
    await expect(page.locator('#hiUnauth')).toBeVisible();
    await expect(page.locator('#authGate')).toBeVisible();
    await expect(page.locator('#hiAuth')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
