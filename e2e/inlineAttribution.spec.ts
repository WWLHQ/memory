// REQ-004 Agent 界面内联记忆标识 · 真浏览器点击级 E2E
// 被测对象 = Vite 构建产物 dist/inlineattribution.html。
// 数据真相 = 内核账本 + 接入页持久化名单（localStorage agentOnboardState）：
//   · 无已接入 agent / 空账本 → 诚实空态，绝不硬编码演示标记；
//   · 已接入 agent + 空账本 → 切换器渲染、共享账本空态（不伪造 🧠/⚠ 标记）；
//   · 标识开关（19.7）在空账本下仍可切换，降级文案如实。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/inlineattribution.html`;
});
test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

/** 模拟接入页已持久化的「已接入 agent」名单（真实 localStorage 键，跨 iframe 同款口径） */
async function seedOnboardState(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('agentOnboardState', JSON.stringify({
      lastOnboardAt: Date.now(),
      agentNames: ['deepseek harness', 'claude code'],
      source: 'kernel',
    }));
  });
}

test.describe('REQ-004 Agent 界面内联标识 · 真实账本', () => {
  test('无已接入 agent → 诚实空态（不渲染任何伪造标记）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="inline-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="inline-empty"]')).toContainText('当前无任何已接入 agent');
    await expect(page.locator('[data-testid="inline-empty"]')).toContainText('空账本不伪造数据');
    await expect(page.locator('.mem-tag')).toHaveCount(0);
    await expect(page.locator('.tokbar')).toHaveCount(0);
    await expect(page.locator('.warn-tag')).toHaveCount(0);
    await expect(page.locator('.savebar')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('已接入 agent + 空共享账本 → 切换器 + 统一账本空态', async ({ page }) => {
    const errors = collectErrors(page);
    await seedOnboardState(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="agent-switcher"]')).toBeVisible();
    await expect(page.locator('[data-testid="agent-select"]')).toContainText('deepseek harness');
    await expect(page.locator('[data-testid="agent-select"]')).toContainText('claude code');
    // 统一共享账本为空 → 不渲染注入标记/背景/警示（诚实）
    await expect(page.locator('[data-testid="inline-shared-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="inline-shared-empty"]')).toContainText('统一记忆库中暂无可读记忆');
    await expect(page.locator('.mem-tag')).toHaveCount(0);
    await expect(page.locator('.warn-tag')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('标识开关（19.7）：降级文案如实，空账本不因级别变化伪造标记', async ({ page }) => {
    const errors = collectErrors(page);
    await seedOnboardState(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="inline-shared-empty"]')).toBeVisible();

    // token_only：🧠 隐藏、⚠ 仍显示（诚实约束）
    await page.check('.attr-toggle input[value="token_only"]');
    await expect(page.locator('.toast')).toContainText('仅 token 节省');
    await expect(page.locator('.mem-tag')).toHaveCount(0);

    // off：降级为统计行，⚠ 证据/老化警示仍强制显示
    await page.check('.attr-toggle input[value="off"]');
    await expect(page.locator('.toast')).toContainText('降级为统计行');
    await expect(page.locator('.tokbar')).toHaveCount(0);
    await expect(page.locator('.savebar')).toHaveCount(0);
    // 空账本无可显示的警示数据（不伪造 ⚠）
    await expect(page.locator('.warn-tag')).toHaveCount(0);

    // 回到 full：文案确认，空账本仍无注入标记
    await page.check('.attr-toggle input[value="full"]');
    await expect(page.locator('.toast')).toContainText('完整显示');
    await expect(page.locator('.mem-tag')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
