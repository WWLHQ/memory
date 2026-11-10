// E2E：记忆助手整页（2026-11-10：原壳层悬浮窗 → 独立整页 assistant.html）
//   ① 导航「记忆助手」打开整页（assistant.html），不再是覆盖在中心区之上的浮层面板；
//   ② 整页自行读取真实账本快照并回答；读不到就如实说「没读到」，不拿 0 冒充；
//   ③ 页面内「重读」只重取本页数据（不重挂页面、不丢会话）；
//   ④ 功能导航折叠后保留窄图标栏：只显示图标、名称走 title、点击仍能打开对应页面。
//
// 真实路径：真实静态站点 + 真实 home 后端，非 mock。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';

const ACCOUNT = 'assistant_e2e';
const PWD = 'assistant_pwd';

let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let SHELL = '';
let ASSISTANT = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist');
  registerAccount(ACCOUNT, hashPassword(PWD), { enterprise_id: 'ent_assistant_e2e', team_id: 'team_assistant_e2e', perspective: 'team' });
  const dataFile = join(tmpdir(), `e2e-assistant-${Date.now()}.json`);
  backend = await startHomeBackend({ dataFile, allowedOrigins: [`http://localhost:${staticSrv.port}`] });
  const q = `backend=${encodeURIComponent(`http://localhost:${backend.port}`)}`;
  SHELL = `http://localhost:${staticSrv.port}/workspace.html?${q}`;
  ASSISTANT = `http://localhost:${staticSrv.port}/assistant.html?${q}`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('记忆助手整页 + 功能导航折叠图标栏', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SHELL);
    await page.evaluate(() => localStorage.clear());
  });

  test('导航「记忆助手」打开独立整页 assistant.html，不再是壳层浮层面板', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(SHELL);

    // 壳层不再渲染记忆助手浮层面板
    await expect(page.getByTestId('memory-assistant')).toHaveCount(0);

    // 点击导航 → 中心区打开整页
    await page.getByRole('treeitem', { name: /记忆助手/ }).click();
    await expect(page.locator('iframe.page-frame[src*="assistant.html"]')).toHaveCount(1, { timeout: 15_000 });

    // 整页真实渲染出问答界面
    const frame = page.frameLocator('iframe.page-frame[src*="assistant.html"]');
    await expect(frame.locator('[data-testid="memory-assistant-page"]')).toBeVisible();
    await expect(frame.locator('[data-testid="ma-state"]')).toContainText('只转述本次快照');
    expect(errors).toEqual([]);
  });

  test('整页可提问并给出只转述真实快照的回答；页面内「重读」不丢会话', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(ASSISTANT);
    await expect(page.locator('[data-testid="memory-assistant-page"]')).toBeVisible();

    // 建议问题可点 → 出现真实回答（内容取决于真实账本，不预设数字）
    await page.getByRole('button', { name: '账本里有多少条记忆？' }).click();
    await expect(page.locator('[data-testid="ma-answer"]')).toBeVisible();

    // 页面内「重读」→ 只重新取数，页面不被重挂（会话仍在）
    await page.getByTestId('ma-refresh').click();
    await expect(page.locator('[data-testid="ma-answer"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('整页配色跟随记忆库页主题变量：浅色主题下不是深色（2026-11-10）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(ASSISTANT);
    await expect(page.locator('[data-testid="memory-assistant-page"]')).toBeVisible();

    // 页面用的是记忆库页同一套变量（--text/--muted/--panel/--win/--accent）
    const vars = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        text: cs.getPropertyValue('--text').trim(),
        win: cs.getPropertyValue('--win').trim(),
        panel: cs.getPropertyValue('--panel').trim(),
      };
    });
    expect(vars.text, '记忆助手页未拿到主题变量（--text 为空）').not.toBe('');
    expect(vars.win).not.toBe('');

    // 浅色主题：页面背景应是浅色（不是深色底）
    const bg = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="memory-assistant-page"]');
      return el ? getComputedStyle(el).backgroundColor : '';
    });
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
    expect(m, `页面背景色不可解析：${bg}`).not.toBeNull();
    const luminance = (Number(m![1]) * 0.299 + Number(m![2]) * 0.587 + Number(m![3]) * 0.114);
    expect(luminance, `浅色主题下页面背景应偏亮，实际 ${bg}`).toBeGreaterThan(120);
    expect(errors).toEqual([]);
  });

  test('底部状态栏的 L0 格：浏览器模式如实标注「不可用」（双锁文案由单元测试覆盖）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(SHELL);
    const sbL0 = page.locator('[data-testid="sb-l0"]');
    await expect(sbL0).toBeVisible();
    // 浏览器模式没有桌面主进程的 L0Vault → 读不到就如实标注「不可用」，绝不冒充已解锁/已锁定
    await expect(sbL0).toContainText('不可用');
    const title = await sbL0.getAttribute('title');
    expect(title).toContain('浏览器模式');
    expect(title).toContain('读不到');
    expect(errors).toEqual([]);
  });

  test('功能导航折叠后保留窄图标栏：只显示图标、名称走 title、点击仍能打开页面', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(SHELL);

    // 折叠前：完整文字导航
    await expect(page.getByRole('treeitem', { name: /记忆库/ })).toBeVisible();

    // 折叠 → 保留窄图标栏（不是归零），树项标记为 icon-only
    await page.getByTestId('nav-collapse-toggle').click();
    await expect(page.locator('.nav-pane.collapsed')).toHaveCount(1);
    await expect(page.locator('.tree-row.icon-only')).not.toHaveCount(0);

    // 图标可见、文字隐藏（CSS 生效）
    const row = page.getByTestId('nav-item-home');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('title', '首页');
    await expect(row.locator('.tico')).toBeVisible();
    await expect(row.locator('.tlabel')).toBeHidden();

    // 折叠态点击图标仍能打开对应页面
    await page.getByTestId('nav-item-memory-bank').click();
    await expect(page.locator('iframe.page-frame[src*="memory.html"]')).toHaveCount(1, { timeout: 15_000 });

    // 展开按钮可恢复完整导航
    await page.getByTestId('nav-reopen').click();
    await expect(page.locator('.nav-pane.collapsed')).toHaveCount(0);
    await expect(page.locator('.tree-row.icon-only')).toHaveCount(0);
    await expect(page.getByRole('treeitem', { name: /记忆库/ })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
