// REQ-005 T12 端到端验收（真浏览器点击级，对齐 HOME-LOGIN.md T12 验收清单）
// 覆盖：① 首屏未登录灰置不阻塞 ② ▶ 登录 弹卡 ③ 密码错 → 锁定 + 审计（断言打到真实后端）
//       ④ 登录成功 → 顶栏变已登录 + 功劳 4 卡出数据 ⑤ .rid 溯源弹审计 modal ⑥ 登出回灰置 ⑦ 无脚本异常
// 被测对象 = Vite 构建产物（dist/home.html），登录走 T11 后端镜像（useLoginMirror，?backend= 覆盖）。
// 后端 = T10 home server（src/home/server.ts），E2E 进程内起服并预置测试账号。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { hashPassword } from '../src/auth/hash.ts';

const PWD = 'e2e_pwd';

let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let BACKEND_PORT = 0;
let APP = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用

  const dataFile = join(tmpdir(), `e2e-home-${Date.now()}.json`);
  // 预置测试账号（T3 registerAccount，团队只读 team_id 由"管理员"分配）
  const { registerAccount } = await import('../src/home/server.ts');
  registerAccount('e2e_user', hashPassword(PWD), { enterprise_id: 'ent_001', team_id: 'team_001', perspective: 'team' });
  registerAccount('e2e_lock', hashPassword(PWD), { enterprise_id: 'ent_002', team_id: 'team_002', perspective: 'team' });
  registerAccount('e2e_lock2', hashPassword(PWD), { enterprise_id: 'ent_003', team_id: 'team_003', perspective: 'team' });

  backend = await startHomeBackend({ dataFile, allowedOrigins: [`http://localhost:${staticSrv.port}`] });
  BACKEND_PORT = backend.port;
  APP = `http://localhost:${staticSrv.port}/index.html?backend=http://localhost:${BACKEND_PORT}`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('REQ-005 首页与登录卡片 · 点击级 E2E', () => {
  test('① 首屏进入不阻塞登录（未登录显示登录门控）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    // 未登录：欢迎语 + ▶ 登录 可见；登录门控遮罩替代仪表盘
    await expect(page.locator('#hiUnauth')).toBeVisible();
    await expect(page.locator('#btnOpenLogin')).toBeVisible();
    await expect(page.locator('#authGate')).toBeVisible();
    // 已登录态元素不应出现（不阻塞、不预载）
    await expect(page.locator('#hiAuth')).toHaveCount(0);
    await expect(page.locator('#dashGrid')).toHaveCount(0);
    // 程序运行日志窗口已迁至日志记录页（批次19）：首页不再渲染
    await expect(page.locator('#programLog')).toHaveCount(0);
    // 未登录启动会触发 mirror 查询 → 服务端如实 401；这是预期状态，不得弹「镜像上抛失败」全局提示
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('mirror-failure-notice')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('② ▶ 登录 弹卡', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await page.click('#btnOpenLogin');
    await expect(page.locator('#loginModal.show')).toBeVisible();
    await expect(page.locator('#acc')).toBeVisible();
    await expect(page.locator('#pwd')).toBeVisible();
    // 端形态 / 团队 只读（无输入控件，仅展示）
    await expect(page.locator('#rowForm .pill')).toContainText('自动识别');
    await expect(page.locator('#rowTeam .pill')).toContainText('只读');
    expect(errors).toEqual([]);
  });

  test('③ 密码错 → 锁定 + 审计（断言确实打到真实后端）', async ({ page }) => {
    const errors = collectErrors(page);
    const calls: string[] = [];
    page.on('request', (r) => { if (r.url().includes(`:${BACKEND_PORT}`)) calls.push(`${r.method()} ${r.url()}`); });

    await page.goto(APP);
    await page.click('#btnOpenLogin');
    await page.fill('#acc', 'e2e_lock');
    await page.fill('#pwd', 'wrong-password');
    await page.click('#btnLogin');

    // 真实后端确实被调用（T11 镜像写审计 action=login_fail）
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.includes('/api/login'))).toBeTruthy();

    // 后端锁定策略生效：连续 6 次错 → 第 6 次 423 Locked（e2e_lock2 独立账号，恰好 6 次）
    const sixth = await page.evaluate(async (port) => {
      const body = { account: 'e2e_lock2', password: 'wrong', form: 'desktop' };
      let last = 0;
      for (let i = 0; i < 6; i++) {
        const r = await fetch(`http://localhost:${port}/api/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        last = r.status;
      }
      return last;
    }, BACKEND_PORT);
    expect(sixth).toBe(423);
    expect(errors).toEqual([]);
  });

  test('④ 登录成功 → 顶栏变已登录 + 四卡为内核账本实时指标（打到真实后端）', async ({ page }) => {
    const errors = collectErrors(page);
    const calls: string[] = [];
    page.on('request', (r) => { if (r.url().includes(`:${BACKEND_PORT}`)) calls.push(`${r.method()} ${r.url()}`); });

    await page.goto(APP);
    await page.click('#btnOpenLogin');
    await page.fill('#acc', 'e2e_user');
    await page.fill('#pwd', PWD);
    await page.click('#btnLogin');

    // 顶栏变已登录（后端 team_id 只读注入）
    await expect(page.locator('#hiAuth')).toContainText('e2e_user');
    await expect(page.locator('#hiAuth')).toContainText('team_001');
    await expect(page.locator('#hiAuth')).toContainText('只读');
    // 四卡为内核账本实时指标（累计记忆 / 累计动作 / 近 1h 调用 / 待裁决），无示例假文案
    await expect(page.locator('#gains .gain')).toHaveCount(4);
    await expect(page.locator('#gains')).toContainText('累计记忆');
    await expect(page.locator('#gains')).toContainText('累计动作');
    await expect(page.locator('#gains')).toContainText('内核账本');
    await expect(page.locator('#gains')).not.toContainText('-58%');
    // 批次23：效果证据四卡（Token 节省 / 效率提升 / 跨 Agent 复用 / 模型成本）在关系图谱上方
    await expect(page.locator('#effectEvidence #effectGains > .gain')).toHaveCount(4);
    await expect(page.locator('#effectEvidence')).toContainText('效果证据');
    const effectBox = await page.locator('#effectEvidence').boundingBox();
    const graphBox = await page.locator('#layerGraph').boundingBox();
    expect(effectBox && graphBox && effectBox.y < graphBox.y).toBeTruthy();
    // 灰置占位消失
    await expect(page.locator('#offPlaceholder')).toHaveCount(0);
    // 真实后端确实被调用（T11 镜像登录）
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.includes('/api/login'))).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('⑤ 数字可点溯源 request_id（弹审计 modal，真实 mirror 账本）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);

    // 真实会话：mirror 账本绑定会话（匿名 POST 会如实 401），故先登录拿到权威 session_id
    await page.click('#btnOpenLogin');
    await page.fill('#acc', 'e2e_user');
    await page.fill('#pwd', PWD);
    await page.click('#btnLogin');
    await expect(page.locator('#hiAuth')).toContainText('e2e_user');

    const sid = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(sid).toBeTruthy();

    // 以真实会话向 home server 镜像上抛一条真实 recall 审计（evidence_thin），作为可溯源真实条目
    const posted = await page.evaluate(async ({ port, sessionId }) => {
      const r = await fetch(`http://localhost:${port}/api/mirror/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body: JSON.stringify({ source: 'e2e', action: 'recall', request_id: 'e2e_real_1', payload: { query: 'e2e', evidence_thin: true } }),
      });
      return r.status;
    }, { port: BACKEND_PORT, sessionId: sid as string });
    expect(posted).toBe(200);

    // 重新进入应用（会话仍在）→ 触发真实 feed 聚合（含 mirror 兜底源）→ 异常区出现该 request_id 的 .rid
    await page.goto(APP);
    await expect(page.locator('#hiAuth')).toContainText('e2e_user');

    // 点击异常区的 .rid → 弹审计 modal（显示真实 request_id）
    await expect(page.locator('#dashGrid .rid').first()).toBeVisible();
    await page.click('#dashGrid .rid');
    await expect(page.locator('#auditModal')).toBeVisible();
    await expect(page.locator('#auditRid')).toContainText('e2e_real_1');
    expect(errors).toEqual([]);
  });

  test('⑥ 登出 → 回灰置', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await page.click('#btnOpenLogin');
    await page.fill('#acc', 'e2e_user');
    await page.fill('#pwd', PWD);
    await page.click('#btnLogin');
    await expect(page.locator('#hiAuth')).toContainText('e2e_user');

    await page.click('#btnLogout');
    // 回未登录门控态
    await expect(page.locator('#hiUnauth')).toBeVisible();
    await expect(page.locator('#authGate')).toBeVisible();
    await expect(page.locator('#hiAuth')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('⑦ L1–L6 关系图谱：真实空态 + 六层筛选 + 缩放/复位', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await page.click('#btnOpenLogin');
    await page.fill('#acc', 'e2e_user');
    await page.fill('#pwd', PWD);
    await page.click('#btnLogin');
    await expect(page.locator('#hiAuth')).toContainText('e2e_user');

    // 图谱卡片 + 六层锚点（E2E 浏览器账本为空 → 诚实空态，不出现演示节点）
    const graph = page.locator('#layerGraph');
    await expect(graph).toBeVisible();
    await expect(graph).toContainText('L1–L6 关系图谱');
    await expect(page.locator('[data-graph-hub]')).toHaveCount(6);
    for (const layer of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) {
      await expect(page.locator(`#lgChip${layer}`)).toBeVisible();
    }
    await expect(page.locator('#lgEmpty')).toBeVisible();
    await expect(graph).toContainText('无演示节点');

    // 缩放/复位真实改变画布变换
    await expect(page.locator('#lgZoomValue')).toHaveText('100%');
    await page.click('#lgZoomIn');
    await expect(page.locator('#lgZoomValue')).toHaveText('120%');
    await expect(page.locator('#layerGraphSvg')).toHaveAttribute('data-zoom', '1.20');
    await page.click('#lgZoomReset');
    await expect(page.locator('#lgZoomValue')).toHaveText('100%');

    // 刷新：重新聚合真实账本后按钮恢复可用
    await page.click('#lgRefresh');
    await expect(page.locator('#lgRefresh')).toBeEnabled();
    expect(errors).toEqual([]);
  });
});
