// 阶段 B：网页会话无头自动采集器（Electron 侧接线）。
//
// 为什么不用 Playwright：本项目打包明确排除 node_modules（`electron-builder.config.cjs` 的
// `files: ['!node_modules/**/*']`），主进程 bundle 也只外置 electron/pg/pglite
// （`tools/build-electron.cjs`），所以运行期 `require('playwright')` 必然失败；
// 它还要自带 150MB+ 浏览器二进制。改用 Electron 自带 Chromium：
//   · 隐藏 BrowserWindow + `persist:` partition → 登录态落在 <userData>/Partitions/，
//     与主进程自己的 Local State 天然隔离（放同一个 userDataDir 会互抢 lockfile）；
//   · `executeJavaScript(core.js 源码)` 等价于插件的 addScriptTag，选择器一行都不用重写；
//   · 不是 CDP 注入，`navigator.webdriver` 不上报，风控面更小。
//
// 三条纪律（与插件同源）：抽取为空不产出、单站失败不打断、成功后才记账。
import { BrowserWindow } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WEBCHAT_SITES } from '../shared/webchatSites.ts';
import {
  AUTO_MAX_ATTEMPTS_MANUAL, AUTO_MAX_ATTEMPTS_ROUND, AUTO_MAX_ATTEMPTS_SWEEP, AUTO_MAX_CHATS_MANUAL,
  AUTO_MAX_CHATS_PER_ROUND, AUTO_MAX_CHATS_SWEEP, AUTO_SWEEP_MAX_BATCHES,
  DEFAULT_AUTO_CONFIG, SITE_ENTRY_URL, appendLedger,
  autoDir, buildDriverScript, judgeSite, parseDriverResult, readAutoConfig, readAutoState,
  writeAutoConfig, writeAutoState,
  type AutoPatch, type AutoState, type RoundSummary, type SiteRoundResult, type WebchatAutoConfig,
} from './webchatAutoConfig.ts';
import { applyCleanUserAgent } from './webchatAutoUa.ts';
import { listCollectedIds, pickNewChatsById } from './webchatIdReconcile.ts';

export interface AutoCollectorDeps {
  /** 数据根（配置/状态/账本都落这里） */
  root: () => string;
  /** shared/core.js 的绝对路径（开发态读仓库，安装态读 resources/webchat-exporter） */
  coreJsPath: () => string;
  /** 本机接收端（端口是探测出来的，拿不到就如实报「未就绪」而不是硬编码） */
  ingest: () => { port: number; token: string } | null;
  /** 导出根目录（与接收端共用同一真源）；扫 <root>/<site>/*.md 得「已采 ID 集合」 */
  exportDir: () => string;
  log: (event: string, data?: Record<string, unknown>, level?: 'warn' | 'error') => void;
}

export interface AutoStateView {
  ok: true;
  config: WebchatAutoConfig;
  running: boolean;
  lastRound: RoundSummary | null;
  nextAt: number | null;
  /** 已登录窗口（用户在点「重新登录」时能看到窗口是否开着） */
  loginWindows: string[];
  /** 已知站点（卡片渲染站点列表用；label 只显示中文名） */
  sites: Array<{ key: string; label: string }>;
  /** 本轮不可用的原因（接收端未就绪等），空串=正常 */
  blocked: string;
  /** 站点最近一次重新登录的时间；晚于 lastRound.at 的 need_relogin 已被用户处理，计数剔除 */
  relogins: Record<string, number>;
}

export interface WebchatAutoCollector {
  state(): AutoStateView;
  apply(patch: AutoPatch): AutoStateView;
  runNow(): Promise<RoundSummary>;
  /** 补齐历史：按游标把侧栏剩下的会话分批采完（一次性把历史补齐，之后回到增量） */
  sweepNow(): Promise<RoundSummary>;
  openLogin(site: string): Promise<{ ok: boolean; error?: string }>;
  stop(): void;
}

export function createWebchatAutoCollector(deps: AutoCollectorDeps): WebchatAutoCollector {
  let cfg: WebchatAutoConfig = readAutoConfig(deps.root());
  let state: AutoState = readAutoState(deps.root());
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  let nextAt: number | null = null;
  const wins = new Map<string, BrowserWindow>();
  const loginWins = new Map<string, BrowserWindow>();

  const blockedReason = (): string => (deps.ingest() ? '' : '本机接收端未就绪（端口没起来）：暂时无法落盘，不是站点问题');

  function clearTimer(): void {
    if (timer) { clearTimeout(timer); timer.unref?.(); timer = null; }
    nextAt = null;
  }

  function schedule(): void {
    clearTimer();
    if (!cfg.enabled) return;
    const delay = cfg.intervalMinutes * 60_000;
    nextAt = Date.now() + delay;
    timer = setTimeout(() => {
      void runRound('timer').catch((e) => {
        deps.log('webchat-auto:round-fail', { error: String((e as Error)?.message ?? e) }, 'warn');
      }).finally(() => schedule());
    }, delay);
    timer.unref?.();
  }

  /** 该站点的隐藏窗口（按站点复用：一个 partition 一个窗口，避免反复创建丢登录态） */
  function ensureHiddenWindow(site: string): BrowserWindow {
    const existed = wins.get(site);
    if (existed && !existed.isDestroyed()) return existed;
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 860,
      title: `自动采集 · ${site}`,
      // 隐藏窗口也要走完整渲染管线（BrowserWindow 选项，不是 webPreferences 里的；默认 true，写出来防误改）
      paintWhenInitiallyHidden: true,
      webPreferences: {
        partition: `persist:webchat-${site}`,
        // 隐藏窗口默认会被节流：setTimeout 可能被拖到分钟级，等页面变化的轮询直接失效
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // 站点风控只认 UA 里的 Electron 标记；必须在 loadURL 前剥离，否则第一屏就被判「使用环境异常」
    applyCleanUserAgent(win.webContents);
    // 绝对护栏：采集器窗口一律不许开新窗口。
    // 2026-11-19 真机事故：隐藏窗没登录 DeepSeek，驱动把登录页的「用户协议/备案/反馈表」
    // 当成会话逐个点击 → 弹出 5 个外部窗口，用户被严重打扰。就算 item 判据日后又出错，
    // 这一层也要保证「最坏只是采不到」，绝不能变成「替用户乱点外部链接」。
    win.webContents.setWindowOpenHandler((details) => {
      deps.log('webchat-auto:popup-denied', { site, url: String(details.url ?? '').slice(0, 200) }, 'warn');
      return { action: 'deny' };
    });
    win.on('closed', () => { wins.delete(site); });
    wins.set(site, win);
    return win;
  }

  /**
   * 注入页面内的跳过键 = 导出目录里该站点现存的 .md 文件名（<会话ID>.md）。
   *
   * 迁移完成前曾把旧内容指纹（doneKeys）一起注入做兜底，避免时间戳文件被重复导出；
   * 迁移已实跑（2026-11-20）后必须撤掉：否则删掉 <ID>.md 后旧内容键仍命中跳过，
   * 「删文件即重采」失效。文件系统是唯一账本，state.doneKeys 只读兼容、不再参与判据。
   */
  function skipKeysForSite(site: string): string[] {
    // 没有 `## 用户` 的旧坏文件不算已采：否则 2026-11-19 那些「只有助手」的会话
    // 会被文件系统的 ID 账永久挡住，修了抽取代码也永远不会被重采回来。
    return [...listCollectedIds(join(deps.exportDir(), site), { requireUserMessage: true })];
  }

  async function collectSite(
    site: string,
    maxChats: number,
    opts?: { startAt?: number; maxAttempts?: number },
  ): Promise<SiteRoundResult> {
    const entry = SITE_ENTRY_URL[site];
    if (!entry) return { site, status: 'error', scanned: 0, exported: 0, reason: `没有该站点的入口地址：${site}` };
    const ingest = deps.ingest();
    if (!ingest) return { site, status: 'error', scanned: 0, exported: 0, reason: blockedReason() };

    const win = ensureHiddenWindow(site);
    try {
      await win.loadURL(entry);
    } catch (e) {
      return { site, status: 'error', scanned: 0, exported: 0, reason: `打开站点失败：${String((e as Error)?.message ?? e)}` };
    }
    try {
      // 注入抽取内核（等价插件 addScriptTag）；core.js 是 IIFE，安全地挂到 globalThis
      const coreSrc = readFileSync(deps.coreJsPath(), 'utf8');
      await win.webContents.executeJavaScript(coreSrc, true);
    } catch (e) {
      return { site, status: 'error', scanned: 0, exported: 0, reason: `注入抽取内核失败：${String((e as Error)?.message ?? e)}` };
    }

    let raw: unknown;
    try {
      raw = await win.webContents.executeJavaScript(
        buildDriverScript({
          siteKey: site,
          maxChats,
          // 已采过的往下跳，别停在原地空转（2026-11-19 采集停滞事故的修法）
          skipKeys: skipKeysForSite(site),
          startAt: opts?.startAt ?? 0,
          maxAttempts: opts?.maxAttempts,
        }), true,
      );
    } catch (e) {
      return { site, status: 'error', scanned: 0, exported: 0, reason: `页面执行失败：${String((e as Error)?.message ?? e)}` };
    }

    const parsed = parseDriverResult(raw);
    if (!parsed) return judgeSite(site, null, 0);
    // 逐条切换结果落动作日志：抽不到时这里是唯一能判「没跳转 vs 跳了没正文」的证据，
    // 不落日志就只能靠再打一次包去猜（2026-11-19 就是这么被坑了一轮）
    deps.log('webchat-auto:steps', {
      site,
      scanned: parsed.items.length,
      steps: parsed.steps.map((s) => `${s.title.slice(0, 12)}:${s.why || `ok/${s.msgs}`}:c${s.containers}`).join(','),
      diag: { semantic: parsed.diag?.semantic ?? null, groupRows: parsed.diag?.groupRows ?? null, msgRows: parsed.diag?.messageAreaRows ?? null },
    });
    // 一条都没抽到 → 落一份页面快照：下次排查读结构，不用「再打一版包让用户再点一次」
    if (parsed.debug) {
      const file = join(autoDir(deps.root()), `debug-${site}.html`);
      try {
        mkdirSync(autoDir(deps.root()), { recursive: true });
        writeFileSync(file, [
          `<!-- url: ${parsed.debug.url} -->`,
          `<!-- title: ${parsed.debug.title} -->`,
          `<!-- visibility: ${parsed.debug.visibility} -->`,
          parsed.debug.html,
        ].join('\n'), 'utf8');
        deps.log('webchat-auto:snapshot', { site, file, bytes: parsed.debug.html.length, visibility: parsed.debug.visibility });
      } catch (e) {
        deps.log('webchat-auto:snapshot-fail', { site, error: String((e as Error)?.message ?? e) }, 'warn');
      }
    }

    // 主进程侧再按「文件系统即账本」对一次差集：页面内已跳一遍，这里防并发/回传脏数据
    const collected = listCollectedIds(join(deps.exportDir(), site), { requireUserMessage: true });
    const fresh = pickNewChatsById(parsed.chats, collected);
    let exported = 0;
    const failures: string[] = [];
    for (const chat of fresh) {
      try {
        const res = await fetch(`http://127.0.0.1:${ingest.port}/export`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${ingest.token}` },
          body: JSON.stringify({
            site,
            title: chat.title,
            url: chat.url,
            // 会话 ID 决定落盘文件名；接收端同名即覆盖，不再出现 -1/-2 副本
            conversationId: chat.id || undefined,
            exportedAt: Date.now(),
            markdown: chat.markdown,
            auditSource: chat.messages,
          }),
        });
        const body = await res.json() as { ok?: boolean; error?: string };
        if (res.ok && body.ok) {
          exported += 1;
          // 不再写内容指纹账：文件本身（<ID>.md）就是账，删文件即重采。
          // 失败依然不记任何东西——那会让这段内容永远导不出去（插件 0.4.0 的教训）。
        } else {
          failures.push(`${chat.title}: ${body.error ?? `HTTP ${res.status}`}`);
        }
      } catch (e) {
        failures.push(`${chat.title}: ${String((e as Error)?.message ?? e)}`);
      }
    }

    // 进度信息（跳过了几条 / 下批从哪开始 / 是否扫到底）必须随结果回传：
    // 补齐历史靠它推进游标，只报「导出 0 条」等于把「走完了」和「卡住了」混成一种状态
    const missing = Math.max(0, parsed.attempts - parsed.chats.length - parsed.skipped);
    const progress = {
      skipped: parsed.skipped, missing, nextStart: parsed.nextStart, reachedEnd: parsed.reachedEnd,
    };
    const judged = { ...judgeSite(site, parsed, exported), ...progress };
    if (failures.length > 0) {
      const reason = `有 ${failures.length} 条导出失败：${failures.slice(0, 2).join('；')}`;
      return exported > 0
        ? { ...judged, reason }
        : { site, status: 'error', scanned: judged.scanned, exported: 0, reason, ...progress };
    }
    return judged;
  }

  /** 按触发方式决定「收几条新的 / 最多走几步」 */
  function planFor(trigger: RoundSummary['trigger']): { maxChats: number; maxAttempts: number } {
    if (trigger === 'sweep') return { maxChats: AUTO_MAX_CHATS_SWEEP, maxAttempts: AUTO_MAX_ATTEMPTS_SWEEP };
    if (trigger === 'manual') return { maxChats: AUTO_MAX_CHATS_MANUAL, maxAttempts: AUTO_MAX_ATTEMPTS_MANUAL };
    // 定时轮「收几条」由用户在参数页选（默认 3）。步数跟着放大：顶部压着已采的，步数不够就永远收不满
    const perRound = cfg.perRound ?? AUTO_MAX_CHATS_PER_ROUND;
    return { maxChats: perRound, maxAttempts: Math.max(AUTO_MAX_ATTEMPTS_ROUND, perRound * 3) };
  }

  /**
   * 补齐历史：没有游标，每批都从侧栏顶部重新对账。
   *
   * 已采会话由「文件系统里的 <ID>.md」跳过，所以下一批会自然越过上一批采到的，继续找没采的；
   * 不再写 state.cursors（位置游标在虚拟列表 + 动态排序下不是稳定坐标，曾撞 200 上限死锁）。
   */
  async function collectSiteSweep(site: string): Promise<SiteRoundResult> {
    const plan = planFor('sweep');
    let exported = 0;
    let scanned = 0;
    let skipped = 0;
    let missing = 0;
    let batches = 0;
    let last: SiteRoundResult | null = null;
    for (let batch = 0; batch < AUTO_SWEEP_MAX_BATCHES; batch += 1) {
      const r = await collectSite(site, plan.maxChats, { startAt: 0, maxAttempts: plan.maxAttempts });
      last = r;
      batches += 1;
      scanned = r.scanned || scanned;
      exported += r.exported;
      skipped += r.skipped ?? 0;
      missing += r.missing ?? 0;
      // 站点不可采就停：拿同一批空转 10 次只会把「未登录」重复十遍
      if (r.status === 'need_relogin' || r.status === 'dom_changed' || r.status === 'error') break;
      if (r.reachedEnd || r.exported === 0) break;
    }
    const base = last ?? { site, status: 'no_new' as const, scanned: 0, exported: 0 };
    return {
      ...base,
      site,
      scanned,
      exported,
      skipped,
      missing,
      status: exported > 0 ? 'exported' : base.status,
      reason: base.reason ?? (batches > 0 ? `补齐历史：走了 ${batches} 批，采到 ${exported} 条新的` : undefined),
    };
  }

  async function runRound(trigger: RoundSummary['trigger']): Promise<RoundSummary> {
    if (running) {
      // 已经在跑就不再叠加（并发点击「立即采一轮」不该起两个浏览器流程）
      const last = state.lastRound;
      return last ?? { at: Date.now(), trigger, results: [] };
    }
    running = true;
    try {
      const results: SiteRoundResult[] = [];
      const plan = planFor(trigger);
      for (const site of cfg.sites) {
        if (trigger === 'sweep') {
          results.push(await collectSiteSweep(site));
          continue;
        }
        // 增量轮恒从侧栏顶部开始：顺序=时间倒序，新的在最上面；已采的由页面内 skipKeys 跳过
        results.push(await collectSite(site, plan.maxChats, { startAt: 0, maxAttempts: plan.maxAttempts }));
      }
      const summary: RoundSummary = { at: Date.now(), trigger, results };
      state = writeAutoState(deps.root(), { ...state, lastRound: summary });
      appendLedger(deps.root(), summary);
      deps.log('webchat-auto:round', {
        trigger,
        sites: results.map((r) => `${r.site}:${r.status}:${r.exported}/${r.scanned}`).join(','),
      });
      return summary;
    } finally {
      running = false;
    }
  }

  function view(): AutoStateView {
    return {
      ok: true,
      config: cfg,
      running,
      lastRound: state.lastRound,
      nextAt,
      loginWindows: [...loginWins.keys()],
      sites: WEBCHAT_SITES.map((s) => ({ key: s.key, label: s.label })),
      blocked: blockedReason(),
      relogins: state.relogins,
    };
  }

  // 启动即排程；enabled=false 时只是不排（手动仍可用）
  schedule();

  return {
    state: view,
    apply(patch: AutoPatch): AutoStateView {
      cfg = writeAutoConfig(deps.root(), { ...cfg, ...patch });
      schedule();
      deps.log('webchat-auto:config', { enabled: cfg.enabled, intervalMinutes: cfg.intervalMinutes, sites: cfg.sites.join(',') });
      return view();
    },
    runNow: () => runRound('manual'),
    sweepNow: () => runRound('sweep'),
    async openLogin(site: string): Promise<{ ok: boolean; error?: string }> {
      const entry = SITE_ENTRY_URL[site];
      if (!entry) return { ok: false, error: `没有该站点的入口地址：${site}` };
      // 用户去登录了：把旧的隐藏窗销毁，下一轮重建，确保拿到登录后的新 cookie 而不是旧会话快照
      const stale = wins.get(site);
      if (stale && !stale.isDestroyed()) { stale.destroy(); wins.delete(site); }
      const existed = loginWins.get(site);
      if (existed && !existed.isDestroyed()) { existed.show(); existed.focus(); return { ok: true }; }
      const win = new BrowserWindow({
        width: 1180, height: 820, title: `登录 ${site}`,
        webPreferences: {
          partition: `persist:webchat-${site}`,
          backgroundThrottling: false,
          contextIsolation: true, nodeIntegration: false, sandbox: true,
        },
      });
      // 与采集窗同一处理：登录窗也要在 loadURL 前去掉 Electron 标记，否则登录页先弹环境异常
      applyCleanUserAgent(win.webContents);
      win.on('closed', () => { loginWins.delete(site); });
      loginWins.set(site, win);
      try {
        await win.loadURL(entry);
      } catch (e) {
        return { ok: false, error: `打开登录窗口失败：${String((e as Error)?.message ?? e)}` };
      }
      // 记下重新登录动作：计数端用它剔除「登录晚于该轮快照」的过期 need_relogin（不伪造采集成功）
      state = writeAutoState(deps.root(), { ...state, relogins: { ...state.relogins, [site]: Date.now() } });
      return { ok: true };
    },
    stop(): void {
      clearTimer();
      for (const w of wins.values()) { if (!w.isDestroyed()) w.destroy(); }
      for (const w of loginWins.values()) { if (!w.isDestroyed()) w.destroy(); }
      wins.clear();
      loginWins.clear();
    },
  };
}

/** 默认配置副本（主进程未初始化时给 UI 一个诚实的默认值） */
export const AUTO_FALLBACK_CONFIG: WebchatAutoConfig = { ...DEFAULT_AUTO_CONFIG };
