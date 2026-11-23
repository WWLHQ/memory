// REQ-005 首页与登录 · 端到端验收（真浏览器点击级）
// 现行结构（旧首页 HomePage/LoginModal 已下线，首页换 OverviewPage、登录独立成 login.html）：
//   ① 首屏不阻塞：index.html 直接渲染概览页（真实账本读数），无登录门控遮罩
//   ② 登录入口：首页不再弹登录卡，登录在 login.html（无注册入口）
//   ③ 密码错 → 后端真实 401；连续 6 次 → 423（直连真实后端）
//   ④ 登录成功 → 会话落本机 + 概览页页脚「已登录」+ 效果证据四卡（真实账本聚合）
//   ⑤ request_id 溯源：旧 `.rid` 审计弹窗已迁至审计页链路视图（audit.html?chain=），未命中如实「账本无链路」
//   ⑥ 登出 → 清本机会话 → 概览页回「未登录 · 只读」
//   ⑦ L1–L6 层级图谱：批次57-B 首页改挂 Stratum A 图谱（.af-graph，六枢纽由真实账本派生，空账本计数 0），
//      旧 Dashboard 的 #layerGraph/[data-graph-hub] DOM 不复活；真实分层界面仍在 memory-layered.html
// 后端 = home server（src/home/server.ts），E2E 进程内起服并预置测试账号。
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, startHomeBackend, closeServer, type StaticServer } from './servers.ts';
import { registerAccount } from '../src/home/server.ts';
import { hashPassword } from '../src/auth/hash.ts';
import type { Page } from 'playwright-core';

const PWD = 'e2e_pwd';

let staticSrv: StaticServer | undefined;
let backend: Awaited<ReturnType<typeof startHomeBackend>> | undefined;
let BACKEND_PORT = 0;
let HOME = '';
let LOGIN = '';
let AUDIT = '';
let LAYERED = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用

  const dataFile = join(tmpdir(), `e2e-home-${Date.now()}.json`);
  // 预置测试账号（T3 registerAccount，团队只读 team_id 由"管理员"分配）
  registerAccount('e2e_user', hashPassword(PWD), { enterprise_id: 'ent_001', team_id: 'team_001', perspective: 'team' });
  registerAccount('e2e_lock', hashPassword(PWD), { enterprise_id: 'ent_002', team_id: 'team_002', perspective: 'team' });
  registerAccount('e2e_lock2', hashPassword(PWD), { enterprise_id: 'ent_003', team_id: 'team_003', perspective: 'team' });

  backend = await startHomeBackend({ dataFile, allowedOrigins: [`http://localhost:${staticSrv.port}`] });
  BACKEND_PORT = backend.port;
  const q = `backend=http://localhost:${BACKEND_PORT}`;
  HOME = `http://localhost:${staticSrv.port}/index.html?${q}`;
  LOGIN = `http://localhost:${staticSrv.port}/login.html?${q}`;
  AUDIT = `http://localhost:${staticSrv.port}/audit.html`;
  LAYERED = `http://localhost:${staticSrv.port}/memory-layered.html`;
});

test.afterAll(async () => {
  await closeServer(backend?.server);
  await staticSrv?.stop();
  await disconnectBrowser();
});

async function login(page: Page, account = 'e2e_user', pwd = PWD): Promise<void> {
  await page.goto(LOGIN);
  await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
  await page.locator('#loginAccount').fill(account);
  await page.locator('#loginPassword').fill(pwd);
  await page.getByRole('button', { name: /^登录$/ }).click();
}

test.describe('REQ-005 首页与登录 · 点击级 E2E', () => {
  test('① 首屏进入不阻塞登录（概览页直接出真实读数，无门控遮罩）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(HOME);
    await expect(page.locator('[data-testid="overview-page"]')).toBeVisible();
    // 标题 + 效果证据四卡（真实账本聚合；浏览器空账本显示「未取数」，不伪造）
    await expect(page.locator('.af-head h1')).toContainText('总览工作台');
    await expect(page.locator('.af-g4 .af-stat')).toHaveCount(4);
    // 页脚只留审计行 + 数据来源；HTTP/端口/登录串已整组移到壳层状态栏最右（图3），页面内不再有第二份
    await expect(page.locator('.af-foot')).toContainText('audit.jsonl');
    await expect(page.locator('[data-testid="overview-foot-source"]')).toContainText('数据来源');
    await expect(page.locator('.af-foot')).not.toContainText('HTTP');
    await expect(page.locator('.af-foot')).not.toContainText('home :');
    await expect(page.locator('[data-testid="overview-health"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="overview-foot-right"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="sb-endpoints"]')).toHaveCount(0);
    // 未登录仍可读本地账本（诚实口径），并给出「去登录」快捷入口
    await expect(page.getByRole('button', { name: '去登录' })).toBeVisible();
    // 旧首页的门控遮罩 / 仪表盘 / 程序日志窗已随旧首页下线
    await expect(page.locator('#authGate')).toHaveCount(0);
    await expect(page.locator('#dashGrid')).toHaveCount(0);
    await expect(page.locator('#programLog')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('①b 写密钥锁状态：浏览器无桌面壳时如实标注「状态未取到」，不冒充已解锁、也不误报未解锁', async ({ page }) => {
    const errors = collectErrors(page);
    // 写锁提示只在登录后出现（2026-11-16：未登录先引导登录，不提前催解锁）
    await login(page);
    await page.goto(HOME);
    await expect(page.locator('[data-testid="overview-page"]')).toBeVisible();
    // 常驻醒目条只在真实读到「未解锁」时出现；读不到时给诚实标注
    await expect(page.locator('[data-testid="home-l0-lock-alert"]')).toHaveCount(0);
    const unknown = page.locator('[data-testid="home-l0-lock-unknown"]');
    await expect(unknown).toBeVisible();
    await expect(unknown).toContainText('不能据此判断已解锁');
    // 2026-11-22：启动读不到写锁时只做中性标注，不再要求用户「点重读」才继续
    await expect(unknown).not.toContainText('重读');
    await expect(unknown.locator('button')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('①c 写锁变化信号：收到信号即重读真实锁状态（解锁后红条不再常驻）', async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);
    await page.goto(HOME);
    await expect(page.locator('[data-testid="overview-page"]')).toBeVisible();

    // 统计首页对真实后端的健康探测次数：首页每次 reload 都会重新取数，
    // 因此「收到写锁信号 → 重新取数」可以用请求次数客观观测（不依赖 DOM 细节）。
    let healthCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/health')) healthCalls += 1;
    });
    const before = healthCalls;

    // 模拟安全页解锁写密钥后广播的同源信号。
    // ⚠️ storage 事件只在「其它」同源文档触发（同文档 setItem 不会收到事件），
    //    因此这里用另一个标签页写入信号，模拟真实的跨页通知。
    const other = await page.context().newPage();
    await other.goto(HOME);
    await other.evaluate(() => {
      localStorage.setItem('memdesk.l0.writeLockSignal.v1', String(Date.now()));
    });

    // 首页应因信号自动重读（重读 → 重新取 l0Status → 红条随之消失/更新）
    const deadline = Date.now() + 15_000;
    while (healthCalls <= before && Date.now() < deadline) {
      await page.waitForTimeout(200);
    }
    expect(healthCalls, '收到写锁信号后首页未自动重读真实状态').toBeGreaterThan(before);

    // 重读后状态仍以真实读数为准：浏览器模式读不到锁状态 → 诚实标注，绝不误报已解锁
    await expect(page.locator('[data-testid="home-l0-lock-unknown"]')).toBeVisible();
    expect(errors).toEqual([]);
    await other.close();
  });

  test('② 登录入口：首页不再弹登录卡，登录走独立 login.html（且无注册入口）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(HOME);
    await expect(page.locator('#loginModal')).toHaveCount(0);
    await expect(page.locator('#btnOpenLogin')).toHaveCount(0);

    await page.goto(LOGIN);
    await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
    await expect(page.locator('#loginAccount')).toBeVisible();
    await expect(page.locator('#loginPassword')).toBeVisible();
    await expect(page.getByRole('button', { name: /^登录$/ })).toBeVisible();
    // 诚实态：注册表单随旧首页 LoginModal 下线（注册能力在 home 后端，见 register.spec）
    await expect(page.locator('#btnRegister')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('③ 密码错 → 后端真实 401；连续 6 次 → 423 锁定', async ({ page }) => {
    const errors = collectErrors(page);
    const calls: string[] = [];
    page.on('request', (r) => { if (r.url().includes(`:${BACKEND_PORT}`)) calls.push(`${r.method()} ${r.url()}`); });

    await login(page, 'e2e_lock', 'wrong-password');
    // 真实后端确实被调用（T11 镜像写审计 action=login_fail）
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.includes('/api/login'))).toBeTruthy();
    // 登录页按后端真实原因提示（401 密码错误）
    await expect(page.locator('[data-testid="login-error"]')).toContainText('HTTP 401');
    await expect(page.locator('[data-testid="login-error"]')).toContainText('密码错误');

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

  test('④ 登录成功 → 会话落本机 + 概览页「已登录」+ 四卡为真实账本指标', async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);
    await expect(page.locator('[data-testid="login-session-valid"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="login-session-valid"]')).toContainText('e2e_user');
    await expect(page.locator('[data-testid="login-session-valid"]')).toContainText('team_001');

    const sid = await page.evaluate(() => localStorage.getItem('session:realpage'));
    expect(sid).toBeTruthy();

    // 概览页读同一份会话：不再显示「去登录」（登录态文字已随图3 统一移到壳层状态栏，见 shell.spec ⑰）
    await page.goto(HOME);
    await expect(page.getByRole('button', { name: '去登录' })).toHaveCount(0);
    // 效果四卡为真实账本聚合（空账本 = 未取数，不伪造演示数字）；今日数字在「今日概览」列表（批次57-C 定稿版式）
    await expect(page.locator('.af-g4 .af-stat')).toHaveCount(4);
    await expect(page.locator('[data-testid="home-today"]')).toContainText('写入');
    await expect(page.locator('[data-testid="home-today"]')).toContainText('召回');
    await expect(page.locator('[data-testid="home-today"]')).toContainText('嫁接');
    await expect(page.locator('[data-testid="home-today"]')).toContainText('过滤');
    // 空账本今日写入 = 0（真实读数，不拿演示数冒充）
    await expect(page.locator('[data-testid="home-today"] .af-li .rt').first()).toContainText('0');
    await expect(page.locator('[data-testid="overview-page"]')).not.toContainText('-58%');
    expect(errors).toEqual([]);
  });

  test('⑤ request_id 溯源：审计页链路视图真查账本，未命中如实「账本无链路」', async ({ page }) => {
    const errors = collectErrors(page);
    // 旧首页的 `.rid` + 审计弹窗已下线（功能迁至审计页链路视图）；如实确认现行首页无该弹窗
    await page.goto(HOME);
    await expect(page.locator('#auditModal')).toHaveCount(0);
    await expect(page.locator('#auditRid')).toHaveCount(0);

    // 审计页按 ?chain= 真查内核账本：该 id 不存在 → 5 段链路全为「账本无链路」，不补造证据
    await page.goto(`${AUDIT}?chain=e2e_real_1`);
    await expect(page.locator('[data-testid="audit-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="chain-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="chain-view"]')).toContainText('e2e_real_1');
    await expect(page.locator('[data-testid="chain-view"]')).toContainText('共 0 行真实审计');
    await expect(page.locator('[data-testid="chain-view"]')).toContainText('账本无链路');
    await expect(page.locator('[data-testid="chain-view"]')).not.toContainText('模拟');
    await expect(page.locator('tr[data-testid^="row-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="clear-chain"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('⑥ 登出 → 清本机会话 → 概览页回「未登录 · 只读」', async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);
    await expect(page.locator('[data-testid="login-session-valid"]')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /登出（清除本机会话）/ }).click();
    await expect(page.locator('#loginAccount')).toBeVisible();
    await expect(page.locator('[data-testid="login-session-valid"]')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('session:realpage'))).toBeFalsy();

    await page.goto(HOME);
    // 登录态文字已统一到壳层状态栏；概览页只保留「去登录」入口的显隐
    await expect(page.getByRole('button', { name: '去登录' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('⑦ L1–L6 图谱：首页挂 Stratum A 图谱（真实派生），旧 Dashboard DOM 不复活；分层界面在 memory-layered.html', async ({ page }) => {
    const errors = collectErrors(page);
    // 旧 `#layerGraph` 及其六层锚点/缩放控件随 Dashboard 下线，不复活
    await page.goto(HOME);
    await expect(page.locator('#layerGraph')).toHaveCount(0);
    await expect(page.locator('[data-graph-hub]')).toHaveCount(0);
    await expect(page.locator('#lgZoomValue')).toHaveCount(0);
    // 批次57-B：首页新挂 A 版式图谱，六枢纽由真实账本派生（空账本计数 0，不伪造节点）
    await expect(page.locator('.af-graph')).toBeVisible();
    await expect(page.locator('.af-graph .af-hub')).toHaveCount(6);
    await expect(page.locator('.af-graph .af-core-n')).toContainText('0');

    // 真实分层界面：L6→L1 层明细由账本派生；空账本如实空态（无明细块、语义卡计数全 0）
    await page.goto(LAYERED);
    await expect(page.locator('[data-testid="layered-memory-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="memory-empty"]')).toContainText('记忆账本还是空的');
    // 空账本不得出现任何层明细块（L6→L1 明细 + L0 解锁块）；[data-layer] 还包含固定语义说明卡，
    // 所以按明细容器精确断言，并逐卡要求「有内容 0 条」——比旧的全局 [data-layer]=0 更严格。
    await expect(page.locator('#layer-block-L6, #layer-block-L5, #layer-block-L4, #layer-block-L3, #layer-block-L2, #layer-block-L1')).toHaveCount(0);
    await expect(page.locator('[data-testid="l0-stack"] [data-layer]')).toHaveCount(0);
    for (const L of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) {
      await expect(page.locator(`[data-testid="layer-card-${L}"]`)).toContainText('有内容 0 条');
    }
    await expect(page.locator('[data-testid="layered-memory-page"]')).toContainText('L6→L1');
    expect(errors).toEqual([]);
  });

  test('⑧ 批次57-D：壳层中心区实宽（≈702px）下双栏保持并排，遥测右栏不再塌到图谱下方', async ({ page }) => {
    const errors = collectErrors(page);
    // 桌面壳默认 1280×860 窗 − 250 导航栏 − 318 检查器 − 10 分条 ≈ 702px 中心 iframe 宽
    await page.setViewportSize({ width: 702, height: 860 });
    await page.goto(HOME);
    await expect(page.locator('.af-head h1')).toContainText('总览工作台');
    // 双栏：1fr + 264px（中段收窄），不是塌成单列
    const cols = await page.locator('.af-cols').evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    const parts = cols.split(' ').filter(Boolean);
    expect(parts.length).toBe(2);
    expect(Math.abs(Number.parseFloat(parts[1]) - 264)).toBeLessThan(2);
    // 图谱高度随宽度按 760/352 比例缩放（窄栏不再出现固定 330px 下的巨幅空白）
    const graph = await page.locator('.af-graph').boundingBox();
    expect(graph).toBeTruthy();
    expect(graph!.height).toBeLessThan(330);
    expect(graph!.height).toBeGreaterThan(120);
    expect(errors).toEqual([]);
  });

  test('⑨ 关系图谱：L6 居中汇聚、L1–L5 环绕，五条箭头均指向 L6，筛选仍真实生效', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(HOME);
    const svg = page.locator('.af-graph');
    await expect(svg).toBeVisible();
    // 六层枢纽仍在（L1–L5 环上 + L6 中心），账本核总数仍读真实 stats.total
    await expect(svg.locator('.af-hub')).toHaveCount(6);
    await expect(svg.locator('.af-hub-core')).toHaveCount(1);

    const box = await svg.boundingBox();
    const core = await svg.locator('.af-hub-core').boundingBox();
    expect(box && core).toBeTruthy();
    const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    expect(Math.abs(core!.x + core!.width / 2 - center.x)).toBeLessThan(2);
    expect(Math.abs(core!.y + core!.height / 2 - center.y)).toBeLessThan(2);

    // L6 明显大于外围层枢（尺寸区分，颜色/光晕由样式承担）
    const ring = await svg.locator('[data-graph-layer="L1"] .af-hub').boundingBox();
    expect(ring).toBeTruthy();
    expect(core!.width).toBeGreaterThan(ring!.width * 1.5);

    // 五条辐条：全部带箭头，且终点（L6 外沿）比起点更靠近中心 → 箭头朝 L6
    const spokes = svg.locator('line.af-spoke');
    await expect(spokes).toHaveCount(5);
    for (let i = 0; i < 5; i += 1) {
      const spoke = spokes.nth(i);
      await expect(spoke).toHaveAttribute('marker-end', 'url(#af-arrow)');
      const g = await spoke.evaluate((el) => {
        const l = el as SVGLineElement;
        return {
          x1: Number(l.getAttribute('x1')), y1: Number(l.getAttribute('y1')),
          x2: Number(l.getAttribute('x2')), y2: Number(l.getAttribute('y2')),
        };
      });
      const far = Math.hypot(g.x1 - 380, g.y1 - 176);
      const near = Math.hypot(g.x2 - 380, g.y2 - 176);
      expect(near).toBeLessThan(far);
      expect(near).toBeLessThan(60);
    }

    // 筛选（全部 / L2 / L3 / L4+）仍是真实过滤：非聚焦层变暗，其余四层被置暗
    await page.locator('.af-chip').filter({ hasText: /^L2$/ }).click();
    await expect(svg.locator('.af-hub-g.off')).toHaveCount(4);
    await page.locator('.af-chip').filter({ hasText: /^全部$/ }).click();
    await expect(svg.locator('.af-hub-g.off')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('⑨b 环向箭头：L1→L2 / L2→L3 / L3→L4 / L4→L5 四条，方向沿环顺序且贴轨道', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(HOME);
    const svg = page.locator('.af-graph');
    await expect(svg).toBeVisible();

    // 只补外圈相邻层的四条环向箭头；L5→L1 / L5→L6 不新增，避免与指向 L6 的辐条混淆
    const arcs = svg.locator('path.af-ring-arc');
    await expect(arcs).toHaveCount(4);
    const ids = await arcs.evaluateAll((els) => els.map((e) => e.getAttribute('data-graph-ring')));
    expect(ids).toEqual(['L1-L2', 'L2-L3', 'L3-L4', 'L4-L5']);

    const ring = ['L1', 'L2', 'L3', 'L4', 'L5'];
    const hub = (layer: string) => {
      const i = ring.indexOf(layer);
      const rad = (-90 + i * 72) * (Math.PI / 180);
      return { x: 380 + 286 * Math.cos(rad), y: 176 + 122 * Math.sin(rad) };
    };
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

    for (let i = 0; i < 4; i += 1) {
      const arc = arcs.nth(i);
      const id = `L${i + 1}-L${i + 2}`;
      const [from, to] = id.split('-');
      // 箭头端点 = 目标层（方向沿环顺序）；箭头色/标记也落在目标层
      await expect(arc).toHaveAttribute('marker-end', `url(#af-ring-arrow-${to})`);
      const d = (await arc.getAttribute('d')) ?? '';
      // 椭圆弧（rx=286 / ry=122）+ sweep=1 = 顺时针，即 L1→L2→L3→L4→L5 的环序
      expect(d).toContain('A 286 122 0 0 1');
      const m = d.match(/^M ([\d.]+) ([\d.]+) A [\d.]+ [\d.]+ [\d.]+ [\d.]+ [\d.]+ ([\d.]+) ([\d.]+)$/);
      expect(m, `弧路径格式不符：${d}`).toBeTruthy();
      const s = { x: Number(m![1]), y: Number(m![2]) };
      const e = { x: Number(m![3]), y: Number(m![4]) };
      expect(dist(s, hub(from)), `${id} 起点未贴近 ${from}`).toBeLessThan(dist(s, hub(to)));
      expect(dist(e, hub(to)), `${id} 终点未贴近 ${to}（方向应沿环顺序）`).toBeLessThan(dist(e, hub(from)));
    }

    // 原配色不变：环向箭头沿用的仍是目标层主题令牌（L2..L5）
    for (let i = 0; i < 4; i += 1) {
      await expect(arcs.nth(i)).toHaveAttribute('stroke', `var(--c-l${i + 2})`);
    }
    expect(errors).toEqual([]);
  });

  test('⑩ 概览页页脚不再持有 HTTP/端口串（全应用唯一一份在壳层状态栏最右，见 shell.spec ⑰）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(HOME);
    await expect(page.locator('[data-testid="overview-page"]')).toBeVisible();

    const foot = page.locator('.af-foot');
    await expect(foot).toContainText('audit.jsonl');
    await expect(page.locator('[data-testid="overview-foot-source"]')).toContainText('数据来源');
    // 端口 / HTTP 状态 / 登录串一律不在这里出现
    await expect(foot).not.toContainText('HTTP');
    await expect(foot).not.toContainText('home :');
    await expect(foot).not.toContainText('onboard :');
    await expect(foot).not.toContainText('mcp :');
    await expect(foot).not.toContainText('webhook :');
    await expect(page.locator('[data-testid="overview-health"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="overview-foot-right"]')).toHaveCount(0);
    // 独立概览页里也不应出现壳层状态栏的那一份（唯一实例只在壳层）
    await expect(page.locator('[data-testid="sb-endpoints"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
