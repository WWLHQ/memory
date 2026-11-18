// 引导指针 → 真实数据根（召回链共享纯模块，不依赖 electron）。
//
// 背景（2026-11-18「数据统一落 D 盘」档1）：引导指针固定放在
// %APPDATA%\MultiAgent Memory\data-root.json，不随数据根搬家；召回钩子是宿主用
// 系统 node 起的**外部进程**，读不到 app.setPath 后的 USER_DATA，之前硬编码拼
// %APPDATA%\MultiAgent Memory —— 数据根切到 D 盘后，主进程读写 D 盘、钩子读写
// C 盘，状态文件/令牌分叉，硬召回门禁会把每轮都误判成 never_ran。
//
// 修法：钩子与内置网关都从这份**固定指针**解析指针里的 root 字段作为真实数据根。
// 指针在切换前后都指向当前生效的数据根，故本改动在存量（C 盘）与切换后（D 盘）
// 两种状态下都与主进程一致，不存在中间断层。
//
// 只做同步只读解析，不写文件、不建目录 —— fail-open 回退由调用方负责。
import { readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { homedir } from 'node:os';

/** 引导指针所在产品目录名（与 electron/dataRoot.ts 的 DATA_ROOT_DIR_NAME 同口径）。 */
export const POINTER_DIR_NAME = 'MultiAgent Memory';
export const POINTER_FILE_NAME = 'data-root.json';

/** 引导指针固定路径（档1不搬指针）：%APPDATA%/MultiAgent Memory/data-root.json。 */
export function pointerFilePath(): string {
  const appdata = process.env.APPDATA || process.env.LOCALAPPDATA;
  if (appdata) return join(appdata, POINTER_DIR_NAME, POINTER_FILE_NAME);
  return join(homedir(), '.config', 'multiagent-memory', POINTER_FILE_NAME);
}

/** appData 下的旧硬编码目录（指针读不到时的 fail-open 回退，等价切换前行为）。 */
export function legacyDataRoot(): string {
  const appdata = process.env.APPDATA || process.env.LOCALAPPDATA;
  if (appdata) return join(appdata, POINTER_DIR_NAME);
  return join(homedir(), '.config', 'multiagent-memory');
}

/**
 * 从引导指针读真实数据根（root 字段）。缺失 / 损坏 / 无 root → 返回 null，由调用方回退。
 * file 参数仅用于测试注入；生产走固定指针路径。
 */
export function readPointerRoot(file: string = pointerFilePath()): string | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { root?: unknown };
    if (parsed && typeof parsed.root === 'string' && parsed.root.trim()) {
      return normalize(parsed.root.trim());
    }
  } catch {
    /* 指针缺失 / 坏 JSON：返回 null 回退，绝不猜一个数据根 */
  }
  return null;
}

/** 召回链实际使用的数据根：指针命中用它，否则回退旧硬编码目录。 */
export function resolveRecallDataRoot(): string {
  return readPointerRoot() ?? legacyDataRoot();
}
