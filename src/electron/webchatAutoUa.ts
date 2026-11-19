// 内嵌浏览器 UA 的最小去标记处理（2026-11-19）。
//
// 为什么只去掉 `Electron/x.y.z`：
//   · DeepSeek 前端检查 navigator.userAgent 是否含 electron，命中就弹「使用环境异常」；
//   · 同类内嵌实现（dsh-webview / dsh-webchat）的实测口径一致：只剥离这个 token，
//     其余 Chromium 指纹原样保留；伪造整套 Chrome UA 会造成版本指纹失配，反而加重风控。
// 所以这里只做删除，不改写任何版本号、平台串或引擎串。
const ELECTRON_TOKEN = /(?:^|\s+)Electron\/[\w.+-]+/gi;

/** 去掉 UA 中的 Electron 标记；没有标记时原样返回（一字不改） */
export function stripElectronUa(ua: string): string {
  return ua.replace(ELECTRON_TOKEN, '');
}

export interface UaWebContents {
  getUserAgent(): string;
  setUserAgent(ua: string): void;
}

/** 在任何 loadURL 之前调用：读取当前 UA → 剥离标记 → 写回 */
export function applyCleanUserAgent(wc: UaWebContents): void {
  wc.setUserAgent(stripElectronUa(wc.getUserAgent()));
}
