// 网页采集窗口的识别判据（2026-11-19 根因修复）。
//
// main.ts 的 `app.on('browser-window-created')` 给**每一个** BrowserWindow 挂了导航闸门：
// 非自家 http(s) 导航一律 preventDefault + shell.openExternal。这对壳层窗口是对的，
// 但采集器/登录窗本来就要浏览外部站点——DeepSeek 扫码确认后的回调导航会被这个闸门
// 拦下并丢给系统浏览器（QQ浏览器），Electron 登录窗因此永远停在「扫码成功」页。
//
// 判据用 Electron Session 的 storagePath：`persist:webchat-<site>` 分区落在
// <userData>/Partitions/webchat-<site>，与自家的默认 Session 天然区分。
export function isWebchatStoragePath(path: unknown): boolean {
  if (typeof path !== 'string') return false;
  return /\/Partitions\/webchat-[^/]+\/?$/i.test(path.replace(/\\/g, '/'));
}
