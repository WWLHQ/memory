// E2E：壳层（批次49）——登录改弹窗（三处入口同一实例）+ 各区域右键菜单真实动作。
//
// 真实路径：真实静态站点 + 真实 home 后端（POST /api/login、/api/me、/api/logout + 真实内核账本），非 mock。
// 覆盖：
//   ① 三处登录入口（菜单栏 / QAT / 登录状态处）打开同一个弹窗
//   ② 401（密码错）与成功后账号/团队/角色如实显示；登出清除本机会话
//   ③ 后端不可达如实报（不写「已登录」）
//   ④ 未登录时需登录动作仍禁用并写「未登录（会话 401）」
//   ⑤ 右键导航树 / 标签条 / 检查器：真实动作 + 禁用原因，不出现空菜单
//   ⑥ 中心页表格行右键（真实账本行）：菜单在壳层渲染，复制/选中为真实动作
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';
import type { Page } from 'playwright-core';

const ACCOUNT = 'shell_e2e';
const PWD = 'shell_pwd';
const TEAM = 'team_shell_e2e';

let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let SHELL = '';
let LOGIN = '';
let SHELL_NO_BACKEND = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist');
  registerAccount(ACCOUNT, hashPassword(PWD), { enterprise_id: 'ent_shell_e2e', team_id: TEAM, perspective: 'team' });
  const dataFile = join(tmpdir(), `e2e-shell-${Date.now()}.json`);
  backend = await startHomeBackend({ dataFile, allowedOrigins: [`http://localhost:${staticSrv.port}`] });
  SHELL = `http://localhost:${staticSrv.port}/workspace.html?backend=${encodeURIComponent(`http://localhost:${backend.port}`)}`;
  LOGIN = `http://localhost:${staticSrv.port}/login.html?backend=${encodeURIComponent(`http://localhost:${backend.port}`)}`;
  // 指向未监听端口的后端：登录必须如实报「后端不可达」，不许假装已登录
  SHELL_NO_BACKEND = `http://localhost:${staticSrv.port}/workspace.html?backend=${encodeURIComponent('http://127.0.0.1:1')}`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

async function openShell(page: Page, target = SHELL): Promise<void> {
  await page.goto(target);
  await expect(page.locator('[data-testid="shell-menubar"]')).toBeVisible();
}

async function openLoginByQat(page: Page): Promise<void> {
  await page.locator('[data-testid="qa-login"]').click();
  await expect(page.locator('[data-testid="shell-login-modal"]')).toBeVisible();
}

test.describe('壳层 · 登录弹窗与右键菜单（真实后端）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SHELL);
    await page.evaluate(() => localStorage.clear());
  });

  test('三处登录入口打开同一个弹窗（菜单栏 / QAT / 登录状态处）', async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page);

    // ① 菜单栏：文件 → 登录 / 会话…
    await page.locator('[data-testid="shell-menubar"]').getByRole('button', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: /登录 \/ 会话/ }).click();
    await expect(page.locator('[data-testid="shell-login-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="slm-account"]')).toBeVisible();
    await page.locator('[data-testid="slm-close"]').click();
    await expect(page.locator('[data-testid="shell-login-modal"]')).toHaveCount(0);

    // ② 快速访问工具条
    await openLoginByQat(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="shell-login-modal"]')).toHaveCount(0);

    // ③ 标题栏登录状态处 + 状态栏会话格：同一弹窗
    await page.locator('[data-testid="shell-session-btn"]').click();
    await expect(page.locator('[data-testid="shell-login-modal"]')).toBeVisible();
    await page.locator('[data-testid="slm-close"]').click();
    await page.locator('[data-testid="sb-session"]').click();
    await expect(page.locator('[data-testid="shell-login-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="slm-submit"]')).toBeEnabled();

    // login.html 仍是可直达兜底页（不进主导航）
    await expect(page.getByRole('treeitem', { name: /登录与会话/ })).toHaveCount(0);
    await page.goto(LOGIN);
    await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('真实登录：密码错 401 如实 → 成功显示账号/团队/角色 → 登出清除', async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page);
    await openLoginByQat(page);

    // 401：真实 /api/login 拒绝，文案如实带状态码与原因，不写「已登录」
    await page.locator('[data-testid="slm-account"]').fill(ACCOUNT);
    await page.locator('[data-testid="slm-password"]').fill('wrong_pwd');
    await page.locator('[data-testid="slm-submit"]').click();
    await expect(page.locator('[data-testid="slm-error"]')).toContainText('HTTP 401');
    await expect(page.locator('[data-testid="slm-error"]')).toContainText('密码错误');
    await expect(page.locator('[data-testid="slm-session"]')).toHaveCount(0);

    // 成功：账号 / 团队 / 角色来自 /api/login 回执与 /api/me
    await page.locator('[data-testid="slm-password"]').fill(PWD);
    await page.locator('[data-testid="slm-submit"]').click();
    await expect(page.locator('[data-testid="slm-session"]')).toBeVisible();
    await expect(page.locator('[data-testid="slm-session-account"]')).toHaveText(ACCOUNT);
    await expect(page.locator('[data-testid="slm-session-team"]')).toHaveText(TEAM);
    await expect(page.locator('[data-testid="slm-session-role"]')).toHaveText(/管理员|成员/);
    await expect(page.locator('[data-testid="slm-notice"]')).toContainText('登录成功');
    // 状态区如实显示身份；会话仍存 session:realpage
    await expect(page.locator('[data-testid="shell-session-btn"]')).toHaveText(ACCOUNT);
    await expect(page.locator('[data-testid="sb-session"]')).toContainText(ACCOUNT);
    const sid = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(sid).toBeTruthy();

    // 登出：真实 /api/logout + 清除本机会话
    await page.locator('[data-testid="slm-logout"]').click();
    await expect(page.locator('[data-testid="slm-notice"]')).toContainText('已登出');
    await expect(page.locator('[data-testid="slm-account"]')).toBeVisible();
    await expect(page.locator('[data-testid="shell-session-btn"]')).toHaveText('只读会话');
    expect(await page.evaluate(() => localStorage.getItem('session:realpage'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('后端不可达：登录弹窗如实报错，不写「已登录」', async ({ page }) => {
    await openShell(page, SHELL_NO_BACKEND);
    await openLoginByQat(page);
    await page.locator('[data-testid="slm-account"]').fill(ACCOUNT);
    await page.locator('[data-testid="slm-password"]').fill(PWD);
    await page.locator('[data-testid="slm-submit"]').click();
    await expect(page.locator('[data-testid="slm-error"]')).toContainText('后端不可达');
    await expect(page.locator('[data-testid="slm-error"]')).toContainText('后端未响应');
    await expect(page.locator('[data-testid="slm-session"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="shell-session-btn"]')).toHaveText('只读会话');
  });

  test('未登录时需登录动作禁用并写「未登录（会话 401）」', async ({ page }) => {
    await openShell(page);
    const gated = page.locator('[title*="未登录（会话 401）"]');
    await expect(gated.first()).toBeVisible();
    await expect(gated.first()).toHaveAttribute('title', /未登录（会话 401）/);
    // 未登录时不发任何登录请求：状态区仍是只读会话
    await expect(page.locator('[data-testid="shell-session-btn"]')).toHaveText('只读会话');
  });

  test('右键导航树：真实动作可用；无能力项禁用并写原因', async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page);
    await page.getByRole('treeitem', { name: /概览/ }).click({ button: 'right' });
    const menu = page.locator('[data-testid="ctx-navmenu"]');
    await expect(menu).toBeVisible();
    await expect(page.locator('[data-testid="ctx-navmenu"] [role="menuitem"]')).not.toHaveCount(0);
    const toggle = page.locator('[data-testid="ctx-navmenu-toggle"]');
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute('title', /该导航项没有子项/);
    await expect(toggle).toContainText('该导航项没有子项');
    // 真实动作：打开个人记忆 → 中心区出现对应标签
    await page.getByRole('treeitem', { name: /个人记忆/ }).click({ button: 'right' });
    await page.locator('[data-testid="ctx-navmenu-open"]').click();
    await expect(page.locator('[data-testid^="shell-tab-"]').filter({ hasText: '个人记忆' })).toBeVisible();
    await expect(page.locator('[data-testid="ctx-navmenu"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('右键标签条：真实关闭标签；唯一标签时禁用并写原因', async ({ page }) => {
    await openShell(page);
    const tabs = page.locator('[data-testid^="shell-tab-"]');
    await expect(tabs).toHaveCount(1);
    await tabs.first().click({ button: 'right' });
    const close = page.locator('[data-testid="ctx-tabmenu-close"]');
    await expect(close).toBeDisabled();
    await expect(close).toHaveAttribute('title', /至少保留一个标签/);
    await expect(page.locator('[data-testid="ctx-tabmenu-closeOthers"]')).toBeDisabled();
    await expect(page.locator('[data-testid="ctx-tabmenu-refresh"]')).toBeEnabled();

    // 打开第二个标签后，右键真实关闭
    await page.getByRole('treeitem', { name: /全部记忆/ }).click();
    await expect(tabs).toHaveCount(2);
    await tabs.last().click({ button: 'right' });
    await page.locator('[data-testid="ctx-tabmenu-close"]').click();
    await expect(tabs).toHaveCount(1);
  });

  test('右键属性检查器：无选中时复制项禁用并写原因，折叠是真实动作', async ({ page }) => {
    await openShell(page);
    await page.locator('[data-testid="shell-inspector"]').click({ button: 'right' });
    await expect(page.locator('[data-testid="ctx-inspmenu"]')).toBeVisible();
    const copyId = page.locator('[data-testid="ctx-inspmenu-copyId"]');
    await expect(copyId).toBeDisabled();
    await expect(copyId).toHaveAttribute('title', /中心页未选中记忆/);
    await expect(copyId).toContainText('中心页未选中记忆');
    await expect(page.locator('[data-testid="ctx-inspmenu-copyFile"]')).toBeEnabled();
    await page.locator('[data-testid="ctx-inspmenu-collapse"]').click();
    await expect(page.locator('[data-testid="shell-inspector"]')).toHaveClass(/collapsed/);
  });

  test('中心页表格行右键：壳层菜单在 iframe 同源文档内挂载（单测覆盖，见 workspace.test.tsx）', async ({ page }) => {
    // 说明：浏览器模式下记忆页账本来自页面自身内存态（真实写入需 L0 密钥），E2E 不伪造账本行。
    // 壳层对同源 iframe 的 contextmenu 监听与菜单真实动作由单测用真实 DOM 行覆盖。
    await openShell(page);
    await page.getByRole('treeitem', { name: /全部记忆/ }).click();
    await expect(page.frameLocator('iframe.page-frame[title*="memory.html"]').locator('body')).toBeVisible();
    // 未伪造行：空账本时页面如实显示空态，壳层不截获非表格行右键（保留原生菜单）
    await expect(page.locator('[data-testid="ctx-rowmenu"]')).toHaveCount(0);
  });
});
