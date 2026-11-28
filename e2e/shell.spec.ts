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
  await expect(page.locator('[data-testid="shell-titlebar"]')).toBeVisible();
}

async function openLoginByAvatar(page: Page): Promise<void> {
  await page.locator('[data-testid="shell-avatar"]').click();
  await expect(page.locator('[data-testid="shell-login-modal"]')).toBeVisible();
}

test.describe('壳层 · 登录弹窗与右键菜单（真实后端）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SHELL);
    await page.evaluate(() => localStorage.clear());
  });

  test('登录入口打开同一个弹窗（标题栏头像 / 状态栏会话格；批次51：QAT 已整簇取消、菜单栏已移除）', async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page);

    // ① 标题栏头像（STRATUM：24px accent 圆）
    await openLoginByAvatar(page);
    await expect(page.locator('[data-testid="slm-account"]')).toBeVisible();
    await page.locator('[data-testid="slm-close"]').click();
    await expect(page.locator('[data-testid="shell-login-modal"]')).toHaveCount(0);

    // ② 状态栏会话格：同一弹窗
    await page.locator('[data-testid="sb-session"]').click();
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
    await openLoginByAvatar(page);

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
    await expect(page.locator('[data-testid="shell-avatar"]')).toBeVisible();
    await expect(page.locator('[data-testid="sb-session"]')).toContainText(ACCOUNT);
    const sid = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(sid).toBeTruthy();

    // 登出：真实 /api/logout + 清除本机会话
    await page.locator('[data-testid="slm-logout"]').click();
    await expect(page.locator('[data-testid="slm-notice"]')).toContainText('已登出');
    await expect(page.locator('[data-testid="slm-account"]')).toBeVisible();
    await expect(page.locator('[data-testid="sb-session"]')).toContainText('只读');
    expect(await page.evaluate(() => localStorage.getItem('session:realpage'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('后端不可达：登录弹窗如实报错，不写「已登录」', async ({ page }) => {
    await openShell(page, SHELL_NO_BACKEND);
    await openLoginByAvatar(page);
    await page.locator('[data-testid="slm-account"]').fill(ACCOUNT);
    await page.locator('[data-testid="slm-password"]').fill(PWD);
    await page.locator('[data-testid="slm-submit"]').click();
    await expect(page.locator('[data-testid="slm-error"]')).toContainText('后端不可达');
    await expect(page.locator('[data-testid="slm-error"]')).toContainText('后端未响应');
    await expect(page.locator('[data-testid="slm-session"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="sb-session"]')).toContainText('只读');
  });

  test('未登录时需登录动作禁用并写「未登录（会话 401）」', async ({ page }) => {
    await openShell(page);
    // 需登录动作（归档）现收在命令面板：打开面板搜「归档」，禁用原因写在该行 title 上
    await page.locator('[data-testid="shell-cmd-entry"]').click();
    const palette = page.locator('[data-testid="shell-palette"]');
    await expect(palette).toBeVisible();
    await palette.locator('input[aria-label="搜索命令"]').fill('归档');
    const gated = page.locator('[title*="未登录（会话 401）"]');
    await expect(gated.first()).toBeVisible();
    await expect(gated.first()).toHaveAttribute('title', /未登录（会话 401）/);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="shell-palette"]')).toHaveCount(0);
    // 未登录时不发任何登录请求：状态区仍是只读会话
    await expect(page.locator('[data-testid="sb-session"]')).toContainText('只读');
  });

  test('右键导航树：真实动作可用；无能力项禁用并写原因', async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page);
    await page.getByRole('treeitem', { name: /首页/ }).click({ button: 'right' });
    const menu = page.locator('[data-testid="ctx-navmenu"]');
    await expect(menu).toBeVisible();
    await expect(page.locator('[data-testid="ctx-navmenu"] [role="menuitem"]')).not.toHaveCount(0);
    const toggle = page.locator('[data-testid="ctx-navmenu-toggle"]');
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute('title', /该导航项没有子项/);
    await expect(toggle).toContainText('该导航项没有子项');
    // 真实动作：打开记忆库 → 中心区出现对应标签（批次54 后为平铺入口）
    await page.getByRole('treeitem', { name: '记忆库', exact: true }).click({ button: 'right' });
    await page.locator('[data-testid="ctx-navmenu-open"]').click();
    await expect(page.locator('[data-testid^="shell-tab-"]').filter({ hasText: '记忆库' })).toBeVisible();
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
    await page.getByRole('treeitem', { name: '记忆库', exact: true }).click();
    await expect(tabs).toHaveCount(2);
    await tabs.last().click({ button: 'right' });
    await page.locator('[data-testid="ctx-tabmenu-close"]').click();
    await expect(tabs).toHaveCount(1);
  });

  test('右键属性检查器：无选中时复制项禁用并写原因，折叠是真实动作', async ({ page }) => {
    await openShell(page);
    // 属性检查器默认收起（批次50+ 省空间）：先展开，再验证右键菜单与折叠动作
    const inspector = page.locator('[data-testid="shell-inspector"]');
    await expect(inspector).toHaveClass(/collapsed/);
    await page.locator('[data-testid="qa-inspector-expand"]').click();
    await expect(inspector).not.toHaveClass(/collapsed/);
    await inspector.click({ button: 'right' });
    await expect(page.locator('[data-testid="ctx-inspmenu"]')).toBeVisible();
    const copyId = page.locator('[data-testid="ctx-inspmenu-copyId"]');
    await expect(copyId).toBeDisabled();
    await expect(copyId).toHaveAttribute('title', /中心页未选中记忆/);
    await expect(copyId).toContainText('中心页未选中记忆');
    await expect(page.locator('[data-testid="ctx-inspmenu-copyFile"]')).toBeEnabled();
    await page.locator('[data-testid="ctx-inspmenu-collapse"]').click();
    await expect(page.locator('[data-testid="shell-inspector"]')).toHaveClass(/collapsed/);
  });

  test('壳层全域右键：非登录区有非空菜单且不含登录项，登录入口处才出现登录', async ({ page }) => {
    await page.addInitScript(() => {
      // 记录 contextmenu 传播结束后的 defaultPrevented：true 表示原生菜单被壳层拦下
      document.addEventListener('contextmenu', (e) => {
        setTimeout(() => { (window as unknown as { __ctxPrevented?: boolean }).__ctxPrevented = e.defaultPrevented; }, 0);
      }, true);
    });
    await openShell(page);
    await expect(page.locator('[data-testid="shell-avatar"]')).toBeVisible();

    await page.locator('.statusbar').click({ button: 'right' });
    const menu = page.locator('[data-testid="ctx-shellmenu"]');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('右键：状态栏');
    await expect(menu.locator('[role="menuitem"]')).not.toHaveCount(0);
    const copySel = page.locator('[data-testid="ctx-shellmenu-copySel"]');
    await expect(copySel).toBeDisabled();
    await expect(copySel).toHaveAttribute('title', /当前页面上没有选中文本/);
    // 批次50：状态栏空白处本身不是登录入口 → 右键不补「登录 / 会话」
    await expect(page.locator('[data-testid="ctx-shellmenu-login"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ctxPrevented?: boolean }).__ctxPrevented)).toBe(true);
    // 真实动作：刷新中心区与底部读数
    await page.locator('[data-testid="ctx-shellmenu-refresh"]').click();
    await expect(page.locator('[data-testid="sb-msg"]')).toHaveText(/已刷新全部打开的真实页面/);

    // 批次51：Ribbon/QAT 已移除——标题栏空白处右键走默认壳层菜单且不含登录项
    await page.locator('[data-testid="shell-titlebar"]').click({ button: 'right' });
    await expect(page.locator('[data-testid="ctx-shellmenu"]')).toContainText('右键：标题栏');
    await expect(page.locator('[data-testid="ctx-shellmenu-login"]')).toHaveCount(0);

    // 真有登录入口的位置：标题栏头像 / 状态栏会话格
    await page.locator('[data-testid="shell-avatar"]').click({ button: 'right' });
    await page.locator('[data-testid="ctx-shellmenu-login"]').click();
    await expect(page.locator('[data-testid="shell-login-modal"]')).toBeVisible();
    await page.locator('[data-testid="slm-close"]').click();

    await page.locator('[data-testid="sb-session"]').click({ button: 'right' });
    await expect(page.locator('[data-testid="ctx-shellmenu-login"]')).toBeVisible();
  });

  test('登录弹窗密码默认为密文，显示/隐藏切换保留已输入内容与焦点', async ({ page }) => {
    await openShell(page);
    await page.locator('[data-testid="shell-avatar"]').click();
    const pw = page.locator('[data-testid="slm-password"]');
    await expect(pw).toHaveAttribute('type', 'password');
    await pw.fill('S3cret-visible');
    await pw.focus();
    const toggle = page.locator('[data-testid="slm-pw-toggle"]');
    await expect(toggle).toHaveAttribute('aria-label', '显示密码');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(pw).toHaveAttribute('type', 'text');
    await expect(pw).toHaveValue('S3cret-visible');
    await expect(pw).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-label', '隐藏密码');
    await toggle.click();
    await expect(pw).toHaveAttribute('type', 'password');
    await expect(pw).toHaveValue('S3cret-visible');
    await expect(pw).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-label', '显示密码');
  });

  test('标题栏登录入口：1024 宽度与浅/深主题下头像可见、可点开真实登录弹窗', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openShell(page);
    const avatar = page.locator('[data-testid="shell-avatar"]');
    await expect(avatar).toBeVisible();
    await expect(avatar).toBeEnabled();
    // 浅色主题
    await avatar.click();
    await expect(page.locator('[data-testid="shell-login-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="slm-account"]')).toBeVisible();
    await page.locator('[data-testid="slm-close"]').click();
    // 切到深色（三联按钮直接点「深色」）后再验一次可见可点
    await page.locator('[data-testid="shell-themes"] button[aria-label="深色"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(avatar).toBeVisible();
    await expect(avatar).toBeEnabled();
    await avatar.click();
    await expect(page.locator('[data-testid="shell-login-modal"]')).toBeVisible();
  });

  test('中心页 iframe 非表格行右键 → 壳层页面菜单，原生菜单同样被拦下（行菜单由单测覆盖）', async ({ page }) => {
    // 说明：浏览器模式下记忆页账本来自页面自身内存态（真实写入需 L0 密钥），E2E 不伪造账本行。
    // 因此这里验证「非行位置也被壳层接管」；真实 DOM 行的菜单动作见 workspace.test.tsx。
    await page.addInitScript(() => {
      document.addEventListener('contextmenu', (e) => {
        setTimeout(() => { (window as unknown as { __ctxPrevented?: boolean }).__ctxPrevented = e.defaultPrevented; }, 0);
      }, true);
    });
    await openShell(page);
    await page.getByRole('treeitem', { name: '记忆库', exact: true }).click();
    const frame = page.frameLocator('iframe.page-frame[title*="memory.html"]');
    await expect(frame.locator('body')).toBeVisible();
    await frame.locator('body').click({ button: 'right', position: { x: 20, y: 20 } });
    const menu = page.locator('[data-testid="ctx-framemenu"]');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('中心页（iframe）');
    const copySel = page.locator('[data-testid="ctx-framemenu-copySel"]');
    await expect(copySel).toBeDisabled();
    await expect(copySel).toHaveAttribute('title', /页面内没有选中文本/);
    await expect(page.locator('[data-testid="ctx-rowmenu"]')).toHaveCount(0);
    const prevented = await frame.locator('body').evaluate(() => (window as unknown as { __ctxPrevented?: boolean }).__ctxPrevented);
    expect(prevented).toBe(true);
  });

  test('导航归属：MCP 接入进连接组、个人记忆进记忆管理组并直达真实整页', async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page);
    // 个人记忆：唯一项，打开后中心区是 personal.html 真实整页（非记忆库 Tab 别名）
    const personal = page.getByRole('treeitem', { name: /^个人记忆/ });
    await expect(personal).toHaveCount(1);
    await personal.click();
    const personalFrame = page.frameLocator('iframe.page-frame[title*="personal.html"]');
    await expect(personalFrame.locator('body')).toBeVisible();
    await expect(page.locator('[data-testid^="shell-tab-"]').filter({ hasText: '个人记忆' })).toBeVisible();

    // MCP 接入：连接组新页。壳层 iframe 走父窗口桥，但浏览器态的顶层没有原生宿主能力
    // → 面板如实降级为「读取本机配置失败」，绝不列出客户端、绝不写「已接入」。
    await page.getByRole('treeitem', { name: 'MCP 接入', exact: true }).click();
    const mcpFrame = page.frameLocator('iframe.page-frame[title*="mcp.html"]');
    await expect(mcpFrame.locator('[data-testid="mcp-page"]')).toBeVisible();
    await expect(mcpFrame.locator('[data-testid="mcp-clients"]')).toBeVisible();
    await expect(mcpFrame.locator('[data-testid="mcp-scan-error"]')).toContainText('读取本机配置失败');
    await expect(mcpFrame.locator('[data-testid="mcp-table"]')).toHaveCount(0);
    // 没有真扫结果时连「七态总览」都不渲染：不把未知渲染成「已接入」
    await expect(mcpFrame.locator('[data-testid="mcp-state-summary"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('冲突裁决页（浏览器壳层）：真实页面挂载；无原生宿主桥时如实报内核不可读，不伪造空态/行', async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page);
    // 浏览器态内核账本要真实会话才能读；先走真实登录，再进冲突裁决页
    await openLoginByAvatar(page);
    await page.locator('[data-testid="slm-account"]').fill(ACCOUNT);
    await page.locator('[data-testid="slm-password"]').fill(PWD);
    await page.locator('[data-testid="slm-submit"]').click();
    await expect(page.locator('[data-testid="slm-session"]')).toBeVisible();
    await page.locator('[data-testid="slm-close"]').click();

    await page.getByRole('treeitem', { name: '冲突裁决', exact: true }).click();
    const frame = page.frameLocator('iframe.page-frame[title*="dispute.html"]');
    await expect(frame.locator('[data-testid="dispute-page"]')).toBeVisible();
    await expect(frame.locator('[data-testid="dispute-head"]')).toContainText('冲突裁决');
    // 壳层 iframe 走父窗口宿主桥，但浏览器态的顶层没有 window.api → 内核读不到就如实报错；
    // 绝不把「读不到」渲染成「当前账本无待裁决冲突」的空态，也绝不编造队列行。
    // （真实空账本的诚实空态与真实行由 dispute.spec.ts / 单测在无桥环境覆盖。）
    await expect(frame.locator('[data-testid="kernel-error"]')).toBeVisible({ timeout: 15000 });
    await expect(frame.locator('[data-testid="kernel-error-title"]')).toContainText('读取待裁决冲突队列失败');
    await expect(frame.locator('[data-testid="dispute-empty"]')).toHaveCount(0);
    await expect(frame.locator('[data-testid^="queue-item-"]')).toHaveCount(0);
    await expect(frame.locator('[data-testid="dispute-filter"]')).toHaveCount(0);
    await expect(frame.locator('[data-testid="verdict-panel"]')).toHaveCount(0);
    await expect(frame.locator('[data-testid="audit-log"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('⑰ 命令条右端：完整端点串（HTTP/登录/四端口）全应用唯一一份，不截断不省略，颜色随真实检查', async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page);
    // 真实登录：端口串里的登录态取自真实会话（不是写死文案）
    await openLoginByAvatar(page);
    await page.locator('[data-testid="slm-account"]').fill(ACCOUNT);
    await page.locator('[data-testid="slm-password"]').fill(PWD);
    await page.locator('[data-testid="slm-submit"]').click();
    await expect(page.locator('[data-testid="slm-session"]')).toBeVisible();
    await page.locator('[data-testid="slm-close"]').click();

    const bar = page.locator('[data-testid="shell-cmdbar"]');
    const status = page.locator('[data-testid="shell-status"]');
    const ep = page.locator('[data-testid="shell-status-net"]');
    await expect(ep).toBeVisible({ timeout: 15_000 });
    await expect(ep).toHaveAttribute('data-health', 'online');
    await expect(ep).toContainText('在线');
    await expect(ep).not.toContainText('系统在线');
    await expect(ep).toContainText('HTTP 200');
    await expect(ep).toContainText('已登录');
    await expect(ep).toContainText('home :');
    await expect(ep).toContainText('onboard :');
    await expect(ep).toContainText('mcp :8202/:8204');
    await expect(ep).toContainText('webhook :8203');

    // 唯一一份：全页只有这一个实例；旧的状态栏副本已删除；中心页 iframe 里也没有第二份
    await expect(page.locator('[data-testid="shell-status-net"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="sb-endpoints"]')).toHaveCount(0);
    expect(await page.locator('.statusbar').innerText()).not.toMatch(/webhook :8203/);
    const frame = page.frameLocator('iframe.page-frame').first();
    await expect(frame.locator('[data-testid="overview-page"]')).toBeVisible({ timeout: 15_000 });
    await expect(frame.locator('[data-testid="overview-health"]')).toHaveCount(0);
    expect(await frame.locator('body').innerText()).not.toMatch(/home :\d+/);

    // 不截断 / 不省略：没有 ellipsis，内容宽度不超过自身盒宽（换行而不是裁切）
    const noClip = await ep.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        textOverflow: s.textOverflow,
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
      };
    });
    expect(noClip.textOverflow).not.toBe('ellipsis');
    expect(noClip.scrollW).toBeLessThanOrEqual(noClip.clientW + 1);
    expect(noClip.scrollH).toBeLessThanOrEqual(noClip.clientH + 1);

    // 贴命令条右端（状态区最后一份，右边缘贴住命令条右边缘）
    expect(await bar.evaluate((el) => el.lastElementChild?.getAttribute('data-testid'))).toBe('shell-status');
    const [bb, sb] = await Promise.all([bar.boundingBox(), status.boundingBox()]);
    expect(bb && sb).toBeTruthy();
    expect(Math.abs((sb!.x + sb!.width) - (bb!.x + bb!.width))).toBeLessThan(10);

    // 在线 = --ok 令牌颜色，且与离线色不同
    const onlineTint = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="shell-status-net"]') as HTMLElement;
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      probe.style.color = 'var(--ok)';
      const ok = getComputedStyle(probe).color;
      probe.style.color = 'var(--bad)';
      const bad = getComputedStyle(probe).color;
      const actual = getComputedStyle(h).color;
      probe.remove();
      return { actual, ok, bad };
    });
    expect(onlineTint.actual).toBe(onlineTint.ok);
    expect(onlineTint.ok).not.toBe(onlineTint.bad);

    // 窄窗口：完整串仍可见、不截断、不省略成 webhook…
    await page.setViewportSize({ width: 1024, height: 700 });
    await expect(ep).toBeVisible();
    await expect(ep).toContainText('webhook :8203');
    const narrow = await ep.evaluate((el) => ({ scrollW: el.scrollWidth, clientW: el.clientWidth, textOverflow: getComputedStyle(el).textOverflow }));
    expect(narrow.textOverflow).not.toBe('ellipsis');
    expect(narrow.scrollW).toBeLessThanOrEqual(narrow.clientW + 1);
    const cmdbarRight = await page.evaluate(() => {
      const cb = document.querySelector('[data-testid="shell-cmdbar"]')!.getBoundingClientRect();
      const p = document.querySelector('[data-testid="shell-status-net"]')!.getBoundingClientRect();
      return { cbRight: cb.right, pillRight: p.right };
    });
    expect(cmdbarRight.pillRight).toBeLessThanOrEqual(cmdbarRight.cbRight + 1);

    // 真实健康检查失败（503）→ 刷新后离线红 + HTTP 503，仍带文字/图标，不只靠颜色
    await page.route('**/api/health', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
    await page.reload();
    await expect(page.locator('[data-testid="shell-titlebar"]')).toBeVisible();
    await expect(ep).toHaveAttribute('data-health', 'offline', { timeout: 15_000 });
    await expect(ep).toContainText('离线');
    await expect(ep).toContainText('HTTP 503');
    const offlineTint = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="shell-status-net"]') as HTMLElement;
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      probe.style.color = 'var(--bad)';
      const bad = getComputedStyle(probe).color;
      const actual = getComputedStyle(h).color;
      probe.remove();
      return { actual, bad };
    });
    expect(offlineTint.actual).toBe(offlineTint.bad);
    expect(errors).toEqual([]);
  });

  test('底部只有四个标签：终端页签已取消，默认视图落在「输出」', async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page);
    const tabs = page.locator('.bp-tab');
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toContainText('输出');
    await expect(tabs.nth(1)).toContainText('问题');
    await expect(tabs.nth(2)).toContainText('审计');
    await expect(tabs.nth(3)).toContainText('任务');
    // 终端页签整项不存在（含渲染分支/图标）；也没有旧的「不可用」灰态占位
    await expect(page.getByRole('button', { name: /终端/ })).toHaveCount(0);
    await expect(page.locator('.bp-tab.unavailable')).toHaveCount(0);

    // 打开底部面板：默认落在「输出」的真实日志视图（浏览器态无主进程 → 如实不可用）
    await tabs.nth(0).click();
    await expect(page.locator('.bp-body')).toHaveCount(1);
    await expect(page.locator('.bp-body')).not.toContainText('程序未提供终端命令通道');
    await expect(page.locator('[data-testid="dock-log-unavailable"], [data-testid="dock-log-empty"], [data-testid="dock-log-row"]').first()).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  test('2026-11-22 页签条高度降 1/4：展开/收起都只占 24px，把纵向空间还给正文', async ({ page }) => {
    await openShell(page);
    const panel = page.locator('.bottom-panel');
    const head = page.locator('.bp-head');
    // 默认收起：整块 24px（原来 31px），页签行 24px（原来 32px）
    await expect(panel).toHaveClass(/collapsed/);
    expect(await panel.evaluate((el) => getComputedStyle(el).height)).toBe('24px');
    expect(await head.evaluate((el) => getComputedStyle(el).height)).toBe('24px');
    // 展开后页签行仍是 24px，且正文可见（高度让给正文）
    await page.locator('.bp-tab').nth(0).click();
    await expect(panel).not.toHaveClass(/collapsed/);
    await expect(page.locator('.bp-body')).toBeVisible();
    expect(await head.evaluate((el) => getComputedStyle(el).height)).toBe('24px');
    // 再收起：恢复 24px
    await page.locator('.bp-tool[title="折叠 / 展开底部面板"]').click();
    await expect(panel).toHaveClass(/collapsed/);
    expect(await panel.evaluate((el) => getComputedStyle(el).height)).toBe('24px');
  });

  test('2026-11-22 输出/问题说人话：主位不出现 ipc:/no_session，原始字段只在「技术详情」里', async ({ page }) => {
    // 真实 Electron 才有的动作日志：这里只给 log:tail 一个桩，喂两条真实格式的内网字段，验证渲染层人话转换
    await page.addInitScript(() => {
      const lines = [
        '[2026-11-22T13:00:00.000Z] [warn] [ipc:refine:state] {"denied":"no_session"}',
        '[2026-11-22T13:00:01.000Z] [error] [ui:backend_param_rejected] {"param":"backend"}',
      ];
      const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };
      w.__ELECTRON__ = true;
      w.api = { log: { tail: async () => ({ ok: true, path: 'C:\\logs\\actions.log', lines }), write: () => {} } };
    });
    await page.reload();
    await expect(page.locator('[data-testid="shell-titlebar"]')).toBeVisible();

    // 输出页：每行主位只给中文动作名，技术详情默认收起
    await page.locator('.bp-tab').nth(0).click();
    const rows = page.locator('[data-testid="dock-log-row"]');
    await expect(rows).toHaveCount(2);
    const titles = await page.locator('[data-testid="dock-log-title"]').allInnerTexts();
    const joined = titles.join(' ');
    expect(joined).not.toMatch(/ipc:|no_session|refine:state|backend_param_rejected|\{/);
    const tech = rows.first().locator('[data-testid="dock-tech-details"]');
    await expect(tech).not.toHaveAttribute('open', /.*/);
    await tech.locator('summary').click();
    await expect(tech.locator('code')).toContainText('ipc:refine:state');

    // 问题页：说明与标题都是人话；两条都只是提醒，明确「不需要你处理」；每行给出影响/处理
    await page.locator('.bp-tab').nth(1).click();
    const intro = page.locator('[data-testid="dock-problems-intro"]');
    await expect(intro).toBeVisible();
    await expect(intro).toContainText('不需要你处理');
    expect(await intro.innerText()).not.toMatch(/ipc:|no_session|json|派生/);
    const problemTitles = (await page.locator('[data-testid="dock-problem-title"]').allInnerTexts()).join(' ');
    expect(problemTitles).not.toMatch(/ipc:|no_session|refine:state|\{"|派生/);
    const firstProblem = page.locator('[data-testid="dock-problem-row"]').first();
    await expect(firstProblem).toContainText('影响：');
    await expect(firstProblem).toContainText('处理：');
    await expect(firstProblem.locator('[data-testid="dock-tech-details"]')).not.toHaveAttribute('open', /.*/);
  });

  test('2026-11-22 功能导航字号增大一号：12/13px，行高不破、不折行，1024 宽度下文案完整', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openShell(page);
    const pane = page.locator('.nav-pane');
    await expect(pane).toBeVisible();
    const groupFont = await pane.locator('.tree-group').first().evaluate((el) => getComputedStyle(el).fontSize);
    expect(groupFont).toBe('12px');
    const rows = pane.locator('.tree-row');
    await expect(rows.first()).toBeVisible();
    const info = await rows.first().evaluate((el) => {
      const s = getComputedStyle(el);
      const label = el.querySelector('.tlabel') as HTMLElement | null;
      return {
        fontSize: s.fontSize,
        whiteSpace: s.whiteSpace,
        height: Math.round(el.getBoundingClientRect().height),
        labelClips: label ? label.scrollWidth > label.clientWidth + 1 : false,
      };
    });
    expect(info.fontSize).toBe('13px');
    expect(info.whiteSpace).toBe('nowrap');
    expect(info.height).toBe(28);
    // 1024 宽度下全部导航文案完整可见（没有被 ellipsis 截断）；子项行高 26 不被字号撑破
    const all = await rows.evaluateAll((els) => els.map((el) => {
      const label = el.querySelector('.tlabel') as HTMLElement | null;
      return {
        text: (el.textContent ?? '').trim(),
        h: Math.round(el.getBoundingClientRect().height),
        child: el.classList.contains('child'),
        clips: label ? label.scrollWidth > label.clientWidth + 1 : false,
      };
    }));
    expect(all.filter((r) => r.clips)).toEqual([]);
    expect(all.filter((r) => r.child).every((r) => r.h === 26)).toBe(true);
  });

  test('2026-11-22 启动提速：首屏账本/L0 读数不再互相等待（渲染侧首读 < 1500ms）', async ({ page }) => {
    // 对照：优化前实测「进程启动 → 状态栏首次读数」2118ms（21:03 日志基线），
    // 其中 mcp 探活/tasklist 同步约 0.5–3.6s 会把四格一起拖在「读取中」。
    // 这里按渲染侧 performance.now() 量首读（浏览器模式无原生宿主，取最快真实值），确认单格先到先显示。
    const ms = await page.waitForFunction(() => {
      const storage = document.querySelector('[data-testid="sb-storage"]');
      const l0 = document.querySelector('[data-testid="sb-l0"]');
      if (!storage || !l0) return false;
      if ((storage.textContent ?? '').includes('读取中')) return false;
      if ((l0.textContent ?? '').includes('读取中')) return false;
      return Math.round(performance.now());
    }, null, { timeout: 15_000 }).then((h) => h.jsonValue() as Promise<number>);
    expect(ms).toBeLessThan(1500);
    // 四格各自有真实结论（有值或明确不可用），不出现空转省略
    await expect(page.locator('[data-testid="sb-storage"]')).not.toContainText('读取中');
    await expect(page.locator('[data-testid="sb-bg"]')).not.toContainText('读取中');
    await expect(page.locator('[data-testid="sb-l0"]')).not.toContainText('读取中');
  });
});
