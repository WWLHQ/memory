// 宿主真扫端到端自测：覆盖 iframe 路径（用户实际点击路径）+ 直达路径
// 用法：node tools/selftest-iframe.cjs [exe路径]
//   不传参 → 用 dev 壳（electron + dist-electron/main.cjs）
//   传参   → 用指定 exe（如 dist/win-unpacked/多Agent记忆助手.exe）
const path = require('node:path');
const { _electron: electron } = require('playwright');
const electronPath = require('electron');

const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const watchdog = setTimeout(() => { log('RESULT: TIMEOUT'); process.exit(3); }, 120000);

const EXE_ARG = process.argv[2];

(async () => {
  const launchOpts = EXE_ARG
    ? {
        executablePath: path.resolve(EXE_ARG),
        args: ['--no-sandbox'],
        cwd: path.dirname(path.resolve(EXE_ARG)),
      }
    : {
        executablePath: electronPath,
        args: [path.join(process.cwd(), 'dist-electron/main.cjs'), '--no-sandbox'],
        cwd: process.cwd(),
      };
  log('target:', EXE_ARG ? launchOpts.executablePath : '(dev shell)');

  const app = await electron.launch({
    ...launchOpts,
    timeout: 60000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  const origin = await win.evaluate(() => window.location.origin);
  await win.evaluate(() => localStorage.setItem('session:realpage', 'selftest'));

  const scan = async (fr, tag) => {
    await fr.waitForSelector('#btnDiscover', { timeout: 20000 });
    const env = await fr.evaluate(() => ({
      isElectron: window.__ELECTRON__ === true,
      hasHostScan: !!(window.api && window.api.hostScan),
      hasStorage: !!(window.api && window.api.storage),
    }));
    log(`[${tag}] env:`, JSON.stringify(env));
    await fr.click('#btnDiscover');
    await fr.waitForFunction(
      () => (document.querySelector('#scanState')?.textContent ?? '').includes('完成'),
      { timeout: 25000 },
    );
    const out = await fr.evaluate(() => ({
      badge: document.querySelector('#formBadge')?.textContent ?? '',
      scanState: document.querySelector('#scanState')?.textContent ?? '',
      rows: [...document.querySelectorAll('#found .found')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    }));
    log(`[${tag}] badge:`, out.badge);
    log(`[${tag}] scanState:`, out.scanState);
    out.rows.forEach((r) => log(`[${tag}]   -`, r));
    return { env, ...out };
  };

  // ---- 路径A：概览页 iframe 内（用户实际点击路径）----
  log('[A] overview.html → Agent 接入 iframe ...');
  await win.goto(`${origin}/overview.html?backend=http://127.0.0.1:8200`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await win.waitForSelector('#nav .item', { timeout: 20000 }).catch(() => {});
  const clicked = await win.evaluate(() => {
    const items = [...document.querySelectorAll('#nav .item')];
    const target = items.find((e) => (e.querySelector('.lbl')?.firstChild?.textContent || '').trim() === 'Agent 接入配置页');
    if (target) { target.click(); return true; }
    return false;
  });
  if (!clicked) {
    const labels = await win.evaluate(() => ({
      itemCount: document.querySelectorAll('#nav .item').length,
      labels: [...document.querySelectorAll('#nav .item .lbl')].map((e) => (e.textContent || '').trim()).slice(0, 20),
      bodySnip: (document.body?.innerText || '').slice(0, 300),
    }));
    log('[A] FAIL: 未找到「Agent 接入配置页」导航项；nav=', JSON.stringify(labels, null, 1));
    clearTimeout(watchdog); await app.close().catch(() => {}); process.exit(1);
  }
  await win.waitForFunction(
    () => [...document.querySelectorAll('iframe')].some((f) => /agentonboard\.html/.test(f.src || '')),
    { timeout: 20000 },
  ).catch(() => {});
  const fr = win.frames().find((f) => /agentonboard\.html/.test(f.url()));
  if (!fr) {
    log('[A] FAIL: 未找到 agentonboard iframe；frames=', JSON.stringify(win.frames().map((f) => f.url())));
    clearTimeout(watchdog); await app.close().catch(() => {}); process.exit(1);
  }
  const a = await scan(fr, 'A-iframe');

  // ---- 路径B：直达 ----
  log('[B] direct agentonboard.html ...');
  await win.goto(`${origin}/agentonboard.html?backend=http://127.0.0.1:8200`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const b = await scan(win, 'B-direct');

  // iframe 内本就没有 preload（isElectron=false 属预期），判据是「经宿主桥拿到宿主真扫结果」
  const passA = a.scanState.includes('宿主真扫') && a.badge.includes('概览页内嵌');
  const passB = b.env.isElectron && b.scanState.includes('宿主真扫');
  log(passA && passB ? 'RESULT: PASS（iframe + 直达 均为宿主真扫）' : `RESULT: FAIL（A=${passA} B=${passB}）`);
  clearTimeout(watchdog);
  await app.close().catch(() => {});
  process.exit(passA && passB ? 0 : 1);
})().catch((e) => { clearTimeout(watchdog); log('ERROR:', (e && e.message) ? e.message : String(e)); process.exit(2); });
