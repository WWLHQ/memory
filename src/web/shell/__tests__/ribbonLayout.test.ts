// STRATUM 1:1 复刻后的静态版式契约（原 v5 版式已被 STRATUM 取代）。
// jsdom 不加载外链 CSS，因此这里直接钉住 theme.css 的关键高度与结构，防止回退到旧四段顶部。
// 设计真源：specs/STRATUM-设计系统规格.md（提取自 stratum-a-full.html：46px 标题栏 + 44px 命令条 + 26px 状态栏）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(`${process.cwd()}/src/web/shell/theme.css`, 'utf8');
const workspace = readFileSync(`${process.cwd()}/src/web/shell/Workspace.tsx`, 'utf8');

describe('STRATUM 壳层版式契约', () => {
  it('标题栏 46px；命令条 44px；状态栏 26px', () => {
    expect(css).toMatch(/\.titlebar\s*\{[\s\S]*?height:\s*46px/);
    expect(css).toMatch(/\.cmdbar\s*\{[\s\S]*?height:\s*44px/);
    expect(css).toMatch(/\.statusbar\s*\{[\s\S]*?height:\s*26px/);
  });

  it('菜单栏与 Ribbon 已移除（含样式与组件），不得回潮', () => {
    expect(css).not.toMatch(/\.menubar|\.ribbon-body|\.ribbon-tabs|\.rgroup|\.rbig|\.rsmall/);
    expect(workspace).not.toMatch(/className="menubar"|className="ribbon|menuSpecs|RIBBON/);
    expect(workspace).not.toMatch(/function RibbonGroupView|function RibbonButton/);
  });

  it('命令条结构：导航折叠 + 面包屑 + 上下文命令（批次51：范围读数取消；批次53：命令面板按钮取消，Ctrl+K 与标题栏搜索框仍开面板）', () => {
    expect(workspace).toContain('data-testid="shell-cmdbar"');
    expect(workspace).toContain('cmdbar-nav-toggle');
    expect(workspace).toContain('cb-crumbs');
    expect(workspace).not.toContain('cb-scope');
    expect(workspace).not.toContain('cmdbar-palette');
  });

  it('标题栏结构：46px 单行，strata 徽标 + 应用名 + 命令框全部靠左（批次53）+ 主题/向导/头像（批次51：QAT 工具簇整簇取消）', () => {
    expect(workspace).toContain('data-testid="shell-cmd-entry"');
    expect(workspace).not.toContain('className="qa"');
    expect(workspace).not.toContain('qaSpecs');
    expect(workspace).toContain('strata-logo');
    expect(workspace).toContain('tb-sub');
    const cmdEntryBlock = css.match(/\.cmd-entry\s*\{[^}]*\}/)?.[0] ?? '';
    expect(cmdEntryBlock).not.toContain('margin: 0 auto');
    const titlebarBlock = css.match(/\.titlebar\s*\{[^}]*\}/)?.[0] ?? '';
    expect(titlebarBlock).not.toContain('justify-content: center');
  });

  it('标题栏右侧：三联主题切换 + ⚙ 首启向导 + 头像/角色（状态栏不再有主题切换）', () => {
    expect(workspace).toContain('data-testid="shell-themes"');
    expect(workspace).toContain('data-testid="shell-wizard"');
    expect(workspace).toContain('data-testid="shell-avatar"');
    expect(workspace).toContain('data-testid="shell-role"');
    expect(workspace).not.toContain('sb-theme');
  });

  it('STRATUM 焦点环两主题同构：外圈 surface 分隔 + 3px brand 描边', () => {
    expect(css).toMatch(/--focus:\s*0 0 0 1px var\(--surface\), 0 0 0 3px var\(--brand\)/);
    expect(css).toMatch(/\.shell :focus-visible/);
  });

  it('STRATUM 审计令牌已落进两主题（海洋蓝 / 辉光青）', () => {
    expect(css).toContain('--muted: #5A6B82');
    expect(css).toContain('--faint: #7A8AA0');
    expect(css).toContain('--brand: #0088CC');
    expect(css).toContain('--faint: #6E82A0');
    expect(css).toContain('--brand: #22D3EE');
  });

  it('侧栏 rail 化：导航/图例用 rail 变量，底色随主题令牌走（浅色浅底 / 深色深底）', () => {
    const navBlock = css.match(/\.nav-pane\s*\{[^}]*\}/)?.[0] ?? '';
    expect(navBlock).toContain('background: var(--rail)');
    expect(css).toMatch(/\.tree-row\s*\{[^}]*border-left:\s*2px solid transparent/);
    expect(css).toMatch(/\.tree-row\.active\s*\{[^}]*border-left-color:\s*var\(--rail-active\)/);
    expect(css).toMatch(/\.strata-scale\s*\{[^}]*background:\s*transparent/);
  });

  it('批次50/51：标题栏可点区全量 no-drag + 右缘让位系统三按钮 + 滚动条随主题（QAT 已取消，样式不得残留）', () => {
    // no-drag 白名单须覆盖主题三联 / 向导 / 头像 / 角色 / 回到工作台（漏了就落在拖拽区，点击无效）
    const noDragBlock = css.match(/\.shell\.electron \.tb-themes[\s\S]*?\n\}/)?.[0] ?? '';
    for (const sel of ['.tb-tbtn', '.tb-wizard', '.tb-avatar', '.tb-role', '.tb-tag', '.cmd-entry']) {
      expect(noDragBlock).toContain(sel);
    }
    // 批次51：QAT 整簇取消后 .qa 样式与 no-drag 条目一并清掉
    expect(noDragBlock).not.toContain('.qa');
    expect(css).not.toMatch(/^\.qa[-\s{]/m);
    expect(noDragBlock).toContain('-webkit-app-region: no-drag');
    // win-space 是绝对定位不占布局：标题栏右缘必须让出系统三按钮覆盖层宽度（否则头像/角色被盖住）
    const tbElectron = css.match(/\.shell\.electron \.titlebar\s*\{[^}]*\}/)?.[0] ?? '';
    expect(tbElectron).toContain('padding-right: calc(135px * var(--shell-zoom, 1))');
    // 滚动条跟随主题：令牌取值（浅色浅/深色深），禁止写死色值
    expect(css).toMatch(/\.shell ::-webkit-scrollbar-thumb\s*\{[^}]*var\(--muted\)/);
    expect(css).not.toMatch(/scrollbar-thumb[^}]*#[0-9A-Fa-f]{3,6}/);
  });
});

