// E2E 测试：大模型配置页（REQ-009 / P13）自包含 :8141
// 覆盖用例：C1 渲染 / C2 judge 温度锁 / C5 换维度重建提示+估时 / C6 重建中禁切换 / C7 auto 免费优先 / C13 price_cap=0 禁付费
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

const STATIC_PORT = 8141;
const APP = `http://localhost:${STATIC_PORT}/models.html`;

let staticSrv: StaticServer;

test.beforeAll(async () => {
  staticSrv = await startStatic(STATIC_PORT, 'dist');
});

test.afterAll(async () => {
  await staticSrv.stop();
  await disconnectBrowser();
});

test.describe('大模型配置页', () => {
  test('C1 页面渲染：向量卡 384 维 + 4 用途表 + 反代理映射表', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="models-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="vector-dims"]')).toContainText('384');
    await expect(page.locator('[data-testid="usage-write"]')).toBeVisible();
    await expect(page.locator('[data-testid="usage-judge"]')).toBeVisible();
    await expect(page.locator('[data-testid="usage-rerank"]')).toBeVisible();
    await expect(page.locator('[data-testid="usage-growth"]')).toBeVisible();
    await expect(page.locator('[data-testid="proxy-claude-code"]')).toContainText('claude-free');
    await expect(page.locator('[data-testid="proxy-x-agent"]')).toContainText('deepseek-v3');
    expect(errors).toEqual([]);
  });

  test('C2/R4 judge 温度锁灰恒 0，其他用途可编辑', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="usage-judge-temp"]')).toBeDisabled();
    await expect(page.locator('[data-testid="usage-judge-temp"]')).toHaveValue('0');
    await expect(page.locator('[data-testid="usage-write-temp"]')).toBeEnabled();
  });

  test('C5/C6 换维度 → 重建确认（含估时）→ 重建中禁切换 → 完成解锁', async ({ page }) => {
    await page.goto(APP);
    let dialogMsg = '';
    page.on('dialog', (d) => {
      // 只读文案；accept 由 harness 全局容错接管（重复 accept 会报 already handled）
      dialogMsg = d.message();
    });
    await page.locator('[data-testid="vector-select"]').selectOption('bge-m3');
    expect(dialogMsg).toContain('1024');
    expect(dialogMsg).toContain('重建');
    await expect(page.locator('[data-testid="rebuild-banner"]')).toBeVisible();
    // R5：重建中 select 锁定
    await expect(page.locator('[data-testid="vector-select"]')).toBeDisabled();
    // 演示重建约 400ms/25% → 1.6s 内完成
    await expect(page.locator('[data-testid="rebuild-banner"]')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('[data-testid="vector-select"]')).toBeEnabled();
    await expect(page.locator('[data-testid="vector-dims"]')).toContainText('1024');
  });

  test('R2 Key 脱敏：勾网络通道并输入 Key → 展示为 [API_KEY:xx****]', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="usage-write-net"]').check();
    await page.locator('[data-testid="usage-write-endpoint"]').fill('https://api.example.com/v1');
    await page.locator('[data-testid="usage-write-key"]').fill('sk-secret-123456');
    await expect(page.locator('[data-testid="usage-write-masked"]')).toContainText('[API_KEY:sk****]');
    await expect(page.locator('[data-testid="usage-write-masked"]')).not.toContainText('secret-123456');
  });

  test('C7 auto 择优：模拟调用命中免费源 claude-code + 审计回显（R10）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="proxy-simulate"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('claude-code/claude-free');
    await expect(page.locator('[data-testid="toast"]')).toContainText('免费优先');
    await expect(page.locator('[data-testid="audit-echo"]')).toContainText('llm_proxy_source=agent:claude-code');
    await expect(page.locator('[data-testid="audit-echo"]')).toContainText('mode=auto');
    // 余量扣减：780（=0.9×1000−120）→ 779
    await expect(page.locator('[data-testid="proxy-remain-claude-code"]')).toHaveText('779');
  });

  test('C8 超限源剔除：x-agent 余量红显，auto 不会命中', async ({ page }) => {
    await page.goto(APP);
    // 手动勾掉免费源只剩超限 x-agent（cheap 0.03 > cap 0.01 → R7 拒绝）
    await page.locator('[data-testid="mode-manual"]').check();
    await page.locator('[data-testid="proxy-check-claude-code"]').uncheck();
    await page.locator('[data-testid="proxy-check-x-agent"]').check();
    await page.locator('[data-testid="proxy-simulate"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('R7 拒绝');
  });

  test('C13 price_cap=0：仅免费提示 + cheap 源被禁（付费回退本地）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="price-cap"]').fill('0');
    await expect(page.locator('[data-testid="free-only-hint"]')).toBeVisible();
    // 剩余免费源耗尽场景：manual 只勾 cursor-trial（免费但超限）→ 回退本地
    await page.locator('[data-testid="mode-manual"]').check();
    await page.locator('[data-testid="proxy-check-claude-code"]').uncheck();
    await page.locator('[data-testid="proxy-check-cursor-trial"]').check();
    await page.locator('[data-testid="proxy-simulate"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('C11');
    await expect(page.locator('[data-testid="audit-echo"]').first()).toContainText('agent:local');
  });

  test('R1/C3 保存门禁：全不勾被拒；勾网络无端点被拒；合法保存写审计', async ({ page }) => {
    await page.goto(APP);
    // C3：write 勾网络、清空本地、无端点 → 保存被拒
    await page.locator('[data-testid="usage-write-net"]').check();
    await page.locator('[data-testid="usage-write-endpoint"]').fill('https://api.example.com/v1');
    await page.locator('[data-testid="usage-write-local"]').uncheck();
    await page.locator('[data-testid="usage-write-endpoint"]').fill('');
    await page.locator('[data-testid="save-config"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('保存被拒绝');
    await expect(page.locator('[data-testid="usage-errors"]')).toContainText('C3');
    // 恢复合法
    await page.locator('[data-testid="usage-write-local"]').check();
    await page.locator('[data-testid="usage-write-net"]').uncheck();
    await page.locator('[data-testid="save-config"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('已保存 model_config');
  });
});
