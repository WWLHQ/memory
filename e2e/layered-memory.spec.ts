// 记忆层级管理页 E2E（REQ-006 / P8 · 19.11）
// 自包含模式：自带静态服务（系统分配端口）serving dist/layered.html。
// 该页为独立入口（无登录门控）；审计上抛真接 /api/mirror/audit，未起 home 后端时失败提示可见但不影响页面数据。
// 注：种子数据已移除（见需求：真实账本无演示数据），测试覆盖空态渲染 + L0 授权结构。
// 纯浏览器无 home 会话/主进程密钥环：L0 输入不渲染、写入不可用，页面如实降级（批次9 起）。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist'); // 端口 0：不与桌面服务/其它 spec 争用
  APP = `http://localhost:${staticSrv.port}/memory-layered.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('记忆层级管理页', () => {
  test('空账本渲染空态提示，L0 授权框可见，无脚本异常', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="layered-memory-page"]')).toBeVisible();
    // 无种子数据 → 空态文案出现
    await expect(page.locator('[data-testid="memory-empty"]')).toBeVisible();
    // 跳转写入页按钮存在
    await expect(page.locator('[data-testid="goto-write"]')).toBeVisible();
    // L0 授权框始终可见（即使空账本）
    await expect(page.locator('[data-testid="l0-bar"]')).toBeVisible();
    // L0 内容卡不存在（不是隐藏，是不渲染）
    await expect(page.locator('.layer[data-layer="L0"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('未登录：L0 授权框只读提示，不渲染密码/grant 输入（不伪造身份）', async ({ page }) => {
    await page.goto(APP);
    // L0 授权框始终可见
    await expect(page.locator('[data-testid="l0-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="l0-bar"]')).toContainText('未登录 · 登录后生效');
    await expect(page.locator('[data-testid="l0-bar"]')).toContainText('已锁定');
    // 未登录不渲染密码/grant 输入与解锁按钮
    await expect(page.locator('[data-testid="l0-pwd"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="l0-grant-id"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="l0-unlock"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="l0-lock"]')).toHaveCount(0);
  });

  test('2026-11-22 首页版式：摘要真实读数 + L1–L6 分组卡 + 层间流动（异常层卡已删除）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="layered-memory-page"]')).toBeVisible();

    // 顶部摘要：真实账本读数（空账本 → 0，不是示例值）
    const sum = page.locator('[data-testid="layered-summary"]');
    await expect(sum).toBeVisible();
    await expect(sum).toContainText('记忆总数');
    await expect(sum).toContainText('0');
    await expect(sum).toContainText('未授权');

    // L1–L6 六张语义卡（定义/条数/规则/定位动作）
    for (const id of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) {
      const card = page.locator(`[data-testid="layer-card-${id}"]`);
      await expect(card).toBeVisible();
      await expect(card).toContainText('有内容');
      await expect(page.locator(`[data-testid="layered-jump-${id}"]`)).toBeVisible();
    }

    // 层间流动 + 规则边界（宽项跨列）；「异常层处理」卡按用户要求整卡删除
    await expect(page.locator('[data-testid="layered-flow"]')).toContainText('L1 → L6');
    await expect(page.locator('[data-testid="layered-anomaly"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="layered-rules"]')).toContainText('层语义');
    // 删卡后能力不丢：L0 授权入口仍在页头，层读取失败时的重试入口在摘要区
    await expect(page.locator('[data-testid="layered-goto-l0"]')).toBeVisible();

    // 版式令牌：af-panel 三列网格已生效
    await expect(page.locator('.layered-page .af-panel').first()).toBeVisible();
    await expect(page.locator('[data-testid="layered-layer-grid"] .af-panel')).toHaveCount(6);
    expect(errors).toEqual([]);
  });

  test('几何：L1–L6 六张卡同宽同高，每行等高，文字不撑高卡片', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="layer-card-L6"]')).toBeVisible();
    const m = await page.evaluate(() => {
      const ids = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
      return ids.map((id) => {
        const el = document.querySelector(`[data-testid="layer-card-${id}"]`) as HTMLElement;
        const r = el.getBoundingClientRect();
        const pb = el.querySelector('.af-pb') as HTMLElement | null;
        return {
          id,
          x: r.x, y: r.y, w: r.width, h: r.height,
          pbOverflow: pb ? getComputedStyle(pb).overflowY : 'none',
        };
      });
    });
    expect(m.length).toBe(6);
    for (const c of m) expect(c.h).toBeGreaterThan(120);
    // 同列同宽：六卡宽度一致
    for (const c of m) expect(Math.abs(c.w - m[0].w)).toBeLessThanOrEqual(1);
    // 每行等高：六卡高度一致（即使文字长短不同）
    for (const c of m) expect(Math.abs(c.h - m[0].h)).toBeLessThanOrEqual(1);
    // 三列两行：按 y 分组后每组 3 张，且第二行从第一行底部之下开始
    const ys = Array.from(new Set(m.map((c) => Math.round(c.y)))).sort((a, b) => a - b);
    expect(ys.length).toBe(2);
    expect(m.filter((c) => Math.round(c.y) === ys[0]).length).toBe(3);
    expect(m.filter((c) => Math.round(c.y) === ys[1]).length).toBe(3);
    expect(ys[1]).toBeGreaterThanOrEqual(ys[0] + m[0].h);
    // 文字超出卡高时卡内滚动，而不是把卡片撑高
    for (const c of m) expect(['auto', 'scroll']).toContain(c.pbOverflow);
  });

  test('几何：页面可滚到内容末尾（明细不吸附不裁切）+ 选中行浅色主题可读', async ({ page }) => {
    await page.goto(APP);
    // 页面滚动容器能到末尾
    const scroll = await page.evaluate(() => {
      const el = document.querySelector('.layered-page') as HTMLElement | null;
      if (!el) return null;
      el.scrollTop = el.scrollHeight;
      return { top: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight };
    });
    expect(scroll).not.toBeNull();
    if (scroll!.sh > scroll!.ch) {
      expect(scroll!.top + scroll!.ch).toBeGreaterThanOrEqual(scroll!.sh - 2);
    }
    // 明细卡不再 position:sticky（长内容会随页滚到底，不被视口裁掉）
    const pos = await page.evaluate(() => {
      const d = document.querySelector('.layered-page .detail') as HTMLElement | null;
      return d ? getComputedStyle(d).position : 'absent';
    });
    expect(pos === 'absent' || pos === 'static').toBe(true);
    // 选中行：主题自适应底色 + 正文颜色由主题变量给出（不是固定深蓝配深字）
    const sel = await page.evaluate(() => {
      const tr = document.createElement('tr');
      tr.className = 'lrow sel';
      tr.innerHTML = '<td class="ldim">x</td>';
      const tbody = document.createElement('tbody');
      tbody.appendChild(tr);
      const table = document.createElement('table');
      table.className = 'layer-table';
      table.appendChild(tbody);
      const host = document.querySelector('.layered-page') ?? document.body;
      host.appendChild(table);
      const cs = getComputedStyle(tr);
      const out = { bg: cs.backgroundColor, color: getComputedStyle(tr.querySelector('td') as HTMLElement).color };
      table.remove();
      return out;
    });
    expect(sel.bg).not.toBe('rgb(26, 51, 82)'); // 旧固定深蓝已移除
    expect(sel.color).not.toBe(sel.bg); // 文字色不与底色相同（可读）
  });

  test('L0 固定 5 分钟连续会话：无自定义超时/本地口令配置', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-testid="l0-timeout"]')).toHaveCount(0);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).not.toContain('l0_auto_lock_minutes');
    expect(keys).not.toContain('l0_pwd');
  });

  test('响应式：默认 1280 宽点选详情不被挤出视口（右列可见、左列可收缩）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(APP);
    await expect(page.locator('[data-testid="layered-memory-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="detail"]')).toBeVisible();
    const m = await page.evaluate(() => {
      const cols = document.querySelector('.layered-page .cols') as HTMLElement | null;
      const left = document.querySelector('.layered-page .left-col') as HTMLElement | null;
      const detail = document.querySelector('.layered-page .detail') as HTMLElement | null;
      const r = detail?.getBoundingClientRect();
      return {
        vw: window.innerWidth,
        tracks: cols ? getComputedStyle(cols).gridTemplateColumns.trim().split(/\s+/).map(parseFloat) : [],
        leftMinWidth: left ? getComputedStyle(left).minWidth : null,
        detail: r ? { x: r.x, y: r.y, w: r.width, right: r.right } : null,
        detailPosition: detail ? getComputedStyle(detail).position : null,
      };
    });
    expect(m.detail).not.toBeNull();
    // 左列允许收缩（min-width:0），不会被层表格 min-content 撑大挤出右列
    expect(m.leftMinWidth).toBe('0px');
    // 两列轨道：1fr 与固定 360px 右列
    expect(m.tracks.length).toBe(2);
    expect(Math.abs(m.tracks[1] - 360)).toBeLessThanOrEqual(1);
    expect(m.tracks[0]).toBeGreaterThan(0);
    // 详情右边界落在视口内（这是「只有最大化才看得见」的回归点）
    expect(m.detail!.w).toBeGreaterThan(200);
    expect(m.detail!.right).toBeLessThanOrEqual(m.vw + 0.5);
    expect(m.detail!.x).toBeGreaterThanOrEqual(0);
    // 正常宽度仍是常驻右列，不是悬浮抽屉
    expect(m.detailPosition).toBe('static');
  });

  test('响应式：1000 宽详情改为悬浮抽屉，不被裁切且内容可滚到末尾', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(APP);
    await expect(page.locator('[data-testid="detail"]')).toBeVisible();
    // 空账本无选中项：显式加 detail-open 触发真实窄屏抽屉样式（与有选中项时同一规则）
    await page.evaluate(() => document.querySelector('.layered-page .detail')?.classList.add('detail-open'));
    const m = await page.evaluate(() => {
      const cols = document.querySelector('.layered-page .cols') as HTMLElement | null;
      const detail = document.querySelector('.layered-page .detail') as HTMLElement;
      const cs = getComputedStyle(detail);
      // 注入长内容验证抽屉内部滚动能到末尾
      const filler = document.createElement('div');
      filler.style.height = '2000px';
      filler.textContent = 'x';
      detail.appendChild(filler);
      detail.scrollTop = detail.scrollHeight;
      const r = detail.getBoundingClientRect();
      return {
        vw: window.innerWidth,
        tracks: cols ? getComputedStyle(cols).gridTemplateColumns.trim().split(/\s+/).length : 0,
        position: cs.position,
        overflowY: cs.overflowY,
        zIndex: cs.zIndex,
        rect: { x: r.x, w: r.width, right: r.right },
        scrollable: detail.scrollHeight > detail.clientHeight,
        reachedBottom: detail.scrollTop + detail.clientHeight >= detail.scrollHeight - 2,
      };
    });
    // 窄屏单列堆叠（详情脱离右列，避免把内容挤出视口）
    expect(m.tracks).toBe(1);
    // 抽屉：悬浮、可滚动、覆盖在内容之上
    expect(m.position).toBe('fixed');
    expect(['auto', 'scroll']).toContain(m.overflowY);
    expect(Number(m.zIndex)).toBeGreaterThan(0);
    // 抽屉整体在视口内（不被右边缘裁掉）
    expect(m.rect.right).toBeLessThanOrEqual(m.vw + 0.5);
    expect(m.rect.x).toBeGreaterThanOrEqual(0);
    expect(m.rect.w).toBeLessThanOrEqual(440 + 0.5);
    // 详情内容可滚到末尾（长内容不被截断）
    expect(m.scrollable).toBe(true);
    expect(m.reachedBottom).toBe(true);
  });

  test('响应式：宽屏 1400 保持右列常驻（详情不悬浮）', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(APP);
    await expect(page.locator('[data-testid="detail"]')).toBeVisible();
    const m = await page.evaluate(() => {
      const cols = document.querySelector('.layered-page .cols') as HTMLElement | null;
      const detail = document.querySelector('.layered-page .detail') as HTMLElement;
      const r = detail.getBoundingClientRect();
      return {
        vw: window.innerWidth,
        tracks: cols ? getComputedStyle(cols).gridTemplateColumns.trim().split(/\s+/).map(parseFloat) : [],
        position: getComputedStyle(detail).position,
        right: r.right,
      };
    });
    expect(m.tracks.length).toBe(2);
    expect(Math.abs(m.tracks[1] - 360)).toBeLessThanOrEqual(1);
    expect(m.position).toBe('static');
    expect(m.right).toBeLessThanOrEqual(m.vw + 0.5);
  });
});
