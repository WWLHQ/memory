// 把随包下发的插件复制到数据根下的**稳定目录**，再让用户到浏览器里「加载已解压的扩展程序」指向它。
//
// 为什么不能直接用随包目录（resources/webchat-exporter）：
// ① 它在安装目录里（多是 Program Files），升级/重装会整目录替换或删除；
// ② Chromium 会把「已加载扩展」的绝对路径记进用户 profile，路径一没就报「清单文件缺失」；
// ③ 展示给用户的路径不该随安装位置/机器名漂移（换台电脑就变成另一串）。
// 复制到 <数据根>/webchat-extension 之后：换机器自动重算、升级重装不失效、路径稳定可展示。
//
// 幂等：逐文件比对字节，内容一致就不写盘（避免每次启动都动磁盘、也避免把用户改过的目录拍回去）。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, dirname } from 'node:path';

/** 插件最小文件集（少一个就不认这个目录可加载）；只做「必存在」检查，复制按源目录整棵来 */
export const WEBCHAT_EXTENSION_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'shared/core.js',
] as const;

export interface EnsureStableExtensionOptions {
  /** 随包目录（只读来源） */
  sourceDir: string;
  /** 数据根下的目标目录 */
  targetDir: string;
  /** 显式指定要复制的相对路径（缺省 = 递归列出源目录全部文件） */
  files?: readonly string[];
  /** 测试注入点（缺省用 node:fs） */
  exists?: (path: string) => boolean;
  read?: (path: string) => Buffer | null;
  copy?: (from: string, to: string) => void;
  mkdir?: (path: string) => void;
  list?: (dir: string) => string[];
}

export interface EnsureStableExtensionResult {
  /** 实际可用目录（复制成功 = targetDir；源缺失时 = targetDir，且 ok=false 由调用方如实提示） */
  dir: string;
  /** 本次真正写了盘的文件（相对路径）；空 = 已是最新，没有动磁盘 */
  copied: string[];
  ok: boolean;
  error?: string;
}

/** 递归列出源目录下的全部文件（相对路径，统一用 /） */
function walkFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, base: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), rel);
      else out.push(rel);
    }
  };
  walk(root, '');
  return out;
}

export function ensureStableExtensionDir(opts: EnsureStableExtensionOptions): EnsureStableExtensionResult {
  const exists = opts.exists ?? existsSync;
  const read = opts.read ?? ((p: string) => (existsSync(p) ? readFileSync(p) : null));
  const copy = opts.copy ?? ((from: string, to: string) => copyFileSync(from, to));
  const mkdir = opts.mkdir ?? ((p: string) => { mkdirSync(p, { recursive: true }); });

  // 源里没有 manifest.json = 这个包根本没带插件，别在数据根造一个空目录骗用户
  if (!exists(join(opts.sourceDir, 'manifest.json'))) {
    return {
      dir: opts.targetDir,
      copied: [],
      ok: false,
      error: `随包插件缺失：${join(opts.sourceDir, 'manifest.json')} 不存在`,
    };
  }

  // 按源目录整棵复制（不写死文件清单）：以后插件加文件（如 offscreen.js）不必再回来改这里
  const files = opts.files ?? (opts.list ? opts.list(opts.sourceDir) : walkFiles(opts.sourceDir));

  try {
    mkdir(opts.targetDir);
  } catch (e) {
    return { dir: opts.targetDir, copied: [], ok: false, error: `建目录失败：${String((e as Error)?.message ?? e)}` };
  }

  const copied: string[] = [];
  try {
    for (const rel of files) {
      const from = join(opts.sourceDir, rel);
      const to = join(opts.targetDir, rel);
      const src = read(from);
      if (!src) continue; // 源缺某个文件 → 跳过（不写空文件冒充）
      const cur = read(to);
      if (cur && cur.equals(src)) continue; // 一致 → 不写盘
      const sub = dirname(to);
      if (sub !== opts.targetDir) mkdir(sub); // shared/ 这类子目录
      copy(from, to);
      copied.push(rel);
    }
  } catch (e) {
    return { dir: opts.targetDir, copied, ok: false, error: `复制失败：${String((e as Error)?.message ?? e)}` };
  }
  return { dir: opts.targetDir, copied, ok: true };
}
