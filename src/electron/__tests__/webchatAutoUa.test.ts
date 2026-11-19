import { describe, expect, it } from 'vitest';
import { applyCleanUserAgent, stripElectronUa } from '../webchatAutoUa.ts';

const ELECTRON_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Electron/45.1.0';

describe('stripElectronUa', () => {
  it('只删 Electron 标记，Chrome 版本与其余指纹一字不改', () => {
    const out = stripElectronUa(ELECTRON_UA);
    expect(out).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    expect(out).toContain('Chrome/131.0.0.0');
    expect(out.toLowerCase()).not.toContain('electron');
  });

  it('没有标记时原样返回', () => {
    const plain = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36';
    expect(stripElectronUa(plain)).toBe(plain);
  });

  it('大小写与多个版本串都剥掉，不留半截标记', () => {
    const out = stripElectronUa('prefix electron/1.2.3 mid Electron/9 Safari/537.36');
    expect(out).toBe('prefix mid Safari/537.36');
    expect(out.toLowerCase()).not.toContain('electron');
  });

  it('不会误伤普通单词里的 electron', () => {
    const plain = 'Mozilla/5.0 (ElectronApp/1.0) Chrome/131.0.0.0';
    expect(stripElectronUa(plain)).toBe(plain);
  });
});

describe('applyCleanUserAgent', () => {
  it('先读当前 UA 再写回剥离后的值', () => {
    const calls: string[] = [];
    const wc = {
      getUserAgent: () => { calls.push('get'); return ELECTRON_UA; },
      setUserAgent: (ua: string) => { calls.push(`set:${ua}`); },
    };
    applyCleanUserAgent(wc);
    expect(calls[0]).toBe('get');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(`set:${stripElectronUa(ELECTRON_UA)}`);
    expect(calls[1]).not.toContain('Electron/45.1.0');
  });
});
