// 阶段 B（无头自动采集）的纯逻辑层：配置、采集账、去重判据、页内驱动脚本。
//
// 为什么单独成文件：真正的难点不是「打开浏览器」，而是「某一轮到底该采哪几条 / 什么样算采过 /
// 登录失效怎么判」这些判据。它们必须能在单测里跑（不能依赖 Electron 或真实站点），
// 所以全部下沉到这里；`webchatAutoCollect.ts` 只做窗口与网络接线。
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WEBCHAT_SITES } from '../shared/webchatSites.ts';
import { conversationIdFromUrl, sanitizeConversationId } from './webchatIdReconcile.ts';

export const AUTO_DIR_NAME = 'webchat-auto-collect';
export const AUTO_CONFIG_FILE = 'config.json';
export const AUTO_STATE_FILE = 'state.json';
export const AUTO_LEDGER_FILE = 'ledger.jsonl';

/** 周期上下限：默认 60 分钟（保守防风控），最短 15 分钟 */
export const AUTO_MIN_INTERVAL = 15;
export const AUTO_MAX_INTERVAL = 1440;
export const AUTO_DEFAULT_INTERVAL = 60;
/** 单站单轮最多点开几个会话：定时轮保守（避免长时间占用），手动轮放宽 */
export const AUTO_MAX_CHATS_PER_ROUND = 3;
/** 手动「立即采一轮」的上限：用户就在屏幕前等，一次多走几条才有意义 */
export const AUTO_MAX_CHATS_MANUAL = 10;

/**
 * 单轮最多「尝试点开」几条（含已采过的）。
 *
 * 为什么必须有这个上限：2026-11-19 事故——驱动脚本每轮都从侧栏第 1 条开始点、点满 maxChats 就停，
 * 而侧栏最新几条早就采过 → 每轮 3 条全被去重命中 → 状态恒 no_new，其余 190+ 条永远轮不到。
 * 修法是「往下多走几步，跳过已采的继续找新的」，所以上限从「收几条」变成「试几条」。
 */
export const AUTO_MAX_ATTEMPTS_ROUND = 15;
/** 手动轮的尝试上限：要多收 10 条新的，就得允许多走几步（顶部通常压着已采的） */
export const AUTO_MAX_ATTEMPTS_MANUAL = 30;
/** 「补齐历史」每批收几条新的 / 每批试几条 */
export const AUTO_MAX_CHATS_SWEEP = 30;
export const AUTO_MAX_ATTEMPTS_SWEEP = 40;
/** 补齐历史每站点最多跑几批（40×10=400 条，足够覆盖 200 条侧栏） */
export const AUTO_SWEEP_MAX_BATCHES = 10;

/** 每轮最多收几条新的：上下限（用户可在参数页选，默认 3） */
export const AUTO_MIN_PER_ROUND = 1;
export const AUTO_MAX_PER_ROUND = 50;

export interface WebchatAutoConfig {
  /** 总开关（关掉 = 定时器不跑，手动「立即采一轮」仍可用） */
  enabled: boolean;
  intervalMinutes: number;
  /** 定时轮每轮最多收几条**新的**（已采过的由页面内 skipKeys 跳过，不占名额） */
  perRound: number;
  /** 启用的站点 key（本期默认只有 deepseek） */
  sites: string[];
}

export const DEFAULT_AUTO_CONFIG: WebchatAutoConfig = {
  enabled: false,
  intervalMinutes: AUTO_DEFAULT_INTERVAL,
  perRound: AUTO_MAX_CHATS_PER_ROUND,
  sites: ['deepseek'],
};

const SITE_KEYS = WEBCHAT_SITES.map((s) => s.key);

/**
 * 各站点入口页（无头窗口第一站）。
 * 取值原则：core.js 里该站点 `hosts[0]` 的 https 根路径——真源是 core.js，这里只是主进程侧的可用副本
 * （core.js 是浏览器脚本，主进程不能 import）。新增站点时两处一起改，
 * `webchatAutoConfig.test.ts` 会断言「每个已知站点都必须有入口页 + 域名与 hosts[0] 一致」，漏填或漂了立刻红。
 * 备用域名（hosts[1..]）不在这里列：站点自己会 302 过去，主进程侧不做候选轮询。
 */
export const SITE_ENTRY_URL: Record<string, string> = {
  deepseek: 'https://chat.deepseek.com/',
  doubao: 'https://www.doubao.com/',
  yiyan: 'https://yiyan.baidu.com/',
  qianwen: 'https://www.qianwen.com/',
  kimi: 'https://www.kimi.ai/',
  chatglm: 'https://chatglm.cn/',
  mimo: 'https://aistudio.xiaomimimo.com/',
};

/** 周期夹取 + 站点过滤；坏值一律回落默认，绝不抛（启动主路径要用） */
export function normalizeAutoConfig(raw: unknown): WebchatAutoConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const enabled = typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_AUTO_CONFIG.enabled;
  const rawInterval = typeof src.intervalMinutes === 'number' && Number.isFinite(src.intervalMinutes)
    ? Math.round(src.intervalMinutes)
    : DEFAULT_AUTO_CONFIG.intervalMinutes;
  const intervalMinutes = Math.min(AUTO_MAX_INTERVAL, Math.max(AUTO_MIN_INTERVAL, rawInterval));
  const rawPerRound = typeof src.perRound === 'number' && Number.isFinite(src.perRound)
    ? Math.round(src.perRound)
    : DEFAULT_AUTO_CONFIG.perRound;
  const perRound = Math.min(AUTO_MAX_PER_ROUND, Math.max(AUTO_MIN_PER_ROUND, rawPerRound));
  const sites = Array.isArray(src.sites)
    ? [...new Set(src.sites.filter((k): k is string => typeof k === 'string' && SITE_KEYS.includes(k)))]
    : [...DEFAULT_AUTO_CONFIG.sites];
  return { enabled, intervalMinutes, perRound, sites };
}

export type AutoPatch = Partial<WebchatAutoConfig>;

export function parseAutoPatch(raw: unknown): { ok: true; patch: AutoPatch } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '参数格式不对：需要 { enabled?, intervalMinutes?, perRound?, sites? }' };
  }
  const src = raw as Record<string, unknown>;
  const patch: AutoPatch = {};
  if (src.enabled !== undefined) {
    if (typeof src.enabled !== 'boolean') return { ok: false, error: 'enabled 必须是布尔值' };
    patch.enabled = src.enabled;
  }
  if (src.intervalMinutes !== undefined) {
    if (typeof src.intervalMinutes !== 'number' || !Number.isFinite(src.intervalMinutes)) {
      return { ok: false, error: 'intervalMinutes 必须是数字' };
    }
    if (src.intervalMinutes < AUTO_MIN_INTERVAL || src.intervalMinutes > AUTO_MAX_INTERVAL) {
      return { ok: false, error: `采集周期须在 ${AUTO_MIN_INTERVAL}–${AUTO_MAX_INTERVAL} 分钟之间` };
    }
    patch.intervalMinutes = Math.round(src.intervalMinutes);
  }
  if (src.perRound !== undefined) {
    if (typeof src.perRound !== 'number' || !Number.isFinite(src.perRound)) {
      return { ok: false, error: 'perRound 必须是数字' };
    }
    if (src.perRound < AUTO_MIN_PER_ROUND || src.perRound > AUTO_MAX_PER_ROUND) {
      return { ok: false, error: `每轮导出条数须在 ${AUTO_MIN_PER_ROUND}–${AUTO_MAX_PER_ROUND} 之间` };
    }
    patch.perRound = Math.round(src.perRound);
  }
  if (src.sites !== undefined) {
    if (!Array.isArray(src.sites)) return { ok: false, error: 'sites 必须是数组' };
    const bad = src.sites.filter((k) => typeof k !== 'string' || !SITE_KEYS.includes(k));
    if (bad.length > 0) return { ok: false, error: `不支持的站点：${bad.map(String).join(', ')}` };
    patch.sites = [...new Set(src.sites as string[])];
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: '没有要改的字段' };
  return { ok: true, patch };
}

export function autoDir(root: string): string {
  return join(root, AUTO_DIR_NAME);
}
export function autoConfigPath(root: string): string {
  return join(autoDir(root), AUTO_CONFIG_FILE);
}
export function autoStatePath(root: string): string {
  return join(autoDir(root), AUTO_STATE_FILE);
}
export function autoLedgerPath(root: string): string {
  return join(autoDir(root), AUTO_LEDGER_FILE);
}

function atomicWrite(file: string, body: string): void {
  const tmp = `${file}.tmp`;
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(tmp, body, 'utf8');
  try {
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* 清理失败不掩盖原始错误 */ }
    throw e;
  }
}

export function readAutoConfig(root: string): WebchatAutoConfig {
  try {
    const f = autoConfigPath(root);
    if (!existsSync(f)) return { ...DEFAULT_AUTO_CONFIG };
    return normalizeAutoConfig(JSON.parse(readFileSync(f, 'utf8')));
  } catch {
    return { ...DEFAULT_AUTO_CONFIG };
  }
}

export function writeAutoConfig(root: string, cfg: WebchatAutoConfig): WebchatAutoConfig {
  const next = normalizeAutoConfig(cfg);
  atomicWrite(autoConfigPath(root), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export type SiteStatus = 'exported' | 'no_new' | 'need_relogin' | 'dom_changed' | 'error' | 'skipped';

export interface SiteRoundResult {
  site: string;
  status: SiteStatus;
  /** 侧栏识别到几条会话（分母；没有它永远答不了「是不是漏了」） */
  scanned: number;
  exported: number;
  /** 人话原因（错误 / DOM 诊断），只在非成功时出现 */
  reason?: string;
  /** 本轮因「已在账里」而跳过的条数（诊断用：>0 说明去重真的在起作用） */
  skipped?: number;
  /** 发现但抽取失败的条数（区分「没有新会话」与「有新会话但没采到」） */
  missing?: number;
  /** 补齐历史：下一批从侧栏第几条开始（undefined = 本轮没跑驱动） */
  nextStart?: number;
  /** 补齐历史：侧栏是否已扫到底 */
  reachedEnd?: boolean;
}

export interface RoundSummary {
  at: number;
  trigger: 'timer' | 'manual' | 'startup' | 'sweep';
  results: SiteRoundResult[];
}

export interface AutoState {
  /**
   * @deprecated 旧内容指纹账：新架构改用「导出目录里的 <会话ID>.md」当账，本字段只读兼容、不再写入。
   * 迁移完成前仍作为兜底跳过键注入驱动，避免历史会话在迁移前被重复导出。
   */
  doneKeys: Record<string, number>;
  /**
   * @deprecated 旧侧栏位置游标：虚拟列表 + 动态排序下位置不稳定，且会撞 200 上限死锁，已停止读写。
   */
  cursors: Record<string, number>;
  /** 上次一轮的结果（UI 直接显示，不用去翻账本） */
  lastRound: RoundSummary | null;
}

export const DEFAULT_AUTO_STATE: AutoState = { doneKeys: {}, cursors: {}, lastRound: null };

export function normalizeAutoState(raw: unknown): AutoState {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const keys: Record<string, number> = {};
  if (src.doneKeys && typeof src.doneKeys === 'object') {
    for (const [k, v] of Object.entries(src.doneKeys as Record<string, unknown>)) {
      if (typeof k === 'string' && k && typeof v === 'number' && Number.isFinite(v)) keys[k] = v;
    }
  }
  const lr = src.lastRound as RoundSummary | undefined;
  const lastRound = lr && typeof lr === 'object' && Array.isArray(lr.results) && typeof lr.at === 'number'
    ? { at: lr.at, trigger: lr.trigger ?? 'timer', results: lr.results } as RoundSummary
    : null;
  const cursors: Record<string, number> = {};
  if (src.cursors && typeof src.cursors === 'object') {
    for (const [k, v] of Object.entries(src.cursors as Record<string, unknown>)) {
      // 游标是下标：负数/小数一律当没记过，避免把「从 -1 开始」带进驱动脚本
      if (typeof k === 'string' && k && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        cursors[k] = Math.floor(v);
      }
    }
  }
  return { doneKeys: keys, cursors, lastRound };
}

export function readAutoState(root: string): AutoState {
  try {
    const f = autoStatePath(root);
    if (!existsSync(f)) return { ...DEFAULT_AUTO_STATE, doneKeys: {}, cursors: {} };
    return normalizeAutoState(JSON.parse(readFileSync(f, 'utf8')));
  } catch {
    return { ...DEFAULT_AUTO_STATE, doneKeys: {}, cursors: {} };
  }
}

export function writeAutoState(root: string, state: AutoState): AutoState {
  const next = normalizeAutoState(state);
  atomicWrite(autoStatePath(root), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** 采集账：追加一行 JSONL；写不进去不影响本轮结果（账是给人看的，不是判据） */
export function appendLedger(root: string, entry: RoundSummary): void {
  try {
    mkdirSync(autoDir(root), { recursive: true });
    writeFileSync(autoLedgerPath(root), `${JSON.stringify(entry)}\n`, { encoding: 'utf8', flag: 'a' });
  } catch { /* 账写失败不阻断采集 */ }
}

// ─── 页内驱动脚本 ────────────────────────────────────────────────────────────

export interface DriverChat {
  title: string;
  url: string;
  path: string;
  /** 会话稳定 ID（从 URL 提取）；落盘文件名与去重都用它，正文改了也不重复采 */
  id: string;
  messages: Array<{ role: string; text: string }>;
  /** 内容指纹短键（core.js contentKey） */
  key: string;
  /** 完整签名（几十 KB，不进 key，仅用于判断「内容是否真的变了」） */
  sig: string;
  /** 页面里用 core.js formatMarkdown 生成的正文（与插件产物同格式） */
  markdown: string;
  /** 兼容 ID 对账模块的通用结构（只用 id/title，其余字段原样透传） */
  [k: string]: unknown;
}

/**
 * 侧栏体检结构（`core.describeSidebar()` 的**原样**结构）。
 *
 * 2026-11-19 事故：这里一度被当成字符串处理（`typeof src.diag === 'string'`），
 * 于是真结构被丢掉、UI 上永远显示「诊断：(空)」——诊断唯一的价值就是"抽不到时告诉你为什么"，
 * 丢掉它等于把最需要的那次排查也做瞎了。类型必须写清楚，不许再用 `any` 兜。
 */
export interface SidebarDiag {
  /** 侧栏里可点的语义条目数（a[href] / li / role=button|link） */
  semantic: number;
  /** 同类成组识别到的条目总数（hash 类名站点的主路径） */
  groupRows: number;
  groups: Array<{ cls: string; count: number; sample: string }>;
  /** 页面上前几个带 href 的锚点（判断"侧栏条目到底有没有链接"） */
  anchors: Array<{ href: string; text: string }>;
  /** 落在正文区里的行数（能证明"正文渲染出来了，只是认不出角色"） */
  messageAreaRows: number;
}

/**
 * 每一条会话的切换结果 —— 诊断的核心。
 *
 * 为什么必须逐条记：整轮只回一个「0 条」时，两种完全不同的故障长得一模一样：
 *   · `click-no-nav`    点了没跳转（条目不是会话链接 / 站点忽略模拟点击）
 *   · `nav-no-content`  地址跳过去了但正文读不到（选择器失效 / 渲染没跟上）
 * 修法完全不同（前者要换导航方式，后者要修抽取），不分开就永远只能猜。
 */
export interface DriverStep {
  title: string;
  urlBefore: string;
  urlAfter: string;
  /** 抽到的消息条数 */
  msgs: number;
  /** 当前页面疑似消息容器数量（区分"没渲染"与"渲染了但认不出角色"） */
  containers: number;
  /** '' = 抽到了；否则 `click-no-nav` / `nav-no-content` / `no-element` / `missing-user` / `error:…` */
  why: string;
}

export interface DriverResult {
  /** 侧栏识别到的会话标题（分母 + 诊断） */
  items: string[];
  /** 侧栏体检（core.describeSidebar 原结构；拿不到时 null） */
  diag: SidebarDiag | null;
  /** 自由文本诊断（core.js 没注入等，不属于侧栏体检的情况） */
  diagText: string;
  chats: DriverChat[];
  steps: DriverStep[];
  /** 当前页面是登录/注册/找回密码页：绝不能点上面任何"条目" */
  needRelogin: boolean;
  /** 下一批从侧栏第几条开始（= 本轮走到的位置；触底时等于 items.length） */
  nextStart: number;
  /** 本轮实际点开了几条（含已采过的）：用来区分「走完了」和「到上限停了」 */
  attempts: number;
  /** 本轮因已在账里而跳过的条数 */
  skipped: number;
  /** 侧栏是否已扫到底（true = 后面没有更多条目了） */
  reachedEnd: boolean;
  /**
   * 一条都没抽到时的页面快照（正常时 null）。
   *
   * 为什么要有：抽不到的原因只能从真实 DOM 判断（选择器失效 / 消息区没渲染 / 落在登录页），
   * 而「改一版代码 → 打包 → 让用户再点一次」的代价是十分钟起步。
   * 存一份 HTML 到数据根，下一次排查直接读结构，不用再猜第二轮。
   */
  debug: PageSnapshot | null;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** 页面自报可见性（hidden 窗口若被站点按隐藏处理，渲染会停） */
  visibility: string;
  /** 页面 HTML（截断，够看出容器结构） */
  html: string;
}

/** 快照上限：够看清容器结构，又不至于让 IPC 回执膨胀到几十 MB */
const SNAPSHOT_MAX_CHARS = 300_000;

/** 单条会话最长等多久（含 URL 变化后的 settle 期） */
const CHAT_WAIT_MS = 10_000;
/** 滚顶补抽的轮询间隔/总预算：一次 sleep 不够（虚拟列表重挂可能慢半拍），但不能无限等。 */
const USER_POLL_MS = 250;
const USER_RETRY_MS = 1500;

/**
 * 生成注入页面的驱动脚本（字符串，在页面上下文执行）。
 *
 * 为什么整段放进页面跑：会话切换是 DOM 交互（点击侧栏 → 等内容渲染），
 * 在主进程里没法操作 DOM；跨进程来回 await 又会把「点完立刻抽」变成「抽到上一条」。
 *
 * 纪律（与插件 `content.js#waitForChange` 同源，2026-11-17 真机验证过）：
 *   ① 抽取为空就当没抽到（不产出空文件）；
 *   ② 单条失败不打断整轮，且**必须记下失败原因**；
 *   ③ 切换必须分三态判：没跳转 / 跳了但正文没跟上 / 真拿到内容 —— 不同故障不能混成一个 0。
 *
 * `chatWaitMs` 可注入：既让未来的手动轮能放宽预算，也让单测能用假 DOM 真跑这段脚本
 * （只做字符串断言等于没测——这段代码永远不会被 TypeScript 检查到）。
 */
export function buildDriverScript(input: {
  siteKey: string;
  maxChats: number;
  chatWaitMs?: number;
  /**
   * 已采过的内容键（**只传该站点的**，减小注入体积）。
   *
   * 为什么要在页面里跳过：内容键必须先抽到正文才能算，主进程没法预判「这条采没采过」。
   * 以前不去重就点固定 N 条，导致侧栏最新的几条采过之后采集永久停在同一位置（2026-11-19 事故）。
   */
  skipKeys?: string[];
  /** 从侧栏第几条开始扫（补齐历史分批推进用；缺省 0） */
  startAt?: number;
  /** 最多点开几条（**含已采过的**）：这是「走几步」的上限，不是「收几条」的上限 */
  maxAttempts?: number;
}): string {
  const { siteKey, maxChats } = input;
  const waitMs = Math.max(300, Math.round(input.chatWaitMs ?? CHAT_WAIT_MS));
  // 跳转后正文迟迟不出来的宽限期：跟着主预算缩放，最小 300ms
  const graceMs = Math.max(300, Math.min(4000, Math.round(waitMs / 2)));
  const skipKeys = Array.isArray(input.skipKeys) ? input.skipKeys.filter((k) => typeof k === 'string' && k) : [];
  // startAt 只为兼容旧调用方保留，已不再注入页面：无状态对账每轮恒从顶部开始。
  void input.startAt;
  // 缺省 = 只点 maxChats 条（旧语义）。允许 maxAttempts < maxChats：那只是「走不到那么多条」，不是错
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? maxChats));
  return `(async () => {
  const C = globalThis.WebchatExporterCore;
  if (!C) return { items: [], diag: null, diagText: 'core.js 未注入（WebchatExporterCore 不存在）', chats: [], steps: [], needRelogin: false, nextStart: 0, attempts: 0, skipped: 0, reachedEnd: false, debug: null };
  const siteKey = ${JSON.stringify(siteKey)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // ① 登录页/页脚/外链一律不算会话。2026-11-19 真机事故：登录页上「忘记密码 / 用户协议 /
  //    浙ICP备案 / 反馈表」被 listSidebarItems 当成 18 条“同类成组”会话，点了 10 次弹出 5 个外部窗口。
  //    这里不修改 core.js（它是插件真源），只在无头驱动这一侧收紧。
  const NON_CHAT_RE = /忘记密码|立即注册|注册账号|验证码登录|使用\\s*apple\\s*账号|用户协议|隐私政策|联系我们|ICP备|帮助中心|关于我们|登录\\s*\\/\\s*注册/i;
  const isExternalEntry = (el) => {
    try {
      const a = el && el.closest ? el.closest('a[href]') : null;
      if (!a) return false;
      if (a.getAttribute('target') === '_blank') return true;
      const u = new URL(a.href, location.href);
      return u.host !== location.host;
    } catch (e) { return false; }
  };
  const itemKey = (it) => {
    let href = '';
    try {
      const a = it && it.el && it.el.closest ? it.el.closest('a[href]') : null;
      if (a) href = String(a.href || '');
    } catch (e) { href = ''; }
    return href || ('label:' + String((it && it.label) || ''));
  };
  const collectItems = () => C.listSidebarItems(document, { max: 1000 })
    .filter((it) => !NON_CHAT_RE.test(String(it.label || '')) && !isExternalEntry(it.el));
  let items = collectItems();
  // 虚拟列表只挂载可视区：逐屏滚一遍把没挂上的行也发现出来。
  // 滚动只负责「发现」，点之前会重新取活元素，避免点到已卸载的旧节点。
  try {
    const sc = items.length && C.findScrollAncestor ? C.findScrollAncestor(items[0].el) : null;
    const sh = sc ? Number(sc.scrollHeight || 0) : 0;
    const ch = sc ? Number(sc.clientHeight || 0) : 0;
    if (sc && sh > ch + 4) {
      const seen = new Set(items.map(itemKey));
      let prev = Number(sc.scrollTop || 0);
      for (let pass = 0; pass < 20; pass += 1) {
        sc.scrollTop = prev + Math.max(200, Math.floor(ch * 0.8));
        await sleep(120);
        const nowTop = Number(sc.scrollTop || 0);
        let added = 0;
        for (const more of collectItems()) {
          const k = itemKey(more);
          if (seen.has(k)) continue;
          seen.add(k); items.push(more); added += 1;
        }
        if (nowTop <= prev || added === 0) break;
        prev = nowTop;
      }
      sc.scrollTop = 0;
      await sleep(120);
    }
  } catch (e) { /* 滚不动就按当前可见条目跑，绝不因为滚动失败整轮作废 */ }
  const titles = items.map((i) => i.label);
  // ② 登录页判据：URL / 表单标记 / 登录页文案任一命中即整轮不点。
  //    必须放在任何 click 之前——判断错了最多少采一轮，点错了会替用户打开外部网站。
  const looksLikeLoginPage = () => {
    try {
      const p = String(location.pathname || '').toLowerCase();
      if (/\\/(login|signin|sign-in|register|signup|forgot[_\\-]?password|password[_\\-]?reset)/.test(p)) return true;
      if (document.querySelector('input[type="password"], [class*="verify-code"], [class*="ds-verify"]')) return true;
      const t = document.body ? String(document.body.innerText || '') : '';
      if (/忘记密码|立即注册|验证码登录|使用\\s*apple\\s*账号登录/.test(t)) return true;
    } catch (e) { /* 拿不到就按非登录页处理，靠上面的 item 过滤兜底 */ }
    return false;
  };
  const needRelogin = looksLikeLoginPage();
  let diag = null;
  let diagText = '';
  try { diag = C.describeSidebar(document) || null; } catch (e) { diagText = '侧栏体检失败: ' + String((e && e.message) || e); }
  const readMsgs = () => { try { return C.extractMessages(document, siteKey); } catch (e) { return []; } };
  const countContainers = () => {
    try {
      return Math.min(999, document.querySelectorAll('[class*="ds-message"], [data-message-role], [class*="message"]').length);
    } catch (e) { return -1; }
  };
  const hasUserMsg = (arr) => Array.isArray(arr) && arr.some((m) => m && m.role === 'user');
  /**
   * 滚顶补抽必须把所有「真能滚」的消息祖先都推到 0。
   * 2026-11-19 老逻辑只取 document.querySelector 命中的第一个锚点：
   * 命中侧栏/外层 wrapper 或拿到 overflow:auto 但 scrollHeight==clientHeight 的假容器时，
   * scrollTop=0 什么也不会发生，首条 user 依旧没挂上，坏文件就被当成功导出。
   */
  const messageScrollRoots = () => {
    var anchors = [];
    try {
      var preferred = document.querySelectorAll('[class*="ds-message"], [data-message-role]');
      for (var pi = 0; pi < preferred.length; pi += 1) anchors.push(preferred[pi]);
    } catch (e) { /* 没精确锚点就退回泛指 */ }
    if (!anchors.length) {
      try {
        var fallback = document.querySelector('[class*="message"]');
        if (fallback) anchors.push(fallback);
      } catch (e) { /* 没有锚点就返回空，调用方按现状判 missing-user */ }
    }
    var roots = [];
    for (var ai = 0; ai < anchors.length; ai += 1) {
      var sc = C.findScrollAncestor ? C.findScrollAncestor(anchors[ai]) : null;
      if (!sc || roots.indexOf(sc) !== -1) continue;
      var sh = Number(sc.scrollHeight || 0);
      var ch = Number(sc.clientHeight || 0);
      if (sh > ch + 4) roots.push(sc);
    }
    return roots;
  };
  const scrollChatToTop = () => {
    var roots = messageScrollRoots();
    if (!roots.length) {
      try {
        var el = document.querySelector('[class*="ds-message"], [data-message-role], [class*="message"]');
        var sc = el && C.findScrollAncestor ? C.findScrollAncestor(el) : null;
        if (sc) roots = [sc];
      } catch (e) { /* 滚不动就按现状判 missing-user */ }
    }
    for (var ri = 0; ri < roots.length; ri += 1) {
      try { roots[ri].scrollTop = 0; } catch (e) { /* 单个容器失败不影响其它容器 */ }
    }
    return roots.length;
  };
  const chats = [];
  /**
   * 把「滚到顶部后抽到的前段」和「原本抽到的后段」按重叠拼起来。
   *
   * 为什么需要：DeepSeek 正文是虚拟列表，打开会话时停在底部，最顶上那条根本没渲染。
   * 滚到顶后新抽到的是前段，但底部又可能被卸载，所以两段都不能丢——靠尾部/头部的内容重叠对齐。
   */
  const mergeOverlap = (head, tail) => {
    if (!head.length) return tail;
    if (!tail.length) return head;
    let best = 0;
    const most = Math.min(head.length, tail.length);
    for (let k = most; k >= 1; k -= 1) {
      let same = true;
      for (let j = 0; j < k; j += 1) {
        const a = head[head.length - k + j];
        const b = tail[j];
        if (a.role !== b.role || a.text !== b.text) { same = false; break; }
      }
      if (same) { best = k; break; }
    }
    return head.concat(tail.slice(best));
  };
  const steps = [];
  let prevSig = C.signature(readMsgs());
  // 双轨跳过键：旧内容指纹（迁移前兼容）+ 新 <会话ID>.md 文件名（文件系统即账本）。
  // 命中就跳过继续往下找（不是停下），这是「采集能往前推进」的关键。
  const skipContentSet = new Set();
  const skipIdSet = new Set();
  for (const k of ${JSON.stringify(skipKeys)}) {
    if (k.endsWith('.md')) skipIdSet.add(k.slice(0, -3));
    else skipContentSet.add(k);
  }
  const idFromUrl = (u) => {
    try {
      const patterns = [
        /(?:^|\\/)a\\/chat\\/s\\/([0-9a-fA-F-]{8,})/,
        /(?:^|\\/)chat\\/([0-9]{8,})/,
        /(?:^|\\/)search\\/([0-9]{8,})/,
        /[?&]chat(?:id)?=([0-9a-zA-Z_-]{8,})/,
      ];
      for (const re of patterns) {
        const m = re.exec(String(u || ''));
        if (m && m[1]) return m[1];
      }
      return '';
    } catch (e) { return ''; }
  };
  const seenKeys = new Set();
  const seenIds = new Set();
  const maxNew = ${maxChats};
  const maxAttempts = ${maxAttempts};
  // 无状态对账：每一轮都从侧栏顶部开始，不再有「从第几条接着扫」的位置状态。
  // 虚拟列表动态排序下位置不是稳定坐标；旧的 startAt=min(cursor, items.length) 曾撞 200 上限死锁。
  const startAt = 0;
  let attempts = 0;
  let skipped = 0;
  let nextStart = startAt;
  // 触底 = 循环自然走完；中途 break（到步数/到条数上限）一律算「没扫完」，下批从 nextStart 接着来
  let reachedEnd = true;
  for (let i = startAt; i < items.length; i += 1) {
    if (needRelogin) { nextStart = i; reachedEnd = false; break; }
    if (attempts >= maxAttempts || chats.length >= maxNew) { nextStart = i; reachedEnd = false; break; }
    const label = items[i].label;
    const wanted = itemKey(items[i]);
    // 滚动发现阶段可能已把旧节点卸载：点之前重新取活元素，找不到才退回原节点（并如实记 no-element）
    const live = collectItems().find((it) => itemKey(it) === wanted || String(it.label || '') === label);
    const el = live ? live.el : items[i].el;
    const urlBefore = location.href;
    let msgs = [];
    let why = '';
    try {
      if (!el || typeof el.click !== 'function') {
        why = 'no-element';
      } else {
        el.click();
        // 三态判：URL 变了要额外给 settle 期；只等"签名变化"会把"跳了但没正文"误当"没跳转"
        const SETTLE_MS = 800;
        const CONTENT_WAIT_MS = 2500;
        const deadline = Date.now() + ${waitMs};
        let urlChangedAt = 0;
        while (Date.now() < deadline) {
          await sleep(300);
          if (location.href !== urlBefore && !urlChangedAt) urlChangedAt = Date.now();
          msgs = readMsgs();
          const sig = C.signature(msgs);
          if (urlChangedAt) {
            const settled = Date.now() - urlChangedAt >= SETTLE_MS;
            if (msgs.length && settled && (!prevSig || sig !== prevSig)) break;
            if (Date.now() - urlChangedAt >= CONTENT_WAIT_MS) break;
          } else if (msgs.length && sig !== prevSig) {
            break;
          }
        }
        // 跳转了但正文为空：再给一轮宽限（路由比渲染快是常态，别把慢当成坏）
        if (!msgs.length && location.href !== urlBefore) {
          const d2 = Date.now() + ${graceMs};
          while (Date.now() < d2) {
            await sleep(400);
            msgs = readMsgs();
            if (msgs.length) break;
          }
        }
        if (!msgs.length) why = location.href === urlBefore ? 'click-no-nav' : 'nav-no-content';
      }
    } catch (e) {
      why = 'error:' + String((e && e.message) || e);
    }
    steps.push({
      title: label,
      urlBefore: urlBefore,
      urlAfter: location.href,
      msgs: msgs.length,
      containers: countContainers(),
      why: why,
    });
    if (!msgs.length) { attempts += 1; nextStart = i + 1; continue; }
    /**
     * 首条不是用户 → 顶部几乎肯定还没渲染（虚拟列表停在底部）。
     *
     * 2026-11-19 实测：3 轮以上的长会话稳定丢第一条用户提问，1 轮的短会话完整；
     * 且 core.js 里早就有 findScrollAncestor（注释写着"不滚动就永远只能导到眼前这十几条"），
     * 但无头驱动一次都没调用过。修法：滚到顶、等一帧渲染、再抽一次，两段重叠合并。
     * 抽不到绝不按现状导出：那正是 2026-11-19 8 份「只有助手」坏文件的入口。
     * 现在记 missing-user 并跳过，文件不动，下一轮继续补；好文件也绝不会被坏版本覆盖。
     */
    // 首条不是 user 就补抽：哪怕后面有 user，也说明顶部那条提问还没挂上（2026-11-19 的截图就是这个形态）。
    if (!msgs.length || msgs[0].role !== 'user') {
      try {
        var roots = scrollChatToTop();
        if (roots > 0) {
          // 滚顶后虚拟列表要重新挂载，一次固定 sleep 可能早于渲染；轮询到认出 user 或预算用尽。
          var headDeadline = Date.now() + ${USER_RETRY_MS};
          do {
            await sleep(${USER_POLL_MS});
            // 虚拟列表重挂可能把 scrollTop 又推回去；每轮重新压到顶部再抽。
            scrollChatToTop();
            var head = readMsgs();
            if (head.length) {
              msgs = mergeOverlap(head, msgs);
              if (hasUserMsg(msgs)) break;
            }
          } while (Date.now() < headDeadline);
        }
      } catch (e) { /* 滚不动继续走硬校验：下面会如实记 missing-user，不落坏文件 */ }
    }
    // 硬校验：没有用户提问的 md 一律不落盘。旧逻辑"补抽失败也导出"正是坏文件反复出现的入口。
    if (!hasUserMsg(msgs)) {
      why = 'missing-user';
      steps[steps.length - 1].why = why;
      steps[steps.length - 1].msgs = msgs.length;
      attempts += 1;
      nextStart = i + 1;
      continue;
    }
    attempts += 1;
    const sig2 = C.signature(msgs);
    prevSig = sig2;
    nextStart = i + 1;
    // 内容键只能抽完正文才知道，所以「跳过已采」必须发生在这里：命中就继续往下一条，而不是停下
    const key2 = C.contentKey(siteKey, sig2);
    const chatId = idFromUrl(location.href);
    if (skipContentSet.has(key2) || skipIdSet.has(chatId) || seenKeys.has(key2) || (chatId && seenIds.has(chatId))) {
      skipped += 1; continue;
    }
    seenKeys.add(key2);
    if (chatId) seenIds.add(chatId);
    const siteMeta = (C.SITES || []).find((s) => s.key === siteKey) || {};
    const plain = msgs.map((m) => ({ role: m.role, text: m.text }));
    chats.push({
      title: label,
      id: chatId,
      url: location.href,
      path: location.pathname,
      messages: plain,
      key: key2,
      sig: sig2,
      markdown: C.formatMarkdown({
        site: siteKey,
        siteLabel: siteMeta.label || siteKey,
        url: location.href,
        title: label,
        exportedAt: Date.now(),
        messages: plain,
      }),
    });
  }
  // 一条都没抽到才抓快照：正常轮不能往盘上写几百 KB 的 HTML
  let debug = null;
  if (chats.length === 0) {
    try {
      const html = document.documentElement ? String(document.documentElement.outerHTML || '') : '';
      debug = {
        url: location.href,
        title: String(document.title || ''),
        visibility: String(document.visibilityState || ''),
        html: html.slice(0, ${SNAPSHOT_MAX_CHARS}),
      };
    } catch (e) { debug = null; }
  }
  // 登录页一个都不点：此时「没扫完」是真的，不能让调用方把 reachedEnd=true 当成「历史已补齐」
  if (needRelogin) { nextStart = 0; reachedEnd = false; }
  return { items: titles, diag: diag, diagText: diagText, chats: chats, steps: steps, needRelogin: needRelogin, nextStart: nextStart, attempts: attempts, skipped: skipped, reachedEnd: reachedEnd, debug: debug };
})()`;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseDiag(raw: unknown): SidebarDiag | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const groups = Array.isArray(o.groups)
    ? o.groups.slice(0, 5).map((g) => {
      const x = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>;
      return { cls: String(x.cls ?? ''), count: num(x.count), sample: String(x.sample ?? '') };
    })
    : [];
  const anchors = Array.isArray(o.anchors)
    ? o.anchors.slice(0, 5).map((a) => {
      const x = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
      return { href: String(x.href ?? ''), text: String(x.text ?? '') };
    })
    : [];
  return {
    semantic: num(o.semantic),
    groupRows: num(o.groupRows),
    groups,
    anchors,
    messageAreaRows: num(o.messageAreaRows),
  };
}

function parseSteps(raw: unknown): DriverStep[] {
  if (!Array.isArray(raw)) return [];
  const out: DriverStep[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    out.push({
      title: typeof o.title === 'string' ? o.title : '',
      urlBefore: typeof o.urlBefore === 'string' ? o.urlBefore : '',
      urlAfter: typeof o.urlAfter === 'string' ? o.urlAfter : '',
      msgs: num(o.msgs),
      containers: num(o.containers),
      why: typeof o.why === 'string' ? o.why : '',
    });
  }
  return out;
}

function parseSnapshot(raw: unknown): PageSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const html = typeof o.html === 'string' ? o.html : '';
  if (!html) return null;
  return {
    url: typeof o.url === 'string' ? o.url : '',
    title: typeof o.title === 'string' ? o.title : '',
    visibility: typeof o.visibility === 'string' ? o.visibility : '',
    html: html.slice(0, SNAPSHOT_MAX_CHARS),
  };
}

/** 解析页面回传结果；结构不对就当没拿到（不猜、不伪造空结果） */
export function parseDriverResult(raw: unknown): DriverResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const items = Array.isArray(src.items) ? src.items.filter((x): x is string => typeof x === 'string') : [];
  const chats: DriverChat[] = [];
  if (Array.isArray(src.chats)) {
    for (const c of src.chats) {
      const o = c as Record<string, unknown>;
      if (typeof o?.title !== 'string' || typeof o?.key !== 'string' || !o.key) continue;
      // 正文必须真的存在：空正文导出等于往库里塞空记忆（与插件「不产出空文件」同一条纪律）
      if (typeof o.markdown !== 'string' || !o.markdown.trim()) continue;
      const messages = Array.isArray(o.messages)
        ? o.messages
          .map((m) => m as Record<string, unknown>)
          .filter((m) => typeof m?.role === 'string' && typeof m?.text === 'string')
          .map((m) => ({ role: m.role as string, text: m.text as string }))
        : [];
      if (messages.length === 0) continue;
      // 第二道闸：即使页面驱动漏判，也不让「只有助手」的会话回传到落盘层。
      if (!messages.some((m) => m.role === 'user') || !/^##\s*用户\s*$/m.test(o.markdown)) continue;
      const url = typeof o.url === 'string' ? o.url : '';
      // ID 是落盘主键：页面已给就用页面值，缺了就从 URL 现提；两者都没有才留空（退化为标题键）。
      const id = sanitizeConversationId(
        typeof o.id === 'string' && o.id.trim() ? o.id.trim() : (conversationIdFromUrl(url) ?? ''),
      );
      chats.push({
        title: o.title,
        id,
        url,
        path: typeof o.path === 'string' ? o.path : '',
        messages,
        key: o.key,
        sig: typeof o.sig === 'string' ? o.sig : '',
        markdown: o.markdown,
      });
    }
  }
  return {
    items,
    diag: parseDiag(src.diag),
    diagText: typeof src.diagText === 'string' ? src.diagText : '',
    chats,
    steps: parseSteps(src.steps),
    needRelogin: src.needRelogin === true,
    nextStart: num(src.nextStart),
    attempts: num(src.attempts),
    skipped: num(src.skipped),
    reachedEnd: src.reachedEnd === true,
    debug: parseSnapshot(src.debug),
  };
}

/** 侧栏体检 → 一句人话（UI 的说明列只有一行位置，不铺 JSON） */
export function formatDiag(diag: SidebarDiag | null, diagText = ''): string {
  if (!diag) return diagText || '没有侧栏体检数据';
  const parts = [
    `语义条目 ${diag.semantic}`,
    `同类成组 ${diag.groupRows}`,
    `正文区行 ${diag.messageAreaRows}`,
  ];
  if (diag.anchors.length > 0) parts.push(`首个锚点 ${diag.anchors[0].href || '(无 href)'}`);
  return parts.join(' / ');
}

/** 把逐条失败原因压成一句（区分「没跳转」和「跳了没正文」是这轮排查的关键） */
export function summarizeSteps(steps: DriverStep[]): string {
  const failed = steps.filter((s) => s.why);
  if (steps.length === 0) return '本轮一条会话都没点到（侧栏条目为 0 或全部超上限）';
  if (failed.length === 0) return '点开的会话都拿到了正文，但没有一条通过入库校验';
  const noNav = failed.filter((s) => s.why === 'click-no-nav').length;
  const noContent = failed.filter((s) => s.why === 'nav-no-content').length;
  const noEl = failed.filter((s) => s.why === 'no-element').length;
  const missingUser = failed.filter((s) => s.why === 'missing-user').length;
  const errs = failed.filter((s) => s.why.startsWith('error:')).length;
  if (missingUser === failed.length) return `点了 ${failed.length} 条，滚顶后仍没认出用户提问；本轮不落坏文件，下一轮继续重试`;
  if (noNav === failed.length) return `点了 ${failed.length} 条，地址都没变（点了但页面没切换，侧栏条目可能不是会话链接）`;
  if (noContent === failed.length) {
    const c = steps[0]?.containers ?? 0;
    return `点了 ${failed.length} 条，地址跳过去了但正文一条都没读到（页面疑似消息容器 ${c} 个）`;
  }
  const bits: string[] = [];
  if (noNav) bits.push(`${noNav} 条点了没跳转`);
  if (noContent) bits.push(`${noContent} 条跳过去没读到正文`);
  if (noEl) bits.push(`${noEl} 条拿不到可点元素`);
  if (missingUser) bits.push(`${missingUser} 条没认出用户提问`);
  if (errs) bits.push(`${errs} 条报错`);
  return `点了 ${failed.length} 条：${bits.join('、')}`;
}

/** 去重：只保留这一轮真正要导的（已采过 / 本轮内重复都剔掉） */
export function pickNewChats(chats: DriverChat[], doneKeys: Record<string, number>): DriverChat[] {
  const out: DriverChat[] = [];
  const seen = new Set<string>();
  for (const c of chats) {
    // 判「在不在账里」不能看值真假：时间戳为 0 也是采过（真值判断会让边界值重采）
    if (Object.prototype.hasOwnProperty.call(doneKeys, c.key) || seen.has(c.key)) continue;
    seen.add(c.key);
    out.push(c);
  }
  return out;
}

/** 判定单站结果：这条判据决定 UI 上显示「正常」还是「要重新登录」 */
export function judgeSite(
  site: string,
  parsed: DriverResult | null,
  exported: number,
  error?: string,
): SiteRoundResult {
  if (error) return { site, status: 'error', scanned: 0, exported: 0, reason: error };
  if (!parsed) return { site, status: 'error', scanned: 0, exported: 0, reason: '页面没有回传可解析结果' };
  const scanned = parsed.items.length;
  const diagText = formatDiag(parsed.diag, parsed.diagText);
  if (parsed.needRelogin) {
    // 登录页优先于一切：这一轮刻意零点击，绝不能报成「页面结构变了」让人去改选择器
    return {
      site, status: 'need_relogin', scanned, exported: 0,
      reason: `当前是登录/找回密码页，没有会话列表，本轮没有点击任何条目。请点上方「重新登录」在该站点登录一次。体检：${diagText}`,
    };
  }
  if (scanned === 0) {
    // 侧栏一条都没有 + 也没抽到消息 = 最可能是未登录（登录页没有侧栏）
    return {
      site, status: 'need_relogin', scanned: 0, exported: 0,
      reason: `侧栏未识别到会话，可能未登录或侧栏被折叠。体检：${diagText}`,
    };
  }
  if (parsed.chats.length === 0) {
    // 抽到了正文但全被去重命中 = 正常（这一区间没有新会话），绝不能报成「页面结构变了」：
    // 侧栏最新几条采过之后，每轮都会走到这里，误报会让人去改本来没坏的选择器。
    if (parsed.skipped > 0 && parsed.attempts > 0) {
      return { site, status: 'no_new', scanned, exported: 0, reason: `点开 ${parsed.attempts} 条，${parsed.skipped} 条已在账里（没有新会话，不是页面问题）` };
    }
    return {
      site, status: 'dom_changed', scanned, exported: 0,
      reason: `识别到 ${scanned} 条会话，${summarizeSteps(parsed.steps)}。体检：${diagText}`,
    };
  }
  return { site, status: exported > 0 ? 'exported' : 'no_new', scanned, exported };
}
