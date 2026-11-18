// 引导指针 → 真实数据根（档1 数据统一落 D 盘）：钩子/网关解析口径单测。
// 这是「切数据根后主进程与外部钩子不分裂」的回归钉子——
// 变异：把 readPointerRoot 改成永远返回 null → 「指针命中 root」用例必须红灯。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { legacyDataRoot, pointerFilePath, readPointerRoot, resolveRecallDataRoot } from '../pointerRoot.ts';

const temps: string[] = [];
function tempDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `mam-pointer-${tag}-`));
  temps.push(d);
  return d;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('引导指针解析真实数据根', () => {
  test('指针命中 root → 返回真实数据根（切 D 盘后钩子据此定位，不读旧硬编码）', () => {
    const file = join(tempDir('hit'), 'data-root.json');
    writeFileSync(file, JSON.stringify({ version: 1, root: 'D:\\MultiAgent Memory', setupDone: true, updatedAt: '' }), 'utf8');
    expect(readPointerRoot(file)).toBe('D:\\MultiAgent Memory');
  });

  test('指针缺失 / 坏 JSON / 无 root → 返回 null（不猜数据根）', () => {
    const dir = tempDir('miss');
    expect(readPointerRoot(join(dir, 'nope.json'))).toBeNull();
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{bad', 'utf8');
    expect(readPointerRoot(bad)).toBeNull();
    const noRoot = join(dir, 'noroot.json');
    writeFileSync(noRoot, JSON.stringify({ version: 1, setupDone: true }), 'utf8');
    expect(readPointerRoot(noRoot)).toBeNull();
  });

  test('resolveRecallDataRoot：读不到指针时回退 legacyDataRoot（等价切换前行为）', () => {
    // legacyDataRoot 依据真实环境 APPDATA 拼接，这里只断言它与 resolve 的回退同源：
    // 环境里若存在有效指针则以指针为准（本机 C 盘指针），否则等于 legacy 值。
    const fromPointer = readPointerRoot();
    expect(resolveRecallDataRoot()).toBe(fromPointer ?? legacyDataRoot());
  });

  test('pointerFilePath 固定在 appData 产品目录下，不随平台硬编码漂移', () => {
    const p = pointerFilePath();
    expect(p).toMatch(/data-root\.json$/);
    expect(p.replace(/\\/g, '/')).toContain('MultiAgent Memory/');
  });
});
