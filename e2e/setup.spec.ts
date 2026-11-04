// E2E 测试：首启强制向导 setup.html（批次37-B；本规格补上它的点击级覆盖）。
//
// 这套 E2E 跑在**真构建产物**上（run.mjs 先 `npx vite build`，此处 startStatic 直接服务 dist/），
// 但**没有 Electron 主进程**：harness 用 CDP 连外部 Chromium，页面拿不到 preload 注入的 window.api。
// 所以本规格分两种口径，断言的都是真实代码路径，不含冒充：
//   ① 不打桩 → 走 hostBridge.hostCapability() 的真判定 + 打包后 SetupPage 的真降级分支。
//      这是唯一能在浏览器里证明「纯浏览器模式不假装设置成功」的方式。
//   ② 打桩 window.__ELECTRON__ / window.api.setup.*（见 installSetupStub）→ 真跑 dist 里的
//      SetupPage + desktop/hostBridge 的 native 调用链：CHANNEL_TO_NATIVE 的
//      setup.{state,reselectDirs,setL0Password,regenCode,exportCard,finish} 映射、参数透传、
//      每步之后的 refresh 重拉、以及 setupEntry 未注入 onNavigate 时那次真导航，全部被执行。
//      桩逐条镜像 main.ts §6e 的真返回（文案抄自源码，状态机 admin_wrap / pendingRecoveryCard /
//      recoveryCardExported 与之一一对应）。
//   **桩证明不了的部分（如实声明）**：真密钥环与 DEK 封装、真原生「另存为」对话框、
//   setupDone 落盘与主窗口门禁、两个库文件真的被创建——分别由 dataRoot.test.ts、
//   core/memagent 的 l0* 单测、SetupPage.test.tsx 与批次37 手测报告 §4 的实机走查负责。
import { test, expect, disconnectBrowser, collectErrors } from './harness.ts';
import { startStatic, type StaticServer } from './servers.ts';

// 与 main.ts §6e 逐字一致的四条拒绝文案（源码改了这里会红，是故意的）
const ERR_ALREADY_SET_PASSWORD = '本机已设过 L0 管理密码：请在「安全」页用恢复码找回，向导不再改密码';
// setup:regenCode 走 vault.unlockWrite，密码错的文案在 l0vault.ts:491（§4.4.4 口径）
const ERR_BAD_WRITE_PASSWORD = '管理密码错误（§4.4.4）';
const ERR_RESELECT_CANCELED = '未选择目录：保持原位置不变';
const ERR_PERSIST_POINTER = '无法写入数据位置指针（首启设置没保存）：请检查该目录是否可写后重试';

interface StubConfig {
  /** 指针里 ledgerDir + l0Dir 都已选定 */
  dirsSet: boolean;
  /** 密钥环已有 admin_wrap（= 本机此前设过 L0 管理密码） */
  hasAdminPassword: boolean;
  /** setup:regenCode 交上去的密码不对：走 l0Fail(e)，返回真实错误文案 */
  regenWrongPassword?: boolean;
  /** setup:reselectDirs 在原生目录对话框点了取消 */
  reselectCanceled?: boolean;
  /** setup:exportCard 在原生另存为对话框点了取消 */
  exportCanceled?: boolean;
  /** setup:finish 时 persistPointer 失败：三步看起来都完成，仍拒绝进入应用 */
  finishRejects?: boolean;
  nextUrl?: string;
}

const FIRST_RUN: StubConfig = { dirsSet: true, hasAdminPassword: false };
const ALREADY_SET: StubConfig = { dirsSet: true, hasAdminPassword: true };

/**
 * 页面脚本之前安装 window.api.setup 桩。
 * 注意：函数体会被 Playwright 序列化后在浏览器里执行，**不能引用本文件作用域的任何变量**，
 * 所以下面把 main.ts 的文案重复写了一遍字面量（与上面的常量必须保持一致）。
 */
function installSetupStub(cfg: StubConfig): void {
  const LEDGER_DIR = 'C:\\MultiAgentE2E\\ledger';
  const L0_DIR = 'C:\\MultiAgentE2E\\l0';
  // 与 l0Recovery.ts 同构：32 字节 → base64url 43 字符 → 每 4 字符一组空格分隔（真码来自 randomBytes，这里固定才可断言）
  const RAW_CODE = 'M6b9Q0xKz2pLs8tRd1Yv7cAe4nHw3jUq5fTg6iBkQ7f';
  const GROUPED_CODE = (RAW_CODE.match(new RegExp('.{1,4}', 'g')) ?? []).join(' ');
  const FINGERPRINT = 'a1b2c3d4';
  const s = {
    dirs_set: cfg.dirsSet,
    has_admin_password: cfg.hasAdminPassword,
    /** = main.ts 的 pendingRecoveryCard：本「进程」发过码才有 */
    pending: null as null | { grouped: string },
    /** = main.ts 的 recoveryCardExported */
    exported: false,
  };
  const state = () => ({
    ok: true,
    setup_done: false,
    dirs_set: s.dirs_set,
    ledger_dir: LEDGER_DIR,
    l0_dir: L0_DIR,
    same_dir: false,
    ledger_file: { path: LEDGER_DIR + '\\memories.db.json', exists: true, bytes: 21153428 },
    l0_file: { path: L0_DIR + '\\memories.l0.json', exists: false, bytes: 0 },
    has_admin_password: s.has_admin_password,
    write_unlocked: false,
    has_recovery: s.pending !== null,
    card_pending: s.pending !== null && !s.exported,
    card_exported: s.exported,
    fingerprint: s.pending !== null || s.has_admin_password ? FINGERPRINT : '',
  });
  /** = main.ts 的 issueRecoveryCard：发新码即作废上一次导出 */
  const issue = () => {
    s.pending = { grouped: GROUPED_CODE };
    s.exported = false;
    s.has_admin_password = true;
    return {
      ok: true,
      recovery_code: RAW_CODE,
      recovery_code_grouped: GROUPED_CODE,
      fingerprint: FINGERPRINT,
      created_at: Date.now(),
    };
  };
  const setup = {
    state: async () => state(),
    reselectDirs: async () =>
      cfg.reselectCanceled ? { ok: false, canceled: true, error: '未选择目录：保持原位置不变' } : { ok: true, relaunch: true },
    setL0Password: async (password?: string) => {
      if (typeof password !== 'string') return { ok: false, error: '管理密码必须是字符串' };
      if (s.has_admin_password) return { ok: false, error: '本机已设过 L0 管理密码：请在「安全」页用恢复码找回，向导不再改密码' };
      return issue();
    },
    regenCode: async (password?: string) => {
      if (!s.has_admin_password) return { ok: false, error: '尚未设置 L0 管理密码：请先完成上一步' };
      if (cfg.regenWrongPassword || password !== 'E2ePass#2026') return { ok: false, code: 'E_AUTH_L0', error: '管理密码错误（§4.4.4）' };
      return issue();
    },
    exportCard: async () => {
      if (s.pending === null) {
        return { ok: false, error: '本次没有待导出的恢复卡：恢复码只在生成那一次可见，请重新换发一张' };
      }
      if (cfg.exportCanceled) {
        return { ok: false, canceled: true, error: '未导出恢复卡：恢复码仍在内存里，可再次点击导出' };
      }
      s.exported = true;
      return { ok: true, file_name: 'L0恢复卡-' + FINGERPRINT + '.txt', inside_data_root: false, fingerprint: FINGERPRINT };
    },
    finish: async () => {
      if (!s.has_admin_password) return { ok: false, error: '还没设置 L0 管理密码：这一步不能跳' };
      if (!s.exported || s.pending === null) {
        return { ok: false, error: '恢复卡还没导出：没有这张卡，忘记管理密码时 L0 原文就找不回来' };
      }
      if (cfg.finishRejects) return { ok: false, error: '无法写入数据位置指针（首启设置没保存）：请检查该目录是否可写后重试' };
      return { ok: true, next_url: cfg.nextUrl ?? '/overview.html' };
    },
  };
  const api = { setup, log: { write: () => { /* E2E 里动作日志不落盘，保持空实现 */ } } };
  const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };
  w.__ELECTRON__ = true;
  w.api = api;
}

let staticSrv: StaticServer | undefined;
let WIZARD = '';
let AFTER_WIZARD = '';

test.beforeAll(async () => {
  staticSrv = await startStatic(0, 'dist');
  const origin = `http://localhost:${staticSrv.port}`;
  WIZARD = `${origin}/setup.html`;
  // setup:finish 返回的 next_url 由主进程给；这里给同源的下一页，用来断言「真的换了地址」
  AFTER_WIZARD = `${origin}/overview.html`;
});

test.afterAll(async () => {
  await staticSrv?.stop();
  await disconnectBrowser();
});

test.describe('首启向导 · 纯浏览器模式（没有主进程 = 不假装设置成功）', () => {
  test('setup.html 真产物：只给不可用说明，三步卡片一个都不渲染', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(WIZARD);
    await expect(page.locator('[data-testid="setup-unavailable"]')).toBeVisible();
    await expect(page.locator('[data-testid="setup-unavailable"]')).toContainText('纯浏览器模式');
    // 红线：降级分支里不出现任何「已完成 / 可进入」的样子，也没有可点的假按钮
    await expect(page.locator('[data-testid="setup-step-dirs"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="setup-step-password"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="setup-step-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="setup-finish"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('宿主只有半个 api（没有 setup 方法）时同样如实失败，不给假进度', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };
      w.__ELECTRON__ = true;
      w.api = { setup: {} };
    });
    await page.goto(WIZARD);
    await expect(page.locator('[data-testid="setup-error"]')).toContainText('首启进度读取失败');
    await expect(page.locator('[data-testid="setup-finish"]')).toBeDisabled();
    expect(errors).toEqual([]);
  });
});

test.describe('首启向导 · 首次设置（打桩主进程 §6e，跑 dist 里的真 SetupPage + hostBridge）', () => {
  test('三步进度严格来自 setup:state：没设密码时 finish 禁用并写明原因', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(installSetupStub, FIRST_RUN);
    await page.goto(WIZARD);
    await expect(page.locator('[data-testid="setup-intro"]')).toContainText('① 两个库放在哪 ② L0 管理密码 ③ 导出恢复卡');
    await expect(page.locator('[data-testid="setup-step-dirs"]')).toContainText('① 已完成');
    await expect(page.locator('[data-testid="setup-step-dirs"]')).toContainText('memories.db.json');
    await expect(page.locator('[data-testid="setup-step-dirs"]')).toContainText('密钥环 l0-keyring.json 与原数据库同目录');
    await expect(page.locator('[data-testid="setup-step-password"]')).toContainText('② 待完成');
    await expect(page.locator('[data-testid="setup-step-card"]')).toContainText('③ 待完成');
    await expect(page.locator('[data-testid="setup-card-none"]')).toBeVisible();
    await expect(page.locator('[data-testid="setup-finish"]')).toBeDisabled();
    await expect(page.locator('[data-testid="setup-finish-hint"]')).toContainText('三步都完成后才可点');
    expect(errors).toEqual([]);
  });

  test('密码表单闸门：≥8 位且两次一致才可提交', async ({ page }) => {
    await page.addInitScript(installSetupStub, FIRST_RUN);
    await page.goto(WIZARD);
    const submit = page.locator('[data-testid="setup-pw-submit"]');
    const pw = page.locator('[data-testid="setup-pw"]');
    const pw2 = page.locator('[data-testid="setup-pw2"]');
    await expect(submit).toBeDisabled();
    await pw.fill('short7!');
    await pw2.fill('short7!');
    await expect(submit).toBeDisabled();
    await pw.fill('E2ePass#2026');
    await pw2.fill('E2ePass#2025');
    await expect(submit).toBeDisabled();
    await pw2.fill('E2ePass#2026');
    await expect(submit).toBeEnabled();
  });

  test('设密码 → 恢复码只在这一屏出现一次 → 导出 → finish 真导航进应用', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(installSetupStub, { ...FIRST_RUN, nextUrl: AFTER_WIZARD });
    await page.goto(WIZARD);
    await page.locator('[data-testid="setup-pw"]').fill('E2ePass#2026');
    await page.locator('[data-testid="setup-pw2"]').fill('E2ePass#2026');
    await page.locator('[data-testid="setup-pw-submit"]').click();

    // 第②步变「已完成」靠的是提交后重拉 setup:state，不是页面自己改口
    await expect(page.locator('[data-testid="setup-step-password"]')).toContainText('② 已完成');
    const code = page.locator('[data-testid="setup-code"]');
    await expect(code).toBeVisible();
    await expect(code).toContainText('M6b9 Q0xK');
    await expect(page.locator('[data-testid="setup-code-once"]')).toContainText('关掉本页就再也看不到');
    // 三条红线之一必须摆在明面，不能藏进折叠区
    await expect(page.locator('[data-testid="setup-card-warning"]')).toContainText('管理密码和这张卡同时丢失，L0 原文就不可恢复');
    await expect(page.locator('[data-testid="setup-not-exported"]')).toBeVisible();
    await expect(page.locator('[data-testid="setup-finish"]')).toBeDisabled();

    // 明文只在 DOM 这一次，绝不进 storage
    const leaked = await page.evaluate(() => {
      const hit = (store: Storage): string[] =>
        Object.keys(store).filter((k) => (store.getItem(k) ?? '').includes('M6b9Q0xK') || k.includes('recovery'));
      return [...hit(localStorage), ...hit(sessionStorage)];
    });
    expect(leaked).toEqual([]);

    await page.locator('[data-testid="setup-export"]').click();
    await expect(page.locator('[data-testid="setup-export-result"]')).toContainText('已导出「L0恢复卡-a1b2c3d4.txt」');
    await expect(page.locator('[data-testid="setup-export-result"]')).toContainText('与这台电脑分开');
    await expect(page.locator('[data-testid="setup-step-card"]')).toContainText('③ 已完成');
    await expect(page.locator('[data-testid="setup-not-exported"]')).toHaveCount(0);
    expect(errors).toEqual([]);

    await expect(page.locator('[data-testid="setup-finish"]')).toBeEnabled();
    await page.locator('[data-testid="setup-finish"]').click();
    // setupEntry 没注入 onNavigate → 断言的是页面真的换了地址
    await page.waitForURL(AFTER_WIZARD);
    await expect(page.locator('[data-testid="setup-step-finish"]')).toHaveCount(0);
  });

  test('导出时在原生对话框点取消：如实说「可以再点一次」，且不放开 finish', async ({ page }) => {
    await page.addInitScript(installSetupStub, { ...FIRST_RUN, exportCanceled: true });
    await page.goto(WIZARD);
    await page.locator('[data-testid="setup-pw"]').fill('E2ePass#2026');
    await page.locator('[data-testid="setup-pw2"]').fill('E2ePass#2026');
    await page.locator('[data-testid="setup-pw-submit"]').click();
    await page.locator('[data-testid="setup-export"]').click();
    await expect(page.locator('[data-testid="setup-export-result"]')).toContainText('已取消保存：恢复码还在内存里，可以再点一次导出。');
    await expect(page.locator('[data-testid="setup-step-card"]')).toContainText('③ 待完成');
    await expect(page.locator('[data-testid="setup-finish"]')).toBeDisabled();
  });
});

test.describe('首启向导 · 本机已设过 L0 管理密码（升级 / 上一轮中断的真实分支）', () => {
  test('第②步只给「用密码重新发码」，不再出现设密码表单', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(installSetupStub, ALREADY_SET);
    await page.goto(WIZARD);
    await expect(page.locator('[data-testid="setup-step-password"]')).toContainText('② 已完成');
    await expect(page.locator('[data-testid="setup-pw-set"]')).toContainText('本机已设置 L0 管理密码');
    await expect(page.locator('[data-testid="setup-pw-set"]')).toContainText('旧码当场作废');
    await expect(page.locator('[data-testid="setup-pw-form"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="setup-regen-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="setup-card-none"]')).toBeVisible();
    await expect(page.locator('[data-testid="setup-finish"]')).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test('重新发码 → 导出 → 进入应用', async ({ page }) => {
    await page.addInitScript(installSetupStub, { ...ALREADY_SET, nextUrl: AFTER_WIZARD });
    await page.goto(WIZARD);
    await expect(page.locator('[data-testid="setup-regen"]')).toBeDisabled();
    await page.locator('[data-testid="setup-regen-pw"]').fill('E2ePass#2026');
    await expect(page.locator('[data-testid="setup-regen"]')).toBeEnabled();
    await page.locator('[data-testid="setup-regen"]').click();
    await expect(page.locator('[data-testid="setup-card-body"]')).toBeVisible();
    await page.locator('[data-testid="setup-export"]').click();
    await expect(page.locator('[data-testid="setup-step-card"]')).toContainText('③ 已完成');
    await page.locator('[data-testid="setup-finish"]').click();
    await page.waitForURL(AFTER_WIZARD);
  });

  test('密码错 → 主进程原因原样显示，不发码也不跳转', async ({ page }) => {
    await page.addInitScript(installSetupStub, { ...ALREADY_SET, regenWrongPassword: true });
    await page.goto(WIZARD);
    await page.locator('[data-testid="setup-regen-pw"]').fill('E2ePass#2026');
    await page.locator('[data-testid="setup-regen"]').click();
    await expect(page.locator('[data-testid="setup-error"]')).toContainText(ERR_BAD_WRITE_PASSWORD);
    await expect(page.locator('[data-testid="setup-card-body"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="setup-finish"]')).toBeDisabled();
    await expect(page).toHaveURL(/setup\.html/);
  });

  test('向导里绝不再有「改密码」通道：已设密码时提交新密码被主进程拒绝', async ({ page }) => {
    await page.addInitScript(installSetupStub, ALREADY_SET);
    await page.goto(WIZARD);
    // 页面不给入口（上面一条已断言），这里直接敲通道：主进程仍是最后一道闸
    const res = await page.evaluate(() => {
      const api = (window as unknown as { api?: { setup?: { setL0Password?: (p: string) => Promise<unknown> } } }).api;
      return api?.setup?.setL0Password ? api.setup.setL0Password('Another#Pass1') : null;
    });
    expect(res).toEqual({ ok: false, error: ERR_ALREADY_SET_PASSWORD });
  });
});

test.describe('首启向导 · 主进程拒绝即不放行（页面闸门不是唯一防线）', () => {
  test('改选目录点取消：保持原位置并如实说明，不崩不假装重启', async ({ page }) => {
    await page.addInitScript(installSetupStub, { ...ALREADY_SET, reselectCanceled: true });
    await page.goto(WIZARD);
    await page.locator('[data-testid="setup-reselect-dirs"]').click();
    await expect(page.locator('[data-testid="setup-error"]')).toContainText(ERR_RESELECT_CANCELED);
    await expect(page.locator('[data-testid="setup-step-dirs"]')).toContainText('① 已完成');
  });

  test('三步看起来都完成，但 setup:finish 被拒 → 停在向导页并摆出原因', async ({ page }) => {
    await page.addInitScript(installSetupStub, { ...FIRST_RUN, finishRejects: true });
    await page.goto(WIZARD);
    await page.locator('[data-testid="setup-pw"]').fill('E2ePass#2026');
    await page.locator('[data-testid="setup-pw2"]').fill('E2ePass#2026');
    await page.locator('[data-testid="setup-pw-submit"]').click();
    await page.locator('[data-testid="setup-export"]').click();
    await expect(page.locator('[data-testid="setup-finish"]')).toBeEnabled();
    await page.locator('[data-testid="setup-finish"]').click();
    await expect(page.locator('[data-testid="setup-error"]')).toContainText(ERR_PERSIST_POINTER);
    await expect(page).toHaveURL(/setup\.html/);
  });
});
