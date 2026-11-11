// REQ-003 + REQ-005 通览页 · 真浏览器点击级 E2E（覆盖最新联合展示入口 overview.html）
// 验证：左导航切换「首页+登录卡片」/「Agent 接入配置页」，右侧 iframe 正确加载对应产物，无脚本异常。
// 被测对象 = Vite 构建产物（dist/overview.html）。iframe 内页面同源由本 spec 的静态服务承载。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, stopRunningServer, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { createServer as createBackend, type RunningServer } from '../src/agentOnboard/server.ts';
import { ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD } from '../src/auth/loginService.ts';

let staticSrv: StaticServer | undefined;
let backend: RunningServer | undefined;
let homeBackend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let APP = '';
let ADMIN_SID = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  backend = await createBackend({
    port: 0,
    dataFile: join(tmpdir(), `e2e-overview-${Date.now()}.json`),
    allowedOrigins: [`http://localhost:${staticSrv.port}`], // A5：页面来源白名单
  });
  // 批次28-A：接入页 iframe 走 agentBackend；首页/内联标识等内核数据面走 home 后端（挂内存账本）。
  // 内核数据面需真实会话（/api/kernel/invoke 会话门禁），这里以内置 admin 真登录取 sid。
  homeBackend = await startHomeBackend({
    dataFile: join(tmpdir(), `e2e-overview-home-${Date.now()}.json`),
    allowedOrigins: [`http://localhost:${staticSrv.port}`],
  });
  const login = await fetch(`http://localhost:${homeBackend.port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: ADMIN_ACCOUNT, password: DEFAULT_ADMIN_PASSWORD, form: 'desktop' }),
  });
  const loginBody = (await login.json()) as { sessionId?: string };
  if (!loginBody.sessionId) throw new Error(`overview spec admin login failed: ${login.status}`);
  ADMIN_SID = loginBody.sessionId;
  APP = `http://localhost:${staticSrv.port}/overview.html?backend=http://localhost:${homeBackend.port}&agentBackend=http://localhost:${backend.port}`;
});
test.afterAll(async () => {
  await stopRunningServer(backend);
  await closeServer(homeBackend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('REQ-003 + REQ-005 通览页 · 点击级 E2E', () => {
  test('左导航切换两视图，iframe 正确加载首页与接入页', async ({ page }) => {
    const errors = collectErrors(page);
    // 登录门控（REQ-005）：非登录视图需先有 session。
    // 这里模拟"已在首页登录过"的状态（登录/注册流程由 home/register/crossTabAuth spec 覆盖）。
    // 同时预置真实持久化接入名单（AI 接入页从 localStorage 恢复 3 张卡，非演示种子）。
    await page.addInitScript(([sid]) => {
      localStorage.setItem('session:realpage', sid as string);
      localStorage.setItem('agentOnboardState', JSON.stringify({
        lastOnboardAt: Date.now(),
        agentNames: ['deepseek harness', 'claude code', 'codex'],
        source: 'kernel',
      }));
    }, [ADMIN_SID]);
    // ?backend= 透传给 iframe 内的子页面，使其指向本 spec 的独立后端
    await page.goto(APP);

    await expect(page.locator('.top .logo')).toContainText('记忆助手');

    // 默认视图：首页（REQ-005，现由 OverviewPage 承载，旧问候语大卡已下线）
    await expect(page.locator('#stage')).toHaveAttribute('src', /\/index\.html/);
    const home = page.frameLocator('#stage');
    await expect(home.locator('[data-testid="overview-page"]')).toBeVisible();
    await expect(home.locator('.af-title h1')).toContainText('总览工作台');

    // 切到接入配置页（REQ-003）：持久化名单恢复 3 张卡（未拨测 → 未配置）；卡片在「接入配置」页签
    await page.click('.nav .item:has-text("Agent 接入配置页")');
    await expect(page.locator('#stage')).toHaveAttribute('src', /\/agentonboard\.html/);
    const onboard = page.frameLocator('#stage');
    await expect(onboard.locator('[data-testid="agent-onboard-page"]')).toBeVisible();
    await onboard.locator('[data-testid="agent-tabs"] [role="tab"]').nth(3).click();
    const cards = onboard.locator('#cards > .card');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('未配置');

    // 批次59：REQ-004 内联标识（演示页 + 悬浮层）已作废删除——
    // 主导航无该项是既有事实，这里再锁一条「按钮与页面都不再存在」，防止回流。
    await expect(page.locator('.nav .item:has-text("Agent 界面内联标识")')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /悬浮标识层（演示）/ })).toHaveCount(0);
    // 直接访问旧入口：无论静态服务回 404 还是回退到首页，都不该再出现演示标识
    await page.goto(APP.replace('/overview.html', '/inlineattribution.html'));
    await expect(page.locator('[data-testid="demo-badge"]')).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
