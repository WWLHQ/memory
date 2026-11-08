// REQ-003 真浏览器点击级 E2E（对齐 design/ui/Agent接入页_原型.html）
// 覆盖：持久化接入恢复、一键接入（浏览器无宿主能力 → 如实失败并指向「手动检测」）、R3/R4 校验、测试/轮换/保存 联动真实后端、
// 撤销绑定、隔离 toast。
// 关键回归：Codex tools.pref 为布尔 false → 勾选不得抛 "Cannot create property 'on' on boolean"。
// 数据真相 = localStorage 持久化名单（agentOnboardState / agentOnboardDetectedAgents）；
// 批次16 起自动接入不再用内核模拟冒充本机命中：浏览器模式必须显式失败，绝不伪造发现结果。
// 批次26 P0-5 起：接入后端写端点要求真实会话（x-session-id 经 home server 校验，轮换/撤销/删除需 admin）→
// 本 spec 起真实 home 后端 + 真实 admin 登录拿 sessionId，不再用伪造 'e2e-session-*'。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, stopRunningServer, closeServer, type StaticServer } from './servers.ts';
import { createServer as createBackend, type RunningServer } from '../src/agentOnboard/server.ts';

const ADMIN_PWD = 'Admin@123456'; // home server 启动播种的内置管理员（批次7）

let staticSrv: StaticServer | undefined;
let backend: RunningServer | undefined;
let home: Awaited<ReturnType<typeof import('./servers.ts').startHomeBackend>> | undefined;
let APP = '';
let ADMIN_SID = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  home = await (await import('./servers.ts')).startHomeBackend({
    dataFile: join(tmpdir(), `e2e-agent-onboard-home-${Date.now()}.json`),
    allowedOrigins: [`http://localhost:${staticSrv.port}`],
  });
  // 真实登录内置 admin → sessionId（写端点以它过会话闸门）
  const loginRes = await fetch(`http://localhost:${home.port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin', password: ADMIN_PWD, form: 'desktop' }),
  });
  const login = (await loginRes.json()) as { sessionId?: string; reason?: string };
  if (loginRes.status !== 200 || !login.sessionId) throw new Error(`E2E admin 登录失败（${loginRes.status} ${login.reason ?? ''}）`);
  ADMIN_SID = login.sessionId;
  backend = await createBackend({
    port: 0,
    dataFile: join(tmpdir(), `e2e-agent-onboard-${Date.now()}.json`),
    allowedOrigins: [`http://localhost:${staticSrv.port}`], // A5：页面来源白名单（harness baseURL）
    getSession: (sid) => home?.homeServer.getSessionContext(sid) ?? null, // 批次26 P0-5：会话真源
  });
  APP = `http://localhost:${staticSrv.port}/agentonboard.html?agentBackend=http://localhost:${backend.port}`;
});
test.afterAll(async () => {
  await stopRunningServer(backend); // 内部先断 keep-alive，避免 stop() 卡住
  await closeServer(home?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

/** 切到指定页签（0 接入概览 / 1 MCP 客户端 / 2 探针结果 / 3 接入配置），面板以 hidden 挂载 */
async function atab(page: import('playwright-core').Page, i: 0 | 1 | 2 | 3): Promise<void> {
  await page.locator(`[data-testid="agent-tab-${i}"]`).click();
  await expect(page.locator(`[data-testid="agent-tab-${i}"]`)).toHaveAttribute('aria-selected', 'true');
}

test.describe('REQ-003 Agent 接入页 · 点击级 E2E', () => {
  // 登录门控（REQ-005）：AgentOnboardPage 未登录时显示 .auth-gate 拦截。
  // 这里预置真实 admin 会话（批次26 P0-5：写端点以 x-session-id 经 home server 校验；登录流程由 home/register/crossTabAuth spec 覆盖）。
  // 同时预置真实持久化接入名单（3 张卡 = 卡片快照；Codex pref 以布尔 false 存储 → R3 回归）。
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((sid) => {
      localStorage.setItem('session:realpage', sid);
      type Snap = {
        name: string; badge: string; label: string; method: string;
        conn: number; circuit: string; latency: number; fail: number; recover: number;
        tenant: string;
        tools: { recall: { on: boolean; topk: number; scene: string; mode: string }; write: { on: boolean }; pref: unknown };
        iso: { projShare: boolean; prefCross: boolean };
        chan: { webhook: boolean; api: boolean; recon: string };
        key: { mask: string; last: string; grace: number };
        state: string;
      };
      const mk = (name: string, badge: string, label: string, method: string, prefOn: boolean): Snap => ({
        name, badge, label, method,
        conn: 0, circuit: 'CLOSED', latency: 0, fail: 0, recover: 0,
        tenant: 'ent_local / team_local',
        tools: {
          recall: { on: true, topk: 5, scene: 'default', mode: '' },
          write: { on: true },
          pref: prefOn ? { on: true } : false, // 原型历史形状：布尔 false = 未启用
        },
        iso: { projShare: true, prefCross: true },
        chan: { webhook: true, api: true, recon: '5min' },
        key: { mask: `[API_KEY:${name.toLowerCase().replace(/\s+/g, '-')}]`, last: '未记录', grace: 24 },
        state: 'onboard', // 只有真实拨测/宿主真扫命中才允许标「已连通」
      });
      const names = ['deepseek harness', 'claude code', 'codex'];
      localStorage.setItem('agentOnboardDetectedAgents', JSON.stringify([
        { name: names[0], card: mk(names[0], 'p0', 'MVP·P0', 'MCP + Webhook 直连（自有）', true), addedAt: Date.now() },
        { name: names[1], card: mk(names[1], 'p1', 'MVP·P1', 'MCP 工具 + 会话日志兜底（第三方样板）', true), addedAt: Date.now() },
        { name: names[2], card: mk(names[2], 'p2', '兜底·P2', 'MCP（若支持）+ API 拉取兜底', false), addedAt: Date.now() },
      ]));
      localStorage.setItem('agentOnboardState', JSON.stringify({
        lastOnboardAt: Date.now(), agentNames: names, source: 'kernel',
      }));
    }, ADMIN_SID);
  });

  test('首屏渲染：3 恢复卡片 + 3 已绑定发现项（效果证据四卡已迁首页），均未虚报连通', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    // 接入配置页签：3 张恢复卡片
    await atab(page, 3);
    await expect(page.locator('#cards > .card')).toHaveCount(3);
    // 批次23：效果证据四卡迁至首页关系图谱上方，接入页不再渲染
    await expect(page.locator('#gains')).toHaveCount(0);
    await expect(page.locator('#effectEvidence')).toHaveCount(0);
    // 持久化恢复的卡片未经真实拨测 → 如实显示「未配置」（不冒充已连通）
    await expect(page.locator('#cards > .card').nth(0)).toContainText('deepseek harness');
    await expect(page.locator('#cards > .card').nth(0)).toContainText('未配置');
    // 接入概览页签：3 条已绑定发现项 + 端形态徽章
    await atab(page, 0);
    await expect(page.locator('#found > .found')).toHaveCount(3);
    await expect(page.locator('#formBadge')).toContainText('当前端');
    expect(errors).toEqual([]);
  });

  test('一键接入：四段进度依次完成 + 浏览器模式如实失败并指向手动检测', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await page.click('#btnDiscover');
    await expect(page.locator('#stages .stage.done')).toHaveCount(4);
    // 浏览器无宿主扫描能力 → 明确失败（不再用内核模拟冒充「发现并绑定 0 个」）
    await expect(page.locator('#scanState')).toContainText('自动接入失败');
    await expect(page.locator('#scanState')).toContainText('非桌面壳环境');
    await expect(page.locator('[data-testid="onboard-failure"]')).toContainText('请使用桌面应用');
    await expect(page.locator('[data-testid="onboard-failure"]')).toContainText('手动检测');
    await expect(page.locator('[data-testid="manual-detect"]')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('自动接入失败');
    await expect(page.locator('#found > .found')).toHaveCount(3);
    await expect(page.locator('#btnDiscover')).toBeEnabled();
    // 预置的 3 张持久化卡片保持原样（失败不删除既有接入，也不伪造新发现）
    await atab(page, 3);
    await expect(page.locator('#cards > .card')).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test('R4 双通道至少一：全关 → 报错且禁用保存，恢复即可用', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await atab(page, 3);
    const card = page.locator('#cards > .card').nth(0);
    await card.locator('input[data-chan="webhook"]').uncheck();
    await card.locator('input[data-chan="api"]').uncheck();
    await expect(card.locator('[data-err]')).toBeVisible();
    await expect(card.locator('[data-err]')).toContainText('R4');
    await expect(card.locator('[data-act="save"]')).toBeDisabled();
    await card.locator('input[data-chan="webhook"]').check();
    await expect(card.locator('[data-err]')).toBeHidden();
    await expect(card.locator('[data-act="save"]')).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('R3 回归：Codex tools.pref 为布尔 false，勾选不抛异常', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await atab(page, 3);
    const codex = page.locator('#cards > .card').nth(2); // Codex（pref:false）
    await expect(codex).toContainText('codex');
    const pref = codex.locator('input[data-tool="pref"]');
    await expect(pref).not.toBeChecked(); // 布尔 false → 未勾选，且不崩溃
    await pref.check();
    await pref.uncheck();
    await codex.locator('input[data-tool="write"]').uncheck();
    await codex.locator('input[data-tool="write"]').check();
    expect(errors).toEqual([]);
  });

  test('操作联动：测试/轮换/保存 打到真实后端，失败原因如实回显', async ({ page }) => {
    const errors = collectErrors(page);
    const calls: string[] = [];
    const backendPort = backend!.port;
    page.on('request', (r) => { if (r.url().includes(`:${backendPort}`)) calls.push(`${r.method()} ${r.url()}`); });
    await page.goto(APP);
    await atab(page, 3);
    const card = page.locator('#cards > .card').nth(0);

    // 后端尚无该卡 → 真实拨测如实失败（no-card），UI 不得谎报连通
    await card.locator('[data-act="test"]').click();
    await expect(page.locator('#toast')).toContainText('测试未通过');
    await expect(page.locator('#toast')).toContainText('no-card');

    await card.locator('[data-act="rotate"]').click();
    await expect(page.locator('#toast')).toContainText('轮换失败');
    await expect(page.locator('#toast')).toContainText('no-card');

    await card.locator('[data-act="save"]').click();
    await expect(page.locator('#toast')).toContainText('已保存 deepseek harness 接入配置');

    // 真实后端确实被调用（best-effort 镜像）
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.includes('/test'))).toBeTruthy();
    expect(calls.some((c) => c.includes('/rotate-key'))).toBeTruthy();
    expect(calls.some((c) => c.includes('/agents'))).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('隔离开关：切换触发 toast（19.4）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await atab(page, 3);
    const card = page.locator('#cards > .card').nth(0);
    await card.locator('input[data-iso="projShare"]').uncheck();
    await expect(page.locator('#toast')).toContainText('已关闭：该项目记忆不再跨 Agent 共享');
    expect(errors).toEqual([]);
  });

  test('撤销自动绑定：发现项回到未绑定 + 卡片保持未配置 + toast', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    const first = page.locator('#found > .found').first();
    await expect(first).toContainText('deepseek harness');
    await first.locator('[data-unbind]').click();
    await expect(page.locator('#toast')).toContainText('已撤销');
    await expect(page.locator('#found > .found').first()).toContainText('未发现信号 · 需手填端点');
    await expect(page.locator('#found > .found').first()).toHaveClass(/unbound/);
    await atab(page, 3);
    await expect(page.locator('#cards > .card').nth(0)).toContainText('未配置');
    expect(errors).toEqual([]);
  });
});
