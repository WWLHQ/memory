import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 假 BrowserWindow：不连真 Electron，只把「UA 是否在 loadURL 前被改写」这件事变成可断言的调用序列。
const H = vi.hoisted(() => {
  const created: Array<{
    options: Record<string, unknown>;
    appliedUa: string | null;
    execCount: number;
  }> = [];
  const events: string[] = [];
  const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36 Electron/45.1.0';

  class FakeBrowserWindow {
    options: Record<string, unknown>;
    webContents: {
      getUserAgent: () => string;
      setUserAgent: (ua: string) => void;
      setWindowOpenHandler: (h: unknown) => void;
      loadURL: (url: string) => Promise<void>;
      executeJavaScript: (src: string) => Promise<unknown>;
      openHandler?: unknown;
      appliedUa: string | null;
    };
    destroyed = false;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.webContents = {
        appliedUa: null,
        getUserAgent: () => { events.push('get-ua'); return DEFAULT_UA; },
        setUserAgent: (ua: string) => {
          events.push(`set-ua:${ua}`);
          this.webContents.appliedUa = ua;
          const rec = created.find((x) => x.options === this.options);
          if (rec) rec.appliedUa = ua;
        },
        setWindowOpenHandler: (h: unknown) => { events.push('popup-handler'); this.webContents.openHandler = h; },
        loadURL: async (url: string) => { events.push(`load:${url}`); },
        executeJavaScript: async () => {
          events.push('exec');
          const rec = created.find((x) => x.options === this.options)!;
          rec.execCount += 1;
          // 第一针注入 core.js；第二针取驱动结果。needRelogin 让这一轮零点击、不发网络请求。
          return rec.execCount === 2
            ? { items: [], chats: [], steps: [], needRelogin: true }
            : undefined;
        },
      };
      created.push({ options, appliedUa: null, execCount: 0 });
    }
    loadURL(url: string): Promise<void> { return this.webContents.loadURL(url); }
    on(): void {}
    show(): void {}
    focus(): void {}
    destroy(): void { this.destroyed = true; }
    isDestroyed(): boolean { return this.destroyed; }
  }

  return { created, events, FakeBrowserWindow, DEFAULT_UA };
});

vi.mock('electron', () => ({ BrowserWindow: H.FakeBrowserWindow }));

import { createWebchatAutoCollector } from '../webchatAutoCollect.ts';

function makeDeps() {
  const root = mkdtempSync(join(tmpdir(), 'mam-ua-test-'));
  const core = join(root, 'core.js');
  writeFileSync(core, 'void 0;', 'utf8');
  return {
    root: () => root,
    coreJsPath: () => core,
    ingest: () => ({ port: 8201, token: 'test' }),
    exportDir: () => join(root, 'exports'),
    log: () => {},
  };
}

function assertCleanUaApplied(index: number): void {
  const rec = H.created[index];
  expect(rec).toBeTruthy();
  expect(rec.appliedUa).toBeTruthy();
  expect(rec.appliedUa!.toLowerCase()).not.toContain('electron');
  expect(rec.appliedUa).toContain('Chrome/131.0.0.0');
  const setAt = H.events.findIndex((e) => e.startsWith('set-ua:'));
  const loadAt = H.events.findIndex((e) => e.startsWith('load:'));
  expect(setAt).toBeGreaterThanOrEqual(0);
  expect(loadAt).toBeGreaterThanOrEqual(0);
  expect(setAt).toBeLessThan(loadAt);
}

describe('采集器两类窗口都剥掉 Electron UA 标记', () => {
  beforeEach(() => {
    H.created.length = 0;
    H.events.length = 0;
  });

  it('登录窗在 loadURL 前剥离，且沿用 persist 分区', async () => {
    const c = createWebchatAutoCollector(makeDeps());
    try {
      const r = await c.openLogin('deepseek');
      expect(r.ok).toBe(true);
      expect(H.created).toHaveLength(1);
      expect((H.created[0].options.webPreferences as Record<string, unknown>).partition)
        .toBe('persist:webchat-deepseek');
      assertCleanUaApplied(0);
      expect(c.state().loginWindows).toEqual(['deepseek']);
    } finally {
      c.stop();
    }
  });

  it('隐藏采集窗在 loadURL 前剥离', async () => {
    const c = createWebchatAutoCollector(makeDeps());
    try {
      const summary = await c.runNow();
      expect(summary.results[0].status).toBe('need_relogin');
      expect(H.created).toHaveLength(1);
      expect(H.created[0].options.show).toBe(false);
      assertCleanUaApplied(0);
      expect(H.events).toContain('popup-handler');
    } finally {
      c.stop();
    }
  });
});
