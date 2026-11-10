// E2E：个人记忆双窗（第一轮本机闭环 + 第二轮跨端同步）——真实登录后端 + 真实独立存储 + 真实 PgSyncHub，非 mock。
//
// 覆盖：
//   ① 未登录直开：诚实不可用（不是「没有记忆」，也不编造条目/计数）
//   ② 登录后真路径：快速记一条（Enter 提交）→ 待确认计数（页签徽标）→ 是我的 → 左窗 + 搜索/时间范围
//   ③ 删除二次确认：第一次只提示，第二次才写墓碑
//   ④ 不是我的 → 已剔除 → 撤销剔除回到待确认
//   ⑤ 刷新后仍读回真实存储（独立文件/进程内实例，而非页面内存）
//   ⑥ agent 投递条目（独立存储里真实存在）在「待 agent 确认」分区，带来源与时间戳
//   ⑦ 批次54：个人记忆不再占主导航；页面待确认数仍来自真实独立存储
//   ⑧ 第二轮：个人确认不提权 → 显式二次确认后上行到真实 PgSyncHub → 幂等 → 失败如实（阶段+错误码）
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';
import { InMemoryPersonalStore, personalContentHash } from '../src/core/memagent/personalStore.ts';
import { PgSyncHub } from '../src/core/memagent/pgSyncHub.ts';
import { sha256hex } from '../src/core/memagent/sync.ts';
import type { Page } from 'playwright-core';

/** 测试夹具：补齐第二轮同步字段（默认 local = 仅本机本人） */
function entryFixture(fields: {
  id: string; content: string; source: 'agent' | 'quick_note'; source_agent: string | null;
  delivered_at: number; confirmed_at: number | null; state: 'pending' | 'confirmed';
}): Parameters<InMemoryPersonalStore['put']>[0] {
  const content = fields.content;
  return {
    ...fields,
    owner: ACCOUNT,
    rejected_at: null,
    layer: 'L1',
    content_hash: personalContentHash(content),
    sha256: sha256hex(content),
    vclock: { web: 1 },
    sync_state: 'local',
    sync_error: null,
    sync_result: null,
    team_shared: false,
    team_id: null,
    version: 1,
    deleted: false,
    deleted_at: null,
  };
}

const ACCOUNT = 'pm_e2e';
const PWD = 'e2e_pwd';

let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let store: InMemoryPersonalStore;
/** 第二轮真实同步中枢：进程内 pglite（真 Postgres WASM 账本），非 mock */
let hub: PgSyncHub;
let BACKEND = '';
let LOGIN = '';
let MEMORY = '';
let SHELL = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist');
  registerAccount(ACCOUNT, hashPassword(PWD), { enterprise_id: 'ent_pm_e2e', team_id: 'team_pm_e2e', perspective: 'team' });
  store = new InMemoryPersonalStore();
  hub = new PgSyncHub();
  await hub.init();
  const dataFile = join(tmpdir(), `e2e-personal-${Date.now()}.json`);
  backend = await startHomeBackend({
    dataFile, allowedOrigins: [`http://localhost:${staticSrv.port}`], personalStore: store, personalSyncHub: hub,
  });
  BACKEND = `http://localhost:${backend.port}`;
  const q = `backend=${BACKEND}`;
  LOGIN = `http://localhost:${staticSrv.port}/login.html?${q}`;
  MEMORY = `http://localhost:${staticSrv.port}/memory.html?tab=personal&${q}`;
  SHELL = `http://localhost:${staticSrv.port}/workspace.html?${q}`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await hub?.close();
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

  test('个人记忆页头：说明行已删，计数与标题同一行（2026-11-10）', async ({ page }) => {
    await login(page);
    await page.goto(MEMORY);
    await expect(page.locator('[data-testid="mm-personal-pane"]')).toBeVisible();

    // 旧的「左：已确认（进入召回）· 右：收件箱…· 数据面…」说明行已删除
    await expect(page.locator('[data-testid="mm-personal-pane"]')).not.toContainText('数据面：');
    await expect(page.locator('[data-testid="mm-personal-pane"]')).not.toContainText('左：已确认');
    await expect(page.locator('[data-testid="mm-personal-pane"]')).not.toContainText('右：收件箱');

    // 计数徽标与「个人记忆」标题同行（同一行父容器内）
    const inHeader = await page.evaluate(() => {
      const tag = document.querySelector('[data-testid="pm-counts"]');
      const h3 = document.querySelector('[data-testid="mm-personal-pane"] .pmp-hd h3');
      if (!tag || !h3) return false;
      return tag.parentElement === h3.parentElement;
    });
    expect(inHeader, '计数徽标未与标题同行').toBe(true);
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
    await store.put(entryFixture({
      id, content: '待删除：临时测试条目', source: 'agent', source_agent: '客服工作台',
      delivered_at: Date.now(), confirmed_at: Date.now(), state: 'confirmed',
    }));
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
    await store.put(entryFixture({
      id, content: '客户偏好：工单回复先给结论再给步骤', source: 'agent', source_agent: '客服工作台',
      delivered_at: delivered, confirmed_at: null, state: 'pending',
    }));
    await page.goto(MEMORY);
    const item = page.locator(`[data-testid="pm-pending-${id}"]`);
    await expect(item).toBeVisible();
    await expect(item).toContainText('来源 agent · 客服工作台');
    await expect(item).toContainText('工单回复先给结论再给步骤');
    // 时间戳格式 MM-DD HH:mm
    await expect(item.locator('.pmp-time')).toHaveText(/\d{2}-\d{2} \d{2}:\d{2}/);

    await item.locator('[data-testid^="pm-confirm-"]').click();
    await expect(page.locator(`[data-testid="pm-confirmed-${id}"]`)).toBeVisible();
  });

  test('个人记忆进主导航：点击打开记忆库全页的个人记忆 Tab；常驻面板走状态栏快捷按钮', async ({ page }) => {
    await login(page);
    const id = 'pm_e2e_nav';
    await store.put(entryFixture({
      id, content: '导航角标验证条目', source: 'agent', source_agent: '工作台',
      delivered_at: Date.now(), confirmed_at: null, state: 'pending',
    }));
    await page.goto(SHELL);
    await expect(page.getByRole('treeitem', { name: /个人记忆/ })).toHaveCount(1);

    // 点击导航「个人记忆」→ 打开记忆库全页的个人记忆 Tab（不再弹浮层面板）
    await page.getByRole('treeitem', { name: /个人记忆/ }).click();
    await expect(page.locator('iframe.page-frame[src*="tab=personal"]')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('personal-memory-panel')).toHaveCount(0);

    // 常驻面板改由状态栏快捷按钮展开：原双窗界面 + 快速记一条置顶（与全页共用同一 Pane）
    await page.getByRole('button', { name: /个人记忆/ }).first().click();
    await expect(page.getByTestId('personal-memory-panel')).toBeVisible();
    await expect(page.getByTestId('mm-personal-pane')).toBeVisible();
    await expect(page.getByTestId('pm-quick-top')).toBeVisible();
    await expect(page.getByTestId('pm-quick-input')).toBeVisible();
    await expect(page.getByTestId('pm-confirmed')).toBeVisible();
    await expect(page.getByTestId('pm-inbox')).toBeVisible();
    await expect(page.getByTestId('pm-ingest-refresh')).toBeVisible();
    // 进库分流口径明示：会话信息直接放行，agent 提取的记忆才进发件箱
    await expect(page.getByTestId('pm-ingest-split')).toContainText('直接放行');

    await page.goto(MEMORY);
    await expect(page.getByTestId('pm-pending-count')).toHaveText('1', { timeout: 15_000 });
  });

  test('第二轮：确认不提权 → 二次确认显式授权 → 真实 PgSyncHub 已同步、幂等，不产生重复中枢条目', async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);
    await page.goto(MEMORY);
    const text = '上行约定：发版前跑全量回归 + 失败即回滚';
    await page.locator('[data-testid="pm-quick-input"]').fill(text);
    await page.locator('[data-testid="pm-quick-input"]').press('Enter');
    await expect(page.locator('[data-testid="pm-sect-quick"]')).toContainText(text);
    await page.locator('.pmp-item[data-testid^="pm-pending-"]').filter({ hasText: text })
      .locator('[data-testid^="pm-confirm-"]').click();

    const item = page.locator('.pmp-item[data-testid^="pm-confirmed-"]').filter({ hasText: text });
    await expect(item).toBeVisible();
    // 确认不自动提权：同步徽标仍是「仅本机 · 本人」
    await expect(item.locator('[data-testid^="pm-sync-badge-"]')).toContainText('仅本机');
    await expect(page.locator('[data-testid="pm-owner-binding"]')).toBeVisible();

    // 第一次点击只提示二次确认，条目仍未上行
    await item.locator('[data-testid^="pm-uplink-"]').click();
    await expect(page.locator('[data-testid="pm-msg"]')).toContainText('再次点击「确认上行」');
    await expect(item.locator('[data-testid^="pm-sync-badge-"]')).toContainText('仅本机');

    // 第二次点击 = 显式授权 → 真实中枢落账
    await item.locator('[data-testid^="pm-uplink-confirm-"]').click();
    await expect(page.locator('[data-testid="pm-msg"]')).toContainText('已上行到团队中枢', { timeout: 15_000 });
    await expect(item.locator('[data-testid^="pm-sync-badge-"]')).toContainText('已同步（团队）');
    await expect(page.locator('[data-testid="pm-sync-queue-count"]')).toHaveText('0');
    // 真实中枢（PgSyncHub）里只有一条同内容条目（sha256 幂等口径）
    const rec = await hub.reconcile({ team_id: 'team_pm_e2e' });
    expect(rec.items.filter((m) => m.content === text)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('第二轮：中枢未接线 → 上行如实显示「阶段 + 错误码」，绝不显示已同步；本机待上行段接真实数据', async ({ page }) => {
    // 独立后端：没有接 PgSyncHub（模拟真实链路不可用），其余全部真实
    const backend2 = await startHomeBackend({
      dataFile: join(tmpdir(), `e2e-personal-nohub-${Date.now()}.json`),
      allowedOrigins: [`http://localhost:${staticSrv!.port}`],
      personalStore: new InMemoryPersonalStore(),
    });
    try {
      const b2 = `http://localhost:${backend2.port}`;
      const q2 = `backend=${b2}`;
      await page.goto(`http://localhost:${staticSrv!.port}/login.html?${q2}`);
      await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
      await page.locator('#loginAccount').fill(ACCOUNT);
      await page.locator('#loginPassword').fill(PWD);
      await page.getByRole('button', { name: /^登录$/ }).click();
      await expect(page.getByText(/登录成功/)).toBeVisible({ timeout: 10_000 });
      await page.goto(`http://localhost:${staticSrv!.port}/memory.html?tab=personal&${q2}`);

      const text = '中枢不可用时的诚实失败条目';
      await page.locator('[data-testid="pm-quick-input"]').fill(text);
      await page.locator('[data-testid="pm-quick-input"]').press('Enter');
      await page.locator('.pmp-item[data-testid^="pm-pending-"]').filter({ hasText: text })
        .locator('[data-testid^="pm-confirm-"]').click();
      const item = page.locator('.pmp-item[data-testid^="pm-confirmed-"]').filter({ hasText: text });
      await item.locator('[data-testid^="pm-uplink-"]').click();
      await item.locator('[data-testid^="pm-uplink-confirm-"]').click();

      // 失败回执：阶段 + 错误码，明确「未送达团队」
      await expect(page.locator('[data-testid="pm-msg"]')).toContainText('阶段 hub_init');
      await expect(page.locator('[data-testid="pm-msg"]')).toContainText('E_SYNC_HUB_UNAVAILABLE');
      await expect(page.locator('[data-testid="pm-msg"]')).toContainText('未送达团队');
      // 条目徽标如实：同步失败（非「已同步」）
      await expect(item.locator('[data-testid^="pm-sync-badge-"]')).toContainText('同步失败');
      await expect(item.locator('[data-testid^="pm-sync-badge-"]')).not.toContainText('已同步');
      // 收件箱「本机待上行」段接真实 pending_sync / failed 数据
      await expect(page.locator('[data-testid="pm-sync-queue-count"]')).toHaveText('1');
      await expect(page.locator('[data-testid="pm-sect-sync"]')).toContainText(text);
      await expect(page.locator('[data-testid="pm-sect-sync"]')).toContainText('阶段 hub_init');
      await expect(page.locator('[data-testid="pm-inbox-foot"]')).toContainText('同步失败 1');
      await expect(page.locator('[data-testid="pm-counts"]')).toContainText('同步失败 1');
    } finally {
      await closeServer(backend2.server);
    }
  });
});
