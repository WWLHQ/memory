/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://chat.deepseek.com/a/chat/s/abc" }
 */
// 内容脚本（content.js）历史遍历的回归：分页续采 + 同名会话不丢。
//
// 2026-11-17 用户实测第三根因：「DeepSeek 导出历史会话没有导出全部，有遗漏」。
// 地面真相：账号下有 74 个会话，插件只导了 29 个（漏 70%）。
// 真因有三层：
//   ① listSidebarItems 默认 max=30，虚拟列表一屏就满 → 只看得到眼前这一屏；
//   ② 「这一屏没有新条目」就 break → 虚拟列表还没滚完就收工；
//   ③ 去重用**标题** → 同名会话被直接丢掉。
//
// 用 vitest 的 jsdom 环境 + node:vm 把 content.js 真跑起来，钉死这三层。
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
// 与 webchatExtensionCore.test.ts 同法：core.js 挂到 globalThis，供直接调 listSidebarItems
import '../../../browser-extension/webchat-exporter/shared/core.js';

const DIR = resolve(process.cwd(), 'browser-extension/webchat-exporter');
const CORE_SRC = readFileSync(resolve(DIR, 'shared/core.js'), 'utf8');
const CONTENT_SRC = readFileSync(resolve(DIR, 'content.js'), 'utf8');

interface RunResult {
  ok: boolean;
  reason?: string;
  delivered?: number;
  viaHost?: number;
  viaDl?: number;
  duplicated?: number;
  /** 本轮处理过的会话标题（后台记为断点） */
  processedLabels?: string[];
  /** true = 侧栏还有没处理完的，需要下一轮接着采 */
  more?: boolean;
  handled?: number;
  /** 0.5.5：侧栏本轮识别到的最大条目数（「导全了没有」的分母） */
  sidebarItems?: number;
  skipped: { title: string; reason: string }[];
}

/** 侧栏 HTML（DeepSeek hash 类名的真实结构） */
function sidebarHtml(items: string[]): string {
  return `
    <div class="_77cdc67 _8a693f3">
      <div class="_3098d02" id="sidebar">${items.join('')}</div>
    </div>
    <div class="ds-virtual-list-visible-items" id="messages">
      <div class="ds-message _63c77b1"><div class="fbb737a4">当前这一轮的用户提问</div></div>
      <div class="ds-message _63c77b1"><div class="ds-markdown ds-assistant-message-main-content">助手回答</div></div>
    </div>`;
}

/** 虚拟列表：只渲染一屏（pageSize 条），翻页时换一批 */
function virtualSidebarItems(page: number, pageSize: number, total: number): string[] {
  const start = page * pageSize;
  const out: string[] = [];
  for (let i = start; i < Math.min(start + pageSize, total); i++) {
    out.push(`<div class="c08e6e93">会话${i + 1}</div>`);
  }
  return out;
}

interface Harness {
  run: (msg: unknown) => Promise<RunResult>;
  /** 被交付到后台的会话标题（按顺序） */
  delivered: string[];
  /** 被交付到后台的完整 payload（诊断线索 etc. 只在这里看得到） */
  payloads: Record<string, unknown>[];
  /** 侧栏滚动次数 */
  scrollCount: () => number;
}

/**
 * 在当前 jsdom 环境里跑 content.js。
 * 用全局 document/window（vitest environment: jsdom），不新建 JSDOM 实例 ——
 * 新建实例要走 CJS 互操作，在 ESM 下会炸（html-encoding-sniffer）。
 */
function loadContent(opts: {
  html: string;
  /** 点击某个侧栏条目时发生什么：返回切换后的 pathname 与消息 */
  onClick?: (title: string) => { pathname: string; messages: { role: string; text: string }[] };
  /** 每次滚动后发生什么（虚拟列表翻页） */
  onScroll?: (scrollTop: number) => void;
}): Harness {
  document.body.innerHTML = `<div id="root">${opts.html}</div>`;

  const delivered: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  let scrollCount = 0;

  // 侧栏容器做成可滚动的（core.findScrollAncestor 认 overflowY:auto + scrollHeight>clientHeight）
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    // scrollTop 必须像真实浏览器那样**夹在 [0, scrollHeight-clientHeight]**：
    // 不夹的话到到底后每次赋值都算「变了」，content.js 会一直滚到页数上限才停。
    const CLIENT = 400;
    const SCROLL = 4000;
    const MAX_TOP = SCROLL - CLIENT;
    let top = 0;
    Object.defineProperty(sidebar, 'clientHeight', { value: CLIENT, configurable: true });
    Object.defineProperty(sidebar, 'scrollHeight', { value: SCROLL, configurable: true });
    Object.defineProperty(sidebar, 'scrollTop', {
      get: () => top,
      set: (v: number) => {
        const next = Math.max(0, Math.min(MAX_TOP, Math.floor(Number(v) || 0)));
        if (next === top) return;
        top = next;
        scrollCount += 1;
        opts.onScroll?.(next);
      },
      configurable: true,
    });
    // jsdom 的 getComputedStyle 对 overflow-y 默认给 visible，这里补一条样式让它认得出可滚动
    const style = document.createElement('style');
    style.textContent = '#sidebar { overflow-y: auto; }';
    document.head.appendChild(style);
  }

  const listeners: ((msg: unknown, sender: unknown, respond: (r: unknown) => void) => unknown)[] = [];
  const chrome = {
    runtime: {
      lastError: undefined as undefined | { message?: string },
      sendMessage: (msg: unknown, cb: (res: unknown) => void) => {
        const m = msg as { type: string; payload?: { title?: string; site?: string; messages?: { role: string; text: string }[] } };
        if (m.type === 'EXPORT_HISTORY_ITEM') {
          delivered.push(String(m.payload?.title ?? ''));
          payloads.push((m.payload ?? {}) as Record<string, unknown>);
          cb({ ok: true, via: 'host' });
          return;
        }
        cb({ ok: true });
      },
      onMessage: { addListener: (fn: (typeof listeners)[number]) => { listeners.push(fn); } },
    },
  };

  /**
   * 定时器加速：content.js 里「每卷一次侧栏 sleep 700ms」「切会话轮询 500ms 一次」
   * 在真机上是为了等 React 渲染，这里没有渲染，等满就是纯浪费（单跑一条 34s）。
   * 只压缩等待时长，不改变「等一会儿再看」的语义。
   */
  const fast = (ms: number): number => Math.min(Math.max(1, Number(ms) || 1), 10);

  const sandbox: Record<string, unknown> = {
    chrome,
    console,
    // 全局对象要跟真实页面一致：content.js 用 window.localStorage 兜旧账、
    // core.matchSite 用 new URL() 判站点。少一个就整段落空（历史遍历会误报
    // 「打开后没读到对话消息」，因为 matchSite 抛错回 null → 一条都抽不到）。
    window,
    document,
    location: window.location,
    URL,
    URLSearchParams,
    navigator: window.navigator,
    history: { back: () => { window.history.back(); } },
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, fast(ms ?? 0)),
    clearTimeout,
    setInterval: (fn: () => void, ms?: number) => setInterval(fn, fast(ms ?? 0)),
    clearInterval,
    Promise,
    Set,
    Map,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(CORE_SRC, ctx);
  // core.js 在 vm 里挂到 globalThis；content.js 读 globalThis.WebchatExporterCore
  sandbox.WebchatExporterCore = (ctx as unknown as { WebchatExporterCore?: unknown }).WebchatExporterCore;
  vm.runInContext(CONTENT_SRC, ctx);

  // 点击侧栏条目 → 模拟切换会话（改 URL + 换消息）
  if (opts.onClick) {
    document.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const title = (target.textContent ?? '').trim();
      if (!title) return;
      const next = opts.onClick?.(title);
      if (!next) return;
      window.history.pushState({}, '', next.pathname);
      // 真实站点切换会话时会更新 document.title；content.js 用它当导出标题
      document.title = title;
      const msgs = document.getElementById('messages');
      if (msgs) {
        msgs.innerHTML = next.messages
          .map((m) => (m.role === 'user'
            ? `<div class="ds-message _63c77b1"><div class="fbb737a4">${m.text}</div></div>`
            : `<div class="ds-message _63c77b1"><div class="ds-markdown ds-assistant-message-main-content">${m.text}</div></div>`))
          .join('');
      }
    }, true);
  }

  const run = (msg: unknown): Promise<RunResult> => new Promise((done) => {
    for (const fn of listeners) {
      const ret = fn(msg, {}, done as (r: unknown) => void);
      if (ret === true) return;
    }
    done({ ok: false, reason: '没有监听器', skipped: [] });
  });

  return { run, delivered, payloads, scrollCount: () => scrollCount };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  document.title = '';
  window.history.pushState({}, '', '/a/chat/s/abc');
});

describe('内容脚本：侧栏单次识别上限', () => {
  it('默认上限不是 30（30 会让 74 个会话只导 29 个）', () => {
    const items = Array.from({ length: 60 }, (_, i) => `<div class="c08e6e93">会话${i + 1}</div>`).join('');
    document.body.innerHTML = sidebarHtml([items]);
    const core = (globalThis as unknown as {
      WebchatExporterCore?: { listSidebarItems: (r: Document, o?: { max?: number }) => { label: string }[] };
    }).WebchatExporterCore;
    expect(core).toBeTruthy();
    // 默认值本身：应远超 30
    const def = core!.listSidebarItems(document);
    expect(def.length).toBeGreaterThan(30);
    // 显式上限 200 时能拿更多
    const many = core!.listSidebarItems(document, { max: 200 });
    expect(many.length).toBeGreaterThanOrEqual(60);
  });
});

describe('内容脚本：历史遍历分页续采', () => {
  it('虚拟列表：第一屏没新条目时先滚动再判断，不提前收工', async () => {
    // 侧栏 12 个会话，虚拟列表一屏 6 个；滚一次换一批
    const PAGE = 6;
    const TOTAL = 12;
    let page = 0;
    const h = loadContent({
      html: sidebarHtml(virtualSidebarItems(0, PAGE, TOTAL)),
      onScroll: () => {
        page = Math.min(1, page + 1);
        const root = document.getElementById('root');
        if (root) root.innerHTML = sidebarHtml(virtualSidebarItems(page, PAGE, TOTAL));
      },
      onClick: (title) => ({
        pathname: `/a/chat/s/${encodeURIComponent(title)}`,
        messages: [
          { role: 'user', text: `${title} 的问题` },
          { role: 'assistant', text: `${title} 的回答` },
        ],
      }),
    });

    const res = await h.run({ type: 'EXPORT_HISTORY', waitMs: 200 });

    expect(res.ok).toBe(true);
    // 关键：滚动次数 > 0（旧实现「没新条目就 break」→ 0 次滚动、只导一屏）
    expect(h.scrollCount()).toBeGreaterThan(0);
    // 导出的会话数应超过一屏
    expect(h.delivered.length).toBeGreaterThan(PAGE);
  }, 60000);

  it('滚动后这一屏还没渲染出新条目 → 再滚一次，不能直接收工（真实虚拟列表有渲染延迟）', async () => {
    // 真机形态：卷到底以后 React 要过一帧才补上新条目。第一次滚动读回来还是老一屏，
    // 旧实现「没有新条目就 break」→ 直接判到底，后面的会话全丢。
    const PAGE = 6;
    const TOTAL = 12;
    let rendered = 0; // 已经渲染到第几屏
    let scrolls = 0;
    const h = loadContent({
      html: sidebarHtml(virtualSidebarItems(0, PAGE, TOTAL)),
      onScroll: () => {
        scrolls += 1;
        // 只有第 2 次滚动才真的换屏：模拟「滚了但渲染没跟上」
        if (scrolls % 2 !== 0) return;
        rendered = Math.min(1, rendered + 1);
        const root = document.getElementById('root');
        if (root) root.innerHTML = sidebarHtml(virtualSidebarItems(rendered, PAGE, TOTAL));
      },
      onClick: (title) => ({
        pathname: `/a/chat/s/${encodeURIComponent(title)}`,
        messages: [
          { role: 'user', text: `${title} 的问题` },
          { role: 'assistant', text: `${title} 的回答` },
        ],
      }),
    });

    const res = await h.run({ type: 'EXPORT_HISTORY', waitMs: 200 });

    expect(res.ok).toBe(true);
    expect(h.scrollCount()).toBeGreaterThan(1);
    // 关键：第二屏也导出来了（旧实现这里只会有一屏 6 条）
    expect(h.delivered.length).toBeGreaterThan(PAGE);
  }, 60000);

  it('单轮配额 + 断点：跳过已处理标题，只处理 maxItems 条并回执 more', async () => {
    // 真事故：一口气点 190 个会话要 4 分钟，MV3 的 SW 撑不住 →
    // 必须能「这轮只做一批」并且「下轮不重复点已经做过的」。
    const items = Array.from({ length: 8 }, (_, i) => `<div class="c08e6e93">会话${i + 1}</div>`).join('');
    const h = loadContent({
      html: sidebarHtml([items]),
      onClick: (title) => ({
        pathname: `/a/chat/s/${encodeURIComponent(title)}`,
        messages: [
          { role: 'user', text: `${title} 的问题` },
          { role: 'assistant', text: `${title} 的回答` },
        ],
      }),
    });

    const res = await h.run({
      type: 'EXPORT_HISTORY',
      waitMs: 200,
      maxItems: 3,
      skipLabels: ['会话1'], // 上一轮已经处理过
    });

    expect(res.ok).toBe(true);
    // 「会话1」被跳过、不再点开 → 本轮实际做 3 条（会话2/3/4）
    expect(res.delivered).toBe(3);
    expect(res.handled).toBe(3);
    expect(res.processedLabels).toEqual(['会话2', '会话3', '会话4']);
    // 侧栏还有 5 条没做 → 必须告诉后台「还要接着采」
    expect(res.more).toBe(true);
  }, 60000);

  it('时间预算到点必须收工（0.5.2：条数 × 每条等待会超过 SW 寿命）', async () => {
    // 真事故：0.5.1 按「25 条」分批，但每条最多等 15 秒 → 单轮 6 分钟 >
    // MV3 SW 的 5 分钟上限 → 每轮被杀、断点写不进去 → 永远跑不完。
    const items = Array.from({ length: 8 }, (_, i) => `<div class="c08e6e93">会话${i + 1}</div>`).join('');
    const h = loadContent({
      html: sidebarHtml([items]),
      onClick: (title) => ({
        pathname: `/a/chat/s/${encodeURIComponent(title)}`,
        messages: [
          { role: 'user', text: `${title} 的问题` },
          { role: 'assistant', text: `${title} 的回答` },
        ],
      }),
    });

    // maxItems 故意给很大：只有预算能拦住它
    const res = await h.run({ type: 'EXPORT_HISTORY', waitMs: 200, maxItems: 50, budgetMs: 1 });

    expect(res.ok).toBe(true);
    expect(res.more).toBe(true);
    expect(res.handled).toBeLessThan(8);
  }, 60000);

  it('同名但不同路径的会话不会被去重顶掉（按元素+路径去重，不是按标题）', async () => {
    const items = Array.from({ length: 3 }, () => '<div class="c08e6e93">同名会话</div>').join('');

    let clickIndex = 0;
    const paths = ['/a/chat/s/one', '/a/chat/s/two', '/a/chat/s/three'];
    const h = loadContent({
      html: sidebarHtml([items]),
      onClick: () => {
        const p = paths[clickIndex] ?? '/a/chat/s/three';
        clickIndex += 1;
        return {
          pathname: p,
          messages: [
            { role: 'user', text: `问 ${p}` },
            { role: 'assistant', text: `答 ${p}` },
          ],
        };
      },
    });

    const res = await h.run({ type: 'EXPORT_HISTORY', waitMs: 200 });

    expect(res.ok).toBe(true);
    // 三个同名会话 → 三次交付（按标题去重的话这里只会剩 1 次）
    expect(h.delivered.length).toBe(3);
  }, 60000);

  it('回执带上「侧栏识别到几条会话」——没有这个分母，永远答不了「是不是漏了」', async () => {
    const items = Array.from({ length: 9 }, (_, i) => `<div class="c08e6e93">会话${i + 1}</div>`).join('');
    const h = loadContent({
      html: sidebarHtml([items]),
      onClick: (title) => ({
        pathname: `/a/chat/s/${encodeURIComponent(title)}`,
        messages: [
          { role: 'user', text: `${title} 的问题` },
          { role: 'assistant', text: `${title} 的回答` },
        ],
      }),
    });

    const res = await h.run({ type: 'EXPORT_HISTORY', waitMs: 200, maxItems: 2 });

    expect(res.ok).toBe(true);
    expect(res.sidebarItems).toBe(9); // 分母：侧栏这屏认出 9 条
    expect(res.handled).toBe(2);      // 分子：这轮只处理 2 条
    expect(res.more).toBe(true);      // 没采完 → 必须续采（旧实现在 200 条处静默收工）
  }, 60000);

  /**
   * 2026-11-17 豆包实测的真根因：SPA **先改 URL 再渲染内容**。
   * 点下第 N 条时 URL 已是第 N 条、内容还是第 N-1 条 →
   * 旧实现「URL 变了就算切换成功」→ 把旧内容记到新路径的账上 → 再落一份。
   * 现场：豆包 57 份导出里 42 份是同一个会话，其它会话一条没进。
   */
  it('地址变了但内容还是上一个会话 → 不交付（否则同一段对话会被导出很多份）', async () => {
    const items = Array.from({ length: 4 }, (_, i) => `<div class="c08e6e93">会话${i + 1}</div>`).join('');
    const h = loadContent({
      html: sidebarHtml([items]),
      // 故意只改地址、不换消息：复现「渲染没跟上」
      onClick: (title) => ({
        pathname: `/a/chat/s/${encodeURIComponent(title)}`,
        messages: [
          { role: 'user', text: '当前这一轮的用户提问' },
          { role: 'assistant', text: '助手回答' },
        ],
      }),
    });

    const res = await h.run({ type: 'EXPORT_HISTORY', waitMs: 200 });

    expect(res.ok).toBe(true);
    // 一条都不能落盘：内容与点击前完全相同，落盘就是「同一对话多份文件」
    expect(h.delivered).toHaveLength(0);
    expect(res.skipped.length).toBeGreaterThan(0);
    expect(res.skipped[0].reason).toContain('内容还是上一个会话');
  }, 60000);

  /**
   * 2026-11-17 豆包现场：侧栏 42 个会话标题一模一样（「让agent优先读自建记忆库的方法」，
   * 豆包按首问截断生成标题）。断点用 Set 存标题 → 同名会话被当成「已处理」永久跳过。
   */
  it('断点是多重集：处理过 2 个同名会话，第 3 个同名会话照样要导', async () => {
    const items = Array.from({ length: 3 }, () => '<div class="c08e6e93">同名会话</div>').join('');
    const paths = ['/a/chat/s/p3', '/a/chat/s/p4', '/a/chat/s/p5'];
    let clickIndex = 0;
    const h = loadContent({
      html: sidebarHtml([items]),
      onClick: () => {
        const p = paths[Math.min(clickIndex, paths.length - 1)];
        clickIndex += 1;
        return {
          pathname: p,
          messages: [
            { role: 'user', text: `问 ${p}` },
            { role: 'assistant', text: `答 ${p}` },
          ],
        };
      },
    });

    const res = await h.run({
      type: 'EXPORT_HISTORY',
      waitMs: 200,
      // 上一轮处理过两个同名会话
      skipLabels: ['同名会话', '同名会话'],
    });

    expect(res.ok).toBe(true);
    // 前两个跳掉、第三个必须导（用 Set 的话这里会是 0）
    expect(h.delivered).toHaveLength(1);
    expect(res.handled).toBe(1);
  }, 60000);
});

// 0.5.3：清空旧导出时必须把 0.3.0 写在页面 localStorage 里的 v1 旧指纹一起清掉。
// 不清的后果不是「多导一份」，而是**一份都导不出来**：后台判「无新增」会比对 legacySig，
// 命中旧账直接跳过 → 用户点了「清空并重新导出」却什么都没发生。
describe('内容脚本：清空页面旧指纹（0.5.3）', () => {
  it('只删 webchatExporter:sig:v1:*，其它键原样保留', async () => {
    window.localStorage.clear();
    window.localStorage.setItem('webchatExporter:sig:v1:deepseek:/a/chat/s/abc', 'sig_old_1');
    window.localStorage.setItem('webchatExporter:sig:v1:deepseek:/a/chat/s/xyz', 'sig_old_2');
    window.localStorage.setItem('unrelated-key', 'keep-me');

    const h = loadContent({ html: sidebarHtml(['<div class="c08e6e93">会话一</div>']) });
    const res = (await h.run({ type: 'CLEAR_LEGACY_SIG' })) as unknown as { ok: boolean; cleared: number };

    expect(res.ok).toBe(true);
    expect(res.cleared).toBe(2);
    expect(window.localStorage.getItem('webchatExporter:sig:v1:deepseek:/a/chat/s/abc')).toBeNull();
    expect(window.localStorage.getItem('webchatExporter:sig:v1:deepseek:/a/chat/s/xyz')).toBeNull();
    expect(window.localStorage.getItem('unrelated-key')).toBe('keep-me');
  });
});

// ── 2026-11-17 用户指出：豆包 41 份历史导出里有 10 份「只有助手、没有用户提问」 ──
// 排查时发现更糟的一件事：这 10 份**一份诊断都没有**——历史遍历这条路径根本没接 diag，
// 于是「认不出用户气泡」永远拿不到现场结构，只能靠猜选择器。先把证据通道补齐。
describe('内容脚本：历史遍历也要带诊断线索', () => {
  // 侧栏至少要 3 个同类条目，`listSidebarItems` 的「同类成组」判据才认得出这是会话列表
  //（只有 1 条时它会诚实报「没找到历史会话列表」——那是另一件事，别混进来）。
  const THREE = ['只有回答的会话', '第二条', '第三条'];

  it('认不出用户提问时，交付的 payload 带 diag（否则永远无法定位选择器失效）', async () => {
    const h = loadContent({
      html: sidebarHtml(THREE.map((t) => `<div class="c08e6e93">${t}</div>`)),
      onClick: (title) => ({
        pathname: `/a/chat/s/${encodeURIComponent(title)}`,
        // 真机症状：页面上只有助手气泡被认出，用户那条认不出
        messages: [{ role: 'assistant', text: `${title} 的回答` }],
      }),
    });

    const res = await h.run({ type: 'EXPORT_HISTORY', waitMs: 200 });
    expect(res.ok, `遍历失败原因：${res.reason ?? '未给出'}`).toBe(true);
    expect(h.payloads.length).toBeGreaterThan(0);

    const diag = h.payloads[0].diag as {
      site?: string; url?: string; title?: string;
      counted?: { total?: number; user?: number; assistant?: number };
    } | undefined;
    expect(diag, '历史遍历必须带诊断线索').toBeTruthy();
    expect(diag!.site).toBe('deepseek');
    expect(diag!.counted).toMatchObject({ total: 1, user: 0, assistant: 1 });
    expect(diag!.url).toContain('/a/chat/s/');
    expect(diag!.title).toContain('只有回答的会话');
  }, 60000);

  it('用户提问认全了就不写诊断（不产无用文件）', async () => {
    const h = loadContent({
      html: sidebarHtml(THREE.map((t) => `<div class="c08e6e93">${t}</div>`)),
      onClick: (title) => ({
        pathname: `/a/chat/s/${encodeURIComponent(title)}`,
        messages: [
          { role: 'user', text: `${title} 的问题` },
          { role: 'assistant', text: `${title} 的回答` },
        ],
      }),
    });

    const res = await h.run({ type: 'EXPORT_HISTORY', waitMs: 200 });
    expect(res.ok, `遍历失败原因：${res.reason ?? '未给出'}`).toBe(true);
    expect(h.payloads.length).toBeGreaterThan(0);
    for (const p of h.payloads) expect(p.diag).toBeUndefined();
  }, 60000);
});
