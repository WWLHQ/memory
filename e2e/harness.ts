// E2E 测试基座：覆盖 page fixture，改用「外部已启动的 Chromium（CDP 连接）」。
// 背景：本机（受限 Windows）下 Playwright 拥有浏览器时，browser.close() 会挂起导致 teardown 卡死；
// 改为 globalSetup 里 detached 启动 Chrome + connectOverCDP，则 runner 不拥有该进程，断开即退出。
import { test as base, expect, chromium, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WS_FILE = join(dirname(fileURLToPath(import.meta.url)), '.cde.json');
const BASE_URL = 'http://localhost:8123';

let cached: Browser | null = null;

async function externalBrowser(): Promise<Browser> {
  if (!cached) {
    const { wsEndpoint } = JSON.parse(readFileSync(WS_FILE, 'utf-8')) as { wsEndpoint: string };
    cached = await chromium.connectOverCDP(wsEndpoint);
  }
  return cached;
}

export const test = base.extend({
  page: async ({}, use) => {
    const browser = await externalBrowser();
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await use(page);
    await page.close();
    await context.close();
  },
});

/**
 * 断开 CDP 连接。CDP 连接是长连接，不主动断开会吊住 worker 进程（teardown 卡死）。
 * 对 connectOverCDP 的 browser 调 close() 只会断开、不会杀掉外部 Chromium。
 */
export async function disconnectBrowser(): Promise<void> {
  if (!cached) return;
  const b = cached;
  cached = null;
  await b.close();
}

/** 收集页面运行时异常（用于断言"无脚本异常"） */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message || String(e)));
  return errors;
}

export { expect };