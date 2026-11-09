// 批次55：功能区命令区由 3 行收成 2 行后的静态版式契约。
// jsdom 不加载外链 CSS，因此这里直接钉住 theme.css 的关键高度，防止改回 94px / 70px。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(`${process.cwd()}/src/web/shell/theme.css`, 'utf8');
const workspace = readFileSync(`${process.cwd()}/src/web/shell/Workspace.tsx`, 'utf8');

describe('批次55 功能区 2 行版式', () => {
  it('ribbon-body 64px、rbig 46px、rsmall 20px，且命令分列按 2 个一组', () => {
    expect(css).toMatch(/\.ribbon-body\s*\{[\s\S]*?height:\s*64px/);
    expect(css).toMatch(/\.rbig\s*\{[\s\S]*?height:\s*46px/);
    expect(css).toMatch(/\.rsmall\s*\{[\s\S]*?height:\s*20px/);
    expect(css).not.toMatch(/\.ribbon-body\s*\{[\s\S]*?height:\s*94px/);
    expect(css).not.toMatch(/\.rbig\s*\{[\s\S]*?height:\s*70px/);
  });

  it('RibbonGroupView 小按钮按 2 个一组分列，不允许回退成 3 行', () => {
    expect(workspace).toMatch(/for \(let i = 0; i < smalls\.length; i \+= 2\)/);
    expect(workspace).not.toMatch(/for \(let i = 0; i < smalls\.length; i \+= 3\)/);
  });
});
