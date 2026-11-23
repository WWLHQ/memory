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

  test('新增：顶部安全摘要读数条 + 四个真实场景分组（未登录如实标注）', async ({ page }) => {
    await page.goto(APP);
    const readout = page.locator('[data-testid="security-readout"]');
    await expect(readout).toBeVisible();
    await expect(readout).toContainText('账号与角色');
    await expect(readout).toContainText('未登录');
    await expect(readout).toContainText('L0 密钥环');
    await expect(readout).toContainText('审计链完整性');
    for (const id of ['account', 'session', 'l0', 'chain']) {
      await expect(page.locator(`[data-testid="security-group-${id}"]`)).toBeVisible();
    }
    // 未登录：缺令牌/无会话原因如实展示，动作禁用或提示需管理员
    await expect(page.locator('[data-testid="security-group-l0"]')).toContainText('错误');
    await expect(page.locator('[data-testid="security-chain-reseal"]')).toBeDisabled();
    // 场景卡动作真跳转（原能力未丢）
    await page.locator('[data-testid="security-jump-policy"]').click();
    await expect(page.locator('[data-testid="pwd-upper"]')).toBeVisible();
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

  test('「N 项需处理」可点开：计数与清单一一对应，逐条给原因/所需身份/处理后状态', async ({ page }) => {
    const errors = collectErrors(page);
    await useSession(page, ADMIN_SID);
    await page.goto(APP);
    const chip = page.locator('[data-testid="security-issue-chip"]');
    await expect(chip).toBeVisible();
    const text = (await chip.textContent()) ?? '';
    const m = text.match(/(\d+) 项需处理/);
    expect(m, `chip 应显示真实计数，实际：${text}`).not.toBeNull();
    const n = Number(m![1]);
    expect(n).toBeGreaterThan(0); // 空 L0 审计至少一项需处理

    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    const list = page.locator('[data-testid="sec-issue-list"]');
    await expect(list).toBeVisible();
    await expect(list.locator('[data-testid^="sec-issue-"]')).toHaveCount(n);

    // 每条都有：为什么 / 需要什么身份或密钥 / 处理后变成什么
    for (const item of await list.locator('[data-testid^="sec-issue-"]').all()) {
      await expect(item).toContainText('为什么');
      await expect(item).toContainText('需要');
      await expect(item).toContainText('处理后');
    }
    // 管理员会话不应出现「角色」告警（不伪造问题）
    await expect(page.locator('[data-testid="sec-issue-chk-role"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('审计链旧无签名段 → 一键封存：计数实时下降、sealed 增加、mirror_reseal 落账本', async ({ page }) => {
    // 独立后端 + 预置两条旧式无签名审计（模拟历史账本；由 servers.ts 写进真实 dataDir）
    const be = await startHomeBackend({
      dataFile: join(tmpdir(), `e2e-reseal-${Date.now()}.json`),
      allowedOrigins: [`http://localhost:${staticSrv!.port}`],
      mirrorAuditSeed: [
        { seq: 1, source: 'audit', action: 'audit_query', request_id: 'legacy_1', payload: { q: 'a' }, ts: 1 },
        { seq: 2, source: 'audit', action: 'audit_query', request_id: 'legacy_2', payload: { q: 'b' }, ts: 2 },
      ],
    });
    try {
      const r = await fetch(`http://localhost:${be.port}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: ADMIN_ACCOUNT, password: DEFAULT_ADMIN_PASSWORD, form: 'desktop' }),
      });
      const sid = ((await r.json()) as { sessionId: string }).sessionId;
      await useSession(page, sid);
      await page.goto(`http://localhost:${staticSrv!.port}/security.html?backend=http://localhost:${be.port}`);

      await expect(page.locator('[data-testid="chk-chain"]')).toContainText('未签名旧段 2');
      const chip = page.locator('[data-testid="security-issue-chip"]');
      const before = Number((((await chip.textContent()) ?? '').match(/(\d+) 项需处理/) ?? [])[1] ?? '0');
      expect(before).toBeGreaterThan(0);
      await chip.click();
      await page.locator('[data-testid="sec-fix-chain"]').click();
      await expect(page.locator('[data-testid="sec-issue-msg"]')).toContainText('已封存 2 条');
      // 真实结果：2 条旧段补签 + 本次 mirror_reseal 审计自身落成 sealed 条目 = 3
      await expect(page.locator('[data-testid="chk-chain"]')).toContainText(/sealed 3/);
      // 旧段为 0 时页面不再显示「未签名旧段」告警文案（不是靠改判，是检查结果真的变了）
      await expect(page.locator('[data-testid="chk-chain"]')).not.toContainText('未签名旧段');
      // 真实检查刷新后计数下降（或归零显示全部通过）
      await expect(chip).not.toContainText(`${before} 项需处理`);
      if (before - 1 > 0) await expect(chip).toContainText(`${before - 1} 项需处理`);

      // 账本真的落了 mirror_reseal，旧内容未改
      const q = (await (await fetch(`http://localhost:${be.port}/api/mirror/audit`, {
        headers: { 'x-session-id': sid },
      })).json()) as { items: Array<{ action: string; payload?: unknown }> };
      expect(q.items.at(-1)?.action).toBe('mirror_reseal');
      expect(q.items[0].payload).toEqual({ q: 'a' });
    } finally {
      await closeServer(be.server);
    }
  });

  test('几何：四组卡等宽 2×2；摘要页三卡同列同宽、无 2/3+1/3 参差', async ({ page }) => {
    await page.goto(APP);
    const g = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      return {
        account: r('[data-testid="security-group-account"]'),
        session: r('[data-testid="security-group-session"]'),
        l0: r('[data-testid="security-group-l0"]'),
        chain: r('[data-testid="security-group-chain"]'),
      };
    });
    for (const k of ['account', 'session', 'l0', 'chain'] as const) expect(g[k]).not.toBeNull();
    // 2×2：同排等宽
    expect(Math.abs(g.account!.w - g.session!.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.l0!.w - g.chain!.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.account!.w - g.l0!.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.account!.x - g.l0!.x)).toBeLessThanOrEqual(1);

    // 摘要页签：检查表整行 + 危险操作卡/加密卡同排等宽
    const s = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width };
      };
      return {
        checks: r('[data-testid="security-checks"]'),
        danger: r('[data-testid="danger-overview"]'),
        enc: r('[data-testid="encrypt-card"]'),
      };
    });
    expect(s.danger).not.toBeNull();
    expect(s.enc).not.toBeNull();
    expect(Math.abs(s.danger!.w - s.enc!.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.danger!.y - s.enc!.y)).toBeLessThanOrEqual(1);
    expect(s.checks!.w).toBeGreaterThan(s.danger!.w);
  });

  test('白底：四组卡与页签内卡片 = --surface（浅色 #FFFFFF / 深色 #0C1424）', async ({ page }) => {
    await page.goto(APP);
    const read = () => page.evaluate(() => {
      const groups = Array.from(document.querySelectorAll('[data-testid^="security-group-"]'))
        .map((el) => getComputedStyle(el as HTMLElement).backgroundColor);
      const cards = Array.from(document.querySelectorAll('.af-page .card'))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => getComputedStyle(el as HTMLElement).backgroundColor);
      return { groups, cards };
    });
    const light = await read();
    expect(light.groups.length).toBe(4);
    for (const bg of light.groups) expect(bg).toBe('rgb(255, 255, 255)');
    // 四个页签逐个检查页签内真实卡片（检查摘要页可无 .card，其余三页必须有）
    let sawCard = false;
    for (const i of [0, 1, 2, 3] as const) {
      await secTab(page, i);
      const bgs = (await read()).cards;
      if (bgs.length) sawCard = true;
      for (const bg of bgs) expect(bg).toBe('rgb(255, 255, 255)');
    }
    expect(sawCard).toBe(true);
    // 深色主题：回到有卡片的页签，同一批卡取深色 surface，不是写死白底
    await secTab(page, 1);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const dark = await read();
    for (const bg of dark.groups) expect(bg).toBe('rgb(12, 20, 36)');
    expect(dark.cards.length).toBeGreaterThan(0);
    for (const bg of dark.cards) expect(bg).toBe('rgb(12, 20, 36)');
  });
});
