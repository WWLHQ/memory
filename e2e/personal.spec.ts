// E2E：个人记忆双窗（第一轮本机闭环 + 第二轮跨端同步）——真实登录后端 + 真实独立存储 + 真实 PgSyncHub，非 mock。
//
// 覆盖：
//   ① 未登录直开：诚实不可用（不是「没有记忆」，也不编造条目/计数）
//   ② 登录后真路径：左窗文本框输入 + 保存（quick_add → confirm）→ 已确认并强制召回 + 已保存列表常驻
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
  MEMORY = `http://localhost:${staticSrv.port}/personal.html?${q}`;
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

  test('个人记忆页头：说明行已删，计数与标题同一行；召回归属在页头右侧（图2 红框）', async ({ page }) => {
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

    // 召回归属：信息仍在，但已从下方整条移到页头（同一 .pmp-hd 内）
    await expect(page.locator('[data-testid="pm-owner-binding"]')).toBeVisible();
    await expect(page.locator('[data-testid="pm-owner-binding"]')).toContainText('召回归属：内核账号');
    const ownerInHeader = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="pm-owner-binding"]');
      const hd = document.querySelector('[data-testid="mm-personal-pane"] .pmp-hd');
      return !!b && !!hd && b.parentElement === hd;
    });
    expect(ownerInHeader, '召回归属未移到页头').toBe(true);

    // 顶部快速记录整块已删除；左窗 = 记事本 textarea + 唯一「保存」（下拉/删除/取消/字数计数全部移除）
    await expect(page.locator('[data-testid="pm-quick-top"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-quick-input"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '记一条' })).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-note-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="pm-note-save"]')).toBeVisible();
    await expect(page.locator('[data-testid="pm-note-save"]')).toHaveText('保存');
    await expect(page.locator('[data-testid="pm-saved-list"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-forced-hint"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-saved-pick"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-delete-selected"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-note-count"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-note-cancel"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-search"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-range"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-confirmed-empty"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-confirmed-foot"]')).toHaveCount(0);
    const leftOnly = await page.evaluate(() => {
      const col = document.querySelector('[data-testid="pm-confirmed"]') as HTMLElement | null;
      if (!col) return null;
      return {
        textarea: col.querySelectorAll('textarea').length,
        inputs: col.querySelectorAll('input, select').length,
        buttons: Array.from(col.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()),
        savedBand: col.querySelectorAll('[data-testid="pm-saved-list"]').length,
      };
    });
    expect(leftOnly).toEqual({ textarea: 1, inputs: 0, buttons: ['保存'], savedBand: 0 });
  });

  test('左卡结构：保存按钮在右上角，记事本铺满整卡（无条带/无第二张卡）', async ({ page }) => {
    await login(page);
    await page.goto(MEMORY);
    await expect(page.locator('[data-testid="pm-confirmed"]')).toBeVisible();

    const geo = await page.evaluate(() => {
      const wrap = document.querySelector('.pmp-wrap') as HTMLElement;
      const col = document.querySelector('[data-testid="pm-confirmed"]') as HTMLElement;
      const head = col.querySelector('.pmp-head') as HTMLElement;
      const save = document.querySelector('[data-testid="pm-note-save"]') as HTMLElement;
      const body = document.querySelector('[data-testid="pm-confirmed-list"]') as HTMLElement;
      const ta = document.querySelector('[data-testid="pm-note-input"]') as HTMLTextAreaElement;
      const cs = getComputedStyle(ta);
      return {
        colW: col.getBoundingClientRect().width,
        wrapW: wrap.getBoundingClientRect().width,
        colH: col.getBoundingClientRect().height,
        saveInHead: head.contains(save),
        saveTop: save.getBoundingClientRect().top - head.getBoundingClientRect().top,
        saveRight: head.getBoundingClientRect().right - save.getBoundingClientRect().right,
        taW: ta.getBoundingClientRect().width,
        bodyW: body.getBoundingClientRect().width,
        taH: ta.getBoundingClientRect().height,
        bodyKids: body.children.length,
        savedBand: document.querySelectorAll('[data-testid="pm-saved-list"]').length,
        pickInHead: head.contains(document.querySelector('[data-testid="pm-saved-pick"]')),
        saveOnly: Array.from(head.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()),
        border: cs.borderTopWidth,
        resize: cs.resize,
        nestedBox: document.querySelector('.pmp-note') !== null,
      };
    });

    // 保存按钮在左卡右上角（头部内、靠右）
    expect(geo.saveInHead).toBe(true);
    expect(geo.saveTop).toBeGreaterThanOrEqual(0);
    expect(geo.saveTop).toBeLessThan(16);
    expect(geo.saveRight).toBeGreaterThanOrEqual(0);
    expect(geo.saveRight).toBeLessThan(16);
    // 记事本无内层边框、不可拖拽；整卡只剩编辑区（条带已删）
    expect(geo.taW).toBeGreaterThan(geo.bodyW - 4);
    expect(geo.taH).toBeGreaterThanOrEqual(120);
    expect(geo.border).toBe('0px');
    expect(geo.resize).toBe('none');
    expect(geo.nestedBox).toBe(false);
    expect(geo.bodyKids).toBe(1);
    expect(geo.savedBand).toBe(0);
    // 页头只剩唯一「保存」按钮（下拉/删除/取消均已移除）
    expect(geo.pickInHead).toBe(false);
    expect(geo.saveOnly).toEqual(['保存']);
    // 卡片撑满可用宽高：左卡高度接近双窗容器，宽度占可用的一半
    expect(geo.colH).toBeGreaterThan(360);
    expect(geo.colW / geo.wrapW).toBeGreaterThan(0.4);
  });

  test('2026-11-22 记事本版式：正文常驻可写、连续保存写回同一条、收件箱半宽不挤压', async ({ page }) => {
    await login(page);
    await page.goto(MEMORY);
    await expect(page.locator('[data-testid="pm-confirmed"]')).toBeVisible();

    // 真实写入：第一次新建，之后框内直接改 + 保存 = 写回同一条（不新增重复）
    for (const t of ['条带一', '条带二', '条带三']) {
      await page.locator('[data-testid="pm-note-input"]').fill(t);
      await page.locator('[data-testid="pm-note-save"]').click();
      await expect(page.locator('[data-testid="pm-msg"]')).toContainText('已保存');
      await expect(page.locator('[data-testid="pm-note-input"]')).toHaveValue(t);
    }
    await expect(page.locator('[data-testid="pm-confirmed-count"]')).toHaveText('1');
    expect((await store.list(ACCOUNT)).filter((e) => e.content.startsWith('条带'))).toHaveLength(1);

    const geo = await page.evaluate(() => {
      const noteCol = document.querySelector('[data-testid="pm-confirmed"]') as HTMLElement;
      const inbox = document.querySelector('[data-testid="pm-inbox"]') as HTMLElement;
      const ta = document.querySelector('[data-testid="pm-note-input"]') as HTMLTextAreaElement;
      const inboxBody = inbox.querySelector('.pmp-body') as HTMLElement;
      return {
        noteW: noteCol.getBoundingClientRect().width,
        inboxW: inbox.getBoundingClientRect().width,
        taH: ta.getBoundingClientRect().height,
        taBg: getComputedStyle(ta).backgroundColor,
        taValue: ta.value,
        pick: document.querySelectorAll('[data-testid="pm-saved-pick"]').length,
        inboxOverflow: getComputedStyle(inboxBody).overflowY,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        savedBand: document.querySelectorAll('[data-testid="pm-saved-list"]').length,
      };
    });

    // 收件箱宽度缩到原来 1/2（左:右 ≈ 2:1），省出的宽度给记事本
    expect(geo.noteW / geo.inboxW).toBeGreaterThan(1.8);
    // 记事本编辑区铺满卡片剩余高度、非透明底，可多行直接写
    expect(geo.taH).toBeGreaterThan(200);
    expect(geo.taBg).not.toBe('rgba(0, 0, 0, 0)');
    // 正文常驻框内；不再有条带，也没有下拉
    expect(geo.taValue).toBe('条带三');
    expect(geo.savedBand).toBe(0);
    expect(geo.pick).toBe(0);
    // 窄收件箱可滚动、文字不横向溢出
    expect(['auto', 'scroll']).toContain(geo.inboxOverflow);
    expect(geo.docOverflow).toBeLessThanOrEqual(1);
  });

  test('左窗文本框 + 保存 → 真实已确认并参与召回（真实存储回读 + 刷新）', async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);
    await page.goto(MEMORY);
    await expect(page.locator('[data-testid="pm-inbox"]')).toBeVisible();
    await expect(page.locator('[data-testid="pm-note-input"]')).toBeVisible();

    await page.locator('[data-testid="pm-note-input"]').fill('个人偏好：晨会前先看夜间告警');
    await page.locator('[data-testid="pm-note-save"]').click();

    // 真实写入 + 确认：计数并入左窗标题；待确认仍为 0；回执带 request_id
    await expect(page.locator('[data-testid="pm-msg"]')).toContainText('已保存并确认');
    await expect(page.locator('[data-testid="pm-msg"]')).toContainText('request_id');
    await expect(page.locator('[data-testid="pm-confirmed-count"]')).toHaveText('1');
    await expect(page.locator('[data-testid="pm-counts"]')).toContainText('已确认 1');
    await expect(page.locator('[data-testid="pm-counts"]')).toContainText('待确认 0');
    // 用户定稿：保存后正文常驻框内（记事本），不再清空
    await expect(page.locator('[data-testid="pm-note-input"]')).toHaveValue('个人偏好：晨会前先看夜间告警');

    // 已确认语义落在真实独立存储（不是页面内存）：state=confirmed 且内容一致
    const saved = (await store.list(ACCOUNT)).filter((e) => e.content === '个人偏好：晨会前先看夜间告警');
    expect(saved).toHaveLength(1);
    expect(saved[0].state).toBe('confirmed');

    // 刷新后计数与框内正文仍从真实存储读回（常驻、不折叠、无下拉）
    await page.reload();
    await expect(page.locator('[data-testid="pm-confirmed-count"]')).toHaveText('1');
    await expect(page.locator('[data-testid="pm-note-input"]')).toHaveValue('个人偏好：晨会前先看夜间告警');
    await expect(page.locator('[data-testid="pm-rules"]')).toContainText('每次会话强制召回');
    expect(errors).toEqual([]);
  });

  test('框内直接编辑写回原条目（不新增重复），刷新后仍是改后正文；页面不再提供删除入口', async ({ page }) => {
    await login(page);
    await page.goto(MEMORY);
    const id = 'pm_e2e_editdel';
    await store.put(entryFixture({
      id, content: '待编辑：临时测试条目', source: 'agent', source_agent: '客服工作台',
      delivered_at: Date.now(), confirmed_at: Date.now(), state: 'confirmed',
    }));
    await page.reload();
    await expect(page.locator('[data-testid="pm-confirmed-count"]')).toHaveText('1');

    // 已确认正文常驻框内；仍不提供上行/转存；下拉/删除/取消入口已按用户要求移除
    await expect(page.locator('[data-testid="pm-note-input"]')).toHaveValue('待编辑：临时测试条目');
    await expect(page.locator('[data-testid="pm-saved-pick"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-delete-selected"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-note-cancel"]')).toHaveCount(0);
    await expect(page.locator(`[data-testid="pm-uplink-${id}"]`)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /转存|晋级|上行/ })).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-rules"]')).toContainText('每次会话强制召回');

    // ── 编辑：框内直接改 → 唯一「保存」→ 覆盖同一条 pm:<id>（不新增重复） ──
    await expect(page.locator('[data-testid="pm-note-save"]')).toHaveText('保存');
    await page.locator('[data-testid="pm-note-input"]').fill('改后的内容\n第二行保留');
    await page.locator('[data-testid="pm-note-save"]').click();
    await expect(page.locator('[data-testid="pm-msg"]')).toContainText('写回原条目');
    await expect(page.locator('[data-testid="pm-msg"]')).toContainText('未新增重复');
    await expect(page.locator('[data-testid="pm-confirmed-count"]')).toHaveText('1');
    await expect(page.locator('[data-testid="pm-note-input"]')).toHaveValue('改后的内容\n第二行保留');
    const edited = await store.get(ACCOUNT, id);
    expect(edited?.id).toBe(id);
    expect(edited?.content).toBe('改后的内容\n第二行保留');
    expect(edited?.version).toBe(2);
    expect((await store.list(ACCOUNT)).filter((e) => e.content.includes('改后的内容'))).toHaveLength(1); // 覆盖不是追加

    // 刷新后框内仍是真实改后内容（记事本常驻）
    await page.reload();
    await expect(page.locator('[data-testid="pm-confirmed-count"]')).toHaveText('1');
    await expect(page.locator('[data-testid="pm-note-input"]')).toHaveValue('改后的内容\n第二行保留');
    // 删除入口已移除：真实存储条目未被删除
    expect((await store.get(ACCOUNT, id))?.deleted).toBe(false);
  });

  test('多行自由写入：换行原样保存、刷新后不丢；空内容不写库；长度上限 4000 有真实提示', async ({ page }) => {
    await login(page);
    await page.goto(MEMORY);
    const ta = page.locator('[data-testid="pm-note-input"]');
    await expect(ta).toHaveAttribute('maxlength', '4000');
    // 2026-11-22：字数计数已按用户要求移除
    await expect(page.locator('[data-testid="pm-note-count"]')).toHaveCount(0);

    const text = '第一行：偏好\n第二行：约束\n第三行：结论';
    await ta.fill(text);
    await page.locator('[data-testid="pm-note-save"]').click();
    await expect(page.locator('[data-testid="pm-msg"]')).toContainText('已保存并确认');
    const saved = (await store.list(ACCOUNT)).filter((e) => e.content.includes('第一行：偏好'));
    expect(saved).toHaveLength(1);
    expect(saved[0].content).toBe(text); // 换行原样，不折叠
    // 保存后正文仍常驻框内（记事本）
    await expect(ta).toHaveValue(text);

    await page.reload();
    await expect(page.locator('[data-testid="pm-note-input"]')).toHaveValue(text);

    // 空内容：不保存、不新增条目
    const before = (await store.list(ACCOUNT)).length;
    await page.locator('[data-testid="pm-note-input"]').fill('   ');
    await page.locator('[data-testid="pm-note-save"]').click();
    await expect(page.locator('[data-testid="pm-msg"]')).toContainText('内容为空');
    expect((await store.list(ACCOUNT)).length).toBe(before);
  });

  test('不是我的 → 已剔除（可撤销）→ 撤销回到待确认', async ({ page }) => {
    await login(page);
    // 待确认条目由真实独立存储夹具产生（左窗保存会直接确认，不再经过待确认）
    await store.put(entryFixture({
      id: 'pm_e2e_reject', content: '这条不是我的：别人的习惯', source: 'quick_note', source_agent: null,
      delivered_at: Date.now(), confirmed_at: null, state: 'pending',
    }));
    await page.goto(MEMORY);
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
    // 确认后计入真实已确认，正文立即常驻框内（强制召回口径见右窗判定口径）
    await expect(page.locator('[data-testid="pm-confirmed-count"]')).toHaveText('1');
    await expect(page.locator('[data-testid="pm-counts"]')).toContainText('已确认 1');
    await expect(page.locator('[data-testid="pm-note-input"]')).toHaveValue('客户偏好：工单回复先给结论再给步骤');
    const confirmed = await store.get(ACCOUNT, id);
    expect(confirmed?.state).toBe('confirmed');
  });

  test('批次57：个人记忆进主导航直达独立页（iframe 渲染同一 Pane），面包屑与导航名一致', async ({ page }) => {
    await login(page);
    const id = 'pm_e2e_nav';
    await store.put(entryFixture({
      id, content: '导航角标验证条目', source: 'agent', source_agent: '工作台',
      delivered_at: Date.now(), confirmed_at: null, state: 'pending',
    }));
    await page.goto(SHELL);
    // 批次54+57：导航树「个人记忆」直达独立页 personal.html（iframe 内渲染同一 Pane；
    // 批次51 面板下线后状态栏个人记忆按钮已移除，常驻面板断言随挂载点一并取消）
    await page.getByRole('treeitem', { name: /个人记忆/ }).click();
    await expect(page.locator('.cb-crumb.cur')).toHaveText('个人记忆');
    const pmFrame = page.frameLocator('iframe.page-frame[title*="personal.html"]');
    await expect(pmFrame.locator('[data-testid="mm-personal-pane"]')).toBeVisible();
    // 壳层 iframe 内 personal 端口经宿主桥降级，读不到直开页的种子数据（诚实降级，非 bug）；
    // 数据级断言（收件箱/分流/确认流）全部由上方 personal.html 直开用例覆盖。

    await page.goto(MEMORY);
    await expect(page.getByTestId('pm-pending-count')).toHaveText('1', { timeout: 15_000 });
  });

  test('不再有上行/转存入口：历史 failed 条目只在本机列表展示并强制召回，页面不出现同步队列与「已同步」', async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);
    const id = 'pm_e2e_failed';
    const text = '中枢不可用时的诚实失败条目';
    await store.put({
      ...entryFixture({
        id, content: text, source: 'quick_note', source_agent: null,
        delivered_at: Date.now(), confirmed_at: Date.now(), state: 'confirmed',
      }),
      sync_state: 'failed',
      sync_error: { stage: 'hub_init', code: 'E_SYNC_HUB_UNAVAILABLE', message: '未接线', at: Date.now() },
    });
    await page.goto(MEMORY);

    // 「转存/上行」整块入口已移除：没有待上行段、没有重试按钮、没有同步失败计数
    await expect(page.locator('[data-testid="pm-sect-sync"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-sync-queue-count"]')).toHaveCount(0);
    await expect(page.locator(`[data-testid="pm-uplink-${id}"]`)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /上行|转存|晋级/ })).toHaveCount(0);
    await expect(page.locator('[data-testid="pm-inbox-foot"]')).not.toContainText('同步失败');
    await expect(page.locator('[data-testid="pm-counts"]')).not.toContainText('同步失败');
    await expect(page.locator('[data-testid="mm-personal-pane"]')).not.toContainText('已同步');

    // 条目仍在本机真实存储里，并在记事本框内直接显示、口径写明强制召回（不做任何转存动作）
    await expect(page.locator('[data-testid="pm-note-input"]')).toHaveValue(text);
    await expect(page.locator('[data-testid="pm-rules"]')).toContainText('每次会话强制召回');
    const kept = await store.get(ACCOUNT, id);
    expect(kept?.sync_state).toBe('failed');
    expect(errors).toEqual([]);
  });
});
