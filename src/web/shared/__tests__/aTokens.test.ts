// L1 令牌契约（批次57-A）：p0.css 与 shell/theme.css 的共享令牌必须落在 Stratum（方案A）取值上，
// 且旧组件命名仍别名到 A 令牌（组件 CSS 不变、只换值）。改令牌须过本契约，防止回退到旧配色。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(file: string): string {
  return readFileSync(resolve(__dirname, file), 'utf8');
}

const p0 = read('../p0.css');
const shell = read('../../shell/theme.css');

describe('L1 · Stratum（A）令牌契约', () => {
  it('p0.css 亮色令牌 = A（纸灰底 / 墨蓝 / 电青），旧命名别名到 A', () => {
    expect(p0).toMatch(/--bg:\s*#F3F5F8/i);
    expect(p0).toMatch(/--ink:\s*#0B1526/i);
    expect(p0).toMatch(/--accent:\s*#0088CC/i);
    expect(p0).toMatch(/--accent-ink:\s*#FFFFFF/i);
    expect(p0).toMatch(/--accent-soft:\s*rgba\(\s*0,\s*136,\s*204,\s*\.10\s*\)/i);
    expect(p0).toMatch(/--c-l1:\s*#22D3EE/i);
    expect(p0).toMatch(/--c-l6:\s*#FBBF24/i);
    expect(p0).toMatch(/--win:\s*var\(--bg\)/);
    expect(p0).toMatch(/--text:\s*var\(--ink\)/);
    expect(p0).toMatch(/--err:\s*var\(--bad\)/);
  });

  it('p0.css 暗色令牌 = A（深空蓝 / 辉光青）', () => {
    expect(p0).toMatch(/--bg:\s*#060B16/i);
    expect(p0).toMatch(/--accent:\s*#22D3EE/i);
    expect(p0).toMatch(/--accent-ink:\s*#04222B/i);
  });

  it('shell/theme.css 令牌 = A，旧壳层命名别名到 A', () => {
    expect(shell).toMatch(/--bg:\s*#F3F5F8/i);
    expect(shell).toMatch(/--accent:\s*#0088CC/i);
    expect(shell).toMatch(/--accent-ink:\s*#FFFFFF/i);
    expect(shell).toMatch(/--win:\s*var\(--bg\)/);
    expect(shell).toMatch(/--tx:\s*var\(--ink\)/);
    expect(shell).toMatch(/--red:\s*var\(--bad\)/);
    expect(shell).toMatch(/--c-l4:\s*#C084FC/i);
    expect(shell).toMatch(/--r:\s*8px/i);
  });

  it('shell/theme.css 暗色令牌 = A（深空蓝 / 辉光青）', () => {
    expect(shell).toMatch(/--bg:\s*#060B16/i);
    expect(shell).toMatch(/--accent:\s*#22D3EE/i);
    expect(shell).toMatch(/--accent-ink:\s*#04222B/i);
  });
});
