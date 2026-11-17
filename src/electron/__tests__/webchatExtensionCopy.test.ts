// 插件目录「复制到数据根稳定目录」的回归（2026-11-16 用户要求：插件随包下发，目录同时改）。
// 钉死三件事：
//   1. 首次复制：六个文件全到位，含 shared/ 子目录
//   2. 幂等：内容一致不写盘（不能每次启动都把用户目录拍一遍）
//   3. 双源缺失：随包目录没有 manifest.json 时不造空目录，如实报错（UI 才能提示「插件缺失」）
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureStableExtensionDir, WEBCHAT_EXTENSION_FILES } from '../webchatExtensionCopy.ts';

const dirs: string[] = [];

function tmpDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** 造一个「随包插件目录」 */
function makeBundle(withManifest = true): string {
  const src = tmpDir('ext-bundle-');
  for (const rel of WEBCHAT_EXTENSION_FILES) {
    if (!withManifest && rel === 'manifest.json') continue;
    const full = path.join(src, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `// ${rel}\ncontent-of-${rel}\n`);
  }
  return src;
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('ensureStableExtensionDir', () => {
  it('首次复制：六个文件全部落到目标目录（含 shared/core.js 子目录）', () => {
    const sourceDir = makeBundle();
    const targetDir = path.join(tmpDir('ext-target-'), 'webchat-extension');

    const r = ensureStableExtensionDir({ sourceDir, targetDir });

    expect(r.ok).toBe(true);
    expect(r.dir).toBe(targetDir);
    expect(r.copied.sort()).toEqual([...WEBCHAT_EXTENSION_FILES].sort());
    for (const rel of WEBCHAT_EXTENSION_FILES) {
      expect(fs.existsSync(path.join(targetDir, rel))).toBe(true);
    }
    expect(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf8')).toContain('content-of-manifest.json');
  });

  it('幂等：内容一致 → 不再写盘（copied 为空）', () => {
    const sourceDir = makeBundle();
    const targetDir = path.join(tmpDir('ext-target-'), 'webchat-extension');
    ensureStableExtensionDir({ sourceDir, targetDir });

    const again = ensureStableExtensionDir({ sourceDir, targetDir });
    expect(again.ok).toBe(true);
    expect(again.copied).toEqual([]);
  });

  it('只补变化的文件：源里改了 manifest.json → 只重写这一个', () => {
    const sourceDir = makeBundle();
    const targetDir = path.join(tmpDir('ext-target-'), 'webchat-extension');
    ensureStableExtensionDir({ sourceDir, targetDir });

    fs.writeFileSync(path.join(sourceDir, 'manifest.json'), '// 升级后的 manifest\n');
    const r = ensureStableExtensionDir({ sourceDir, targetDir });

    expect(r.copied).toEqual(['manifest.json']);
    expect(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf8')).toBe('// 升级后的 manifest\n');
  });

  it('源目录里多出来的文件（如以后加的 offscreen.js）也会被复制，不必改代码', () => {
    const sourceDir = makeBundle();
    fs.writeFileSync(path.join(sourceDir, 'offscreen.html'), '<!doctype html>');
    fs.mkdirSync(path.join(sourceDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'assets', 'icon.png'), 'x');
    const targetDir = path.join(tmpDir('ext-target-'), 'webchat-extension');

    const r = ensureStableExtensionDir({ sourceDir, targetDir });

    expect(r.copied).toContain('offscreen.html');
    expect(r.copied).toContain('assets/icon.png');
    expect(fs.existsSync(path.join(targetDir, 'offscreen.html'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'assets', 'icon.png'))).toBe(true);
  });

  it('随包目录没有 manifest.json → 不造空目录，ok=false 并给真实路径', () => {
    const sourceDir = makeBundle(false);
    const targetDir = path.join(tmpDir('ext-target-'), 'webchat-extension');

    const r = ensureStableExtensionDir({ sourceDir, targetDir });

    expect(r.ok).toBe(false);
    expect(r.copied).toEqual([]);
    expect(r.error).toContain('随包插件缺失');
    expect(fs.existsSync(targetDir)).toBe(false);
  });

  it('目标目录建不出来 → 如实失败，不假装成功', () => {
    const sourceDir = makeBundle();
    const blocker = path.join(tmpDir('ext-block-'), 'file.txt');
    fs.writeFileSync(blocker, 'x'); // 用普通文件占住父路径 → mkdir 必失败

    const r = ensureStableExtensionDir({ sourceDir, targetDir: path.join(blocker, 'webchat-extension') });

    expect(r.ok).toBe(false);
    expect(r.error).toContain('建目录失败');
  });
});
