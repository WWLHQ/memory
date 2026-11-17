// 网页对话导出支持的站点（应用侧唯一词表）。
//
// 为什么要有第二份：插件 `browser-extension/webchat-exporter/shared/core.js` 是纯浏览器脚本，
// 不能用 ESM 导入应用侧模块，所以站点表天然是两份。这份是**应用侧**的（卡片来源列表、来源中文名），
// `shared/__tests__/webchatSites.test.ts` 会直接读插件那份 core.js 比对 key/label，
// 一旦两边漂了立刻判红 —— 允许两份实现，不允许两份真相。

export interface WebchatSite {
  /** 站点目录名，与插件写入的 `chat-exports/<key>/` 一致 */
  key: string;
  /** 中文名（UI 只显示这个） */
  label: string;
}

export const WEBCHAT_SITES: WebchatSite[] = [
  { key: 'deepseek', label: 'DeepSeek' },
  { key: 'doubao', label: '豆包' },
  { key: 'yiyan', label: '文心一言' },
  { key: 'qianwen', label: '千问' },
  { key: 'kimi', label: 'Kimi' },
  { key: 'chatglm', label: '智谱清言' },
  { key: 'mimo', label: '小米 MiMO' },
];

/** 站点 key → 中文名；未收录的（插件未来新增站点）原样返回，不编中文名 */
export function webchatSiteLabel(key: string): string {
  const k = key.trim().toLowerCase();
  return WEBCHAT_SITES.find((s) => s.key === k)?.label ?? key;
}
