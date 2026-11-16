// 批次62 · A 层钩子脚本「稳定化」单测。
// 事故背景：宿主用外部 node 执行钩子，node 不认 asar 归档内的虚拟路径；
// 打包态 __dirname 又绑死安装目录。两者都会让「首步强制召回」静默失效，
// 所以脚本必须复制到数据根固定位置（内容不变就不重复写盘）。
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ensureStableHookScript, stableHookScriptPath } from '../recallHookScript.ts';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rhs-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('批次62 · 钩子脚本稳定化', () => {
  test('稳定副本路径口径：<数据根>/recall-hard/force_recall.mjs', () => {
    expect(stableHookScriptPath(dir).replace(/\\/g, '/')).toBe(`${dir.replace(/\\/g, '/')}/recall-hard/force_recall.mjs`);
  });

  test('源脚本不存在 → 降级用源路径，并给出原因（不静默）', () => {
    const source = join(dir, 'app.asar', 'force_recall.mjs');
    const r = ensureStableHookScript(source, dir);
    expect(r.degraded).toBe(true);
    expect(r.copied).toBe(false);
    expect(r.path).toBe(source);
    expect(r.note).toContain('源脚本不存在');
  });

  test('首次：复制到数据根，内容逐字一致', async () => {
    const source = join(dir, 'resources', 'force_recall.mjs');
    await mkdir(join(dir, 'resources'), { recursive: true });
    await writeFile(source, '// hook v1\n', 'utf8');

    const r = ensureStableHookScript(source, dir);
    expect(r.degraded).toBe(false);
    expect(r.copied).toBe(true);
    expect(r.path.replace(/\\/g, '/')).toBe(stableHookScriptPath(dir).replace(/\\/g, '/'));
    expect(await readFile(r.path, 'utf8')).toBe('// hook v1\n');
  });

  test('内容没变 → 不重复写盘（copied=false）', async () => {
    const source = join(dir, 'resources', 'force_recall.mjs');
    await mkdir(join(dir, 'resources'), { recursive: true });
    await writeFile(source, '// hook v1\n', 'utf8');
    ensureStableHookScript(source, dir);

    const writeText = vi.fn();
    const r = ensureStableHookScript(source, dir, { writeText });
    expect(r.copied).toBe(false);
    expect(r.degraded).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  test('换包后内容变化 → 覆盖稳定副本', async () => {
    const source = join(dir, 'resources', 'force_recall.mjs');
    await mkdir(join(dir, 'resources'), { recursive: true });
    await writeFile(source, '// hook v1\n', 'utf8');
    ensureStableHookScript(source, dir);

    await writeFile(source, '// hook v2\n', 'utf8');
    const r = ensureStableHookScript(source, dir);
    expect(r.copied).toBe(true);
    expect(await readFile(stableHookScriptPath(dir), 'utf8')).toBe('// hook v2\n');
  });

  test('稳定副本所在目录不存在时自动创建', async () => {
    const source = join(dir, 'force_recall.mjs');
    await writeFile(source, '// hook\n', 'utf8');
    expect(existsSync(join(dir, 'recall-hard'))).toBe(false);

    const r = ensureStableHookScript(source, dir);
    expect(r.degraded).toBe(false);
    expect(existsSync(stableHookScriptPath(dir))).toBe(true);
  });

  test('复制失败（目录不可写）→ 仍降级返回可用路径，绝不让 A 层整层失效', () => {
    const source = join(dir, 'force_recall.mjs');
    const ensureDir = vi.fn(() => { throw new Error('EACCES: permission denied'); });
    const r = ensureStableHookScript(source, dir, {
      exists: (p) => p === source,
      readText: () => '// hook\n',
      writeText: () => undefined,
      ensureDir,
    });
    expect(r.degraded).toBe(true);
    expect(r.copied).toBe(false);
    expect(r.path).toBe(source); // 退回源路径，A 层仍可启用
    expect(r.note).toContain('EACCES');
  });
});
