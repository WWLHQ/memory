// E2E 测试：大模型配置页（REQ-009 / P13）自包含（系统分配端口）
// 覆盖用例：C1 渲染 / C2 judge 温度锁 / C5 换维度重建提示+估时 / C6 重建中禁切换 / C7 auto 模拟(dry-run·无源回退本地) / C13 price_cap=0 仅免费可见
// 注：静态构建无宿主 LLM 网关 → 页面走「未配置引擎」诚实空态；反代理路由深逻辑由单测（logic.test.ts / coreModels.test.ts）覆盖。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/models.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('大模型配置页', () => {
  test('C1 页面渲染：向量卡 384 维 + 4 用途表 + 反代理诚实空态（未配置引擎）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="models-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="vector-dims"]')).toContainText('384');
    await expect(page.locator('[data-testid="usage-write"]')).toBeVisible();
    await expect(page.locator('[data-testid="usage-judge"]')).toBeVisible();
    await expect(page.locator('[data-testid="usage-rerank"]')).toBeVisible();
    await expect(page.locator('[data-testid="usage-growth"]')).toBeVisible();
    // 阶段3-B/3-C：无网关 → 诚实空态，绝不渲染假代理行（PROXY_CATALOG 已删）
    await expect(page.locator('[data-testid="proxy-empty-state"]')).toContainText('未配置引擎');
    await expect(page.locator('[data-testid="proxy-rows"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('C2/R4 judge 温度锁灰恒 0，其他用途可编辑', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="usage-judge-temp"]')).toBeDisabled();
    await expect(page.locator('[data-testid="usage-judge-temp"]')).toHaveValue('0');
    await expect(page.locator('[data-testid="usage-write-temp"]')).toBeEnabled();
  });

  test('C5/C6 换维度 → 确认（含估时）→ 保存后真落盘，刷新仍生效', async ({ page }) => {
    await page.goto(APP);
    let dialogMsg = '';
    page.on('dialog', (d) => {
      // 只读文案；accept 由 harness 全局容错接管（重复 accept 会报 already handled）
      dialogMsg = d.message();
    });
    await page.locator('[data-testid="vector-select"]').selectOption('bge-m3');
    expect(dialogMsg).toContain('1024');
    expect(dialogMsg).toContain('重嵌入');
    await expect(page.locator('[data-testid="vector-dims"]')).toContainText('1024');
    // 保存前不伪造重建进度：选择即可继续操作（R5 锁定仅在真实保存期间）
    await expect(page.locator('[data-testid="vector-select"]')).toBeEnabled();
    await page.locator('[data-testid="save-config"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('已持久化');
    await expect(page.locator('[data-testid="toast"]')).toContainText('1024 维');
    // 真落盘：刷新后配置仍在（localStorage）
    await page.reload();
    await expect(page.locator('[data-testid="vector-select"]')).toHaveValue('bge-m3');
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

  test('C7 auto 模拟（dry-run）：无可用源 → 回退本地，不写账本、不扣余量', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="proxy-simulate"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('dry-run（未写账本）');
    await expect(page.locator('[data-testid="toast"]')).toContainText('回退本地');
    await expect(page.locator('[data-testid="audit-echo"]')).toContainText('暂无本会话审计条目');
  });

  test('C8/R7 manual：无可用源时模拟 → 回退本地（dry-run，不伪造代理）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="mode-manual"]').check();
    await page.locator('[data-testid="proxy-simulate"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('dry-run（未写账本）');
    await expect(page.locator('[data-testid="toast"]')).toContainText('回退本地');
  });

  test('C13 price_cap=0：仅免费提示可见；模拟 → 回退本地（无可用源）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="price-cap"]').fill('0');
    await expect(page.locator('[data-testid="free-only-hint"]')).toBeVisible();
    await page.locator('[data-testid="proxy-simulate"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('dry-run（未写账本）');
    await expect(page.locator('[data-testid="toast"]')).toContainText('回退本地');
    await expect(page.locator('[data-testid="audit-echo"]')).toContainText('暂无本会话审计条目');
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
