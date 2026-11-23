// E2E 测试：MCP 接入页（自 Agent 接入页迁入的客户端面板）自包含（系统分配端口）
// 浏览器静态环境无宿主桥 → 面板如实降级；摘要条与五个场景分组必须存在，
// 读数写 0 / 尚未扫描，不伪造「已接入」。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

let APP = '';
let staticSrv: StaticServer | undefined;

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist');
  APP = `http://localhost:${staticSrv.port}/mcp.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('MCP 接入页', () => {
  test('页面渲染：独立页头 + 客户端接入状态面板（不复制数据源）', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(APP);
    await expect(page.locator('[data-testid="mcp-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="mcp-head"]')).toContainText('MCP 接入');
    await expect(page.locator('[data-testid="mcp-clients"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('新增：顶部接入摘要 + 五个场景分组（端口/错误码如实展示）', async ({ page }) => {
    await page.goto(APP);
    const summary = page.locator('[data-testid="mcp-summary"]');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('客户端接入');
    await expect(summary).toContainText('服务端监听');
    await expect(summary).toContainText('8204');
    for (const id of ['status', 'server', 'probe', 'clients', 'errors']) {
      await expect(page.locator(`[data-testid="mcp-group-${id}"]`)).toBeVisible();
    }
    // 浏览器模式空态：已接入 0 / 缺令牌 0，不伪造
    await expect(page.locator('[data-testid="mcp-group-status"]')).toContainText('已接入 0');
    await expect(page.locator('[data-testid="mcp-group-errors"]')).toContainText('扫描错误');
    // 跳到真实清单（原面板能力未丢，滚动动作不报错）
    await page.locator('[data-testid="mcp-jump-table"]').click();
    await expect(page.locator('[data-testid="mcp-clients"]')).toBeVisible();
  });

  test('几何：错误码卡与客户端清单卡同列同宽；清单区无空白、空态如实可读', async ({ page }) => {
    await page.goto(APP);
    const m = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      const empty = document.querySelector('[data-testid="mcp-empty"]') as HTMLElement | null;
      return {
        clients: r('[data-testid="mcp-group-clients"]'),
        errors: r('[data-testid="mcp-group-errors"]'),
        emptyText: empty ? (empty.textContent ?? '').trim() : null,
        emptyRect: empty ? { w: empty.getBoundingClientRect().width } : null,
        panelRect: r('[data-testid="mcp-clients"]'),
      };
    });
    expect(m.clients).not.toBeNull();
    expect(m.errors).not.toBeNull();
    // 同列同宽 + 同一行
    expect(Math.abs(m.clients!.w - m.errors!.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.clients!.y - m.errors!.y)).toBeLessThanOrEqual(1);
    // 浏览器模式：清单区给如实空态（不是空表格/大片空白）
    expect(m.emptyText).not.toBeNull();
    expect(m.emptyText!.length).toBeGreaterThan(8);
    expect(m.emptyRect!.w).toBeGreaterThan(200);
    expect(m.panelRect).not.toBeNull();
  });

  test('几何：「详情 · 触发规则」行与「操作说明」卡同宽同左右边距（同一列）', async ({ page }) => {
    await page.goto(APP);
    const m = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="mcp-clients"] .af-pb') as HTMLElement | null;
      if (!host) return null;
      const box = document.createElement('div');
      // 用真实类名搭一组「详情行 + 操作说明卡」，量同一容器下的左右边界
      box.innerHTML = [
        '<div class="af-scrollx"><table class="af-table"><tbody>',
        '<tr class="aob-detail-row"><td><details class="af-det"><summary>详情 · 触发规则</summary><div class="det-b">x</div></details></td></tr>',
        '</tbody></table></div>',
        '<details class="af-det" id="op-guide"><summary>操作说明与实测速通口径</summary><div class="det-b">y</div></details>',
      ].join('');
      host.appendChild(box);
      const a = (box.querySelector('.aob-detail-row .af-det') as HTMLElement).getBoundingClientRect();
      const b = (box.querySelector('#op-guide') as HTMLElement).getBoundingClientRect();
      box.remove();
      return { ax: a.x, aw: a.width, bx: b.x, bw: b.width };
    });
    expect(m).not.toBeNull();
    expect(Math.abs(m!.ax - m!.bx)).toBeLessThanOrEqual(1);
    expect(Math.abs(m!.aw - m!.bw)).toBeLessThanOrEqual(1);
  });

  test('间距：最后一条「详情 · 触发规则」行与「操作说明」卡间距 = 页内其它卡片间距（不是旧 9px 叠加）', async ({ page }) => {
    await page.goto(APP);
    const m = await page.evaluate(() => {
      const stack = document.querySelector('[data-testid="mcp-clients"] .af-pb') as HTMLElement | null;
      const guide = document.querySelector('[data-testid="mcp-actions-help"]') as HTMLElement | null;
      const empty = document.querySelector('[data-testid="mcp-empty"]') as HTMLElement | null;
      if (!stack || !guide) return null;
      // 基准：页内现有「卡片 → 操作说明」的真实间距（栈 gap + 折叠卡 margin）
      const baseline = empty ? guide.getBoundingClientRect().top - empty.getBoundingClientRect().bottom : null;
      // 模拟桌面模式：客户端表格（末行为展开的「详情 · 触发规则」）紧挨操作说明
      const scroll = document.createElement('div');
      scroll.className = 'af-scrollx';
      scroll.innerHTML = [
        '<table class="af-table"><thead><tr><th>客户端</th><th>状态</th></tr></thead><tbody>',
        '<tr><td>Claude Code</td><td>已接入</td></tr>',
        '<tr class="aob-detail-row"><td colspan="2"><details class="af-det"><summary>详情 · 触发规则</summary><div class="det-b">x</div></details></td></tr>',
        '</tbody></table>',
      ].join('');
      guide.before(scroll);
      const cs = getComputedStyle(stack);
      const out = {
        display: cs.display,
        rowGap: parseFloat(cs.rowGap || '0'),
        gap: guide.getBoundingClientRect().top - scroll.getBoundingClientRect().bottom,
        tdPadBottom: getComputedStyle(scroll.querySelector('.aob-detail-row td') as HTMLElement).paddingBottom,
        baseline,
      };
      scroll.remove();
      return out;
    });
    expect(m).not.toBeNull();
    expect(m!.display).toBe('flex');
    expect(m!.rowGap).toBe(8);
    // 不再挂旧 9px 底留白（旧规则 0 0 9px → 合计 23px 大空隙）
    expect(m!.tdPadBottom).toBe('0px');
    // 收紧到页内其它卡片同一间距，且不与说明文字挤压
    expect(m!.baseline).not.toBeNull();
    expect(m!.gap).toBeGreaterThanOrEqual(6);
    expect(m!.gap).toBeLessThanOrEqual(m!.baseline! + 1);
    expect(Math.abs(m!.gap - m!.baseline!)).toBeLessThanOrEqual(1);
  });
});
