// 网页对话导出目录的「探测」：算出浏览器插件**实际会写到哪里**（纯函数，便于单测）。
//
// 为什么需要探测：浏览器插件只能用 `chrome.downloads.download({ filename: 'chat-exports/<站点>/<时间戳>.md' })`
// 写文件 —— 这个 filename 是**相对浏览器下载目录**的（Chromium 会拒绝绝对路径），插件侧没有任何办法
// 改到别的绝对路径。所以「插件写入位置」= 浏览器下载目录 + /chat-exports，
// 而浏览器下载目录记录在它的 Preferences JSON 里（`download.default_directory`）。
//
// 探测不到时回落 `%USERPROFILE%\Downloads\chat-exports`（Windows 默认下载目录），
// 再不行返回空数组，由调用方退回数据根，绝不瞎猜别的盘符。
import { isAbsolute, join, normalize } from 'node:path';

export interface ChatExportsLocationOptions {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** 读文本文件；不存在 / 不可读一律返回 null（调用方注入 readFileSync 包装） */
  readText: (path: string) => string | null;
  /** 列出目录下的子目录名；失败返回 []（调用方注入 readdirSync 包装） */
  listDirs: (path: string) => string[];
}

/** 各浏览器把 profile 放在这些 User Data 目录下 */
export function browserUserDataDirs(opts: ChatExportsLocationOptions): string[] {
  if (opts.platform !== 'win32') return [];
  const env = opts.env;
  const out: string[] = [];
  const local = env.LOCALAPPDATA ?? '';
  if (local) {
    out.push(join(local, 'Microsoft', 'Edge', 'User Data'));
    out.push(join(local, 'Tencent', 'QQBrowser', 'User Data'));
  }
  return out;
}

/** 每个 profile 一个 Preferences 文件：<User Data>/<profile>/Preferences */
export function browserPreferenceFiles(opts: ChatExportsLocationOptions): string[] {
  const out: string[] = [];
  for (const userData of browserUserDataDirs(opts)) {
    for (const profile of opts.listDirs(userData)) {
      out.push(join(userData, profile, 'Preferences'));
    }
  }
  return out;
}

/**
 * 从 Preferences JSON 里取 `download.default_directory`。
 * 取不到（字段缺失 / JSON 损坏 / 不是绝对路径）返回 null —— 缺字段是**正常情况**：
 * 浏览器没改过下载目录时就不会写这个字段，此时用系统默认下载目录。
 */
export function downloadDirFromPreferences(text: string | null): string | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const dir = (parsed as { download?: { default_directory?: unknown } } | null)?.download?.default_directory;
  if (typeof dir !== 'string') return null;
  const trimmed = dir.trim();
  if (!trimmed || !isAbsolute(trimmed)) return null;
  // 去掉末尾分隔符（「D:\DL\」与「D:\DL」是同一个目录），但盘符根（「D:\」）要保留
  const normalized = normalize(trimmed);
  const stripped = normalized.replace(/[\\/]+$/, '');
  if (!stripped) return normalized;
  if (/^[a-zA-Z]:$/.test(stripped)) return normalized;
  return stripped;
}

/** Windows 路径比对：大小写与末尾分隔符都不敏感 */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const norm = (p: string): string => {
    let s = normalize(p.trim()).replace(/[\\/]+$/, '');
    if (platform === 'win32') s = s.toLowerCase();
    return s;
  };
  return norm(a) === norm(b);
}

function uniqDirs(list: string[], platform: NodeJS.Platform): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of list) {
    const key = platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dir);
  }
  return out;
}

/** 探测到的浏览器下载目录（可能多个 profile 各一个）；探不到返回空数组 */
export function detectDownloadDirs(opts: ChatExportsLocationOptions): string[] {
  const dirs: string[] = [];
  for (const file of browserPreferenceFiles(opts)) {
    const dir = downloadDirFromPreferences(opts.readText(file));
    if (dir) dirs.push(dir);
  }
  return uniqDirs(dirs, opts.platform);
}

/**
 * 插件实际落点候选：<下载目录>/chat-exports，首个即「最可能的位置」。
 * 一个都没探到 → 回落 %USERPROFILE%\Downloads\chat-exports（Windows 默认下载目录）。
 */
export function detectChatExportsDirs(opts: ChatExportsLocationOptions): string[] {
  if (opts.platform !== 'win32') return [];
  const found = detectDownloadDirs(opts).map((dir) => join(dir, 'chat-exports'));
  if (found.length > 0) return uniqDirs(found, opts.platform);
  const profile = opts.env.USERPROFILE ?? '';
  if (!profile) return [];
  return [join(profile, 'Downloads', 'chat-exports')];
}

export interface SiteExportStat {
  /** 站点目录名（插件写的是 chat-exports/<站点>/） */
  site: string;
  /** 该站点下 .md 文件数 */
  count: number;
}

export interface SiteExportStatsOptions {
  dir: string;
  /** 列子目录名；失败返回 [] */
  listDirs: (path: string) => string[];
  /** 列目录下的文件名；失败返回 [] */
  listFiles: (path: string) => string[];
}

/**
 * 导出来源统计：`<采集目录>/<站点>/*.md` 的条数。
 * 只数**已有文件**，不猜站点：某家一次都没导出过就不出现在结果里（UI 据「已支持的站点」补齐空态）。
 * 只回计数，不回文件名/正文 —— 正文一律走采集链路入库。
 */
export function siteExportStats(opts: SiteExportStatsOptions): SiteExportStat[] {
  const out: SiteExportStat[] = [];
  for (const name of opts.listDirs(opts.dir)) {
    const site = name.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(site)) continue; // 非插件写的目录（如用户自建中文目录）不计
    const count = opts.listFiles(join(opts.dir, name)).filter((f) => /\.md$/i.test(f)).length;
    if (count > 0) out.push({ site, count });
  }
  return out.sort((a, b) => b.count - a.count || a.site.localeCompare(b.site));
}
