// 网页对话导出目录「探测」单测。
// 口径：插件只能用「相对浏览器下载目录」的文件名（Chromium 拒绝绝对路径），所以它的真实落点
// 只能从浏览器 Preferences 里读 download.default_directory 推出来；读不到就回落系统默认下载目录。
// 这里锁住：字段缺失是正常情况、JSON 损坏不抛错、非绝对路径不接受、Win 路径大小写不敏感。
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  browserPreferenceFiles, browserUserDataDirs, detectChatExportsDirs, detectDownloadDirs,
  downloadDirFromPreferences, samePath, siteExportStats,
} from '../chatExportsLocations.ts';

const LOCAL = 'C:\\Users\\test\\AppData\\Local';
const env = { LOCALAPPDATA: LOCAL, USERPROFILE: 'C:\\Users\\test' };

function opts(over: Partial<Parameters<typeof detectChatExportsDirs>[0]> = {}) {
  return {
    env,
    platform: 'win32' as NodeJS.Platform,
    readText: () => null,
    listDirs: () => [],
    ...over,
  };
}

describe('chatExportsLocations', () => {
  it('从 Preferences 里读 download.default_directory', () => {
    const text = JSON.stringify({ download: { default_directory: 'D:\\DL\\' } });
    expect(downloadDirFromPreferences(text)).toBe('D:\\DL');
  });

  it('没改过下载目录（字段缺失）是正常情况 → null，不当作错误', () => {
    expect(downloadDirFromPreferences(JSON.stringify({ download: {} }))).toBeNull();
    expect(downloadDirFromPreferences(JSON.stringify({}))).toBeNull();
    expect(downloadDirFromPreferences('')).toBeNull();
    expect(downloadDirFromPreferences(null)).toBeNull();
  });

  it('JSON 损坏或路径不是绝对路径 → 不接受，绝不猜', () => {
    expect(downloadDirFromPreferences('{not json')).toBeNull();
    expect(downloadDirFromPreferences(JSON.stringify({ download: { default_directory: 'Downloads' } }))).toBeNull();
    expect(downloadDirFromPreferences(JSON.stringify({ download: { default_directory: '   ' } }))).toBeNull();
  });

  it('Preferences 候选覆盖 Edge 与 QQ 的每个 profile', () => {
    const listDirs = (p: string): string[] =>
      p.includes('Microsoft\\Edge') ? ['Default', 'Profile 1'] : ['Default'];
    const files = browserPreferenceFiles(opts({ listDirs }));
    expect(files).toContain(join(LOCAL, 'Microsoft', 'Edge', 'User Data', 'Default', 'Preferences'));
    expect(files).toContain(join(LOCAL, 'Microsoft', 'Edge', 'User Data', 'Profile 1', 'Preferences'));
    expect(files).toContain(join(LOCAL, 'Tencent', 'QQBrowser', 'User Data', 'Default', 'Preferences'));
    // 非 Windows 不产生任何候选
    expect(browserUserDataDirs(opts({ platform: 'linux' }))).toEqual([]);
  });

  it('探测到的下载目录去重（多 profile 同名目录只留一个）', () => {
    const text = JSON.stringify({ download: { default_directory: 'D:\\DL' } });
    const dirs = detectDownloadDirs(opts({ readText: () => text, listDirs: () => ['Default', 'Profile 1'] }));
    expect(dirs).toEqual(['D:\\DL']);
  });

  it('插件落点 = 下载目录 / chat-exports', () => {
    const text = JSON.stringify({ download: { default_directory: 'D:\\DL' } });
    const dirs = detectChatExportsDirs(opts({ readText: () => text, listDirs: () => ['Default'] }));
    expect(dirs).toEqual([join('D:\\DL', 'chat-exports')]);
  });

  it('一个都没探到 → 回落 %USERPROFILE%\\Downloads\\chat-exports', () => {
    expect(detectChatExportsDirs(opts())).toEqual([join('C:\\Users\\test', 'Downloads', 'chat-exports')]);
  });

  it('没有 USERPROFILE 或非 Windows → 返回空数组，让调用方退回数据根', () => {
    expect(detectChatExportsDirs(opts({ env: { LOCALAPPDATA: LOCAL } }))).toEqual([]);
    expect(detectChatExportsDirs(opts({ platform: 'darwin' }))).toEqual([]);
  });

  it('路径比对：Win 下大小写与末尾分隔符不敏感', () => {
    expect(samePath('C:\\Users\\A\\chat-exports', 'c:\\users\\a\\chat-exports\\', 'win32')).toBe(true);
    expect(samePath('C:\\Users\\A\\chat-exports', 'C:\\Users\\A\\other', 'win32')).toBe(false);
  });
});

// 导出来源统计：卡片「导出来源」要能看出是 DeepSeek / 豆包 / 千问 哪家导出过
describe('siteExportStats（按站点数导出文件）', () => {
  function stats(tree: Record<string, string[]>) {
    return siteExportStats({
      dir: 'C:\\dl\\chat-exports',
      listDirs: () => Object.keys(tree),
      listFiles: (p) => tree[p.split('\\').pop() ?? ''] ?? [],
    });
  }

  it('按站点目录数 .md，条数多的排前面', () => {
    expect(stats({
      deepseek: ['a.md', 'b.md', 'c.md'],
      doubao: ['a.md'],
      qianwen: ['a.md', 'b.md'],
    })).toEqual([
      { site: 'deepseek', count: 3 },
      { site: 'qianwen', count: 2 },
      { site: 'doubao', count: 1 },
    ]);
  });

  it('空目录 / 只有非 md 文件 → 不出现（没导出过就不编）', () => {
    expect(stats({ deepseek: [], doubao: ['x.json', 'y.txt'] })).toEqual([]);
  });

  it('非插件目录（中文自建目录）不计入，只数合法站点目录', () => {
    expect(stats({ '我的导出': ['a.md'], deepseek: ['a.md'] })).toEqual([{ site: 'deepseek', count: 1 }]);
  });

  it('站点名大小写归一（插件写 DeepSeek 也认）', () => {
    expect(stats({ DeepSeek: ['a.md'] })).toEqual([{ site: 'deepseek', count: 1 }]);
  });

  it('目录读不到（listDirs 返回空）→ 空结果，不抛错', () => {
    expect(siteExportStats({
      dir: 'C:\\nope', listDirs: () => [], listFiles: () => [],
    })).toEqual([]);
  });
});
