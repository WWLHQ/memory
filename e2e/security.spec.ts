// E2E 测试：账号与安全页（REQ-006 / P12）——批次7 起接真登录后端做管理员门禁断言。
// 管理员：策略可改 + 账号表/改密卡可用；普通成员/未登录：敏感区只读并提示「需管理员」。
// 安全操作（策略变更）真写内核审计 security_change 并回执 request_id。
// 现行结构：4 个页签（sec-tab-0 检查摘要 / sec-tab-1 危险操作卡 11 张 / sec-tab-2 账号与密钥 / sec-tab-3 L0 审计）；
//   各面板用 hidden 挂载（DOM 常驻），断言前必须切到对应页签，否则元素存在但不可见。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';
import { ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD } from '../src/auth/loginService.ts';
import type { Page } from 'playwright-core';

const SESSION_KEY = 'session:realpage';
const MEMBER = 'e2e_member';
const MEMBER_PWD = 'member_pw_1';

let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let APP = '';
let ADMIN_SID = '';
let MEMBER_SID = '';

async function loginViaApi(account: string, password: string): Promise<string> {
  const r = await fetch(`http://localhost:${backend!.port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password, form: 'desktop' }),
  });
  const body = (await r.json()) as { sessionId?: string };
  if (!body.sessionId) throw new Error(`login failed for ${account}: ${r.status}`);
  return body.sessionId;
}

/** 页面加载前写入登录会话（与首页登录后的 localStorage 键一致） */
async function useSession(page: Page, sid: string): Promise<void> {
  await page.addInitScript(([key, value]) => {
    try { localStorage.setItem(key as string, value as string); } catch { /* about:blank */ }
  }, [SESSION_KEY, sid]);
}

/** 切到指定页签（0 检查摘要 / 1 危险操作卡 / 2 账号与密钥 / 3 L0 审计） */
async function secTab(page: Page, i: 0 | 1 | 2 | 3): Promise<void> {
  await page.locator(`[data-testid="sec-tab-${i}"]`).click();
  await expect(page.locator(`[data-testid="sec-tab-${i}"]`)).toHaveAttribute('aria-selected', 'true');
}

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist');
  const dataFile = join(tmpdir(), `e2e-security-${Date.now()}.json`);
  backend = await startHomeBackend({ dataFile, allowedOrigins: [`http://localhost:${staticSrv.port}`] });
  ADMIN_SID = await loginViaApi(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD);

  registerAccount(MEMBER, hashPassword(MEMBER_PWD), { enterprise_id: 'ent_e2e', team_id: 'team_e2e', perspective: 'team' });
  MEMBER_SID = await loginViaApi(MEMBER, MEMBER_PWD);

  APP = `http://localhost:${staticSrv.port}/security.html?backend=http://localhost:${backend.port}`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('账号与安全页 · 未登录（只读门禁）', () => {
  test('五区块渲染 + 加密只读 + 成员/密钥空表', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="security-page"]')).toBeVisible();
    // 检查摘要页：加密状态只读卡
    await expect(page.locator('[data-testid="encrypt-card"]')).toContainText('AES');
    // 危险操作卡页：L0 密钥环未登录 → 只读提示，不渲染管理表单
    await secTab(page, 1);
    await expect(page.locator('[data-testid="l0-admin-required"]')).toBeVisible();
    // 账号与密钥页：角色矩阵 + 成员/密钥空表
    await secTab(page, 2);
    await expect(page.locator('[data-testid="role-matrix"]')).toBeVisible();
    // 无种子成员/密钥：仅表头行（不伪造 4 成员/2 密钥）
    await expect(page.locator('[data-testid="member-table"] tr')).toHaveCount(1);
    await expect(page.locator('[data-testid="key-table"] tr')).toHaveCount(1);
    // 前缀选择器会命中表容器本身（member-table/key-table），数据行改查 tbody
    await expect(page.locator('[data-testid="member-table"] tbody tr')).toHaveCount(0);
    await expect(page.locator('[data-testid="key-table"] tbody tr')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('未登录：敏感区只读 + 「需管理员」提示 + 默认管理员账号提示', async ({ page }) => {
    await page.goto(APP);
    await secTab(page, 1);
    await expect(page.locator('[data-testid="admin-required"]')).toBeVisible();
    await expect(page.locator('[data-testid="admin-required"]')).toContainText('未登录');
    await expect(page.locator('[data-testid="pwd-policy-admin-required"]')).toBeVisible();
    await expect(page.locator('[data-testid="pwd-upper"]')).toBeDisabled();
    // 样例校验不受只读影响（普通用户也能自查密码强度）
    await page.locator('[data-testid="pwd-sample"]').fill('MyPassword1!');
    await expect(page.locator('[data-testid="pwd-err"]')).toContainText('含禁用词');
    await page.locator('[data-testid="pwd-sample"]').fill('N3w^Secret9');
    await expect(page.locator('[data-testid="pwd-ok"]')).toBeVisible();
  });

  test('空成员/密钥表无删除或吊销按钮', async ({ page }) => {
    await page.goto(APP);
    await secTab(page, 2);
    await expect(page.locator('[data-testid="member-table"] tbody tr')).toHaveCount(0);
    await expect(page.locator('[data-testid="key-table"] tbody tr')).toHaveCount(0);
    // 表内不存在任何成员删除/共享按钮或密钥轮换/吊销按钮
    await expect(page.locator('[data-testid^="remove-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="shared-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="revoke-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="rotate-"]')).toHaveCount(0);
  });
});

test.describe('账号与安全页 · 普通成员（只读门禁）', () => {
  test('成员会话：策略禁改，账号卡显示「当前账号为普通成员」', async ({ page }) => {
    await useSession(page, MEMBER_SID);
    await page.goto(APP);
    await secTab(page, 1);
    await expect(page.locator('[data-testid="admin-required"]')).toContainText('普通成员');
    await expect(page.locator('[data-testid="pwd-policy-admin-required"]')).toBeVisible();
    await expect(page.locator('[data-testid="pwd-upper"]')).toBeDisabled();
    // 成员看不到账号表（管理员专属数据）
    await expect(page.locator('[data-testid="admin-accounts-table"]')).toHaveCount(0);
  });
});

test.describe('账号与安全页 · 管理员', () => {
  test('管理员会话：账号表可见（admin 行）、策略可改、无只读提示', async ({ page }) => {
    const errors = collectErrors(page);
    await useSession(page, ADMIN_SID);
    await page.goto(APP);
    await secTab(page, 1);

    await expect(page.locator('[data-testid="acct-admin"]')).toBeVisible();
    await expect(page.locator('[data-testid="role-admin"]')).toHaveValue('admin');
    await expect(page.locator('[data-testid="pwd-old"]')).toBeVisible();
    await expect(page.locator('[data-testid="pwd-policy-admin-required"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pwd-upper"]')).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('策略变更 → 真实审计 toast（security_change + req_ 回执）', async ({ page }) => {
    await useSession(page, ADMIN_SID);
    await page.goto(APP);
    await secTab(page, 1);
    // 等身份确认完成（管理员策略区解除只读）
    await expect(page.locator('[data-testid="pwd-upper"]')).toBeEnabled();

    await page.locator('[data-testid="pwd-upper"]').uncheck();
    await expect(page.locator('[data-testid="toast"]')).toContainText('大写=关');
    await expect(page.locator('[data-testid="toast"]')).toContainText(/req_/);
    await expect(page.locator('[data-testid="pwd-upper"]')).not.toBeChecked();
  });

  test('展开真实账号：成员出现在表中，团队可编辑并保存', async ({ page }) => {
    await useSession(page, ADMIN_SID);
    await page.goto(APP);
    await secTab(page, 1);
    await expect(page.locator(`[data-testid="acct-${MEMBER}"]`)).toBeVisible();
    const team = page.locator(`[data-testid="team-${MEMBER}"]`);
    await team.fill('team_e2e_2');
    await page.locator(`[data-testid="team-save-${MEMBER}"]`).click();
    await expect(page.locator('[data-testid="toast"]')).toContainText('团队已设为 team_e2e_2');
  });

  test('改密失败可见：旧密码错 → admin-err 明确提示', async ({ page }) => {
    await useSession(page, ADMIN_SID);
    await page.goto(APP);
    await secTab(page, 1);
    await expect(page.locator('[data-testid="pwd-old"]')).toBeVisible();
    await page.locator('[data-testid="pwd-old"]').fill('definitely-wrong');
    await page.locator('[data-testid="pwd-new"]').fill('NewPass#2026');
    await page.locator('[data-testid="pwd-change"]').click();
    await expect(page.locator('[data-testid="admin-err"]')).toContainText('旧密码');
    // 未改成功：默认管理员密码仍可登录
    expect(await loginViaApi(ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD)).toBeTruthy();
  });
});
