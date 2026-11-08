// 中心区 iframe 跟随壳层主题（浅/深）。
// 壳层把主题写进 localStorage（memdesk.shell.theme.v1）；同源 iframe 监听 storage 事件即可同步，
// 不需要主进程额外传参。system 模式按 prefers-color-scheme 解析。
import { useEffect, useState } from 'react';

export const SHELL_THEME_KEY = 'memdesk.shell.theme.v1';

function readTheme(): 'light' | 'dark' {
  let mode = 'system';
  try {
    mode = localStorage.getItem(SHELL_THEME_KEY) ?? 'system';
  } catch {
    /* localStorage 不可用（隐私模式）→ 按系统偏好 */
  }
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

/** 返回当前应使用的主题，并在壳层切换主题/系统偏好变化时更新 */
export function useHostTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);

  useEffect(() => {
    const sync = () => setTheme(readTheme());
    window.addEventListener('storage', sync);
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    mq?.addEventListener('change', sync);
    sync();
    return () => {
      window.removeEventListener('storage', sync);
      mq?.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return theme;
}
