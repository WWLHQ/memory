// 站点词表与浏览器插件必须一致（允许两份实现，不允许两份真相）。
//
// 应用侧 `src/shared/webchatSites.ts` 与插件侧 `browser-extension/webchat-exporter/shared/core.js`
// 天然是两份：插件是纯浏览器脚本，不能 import 应用侧 ESM。所以这里直接读插件源码比对 key/label，
// 任何一边改了站点（新增/改名/删站）而另一边没跟上，立刻判红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WEBCHAT_SITES, webchatSiteLabel } from '../webchatSites.ts';

const CORE = resolve(process.cwd(), 'browser-extension/webchat-exporter/shared/core.js');

interface PluginSite { key: string; label: string }

/** 从插件 core.js 里抠出 SITES 表的 key/label（不执行插件代码，纯文本解析，避免把浏览器专有 API 拉进来） */
function pluginSites(): PluginSite[] {
  const src = readFileSync(CORE, 'utf8');
  const out: PluginSite[] = [];
  const re = /key:\s*'([^']+)',\s*\n\s*label:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push({ key: m[1], label: m[2] });
  return out;
}

describe('webchatSites（应用侧站点词表）', () => {
  it('与插件 core.js 的 SITES 完全一致（key 与中文名都不许漂）', () => {
    const plugin = pluginSites();
    expect(plugin.length).toBeGreaterThan(0); // 解析失败要立刻暴露，不能静默通过
    expect(WEBCHAT_SITES).toEqual(plugin);
  });

  it('用户点名的三家（DeepSeek / 豆包 / 千问）在表里', () => {
    const keys = WEBCHAT_SITES.map((s) => s.key);
    expect(keys).toContain('deepseek');
    expect(keys).toContain('doubao');
    expect(keys).toContain('qianwen');
  });

  it('站点中文名：已知站点给人话，未收录站点原样返回（不编中文名）', () => {
    expect(webchatSiteLabel('deepseek')).toBe('DeepSeek');
    expect(webchatSiteLabel('doubao')).toBe('豆包');
    expect(webchatSiteLabel('qianwen')).toBe('千问');
    expect(webchatSiteLabel('DEEPSEEK')).toBe('DeepSeek'); // 大小写不敏感
    expect(webchatSiteLabel('brandnew')).toBe('brandnew');
  });
});
