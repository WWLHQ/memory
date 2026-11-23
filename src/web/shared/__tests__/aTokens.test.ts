// L1 令牌契约（批次57-A 建；STRATUM 1:1 复刻改造）：p0.css 与 shell/theme.css 的共享令牌必须落在
// STRATUM（纸灰底 #F3F5F8 / 海洋蓝 #0088CC，暗色深空 + 辉光青 #22D3EE）取值上，且旧组件命名仍别名到
// STRATUM 令牌（组件 CSS 不变、只换值）。改令牌须过本契约，防止回退到旧配色。
// 设计真源：specs/STRATUM-设计系统规格.md §2（亮/暗令牌全表，提取自 stratum-a-full.html）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(file: string): string {
  return readFileSync(resolve(__dirname, file), 'utf8');
}

const p0 = read('../p0.css');
const shell = read('../../shell/theme.css');

describe('L1 · STRATUM 令牌契约', () => {
  it('p0.css 亮色令牌 = STRATUM（纸灰底 / 海洋蓝强调），旧命名别名到 STRATUM', () => {
    expect(p0).toMatch(/--bg:\s*#F3F5F8/i);
    expect(p0).toMatch(/--ink:\s*#0B1526/i);
    expect(p0).toMatch(/--brand:\s*#0088CC/i);
    expect(p0).toMatch(/--muted:\s*#5A6B82/i);
    expect(p0).toMatch(/--c-l1:\s*#22D3EE/i);
    expect(p0).toMatch(/--c-l6:\s*#FBBF24/i);
    // 页面/视图底色沿用 --surface-2（.view-inner/.main），--win 别名跟随它
    expect(p0).toMatch(/--win:\s*var\(--surface2\)/);
    expect(p0).toMatch(/--field:\s*var\(--surface\)/);
    expect(p0).toMatch(/--focus:\s*0 0 0 1px var\(--surface\), 0 0 0 3px var\(--brand\)/);
    expect(p0).toMatch(/--row-h:\s*34px/);
    expect(p0).toMatch(/--text:\s*var\(--ink\)/);
    expect(p0).toMatch(/--err:\s*var\(--bad\)/);
  });

  it('p0.css 暗色令牌 = STRATUM（深空 + 辉光青）', () => {
    expect(p0).toMatch(/--bg:\s*#060B16/i);
    expect(p0).toMatch(/--brand:\s*#22D3EE/i);
    expect(p0).toMatch(/--accent-ink:\s*#04222B/i);
  });

  it('shell/theme.css 令牌 = STRATUM，旧壳层命名别名到 STRATUM', () => {
    expect(shell).toMatch(/--bg:\s*#F3F5F8/i);
    expect(shell).toMatch(/--brand:\s*#0088CC/i);
    expect(shell).toMatch(/--accent:\s*var\(--brand\)/);
    expect(shell).toMatch(/--win:\s*var\(--bg\)/);
    expect(shell).toMatch(/--tx:\s*var\(--ink\)/);
    expect(shell).toMatch(/--red:\s*var\(--bad\)/);
    // STRATUM 层级色亮暗同值
    expect(shell).toMatch(/--c-l4:\s*#C084FC/i);
    expect(shell).toMatch(/--r:\s*10px/i);
  });

  it('shell/theme.css 暗色令牌 = STRATUM（深空 + 辉光青）', () => {
    expect(shell).toMatch(/--bg:\s*#060B16/i);
    expect(shell).toMatch(/--brand:\s*#22D3EE/i);
    expect(shell).toMatch(/--brand-ink:\s*#04222B/i);
  });

  it('两文件层级色 L0–L6 同值（STRATUM：亮暗同值）', () => {
    for (const css of [p0, shell]) {
      expect(css).toMatch(/--c-l0:\s*#8FA3BC/i);
      expect(css).toMatch(/--c-l1:\s*#22D3EE/i);
      expect(css).toMatch(/--c-l2:\s*#38BDF8/i);
      expect(css).toMatch(/--c-l3:\s*#818CF8/i);
      expect(css).toMatch(/--c-l4:\s*#C084FC/i);
      expect(css).toMatch(/--c-l5:\s*#F472B6/i);
      expect(css).toMatch(/--c-l6:\s*#FBBF24/i);
    }
  });

  it('shell/theme.css 侧栏 rail 跟随主题（2026-11-21：浅色浅底 / 深色深底）', () => {
    expect(shell).toMatch(/--rail:\s*var\(--surface2\)/i);
    expect(shell).toMatch(/--rail-active:\s*var\(--brand\)/i);
    expect(shell).toMatch(/--rail-ink:\s*var\(--muted\)/i);
    expect(shell).toMatch(/--rail-hot:\s*#DB2777/i);
    // 深色主题保留深 rail 底
    expect(shell).toMatch(/--rail:\s*#04070F/i);
    expect(shell).toMatch(/--rail-ink:\s*#8296B0/i);
  });
});
