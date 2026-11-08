// 中心区 iframe → 壳层导航（概览页快捷胶囊 / 洞察跳转用）。
// 页面只发导航意图；实际开标签、切视图由壳层 Workspace 执行（壳层不认识的消息一律忽略）。
export const SHELL_GOTO_MSG = 'memdesk:goto';

/** 请求壳层打开某个导航项（id 取自 shell/views.ts 的 NAV） */
export function requestShellView(id: string): void {
  if (typeof window === 'undefined') return;
  const parent = window.parent;
  if (!parent || parent === window) return;
  parent.postMessage({ [SHELL_GOTO_MSG]: id }, window.location.origin);
}
