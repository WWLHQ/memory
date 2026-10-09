// REQ-004 Agent 界面内联记忆标识 · 真浏览器点击级 E2E
// 被测对象 = Vite 构建产物 dist/inlineattribution.html（纯 UI 演示，无需后端）。
// 验证：四类标识渲染、开关降级（诚实约束）、弹层干预、背景展开、token 分解、无脚本异常。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8126; // 避开 overview 8125 / app 8123 / home 8124
let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist'); // 服务 Vite 构建产物（含 inlineattribution）
});
test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('REQ-004 Agent 界面内联标识 · 点击级 E2E', () => {
  test('四类标识渲染 + 背景展开 + token 分解（full 默认）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`http://localhost:${STATIC_PORT}/inlineattribution.html`);

    // ① 记忆注入 🧠 ×3
    await expect(page.locator('.mem-tag')).toHaveCount(3);
    // ③ 背景 📎
    await expect(page.locator('.bgmark')).toBeVisible();
    // ② Token 节省 ⚡
    await expect(page.locator('.tokbar')).toBeVisible();
    // ④ 老化/证据 ⚠️ ×2（aging + evidence_thin）
    await expect(page.locator('.warn-tag')).toHaveCount(2);
    // ⑧ 写入沉淀 💾
    await expect(page.locator('.savebar')).toBeVisible();

    // ③ 背景展开
    await page.click('.bgmark .more');
    await expect(page.locator('.bgmark ul li')).toHaveCount(4);

    // ② token 分解展开
    await page.click('.tokbar');
    await expect(page.locator('.tokbar ul li')).toHaveCount(3);

    expect(errors).toEqual([]);
  });

  test('① 弹层：memory_id / L2 / 衰减层 + 干预回调（toast）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`http://localhost:${STATIC_PORT}/inlineattribution.html`);

    // 点第一个 🧠 开弹层
    await page.locator('.mem-tag').first().hover();
    const pop = page.locator('.pop').first();
    await expect(pop).toBeVisible();
    await expect(pop).toContainText('记忆注入 · mem_005');
    await expect(pop).toContainText('decay_class=cold');
    // request_id 跳审计回调
    await pop.locator('a', { hasText: 'req_017' }).click();
    await expect(page.locator('.toast')).toContainText('开审计页定位 req_017');
    // 记住/忘记 干预回调
    await page.locator('.mem-tag').first().hover();
    await page.locator('.pop').first().getByText('记住 +0.1').click();
    await expect(page.locator('.toast')).toContainText('已「记住」mem_005');

    expect(errors).toEqual([]);
  });

  test('开关降级（19.7 诚实约束）：token_only / off', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`http://localhost:${STATIC_PORT}/inlineattribution.html`);

    // token_only：①🧠 隐藏，⚡⚠💾 仍在
    await page.check('.attr-toggle input[value="token_only"]');
    await expect(page.locator('.mem-tag')).toHaveCount(0);
    await expect(page.locator('.tokbar')).toBeVisible();
    await expect(page.locator('.warn-tag')).toHaveCount(2);
    await expect(page.locator('.savebar')).toBeVisible();

    // off：①②③💾 隐藏，⚠ 恒显示（诚实约束）
    await page.check('.attr-toggle input[value="off"]');
    await expect(page.locator('.mem-tag')).toHaveCount(0);
    await expect(page.locator('.tokbar')).toHaveCount(0);
    await expect(page.locator('.bgmark')).toHaveCount(0);
    await expect(page.locator('.savebar')).toHaveCount(0);
    await expect(page.locator('.warn-tag')).toHaveCount(2); // 诚实约束：必显示

    // 回到 full
    await page.check('.attr-toggle input[value="full"]');
    await expect(page.locator('.mem-tag')).toHaveCount(3);

    expect(errors).toEqual([]);
  });
});
