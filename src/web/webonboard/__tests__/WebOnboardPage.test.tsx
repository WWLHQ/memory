// 网页端接入页单测（批次55 补）：页面只渲染 p0-page 外壳 + WebchatAutoCard。
// 浏览器模式（无 window.__ELECTRON__/window.api）下卡片如实降级为「不可用」，
// 挂载路径无宿主 IPC 依赖，无需 mock（口径同 WebchatAutoCard.test.tsx 的「浏览器模式」用例）。
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WebOnboardPage } from '../WebOnboardPage.tsx';

describe('WebOnboardPage（批次55：深色主题适配）', () => {
  it('跟随壳层深色主题：挂载即设置 html[data-theme="dark"]', () => {
    // 批次55：深色主题适配正向断言
    localStorage.setItem('memdesk.shell.theme.v1', 'dark');
    try {
      render(<WebOnboardPage />);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    } finally {
      localStorage.setItem('memdesk.shell.theme.v1', 'light');
      document.documentElement.removeAttribute('data-theme');
    }
  });
});
