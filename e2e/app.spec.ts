// REQ-003 真浏览器点击级 E2E（对齐 design/ui/Agent接入页_原型.html）
// 覆盖：首屏渲染、一键接入四段动画、R3/R4 校验、测试/轮换/保存 联动真实后端、撤销绑定、隔离 toast。
// 关键回归：Codex tools.pref=false → 勾选不得抛 "Cannot create property 'on' on boolean"。
// 被测对象 = Vite 构建产物（dist/），即TS+React 真实页面。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';
import { createServer as createBackend, type RunningServer } from '../src/agentOnboard/server.ts';

const APP = '/agentonboard.html';

let staticSrv: StaticServer;
let backend: RunningServer;
test.beforeAll(async () => {
  staticSrv = await startStatic(8123, 'dist'); // 服务 Vite 构建产物
  backend = await createBackend({ port: 8200, dataFile: join(tmpdir(), `e2e-agent-onboard-${Date.now()}.json`) });
});
test.afterAll(async () => {
  backend.server.closeAllConnections?.(); // 断开浏览器 keep-alive，避免 stop() 卡住
  await backend.stop();
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('REQ-003 Agent 接入页 · 点击级 E2E', () => {
  // 登录门控（REQ-005）：AgentOnboardPage 未登录时显示 .auth-gate 拦截。
  // 这里预置 session 模拟"已登录"（登录流程由 home/register/crossTabAuth spec 覆盖）。
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('session:realpage', 'e2e-session-agentonboard');
    });
  });

  test('首屏渲染：3 宿主卡片 + 4 效果证据 + 4 发现项，无脚本异常', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('#cards > .card')).toHaveCount(3);
    await expect(page.locator('#gains > .gain')).toHaveCount(4);
    await expect(page.locator('#found > .found')).toHaveCount(4);
    // deepseek 首卡为已连通
    await expect(page.locator('#cards > .card').nth(0)).toContainText('已连通');
    await expect(page.locator('#formBadge')).toContainText('当前端');
    expect(errors).toEqual([]);
  });

  test('一键接入：四段进度依次完成 + 完成审计文案', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await page.click('#btnDiscover');
    await expect(page.locator('#stages .stage.done')).toHaveCount(4);
    await expect(page.locator('#scanState')).toContainText('完成');
    await expect(page.locator('#scanState')).toContainText('auto_bind');
    await expect(page.locator('#btnDiscover')).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('R4 双通道至少一：全关 → 报错且禁用保存，恢复即可用', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
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
    const codex = page.locator('#cards > .card').nth(2); // Codex（pref:false）
    await expect(codex).toContainText('Codex');
    await codex.locator('input[data-tool="pref"]').check();
    await codex.locator('input[data-tool="pref"]').uncheck();
    await codex.locator('input[data-tool="write"]').uncheck();
    await codex.locator('input[data-tool="write"]').check();
    expect(errors).toEqual([]);
  });

  test('操作联动：测试/轮换/保存 触发 toast，并打到真实后端 :8200', async ({ page }) => {
    const errors = collectErrors(page);
    const calls: string[] = [];
    page.on('request', (r) => { if (r.url().includes(':8200')) calls.push(`${r.method()} ${r.url()}`); });
    await page.goto(APP);
    const card = page.locator('#cards > .card').nth(0);

    await card.locator('[data-act="test"]').click();
    await expect(page.locator('#toast')).toContainText('测试成功');

    await card.locator('[data-act="rotate"]').click();
    await expect(page.locator('#toast')).toContainText('已轮换');
    await expect(card.locator('[data-mask]')).toContainText('新');

    await card.locator('[data-act="save"]').click();
    await expect(page.locator('#toast')).toContainText('已保存');

    // 真实后端确实被调用（best-effort 镜像）
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.includes('/test'))).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('隔离开关：切换触发 toast（19.4）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    const card = page.locator('#cards > .card').nth(0);
    await card.locator('input[data-iso="projShare"]').uncheck();
    await expect(page.locator('#toast')).toContainText('已关闭');
    expect(errors).toEqual([]);
  });

  test('撤销自动绑定：发现项 → 卡片回到未配置 + toast', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    const first = page.locator('#found > .found').first();
    await expect(first).toContainText('deepseek harness');
    await first.locator('[data-unbind]').click();
    await expect(page.locator('#toast')).toContainText('已撤销');
    await expect(page.locator('#cards > .card').nth(0)).toContainText('未配置');
    expect(errors).toEqual([]);
  });
});
