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
    // connectOverCDP 偶发被扩展 service worker 目标打断（"targetInfo: ..."），
    // 重连一次通常即可绕过（SW 目标已在上次连接中处理完）。
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        cached = await chromium.connectOverCDP(wsEndpoint);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!cached) throw lastErr;
    hookDialogAccept(cached);
  }
  return cached;
}

/**
 * 多 worker 共享一个 CDP 浏览器：每个连接都会交叉 auto-attach 到所有页面。
 * 未挂 dialog 监听器的 Playwright 连接收到 dialog 事件会【自动 dismiss】，
 * 与页面属主 worker 的 accept 竞速 → confirm 变 cancel，用例必挂。
 * 解法：每个 worker 对其可见的所有 context/page 一律挂容错 accept
 *（项目内 dialog 均为「确认继续」语义），所有会话行为一致，竞态消除。
 */
function hookDialogAccept(browser: Browser): void {
  const hook = (ctx: import('@playwright/test').BrowserContext) => {
    ctx.on('page', (p) => p.on('dialog', (d) => { d.accept().catch(() => { /* 已被处理 */ }); }));
    for (const p of ctx.pages()) p.on('dialog', (d) => { d.accept().catch(() => { /* 已被处理 */ }); });
  };
  for (const ctx of browser.contexts()) hook(ctx);
  browser.on('context', hook);
}

export const test = base.extend({
  page: async ({}, use) => {
    const browser = await externalBrowser();
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    // accept 已由 hookDialogAccept 在 browser/context 级统一接管
    await use(page);
    await page.close();
    await context.close();
  },
});

/**
 * 断开 CDP 连接。CDP 连接是长连接，不主动断开会吊住 worker 进程（teardown 卡死）。
 * 对 connectOverCDP 的 browser 调 close() 只会断开、不会杀掉外部 Chromium。
 * 注意：本机偶发 close() 挂起（iframe 页面残留连接），加 3s 超时兜底——
 * worker 进程退出后 CDP socket 自然释放，不影响外部 Chromium 存活。
 */
export async function disconnectBrowser(): Promise<void> {
  if (!cached) return;
  const b = cached;
  cached = null;
  await Promise.race([
    b.close(),
    new Promise<void>((r) => setTimeout(r, 3000)),
  ]);
}

/** 收集页面运行时异常（用于断言"无脚本异常"） */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message || String(e)));
  return errors;
}

export { expect };