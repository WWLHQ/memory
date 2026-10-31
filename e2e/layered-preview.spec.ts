// 记忆层级管理页预览自测（真浏览器）
// 核心行为：L6→L1 始终可见；L0 授权框始终可见；L0 内容卡默认隐藏，输入授权码后才显示在授权框下方。
// 走 harness（CDP 外部浏览器），预览文件按仓库相对路径定位，换机器/换盘符不受影响。
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, disconnectBrowser } from './harness.ts';

const URL = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'design', 'ui', '记忆层级管理页_预览.html')).href;

test.afterAll(async () => {
  await disconnectBrowser();
});

test.describe('记忆层级管理页预览', () => {
  test('L6→L1 可见且每层 4 条，L0 授权框可见，L0 内容卡隐藏', async ({ page }) => {
    await page.goto(URL);
    for (const l of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) {
      await expect(page.locator(`.layer[data-layer="${l}"]`)).toBeVisible();
      await expect(page.locator(`.layer[data-layer="${l}"] .mem`)).toHaveCount(4);
    }
    // L0 授权框始终可见
    await expect(page.locator('[data-testid="l0-bar"]')).toBeVisible();
    // L0 内容卡不存在（不是隐藏，是不渲染）
    await expect(page.locator('.layer[data-layer="L0"]')).toHaveCount(0);
  });

  test('输入授权码后 L0 内容卡出现且明文可编辑', async ({ page }) => {
    await page.goto(URL);
    // l0bar 始终可见，直接填密码
    await page.fill('[data-testid="l0-pwd"]', 'l0pass123');
    await page.click('[data-testid="l0-unlock"]');
    // L0 内容卡渲染在授权框下方
    await expect(page.locator('.layer[data-layer="L0"]')).toBeVisible();
    const lastLayer = await page.evaluate(() => {
      const cards = document.querySelectorAll<HTMLElement>('.layer');
      return cards[cards.length - 1]?.dataset.layer;
    });
    expect(lastLayer).toBe('L0');
    // L0 无遮罩，显示明文
    await expect(page.locator('.layer[data-layer="L0"] .mask')).toHaveCount(0);
    await expect(page.locator('.layer[data-layer="L0"] .mem').first().locator('.mc')).toContainText('原始对话');
    // 点击 L0 条目 → 详情可编辑
    await page.locator('.layer[data-layer="L0"] .mem').first().click();
    await expect(page.locator('#detail')).toContainText('L0 · 原始对话');
    const ta = page.locator('textarea#ed');
    await expect(ta).toBeVisible();
    await expect(ta).not.toBeDisabled();
  });

  test('重新锁定后 L0 内容卡消失，授权框仍可见', async ({ page }) => {
    await page.goto(URL);
    await page.fill('[data-testid="l0-pwd"]', 'l0pass123');
    await page.click('[data-testid="l0-unlock"]');
    await expect(page.locator('.layer[data-layer="L0"]')).toHaveCount(1);
    // 重新锁定 → L0 内容卡消失
    await page.click('[data-testid="l0-lock"]');
    await expect(page.locator('.layer[data-layer="L0"]')).toHaveCount(0);
    // 但授权框仍然可见
    await expect(page.locator('[data-testid="l0-bar"]')).toBeVisible();
  });

  test('管理员可设定自动上锁时长，配置持久化到 localStorage', async ({ page }) => {
    await page.goto(URL);
    // 默认值 5 分钟
    await expect(page.locator('[data-testid="l0-timeout"]')).toHaveValue('5');
    // 改为 10 分钟
    await page.fill('[data-testid="l0-timeout"]', '10');
    await page.locator('[data-testid="l0-timeout"]').blur();
    // 刷新页面后配置保留
    await page.reload();
    await expect(page.locator('[data-testid="l0-timeout"]')).toHaveValue('10');
  });

  test('点击 L1 条目可打开详情编辑（含存储位置）', async ({ page }) => {
    await page.goto(URL);
    await page.locator('.layer[data-layer="L1"] .mem').first().click();
    await expect(page.locator('#detail')).toBeVisible();
    await expect(page.locator('#detail')).toContainText('L1');
    await expect(page.locator('textarea#ed')).toBeVisible();
    await expect(page.locator('[data-testid="store-location"]')).toBeVisible();
  });

  test('点击 L1 记忆序号（mid）可打开详情编辑', async ({ page }) => {
    await page.goto(URL);
    // 直接点击序号文本而非整行
    await page.locator('.layer[data-layer="L1"] .mem .mid').first().click();
    await expect(page.locator('#detail')).toBeVisible();
    await expect(page.locator('#detail')).toContainText('L1');
    await expect(page.locator('textarea#ed')).toBeVisible();
  });

  test('详情页有「打开记忆文件」按钮', async ({ page }) => {
    await page.goto(URL);
    await page.locator('.layer[data-layer="L1"] .mem').first().click();
    await expect(page.locator('[data-testid="open-memory-file"]')).toBeVisible();
  });

  test('自动锁定逻辑：解锁后状态条显示会话级提示，手动锁定后恢复初始文案', async ({ page }) => {
    await page.goto(URL);
    // 解锁
    await page.fill('[data-testid="l0-pwd"]', 'l0pass123');
    await page.click('[data-testid="l0-unlock"]');
    // 解锁后状态条显示已解锁提示
    await expect(page.locator('[data-testid="l0-bar"]')).toContainText('已解锁');
    // 手动锁定 → 状态条恢复锁定提示，密码框清空
    await page.click('[data-testid="l0-lock"]');
    await expect(page.locator('[data-testid="l0-bar"]')).toContainText('已锁定');
    const pwd = await page.inputValue('[data-testid="l0-pwd"]');
    expect(pwd).toBe('');
  });
});
