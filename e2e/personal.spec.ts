// E2E：个人记忆双窗（第一轮本机闭环）——真实登录后端 + 真实独立存储，非 mock。
//
// 覆盖：
//   ① 未登录直开：诚实不可用（不是「没有记忆」，也不编造条目/计数）
//   ② 登录后真路径：快速记一条（Enter 提交）→ 待确认计数（页签徽标）→ 是我的 → 左窗 + 搜索/时间范围
//   ③ 删除二次确认：第一次只提示，第二次才写墓碑
//   ④ 不是我的 → 已剔除 → 撤销剔除回到待确认
//   ⑤ 刷新后仍读回真实存储（独立文件/进程内实例，而非页面内存）
//   ⑥ agent 投递条目（独立存储里真实存在）在「待 agent 确认」分区，带来源与时间戳
//   ⑦ 壳层左侧导航角标 = 页面回传的真实待确认数
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';
import { InMemoryPersonalStore, personalContentHash } from '../src/core/memagent/personalStore.ts';
import type { Page } from 'playwright-core';

const ACCOUNT = 'pm_e2e';
const PWD = 'e2e_pwd';

let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let store: InMemoryPersonalStore;
let BACKEND = '';
let LOGIN = '';
let MEMORY = '';
let SHELL = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist');
  registerAccount(ACCOUNT, hashPassword(PWD), { enterprise_id: 'ent_pm_e2e', team_id: 'team_pm_e2e', perspective: 'team' });
  store = new InMemoryPersonalStore();
  const dataFile = join(tmpdir(), `e2e-personal-${Date.now()}.json`);
  backend = await startHomeBackend({ dataFile, allowedOrigins: [`http://localhost:${staticSrv.port}`], personalStore: store });
  BACKEND = `http://localhost:${backend.port}`;
  const q = `backend=${BACKEND}`;
  LOGIN = `http://localhost:${staticSrv.port}/login.html?${q}`;
  MEMORY = `http://localhost:${staticSrv.port}/memory.html?tab=personal&${q}`;
  SHELL = `http://localhost:${staticSrv.port}/workspace.html?${q}`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

async function login(page: Page): Promise<void> {
  await page.goto(LOGIN);
  await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
  await page.locator('#loginAccount').fill(ACCOUNT);
  await page.locator('#loginPassword').fill(PWD);
  await page.getByRole('button', { name: /^登录$/ }).click();
  // 登录页不跳转：以后端成功回执文案为准，再进入目标页
  await expect(page.getByText(/登录成功/)).toBeVisible({ timeout: 10_000 });
}

test.describe('个人记忆双窗 · 本机闭环 E2E', () => {
  // 每个用例从空独立存储开始，计数可精确断言（真实存储实例，非 mock）
  test.beforeEach(() => { store.clearForTests(); });
  test('未登录直开：诚实不可用，不编造条目与计数', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(MEMORY);
    await expect(page.locator('[data-testid="mm-personal-pane"]')).toBeVisible();
    await expect(page.locator('[data-testid="pm-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="pm-error"]')).toContainText('数据面不可用');
    await expect(page.locator('[data-testid="pm-error"]')).toContainText('未显示任何编造条目');
    await expect(page.locator('[data-testid="pm-confirmed"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-inbox"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('快速记一条 → 真实待确认计数 → 是我的进入左窗（搜索/时间范围）', async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);
    await page.goto(MEMORY);
    await expect(page.locator('[data-testid="pm-inbox"]')).toBeVisible();
    await expect(page.locator('[data-testid="pm-quick-input"]')).toBeVisible();

    await page.locator('[data-testid="pm-quick-input"]').fill('个人偏好：晨会前先看夜间告警');
    await page.locator('[data-testid="pm-quick-input"]').press('Enter');

    // 真实落库 → 收件箱出现；页签徽标 = 待确认 1
    await expect(page.locator('[data-testid="pm-sect-quick"]')).toContainText('晨会前先看夜间告警');
    await expect(page.locator('[data-testid="pm-msg"]')).toContainText('request_id');
    await expect(page.locator('[data-testid="mm-tab-personal"] .vcount')).toHaveText('1');
    await expect(page.locator('[data-testid="pm-counts"]')).toContainText('待确认 1');

    // 是我的 → 左窗已确认 1，收件箱清空
    await page.locator('[data-testid^="pm-confirm-"]').first().click();
    await expect(page.locator('[data-testid="pm-confirmed"]')).toContainText('晨会前先看夜间告警');
    await expect(page.locator('[data-testid="pm-confirmed-count"]')).toHaveText('1');
    await expect(page.locator('[data-testid="mm-tab-personal"] .vcount')).toHaveCount(0);

    // 搜索过滤：不匹配 → 空态但总数仍如实显示 1
    await page.locator('[data-testid="pm-search"]').fill('不存在的关键词');
    await expect(page.locator('[data-testid="pm-confirmed-empty"]')).toContainText('当前筛选没有匹配条目');
    await expect(page.locator('[data-testid="pm-confirmed-count"]')).toHaveText('1');
    await page.locator('[data-testid="pm-search"]').fill('夜间告警');
    await expect(page.locator('[data-testid="pm-confirmed"]')).toContainText('晨会前先看夜间告警');

    // 确认时间范围：近 7 天可见；切到 30 天仍可见（刚确认）
    await page.locator('[data-testid="pm-range"]').selectOption('7d');
    await expect(page.locator('[data-testid="pm-confirmed"]')).toContainText('晨会前先看夜间告警');
    await page.locator('[data-testid="pm-range"]').selectOption('all');

    // 刷新：读回真实存储（不是页面内存）
    await page.reload();
    await expect(page.locator('[data-testid="pm-confirmed"]')).toContainText('晨会前先看夜间告警');
    await expect(page.locator('[data-testid="pm-confirmed-count"]')).toHaveText('1');
    expect(errors).toEqual([]);
  });

  test('删除需二次确认：第一次不生效，第二次写墓碑后从视图移除', async ({ page }) => {
    await login(page);
    await page.goto(MEMORY);
    const id = 'pm_e2e_delete';
    await store.put({
      id, owner: ACCOUNT, content: '待删除：临时测试条目', source: 'agent', source_agent: '客服工作台',
      delivered_at: Date.now(), confirmed_at: Date.now(), state: 'confirmed', rejected_at: null,
      layer: 'L1', content_hash: personalContentHash('待删除：临时测试条目'), version: 1, deleted: false, deleted_at: null,
    });
    await page.reload();
    await expect(page.locator(`[data-testid="pm-confirmed-${id}"]`)).toBeVisible();

    await page.locator(`[data-testid="pm-delete-${id}"]`).click();
    await expect(page.locator('[data-testid="pm-msg"]')).toContainText('二次确认');
    // 第一次点击后条目仍在（未删除）
    await expect(page.locator(`[data-testid="pm-confirmed-${id}"]`)).toBeVisible();
    await expect(page.locator('[data-testid="pm-confirmed-count"]')).toHaveText('1');

    await page.locator(`[data-testid="pm-delete-confirm-${id}"]`).click();
    await expect(page.locator(`[data-testid="pm-confirmed-${id}"]`)).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-confirmed-count"]')).toHaveText('0');
    await expect(page.locator('[data-testid="pm-msg"]')).toContainText('墓碑保留');
  });

  test('不是我的 → 已剔除（可撤销）→ 撤销回到待确认', async ({ page }) => {
    await login(page);
    await page.goto(MEMORY);
    await page.locator('[data-testid="pm-quick-input"]').fill('这条不是我的：别人的习惯');
    await page.locator('[data-testid="pm-quick-input"]').press('Enter');
    await expect(page.locator('[data-testid="pm-sect-quick"]')).toContainText('别人的习惯');

    await page.locator('[data-testid^="pm-reject-"]').first().click();
    await expect(page.locator('[data-testid="pm-sect-rejected"]')).toContainText('别人的习惯');
    await expect(page.locator('[data-testid="pm-sect-rejected"]')).toContainText('可撤销');
    await expect(page.locator('[data-testid="pm-msg"]')).toContainText('账本保留');
    // 移出收件箱待确认分区（不删账本）
    await expect(page.locator('[data-testid="pm-sect-quick"]')).not.toContainText('别人的习惯');

    await page.locator('[data-testid^="pm-revoke-"]').first().click();
    await expect(page.locator('[data-testid="pm-sect-quick"]')).toContainText('别人的习惯');
    await expect(page.locator('[data-testid="pm-sect-rejected"]')).not.toContainText('别人的习惯');
  });

  test('agent 投递条目：在「待 agent 确认」分区，带来源与时间戳', async ({ page }) => {
    await login(page);
    const id = 'pm_e2e_agent';
    const delivered = Date.now() - 60_000;
    await store.put({
      id, owner: ACCOUNT, content: '客户偏好：工单回复先给结论再给步骤', source: 'agent', source_agent: '客服工作台',
      delivered_at: delivered, confirmed_at: null, state: 'pending', rejected_at: null,
      layer: 'L1', content_hash: personalContentHash('客户偏好：工单回复先给结论再给步骤'), version: 1, deleted: false, deleted_at: null,
    });
    await page.goto(MEMORY);
    const item = page.locator(`[data-testid="pm-pending-${id}"]`);
    await expect(item).toBeVisible();
    await expect(item).toContainText('来源 agent · 客服工作台');
    await expect(item).toContainText('工单回复先给结论再给步骤');
    // 时间戳格式 MM-DD HH:mm
    await expect(item.locator('.pm-time')).toHaveText(/\d{2}-\d{2} \d{2}:\d{2}/);

    await item.locator('[data-testid^="pm-confirm-"]').click();
    await expect(page.locator(`[data-testid="pm-confirmed-${id}"]`)).toBeVisible();
  });

  test('壳层左侧导航角标 = 页面回传的真实待确认数', async ({ page }) => {
    await login(page);
    const id = 'pm_e2e_nav';
    await store.put({
      id, owner: ACCOUNT, content: '导航角标验证条目', source: 'agent', source_agent: '工作台',
      delivered_at: Date.now(), confirmed_at: null, state: 'pending', rejected_at: null,
      layer: 'L1', content_hash: personalContentHash('导航角标验证条目'), version: 1, deleted: false, deleted_at: null,
    });
    await page.goto(SHELL);
    await page.getByRole('treeitem', { name: /个人记忆/ }).click();
    const badge = page.locator('[data-testid="nav-count-ledger-personal"]');
    await expect(badge).toHaveText('1', { timeout: 15_000 });
  });
});
