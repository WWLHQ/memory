// 网页端接入页单测（批次55 补）：页面只渲染 p0-page 外壳 + WebchatAutoCard。
// 浏览器模式（无 window.__ELECTRON__/window.api）下卡片如实降级为「不可用」，
// 挂载路径无宿主 IPC 依赖，无需 mock（口径同 WebchatAutoCard.test.tsx 的「浏览器模式」用例）。
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebOnboardPage } from '../WebOnboardPage.tsx';

afterEach(() => {
  delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
  delete (window as unknown as { api?: unknown }).api;
  vi.restoreAllMocks();
});

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

  it('摘要里的「失败 2」给出站点、原因与处理办法，并有跳到指引的按钮', async () => {
    (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = {
      webchatAuto: {
        state: async () => ({
          ok: true,
          config: { enabled: true, intervalMinutes: 60, perRound: 3, sites: ['deepseek'] },
          running: false,
          lastRound: {
            at: Date.now(), trigger: 'timer',
            results: [
              { site: 'deepseek', status: 'dom_changed', scanned: 3, exported: 0, reason: '识别到 3 条但正文都没抽到' },
              { site: 'kimi', status: 'error', scanned: 0, exported: 0, reason: '本机接收端未就绪' },
            ],
          },
          nextAt: null,
          loginWindows: [],
          sites: [{ key: 'deepseek', label: 'DeepSeek' }, { key: 'kimi', label: 'Kimi' }],
          blocked: '',
          relogins: {},
        }),
        set: async () => ({ ok: true }), run: async () => ({ ok: true }), sweep: async () => ({ ok: true }), login: async () => ({ ok: true }),
      },
      chatExports: { get: async () => ({ ok: true, dir: 'C:\\chat-exports' }), open: async () => ({ ok: true }), set: async () => ({ ok: true }) },
    };
    render(<WebOnboardPage />);
    await waitFor(() => expect(screen.getByTestId('webonboard-failure-help')).toBeTruthy());
    expect(screen.getByTestId('webonboard-group-result').textContent).toContain('失败 2');
    const detail = screen.getByTestId('webonboard-failure-detail').textContent ?? '';
    expect(detail).toContain('DeepSeek');
    expect(detail).toContain('正文都没抽到');
    expect(detail).toContain('Kimi');
    expect(detail).toContain('接收端未就绪');
  });
});
