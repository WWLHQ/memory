// E2E 测试：审计日志页（REQ-006 / P11）自包含：静态服务（系统分配端口）serving dist/audit.html。
// 数据真相 = 内核审计账本（浏览器为进程内单例）：未产生审计 → 空态行，不伪造种子记录。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { ADMIN_ACCOUNT, DEFAULT_ADMIN_PASSWORD } from '../src/auth/loginService.ts';

let APP = '';
let APP_BACKEND = '';
let staticSrv: StaticServer | undefined;
let homeBackend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let ADMIN_SID = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/audit.html`;
  // 倒序分页用例需要真实可 seed 的账本：起一个独立 home 后端，经 /api/kernel/invoke 写入真实审计记录。
  homeBackend = await startHomeBackend({
    dataFile: join(tmpdir(), `e2e-audit-${Date.now()}.json`),
    allowedOrigins: [`http://localhost:${staticSrv.port}`],
  });
  const login = await fetch(`http://localhost:${homeBackend.port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: ADMIN_ACCOUNT, password: DEFAULT_ADMIN_PASSWORD, form: 'desktop' }),
  });
  const body = (await login.json()) as { sessionId?: string };
  if (!body.sessionId) throw new Error(`audit spec admin login failed: ${login.status}`);
  ADMIN_SID = body.sessionId;
  APP_BACKEND = `http://localhost:${staticSrv.port}/audit.html?backend=${encodeURIComponent(`http://localhost:${homeBackend.port}`)}`;
});

test.afterAll(async () => {
  await closeServer(homeBackend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('审计日志页 · 真实账本', () => {
  test('空账本：表结构渲染 + 空态行，无种子记录', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="audit-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="audit-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="audit-table"] tbody')).toContainText('无匹配审计记录');
    await expect(page.locator('tr[data-testid^="row-"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('过滤 → 查询仍为空（真实账本无匹配）', async ({ page }) => {
    await page.goto(APP);
    await page.locator('[data-testid="f-action"]').selectOption('write');
    await page.locator('[data-testid="query"]').click();
    await expect(page.locator('tr[data-testid^="row-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="audit-table"] tbody')).toContainText('无匹配审计记录');
    // 重置后仍为空态（未产生任何真实审计）
    await page.locator('[data-testid="reset"]').click();
    await expect(page.locator('[data-testid="audit-table"] tbody')).toContainText('无匹配审计记录');
  });

  test('空账本无可点击的 request_id 链路', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid^="rid-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="clear-chain"]')).toHaveCount(0);
  });

  test('导出按钮存在（空集也可导出）', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="export-csv"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-json"]')).toBeVisible();
  });

  test('事件流按时间倒序后分页：第 1 页最新在前，翻页承接更早记录', async ({ page }) => {
    // 真实账本 seed：12 条 recall 审计，request_id 序号越大越早（ts = now − i 分钟）
    const now = Date.now();
    for (let i = 0; i < 12; i += 1) {
      const res = await fetch(`http://localhost:${homeBackend!.port}/api/kernel/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': ADMIN_SID },
        body: JSON.stringify({
          method: 'appendAudit',
          args: [{
            request_id: `e2e_ord_${i}`,
            action: 'recall',
            ts: now - i * 60_000,
            detail: { hits: 1, payload_tokens: 300, message: `第${i}条（序号越大越早）` },
          }],
        }),
      });
      expect(res.ok).toBe(true);
    }

    await page.addInitScript(([sid]) => localStorage.setItem('session:realpage', sid as string), [ADMIN_SID]);
    await page.goto(APP_BACKEND);
    await expect(page.locator('[data-testid="audit-page"]')).toBeVisible();

    // 默认每页 10 条：第 1 页最新 10 条，首行 = 序号 0（最新），末行 = 序号 9
    await expect(page.locator('tr[data-testid^="row-"]')).toHaveCount(10);
    await expect(page.locator('tr[data-testid^="row-"]').first()).toContainText('第0条');
    await expect(page.locator('tr[data-testid^="row-"]').last()).toContainText('第9条');
    await expect(page.locator('[data-testid="audit-tblft"]')).toContainText('按时间倒序');

    // 第 2 页承接更早的 2 条（序号 10、11），顺序仍为倒序
    await page.locator('[data-testid="pg-next"]').click();
    await expect(page.locator('tr[data-testid^="row-"]')).toHaveCount(2);
    await expect(page.locator('tr[data-testid^="row-"]').first()).toContainText('第10条');
    await expect(page.locator('tr[data-testid^="row-"]').last()).toContainText('第11条');
    await expect(page.locator('[data-testid="pg-info"]')).toContainText('第 2 / 2 页');
  });
});
