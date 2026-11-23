// 批次62 · A 层钩子脚本「稳定化」：把 force_recall.mjs 复制到数据根固定位置，宿主配置只指向这一份。
//
// 为什么必须这么做（2026-11-16 实测事故）：
//   打包后 main.cjs 落在 app.asar.unpacked/dist-electron/，__dirname 就是 unpacked 路径，
//   于是写进宿主 ~/.workbuddy/settings.json 的命令是
//     node "…\resources\app.asar.unpacked\dist-electron\recall-hard\force_recall.mjs"
//   而历史版本曾经写进过
//     node "…\resources\app.asar\dist-electron\recall-hard\force_recall.mjs"
//   后者是 asar 归档内的**虚拟路径**：Electron 自己的 fs 能看见，**外部 node 看不见**。
//   宿主是用外部 node 起钩子子进程的 → 每轮 ERR_MODULE_NOT_FOUND → fail-open 静默退出 →
//   「首步强制召回」一次都没真正执行过（recall-hook-status.json 从未生成）。
//
// 两种路径都还有同一个毛病：绑死安装目录，换包 / 换安装位置 / 重装就失效。
// 所以统一复制到 <数据根>/recall-hard/force_recall.mjs，宿主配置永远只写这一个不变路径。
// 升级换包时内容变了才覆盖（按内容比对，不做无谓写盘）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 稳定副本在数据根下的相对位置（召回钩子默认名；其它钩子见 hostHookInject.ts 的注册表）。 */
export const STABLE_HOOK_REL = join('recall-hard', 'force_recall.mjs');

export interface StableHookScriptResult {
  /** 最终应当写进宿主配置的路径（成功=稳定副本；降级=源路径） */
  path: string;
  /** 本次是否真的写了盘（内容变了才写） */
  copied: boolean;
  /** 是否降级退回源路径（源不存在 / 复制失败） */
  degraded: boolean;
  /** 人话说明，供日志与 UI 使用；空串表示一切正常且无需动作 */
  note: string;
}

export interface StableHookScriptDeps {
  exists?: (p: string) => boolean;
  readText?: (p: string) => string;
  writeText?: (p: string, text: string) => void;
  ensureDir?: (p: string) => void;
}

/** 稳定副本的绝对路径（唯一口径，别在别处再拼一次）。scriptName 省略=召回钩子，其它钩子传注册文件名。 */
export function stableHookScriptPath(dataDir: string, scriptName = 'force_recall.mjs'): string {
  return join(dataDir, 'recall-hard', scriptName);
}

/**
 * 确保数据根下有一份与源内容一致的钩子脚本，并返回应当写进宿主配置的路径。
 * 任何失败都降级为「用源路径」，绝不因为复制失败就让 A 层直接不可用（fail-open）。
 * scriptName 省略=召回钩子（保持既有行为）；批量注入其它钩子时传注册文件名。
 */
export function ensureStableHookScript(
  source: string,
  dataDir: string,
  deps: StableHookScriptDeps = {},
  scriptName = 'force_recall.mjs',
): StableHookScriptResult {
  const exists = deps.exists ?? ((p: string) => existsSync(p));
  const readText = deps.readText ?? ((p: string) => readFileSync(p, 'utf8'));
  const writeText = deps.writeText ?? ((p: string, text: string) => writeFileSync(p, text, 'utf8'));
  const ensureDir = deps.ensureDir ?? ((p: string) => mkdirSync(p, { recursive: true }));

  if (!exists(source)) {
    return { path: source, copied: false, degraded: true, note: `钩子源脚本不存在：${source}` };
  }
  const target = stableHookScriptPath(dataDir, scriptName);
  let content: string;
  try {
    content = readText(source);
  } catch (e) {
    return { path: source, copied: false, degraded: true, note: `读取钩子源脚本失败：${errMsg(e)}` };
  }
  // 已是最新：不写盘（避免每次启动都改文件时间，也便于判断「谁动过」）
  if (exists(target)) {
    try {
      if (readText(target) === content) {
        return { path: target, copied: false, degraded: false, note: '' };
      }
    } catch { /* 读不出来就当需要重写 */ }
  }
  try {
    ensureDir(dirname(target));
    writeText(target, content);
    return { path: target, copied: true, degraded: false, note: '' };
  } catch (e) {
    // 复制失败不能让 A 层整层失效：退回源路径，同时把原因交给调用方记日志
    return { path: source, copied: false, degraded: true, note: `复制钩子脚本到数据根失败：${errMsg(e)}` };
  }
}

function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e).slice(0, 160);
}
