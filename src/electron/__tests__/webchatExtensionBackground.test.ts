// 插件后台（Service Worker）导出链回归。
//
// 2026-11-16 用户实测事故：点「导出当前对话」永远失败，提示「请刷新对话页后重试；若仍失败，说明页面结构可能有变化」，
// 刷新也没用。真因：`downloadMarkdown` 用了 `URL.createObjectURL` —— **MV3 Service Worker 没有这个 API**
// （Chrome 已移除），必然抛 TypeError，再被 catch 吞成那句「可能有变化」。
//
// 这里用 node:vm 把 background.js 跑进一个「像 Service Worker 的环境」（**故意不给 URL.createObjectURL**），钉死：
//   1. 导出走 data: URL（base64），不依赖 blob:
//   2. 内容脚本没注入 → 明确说「刷新对话页」，不再甩「页面结构可能有变化」
//   3. 下载被拒 → 带出真实原因
//   4. 批量导出失败要列原因
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const DIR = resolve(process.cwd(), 'browser-extension/webchat-exporter');

interface LoadOpts {
  tabs?: { id?: number; url?: string }[];
  sendMessage?: (id: number, msg: unknown) => Promise<unknown>;
  download?: (opts: unknown) => Promise<number>;
  /** 应用写进插件目录的 runtime.json（端口 + 令牌）；null/不传 = 没写过 */
  runtime?: { port: number; token: string } | null;
  /** 本机接收端的响应（仅在请求不是 runtime.json 时被调用） */
  fetch?: (url: string, init?: { method?: string; body?: string }) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;
  /** chrome.permissions.contains 的返回值；不传 = 沙箱里没有 permissions API（按「查不到就不误报」处理） */
  permissions?: boolean;
  /**
   * chrome.scripting.executeScript 的行为；不传 = 沙箱里没有 scripting API
   *（模拟 QQ/旧内核缺 API，走「请刷新页面」老文案）；'ok' = 注入成功
   */
  scripting?: 'ok';
  /**
   * 复用已有的扩展 storage（模拟 Service Worker 被杀后重启：内存没了，storage 还在）。
   * 不传 = 全新 storage（模拟浏览器首次装插件）。
   */
  store?: Record<string, unknown>;
  /**
   * 0.5.5：chrome.idle 的返回值。
   * 不传 = 沙箱里**没有** chrome.idle（模拟老内核 / 没授 idle 权限）→ 空闲补跑必须一律不动手。
   */
  idle?: 'idle' | 'active' | 'locked';
}

interface HostProbe {
  ok: boolean;
  step: string;
  port?: number;
  reason?: string;
}

interface LastAuto {
  at?: number;
  source?: string;
  exported?: number;
  failed?: number;
  skipped?: number;
  historyExported?: number;
  idleRounds?: number;
}

interface Loaded {
  /** 触发一次 runtime.onMessage 并等异步回执 */
  send: (msg: unknown) => Promise<{
    ok?: boolean;
    message?: string;
    unchanged?: boolean;
    host?: HostProbe;
    lastAuto?: LastAuto | null;
    idle?: string | null;
  }>;
  downloads: { url?: string; filename?: string }[];
  /** 模拟真机 Service Worker：这里必须没有 createObjectURL */
  sandboxUrl: Record<string, unknown>;
  /** chrome.alarms.create 的调用记录（钉 5 分钟周期用） */
  createdAlarms: { name?: string; delayInMinutes?: number; periodInMinutes?: number }[];
  /** 触发一次 alarm 回调（模拟自动轮询） */
  fireAlarm: (name: string) => Promise<void>;
  /** chrome.storage.local 的内存镜像（钉自动轮询留痕用） */
  store: Record<string, unknown>;
}

function loadBackground(opts: LoadOpts = {}): Loaded {
  const coreSrc = readFileSync(resolve(DIR, 'shared/core.js'), 'utf8');
  const bgSrc = readFileSync(resolve(DIR, 'background.js'), 'utf8');

  const listeners: ((msg: unknown, sender: unknown, respond: (r: unknown) => void) => unknown)[] = [];
  const downloads: { url?: string; filename?: string }[] = [];
  // 复用传入的 storage：模拟「SW 被杀后重启，内存没了但 storage 还在」
  const store: Record<string, unknown> = opts.store ?? {};
  const createdAlarms: { name?: string; delayInMinutes?: number; periodInMinutes?: number }[] = [];
  const alarmListeners: ((alarm: { name?: string }) => void)[] = [];

  const chrome = {
    alarms: {
      getAll: async () => createdAlarms.map((a) => ({ name: a.name })),
      create: (name: string, info: { delayInMinutes?: number; periodInMinutes?: number }) => {
        createdAlarms.push({ name, ...info });
      },
      onAlarm: { addListener: (fn: (alarm: { name?: string }) => void) => { alarmListeners.push(fn); } },
    },
    storage: {
      local: {
        // get(null) = 取整本账（真 Chrome 支持；「清空旧导出」要靠它列出所有要重置的键）
        get: async (k: string | null) => {
          if (k === null) return { ...store };
          return k in store ? { [k]: store[k] } : {};
        },
        set: async (v: Record<string, unknown>) => { Object.assign(store, v); },
      },
    },
    runtime: {
      lastError: undefined as undefined | { message?: string },
      getURL: (p: string) => `chrome-extension://test/${p}`,
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: (fn: (typeof listeners)[number]) => { listeners.push(fn); } },
    },
    tabs: {
      query: async () => opts.tabs ?? [],
      sendMessage: (id: number, msg: unknown) => (opts.sendMessage ?? (async () => ({ ok: false })))(id, msg),
    },
    downloads: {
      download: (o: { url?: string; filename?: string }) => {
        downloads.push(o);
        return (opts.download ?? (async () => 1))(o);
      },
    },
    // 只有显式传 scripting 才挂这个 API：默认缺失，模拟「旧内核 / 权限未授」的情形
    scripting: opts.scripting === 'ok'
      ? { executeScript: async () => [{ result: undefined }] }
      : undefined,
    // 只有显式传 permissions 才挂这个 API：默认缺失，模拟「浏览器没给/查不到」的情形
    permissions: opts.permissions === undefined
      ? undefined
      : { contains: async () => opts.permissions === true },
    // 只有显式传 idle 才挂这个 API：默认缺失，模拟「老内核 / 没授 idle 权限」
    idle: opts.idle === undefined
      ? undefined
      : {
        queryState: (_seconds: number, cb: (state: string) => void) => { cb(opts.idle as string); },
      },
  };

  // 刻意造一个「能解析 URL、但没有 createObjectURL」的 URL：这才像 MV3 Service Worker。
  // （直接用 Node 的 URL 不行——Node 18+ 自带 createObjectURL，会让旧代码在测试里假通过。）
  const NodeURL = URL;
  function SandboxURL(input: string, base?: string): URL {
    return new NodeURL(input, base);
  }
  const sandboxUrl: Record<string, unknown> = SandboxURL as unknown as Record<string, unknown>;

  // 本机接收端：runtime.json 从扩展包内读（chrome.runtime.getURL），POST 走注入的 fetch
  const fetchMock = async (
    url: string,
    init?: { method?: string; body?: string },
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
    if (String(url).includes('runtime.json')) {
      if (!opts.runtime) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => opts.runtime };
    }
    if (opts.fetch) return opts.fetch(String(url), init);
    return { ok: false, status: 0, json: async () => ({ ok: false, error: 'no mock' }) };
  };

  const sandbox: Record<string, unknown> = {
    chrome,
    console,
    TextEncoder,
    TextDecoder,
    URL: SandboxURL,
    fetch: fetchMock,
    setTimeout,
    clearTimeout,
    Promise,
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    importScripts: () => {}, // core.js 已预载进同一 context
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(coreSrc, ctx);
  vm.runInContext(bgSrc, ctx);

  const send = (msg: unknown) => new Promise<{ ok?: boolean; message?: string; host?: HostProbe }>((done) => {
    for (const fn of listeners) {
      const ret = fn(msg, {}, done as (r: unknown) => void);
      if (ret === true) return; // 异步回执：等 done
    }
    done({});
  });

  const fireAlarm = (name: string) => new Promise<void>((done) => {
    setTimeout(() => {
      for (const fn of alarmListeners) fn({ name });
      setTimeout(() => done(), 50);
    }, 0);
  });

  return { send, downloads, sandboxUrl, createdAlarms, fireAlarm, store };
}

const TAB = { id: 7, url: 'https://chat.deepseek.com/a/chat/s/abc' };

/**
 * 历史遍历相关的持久化键前缀（0.5.1 起有三类：该站点已跑完 / 续采断点 / 正在跑）。
 * 断言任务记录时要全部排除——它们是状态标记，不是任务记录。
 */
const HISTORY_FLAG_PREFIXES = [
  'webchatExporter:historyDoneAt:',
  'webchatExporter:historyProgress:',
  'webchatExporter:historyRunning:',
  'webchatExporter:historyStreak:',
];
const isHistoryFlag = (k: string): boolean => HISTORY_FLAG_PREFIXES.some((p) => k.startsWith(p));
/**
 * 0.5.5（A）新增：每轮巡检都写「最近检查」账，空闲补跑还写「上次补跑时间」。
 * 这两类也是状态标记，不是任务记录——断言「不留任务记录」时必须一起排除。
 */
const META_KEYS = ['webchatExporter:lastAutoAt:v1', 'webchatExporter:historyRefreshAt:v1:'];
const isMetaKey = (k: string): boolean => isHistoryFlag(k) || META_KEYS.some((p) => k.startsWith(p));
const DONE_KEY_PREFIX = 'webchatExporter:historyDoneAt:';
const LAST_AUTO_KEY = 'webchatExporter:lastAutoAt:v1';
const REFRESH_ALARM = 'webchat-exporter-history-refresh';

function payload(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    site: 'deepseek',
    siteLabel: 'DeepSeek',
    title: '支付超时复盘',
    url: 'https://chat.deepseek.com/a/chat/s/abc',
    exportedAt: '2026-11-16T14:00:00.000Z',
    messages: [
      { role: 'user', text: '支付接口为什么超时？' },
      { role: 'assistant', text: '连接池 pool_size 过小。' },
    ],
    ...over,
  };
}

describe('插件后台导出（MV3 Service Worker 环境）', () => {
  it('Service Worker 环境确实没有 createObjectURL（复现 2026-11-16 失败的前提）', () => {
    const { sandboxUrl } = loadBackground();
    expect('createObjectURL' in sandboxUrl).toBe(false);
  });

  it('导出成功（兜底路径）：走 data: URL（base64），文件名落在 chat-exports/<站点>/', async () => {
    const { send, downloads } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload(),
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: true });

    expect(res.ok).toBe(true);
    expect(res.message).toContain('改存到浏览器下载目录');
    expect(downloads).toHaveLength(1);
    expect(downloads[0].url?.startsWith('data:text/markdown;charset=utf-8;base64,')).toBe(true);
    expect(downloads[0].filename?.startsWith('chat-exports/deepseek/')).toBe(true);

    // 内容真的在文件里（中文没被 base64 过程弄坏）
    const b64 = (downloads[0].url ?? '').split(',')[1] ?? '';
    const text = Buffer.from(b64, 'base64').toString('utf8');
    expect(text).toContain('# 网页对话导出');
    expect(text).toContain('- 站点：DeepSeek');
    expect(text).toContain('## 用户');
    expect(text).toContain('支付接口为什么超时？');
  });

  it('内容脚本没注入（Receiving end does not exist）→ 明说刷新对话页，不再甩「页面结构可能有变化」', async () => {
    const { send } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); },
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: true });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('刷新对话页');
    expect(res.message).not.toContain('页面结构可能有变化');
  });

  it('下载被拒 → 消息里带真实原因（含原因码），不再用笼统结论盖住', async () => {
    const { send } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload(),
      download: async () => { throw new Error('net::ERR_INVALID_URL'); },
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: true });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('写入浏览器下载目录失败');
    expect(res.message).toContain('net::ERR_INVALID_URL');
  });

  it('内容脚本回「没读到消息」→ 原样转出它的原因（不替换成兜底文案）', async () => {
    const { send, downloads } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => ({ ok: false, reason: '没读到对话消息：请先登录并打开一段对话。' }),
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: true });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('没读到对话消息');
    expect(downloads).toHaveLength(0);
  });

  it('无新增 → 跳过且不写文件，消息说明已跳过', async () => {
    const { send, downloads } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload({ unchanged: true }),
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: false });

    expect(res.ok).toBe(true);
    expect(res.unchanged).toBe(true);
    expect(downloads).toHaveLength(0);
  });

  it('不在支持站点 → 给出站点清单，不尝试读取页面', async () => {
    const { send, downloads } = loadBackground({ tabs: [{ id: 1, url: 'https://example.com/' }] });

    const res = await send({ type: 'EXPORT_CURRENT', force: true });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('不在支持列表');
    expect(downloads).toHaveLength(0);
  });

  it('批量导出：部分失败时把原因列出来（不再只报数字）', async () => {
    const { send } = loadBackground({
      tabs: [{ id: 1, url: 'https://chat.deepseek.com/a/chat/s/1' }, { id: 2, url: 'https://www.doubao.com/chat/2' }],
      sendMessage: async (id) => {
        if (id === 1) return payload();
        throw new Error('Could not establish connection. Receiving end does not exist.');
      },
    });

    const res = await send({ type: 'EXPORT_ALL', force: false });

    expect(res.message).toContain('导出 1 份');
    expect(res.message).toContain('读取失败 1 份');
    expect(res.message).toContain('原因：');
    expect(res.message).toContain('刷新对话页');
  });

  it('本机接收端可用 → 直写应用，不再碰浏览器下载目录（QQ 浏览器丢文件的根治路径）', async () => {
    const posts: { url: string; body?: string }[] = [];
    const { send, downloads } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload(),
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async (url, init) => {
        posts.push({ url, body: init?.body });
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, path: 'C:\\Users\\LHQ\\Downloads\\chat-exports\\deepseek\\20261116-222305.md' }),
        };
      },
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: true });

    expect(res.ok).toBe(true);
    expect(res.message).toContain('已写入');
    expect(res.message).toContain('20261116-222305.md');
    expect(downloads).toHaveLength(0); // 关键：没有落到浏览器下载目录
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('http://127.0.0.1:8206/export');
    const body = JSON.parse(String(posts[0].body)) as { site: string; markdown: string };
    expect(body.site).toBe('deepseek');
    expect(body.markdown).toContain('支付接口为什么超时？');
  });

  it('本机接收端拒绝（令牌失效）→ 回退下载目录，并把真实原因写进消息', async () => {
    const { send, downloads } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload(),
      runtime: { port: 8206, token: 'stale' },
      fetch: async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: '令牌无效：请重新加载扩展' }) }),
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: true });

    expect(res.ok).toBe(true);
    expect(res.message).toContain('本机接收服务当前不可用');
    expect(res.message).toContain('令牌无效');
    expect(downloads).toHaveLength(1);
  });

  it('没有 runtime.json（应用没启动过）→ 回退下载目录，并说清原因', async () => {
    const { send, downloads } = loadBackground({ tabs: [TAB], sendMessage: async () => payload(), runtime: null });

    const res = await send({ type: 'EXPORT_CURRENT', force: true });

    expect(res.ok).toBe(true);
    expect(res.message).toContain('本机接收服务当前不可用');
    expect(downloads).toHaveLength(1);
  });
});

// ── 0.3.0：拆掉「一条不满足就停」的旧门槛（2026-11-17 用户反馈） ────────────────
describe('0.3.0 放宽旧门槛', () => {
  it('自动导出周期钉死 5 分钟，且启动时无条件重建（升级后旧 15 分钟 alarm 会被覆盖）', () => {
    const { createdAlarms } = loadBackground();
    // 0.5.5 起启动时建**两个** alarm：5 分钟增量巡检 + 60 分钟空闲补跑检查
    expect(createdAlarms.filter((a) => a.name === 'webchat-exporter-auto-v1')).toEqual([
      { name: 'webchat-exporter-auto-v1', delayInMinutes: 5, periodInMinutes: 5 },
    ]);
    expect(createdAlarms.filter((a) => a.name === REFRESH_ALARM)).toEqual([
      { name: REFRESH_ALARM, delayInMinutes: 60, periodInMinutes: 60 },
    ]);
  });

  it('内容脚本没注入但有 scripting API → 自动注入后重试成功，不再要求用户刷新页面', async () => {
    let calls = 0;
    const { send, downloads } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => {
        calls += 1;
        if (calls === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
        return payload();
      },
      scripting: 'ok',
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\retry.md' }) }),
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: true });

    expect(calls).toBe(2);
    expect(res.ok).toBe(true);
    expect(res.message).not.toContain('刷新对话页');
    expect(res.message).toContain('retry.md');
    expect(downloads).toHaveLength(0);
  });

  it('导出全部历史对话：content 回执汇总 → 弹窗消息带份数与去重说明', async () => {
    const posts: string[] = [];
    const { send } = loadBackground({
      tabs: [TAB],
      // EXPORT_HISTORY 汇总由 content 回执；每条会话的交付走 EXPORT_HISTORY_ITEM
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_HISTORY') {
          return { ok: true, delivered: 2, viaHost: 2, viaDl: 0, skipped: [{ title: '空白项', reason: '点击后页面没有切换' }] };
        }
        if (m.type === 'EXPORT_HISTORY_ITEM') {
          posts.push('item');
          return { ok: true, via: 'host' };
        }
        return payload();
      },
      runtime: { port: 8206, token: 'tok_1' },
    });

    const res = await send({ type: 'EXPORT_HISTORY' });

    expect(res.ok).toBe(true);
    expect(res.message).toContain('历史对话导出 2 份');
    expect(res.message).toContain('遍历跳过 1 条');
    expect(res.message).toContain('自动去重');
  });

  it('EXPORT_HISTORY_ITEM：空消息体直接拒绝，不给兜底下载', async () => {
    const { send, downloads } = loadBackground({ tabs: [TAB], runtime: { port: 8206, token: 'tok_1' } });

    const res = await send({ type: 'EXPORT_HISTORY_ITEM', payload: { site: 'deepseek', messages: [] } });

    expect(res.ok).toBe(false);
    expect((res as { reason?: string }).reason ?? '').toContain('没有可交付的内容');
    expect(downloads).toHaveLength(0);
  });

  it('自动轮询有导出 → 落一条 auto 任务留痕（弹窗可见），不再完全静默', async () => {
    const { fireAlarm, store } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload(),
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await fireAlarm('webchat-exporter-auto-v1');

    const tasks = (store['webchatExporter:tasks:v1'] as { kind: string; message: string; status: string }[]) ?? [];
    expect(tasks.some((t) => t.kind === 'auto' && t.message.startsWith('自动导出：') && t.status === 'done')).toBe(true);
  });

  it('自动轮询全部「无新增」跳过 → 第二轮起不留痕（别让记录每 5 分钟刷屏）', async () => {
    const { fireAlarm, store } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload({ unchanged: true }),
    });

    // 第一轮：历史全量遍历会跑并留痕（0.3.0 新行为，另有专门用例）
    await fireAlarm('webchat-exporter-auto-v1');
    for (const k of Object.keys(store)) {
      if (!isMetaKey(k)) delete store[k];
    }

    // 第二轮起：历史不再跑、对话无新增 → 无事发生，不写**任务记录**
    // （0.5.5 起 A 会写「最近检查」账，那是状态标记不是任务记录，见 isMetaKey）
    await fireAlarm('webchat-exporter-auto-v1');
    expect(Object.keys(store).filter((k) => !isMetaKey(k))).toHaveLength(0);
  });

  it('自动首轮先做一次历史全量遍历（DeepSeek/豆包等所有支持站点通用），随后每轮不再跑', async () => {
    const autoTasks: string[] = [];
    let round = 0;
    const { fireAlarm, store } = loadBackground({
      tabs: [TAB],
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_NOW') {
          round += 1;
          return payload({ unchanged: true }); // 当前对话无新增：自动增量什么都不导
        }
        if (m.type === 'EXPORT_HISTORY') {
          autoTasks.push('history');
          return { ok: true, delivered: 4, viaHost: 4, viaDl: 0, skipped: [], siteLabel: 'DeepSeek' };
        }
        if (m.type === 'EXPORT_HISTORY_ITEM') return { ok: true, via: 'host' };
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await fireAlarm('webchat-exporter-auto-v1');
    // 第一轮：历史遍历跑过一次，即使当前对话无新增也留痕（带历史份数）
    expect(autoTasks).toEqual(['history']);
    const firstTasks = JSON.parse(JSON.stringify(store['webchatExporter:tasks:v1'])) as { kind: string; message: string }[];
    expect(firstTasks.some((t) => t.kind === 'auto' && t.message.includes('历史对话导出 4 份'))).toBe(true);

    // 第二轮：不再跑历史，全部无新增 → 不留任务记录
    // （store 里会多 historyDoneAt 标志键与 A 的「最近检查」账，都是状态标记，不算任务记录）
    const keysBefore = Object.keys(store);
    for (const k of keysBefore) if (!isMetaKey(k)) delete store[k];
    await fireAlarm('webchat-exporter-auto-v1');
    expect(autoTasks).toEqual(['history']); // 没有第二次历史遍历
    expect(Object.keys(store).filter((k) => !isMetaKey(k))).toHaveLength(0);
  });

  it('自动首轮：没有任何受支持站点 tab → 跳过历史遍历，本轮照常收场', async () => {
    const { fireAlarm, store } = loadBackground({
      tabs: [{ id: 1, url: 'https://example.com/' }],
      sendMessage: async () => payload({ unchanged: true }),
    });
    await fireAlarm('webchat-exporter-auto-v1');

    // 0.5.5 起仍会写一条「最近检查」账（这是 A 的目的：无动作也要可见）
    expect(Object.keys(store).filter((k) => !isMetaKey(k))).toHaveLength(0);
    expect((store[LAST_AUTO_KEY] as LastAuto).exported).toBe(0);
  });
});

// 2026-11-17 QQ 浏览器实测发现：「首轮跑历史」的标志原本是 SW 内存变量，
// MV3 的 Service Worker 空闲就被杀 → 内存归零 → 「首轮」变成**每 5 分钟一轮**。
// QQ 日志实测：15:29/15:34/15:39/15:44/15:49/15:56 每轮都有一条 history 任务。
// 侧栏识别修好之后这就变成每 5 分钟点一遍整个侧栏、反复劫持用户正在聊的页面。
// 0.4.0 把标志存进扩展 storage：SW 被杀、浏览器重启都不丢。
describe('0.4.0 历史首轮标志持久化', () => {
  it('首轮跑过一次历史遍历后，后续轮次不再自动跑历史', async () => {
    const autoTasks: string[] = [];
    const { fireAlarm } = loadBackground({
      tabs: [TAB],
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_NOW') return payload({ unchanged: true });
        if (m.type === 'EXPORT_HISTORY') {
          autoTasks.push('history');
          return { ok: true, delivered: 2, viaHost: 2, viaDl: 0, skipped: [], siteLabel: 'DeepSeek' };
        }
        if (m.type === 'EXPORT_HISTORY_ITEM') return { ok: true, via: 'host' };
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await fireAlarm('webchat-exporter-auto-v1');
    await fireAlarm('webchat-exporter-auto-v1');
    await fireAlarm('webchat-exporter-auto-v1');

    expect(autoTasks).toEqual(['history']); // 只跑过这一次
  });

  it('标志写在扩展 storage 里（SW 被杀后仍在，不会每轮重跑）', async () => {
    const { fireAlarm, store } = loadBackground({
      tabs: [TAB],
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_HISTORY') return { ok: true, delivered: 1, viaHost: 1, viaDl: 0, skipped: [], siteLabel: 'DeepSeek' };
        if (m.type === 'EXPORT_HISTORY_ITEM') return { ok: true, via: 'host' };
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await fireAlarm('webchat-exporter-auto-v1');

    // 按站点记：DeepSeek 这一份跑过就单独打标，不影响别的站点
    expect(typeof store[`${DONE_KEY_PREFIX}v2:deepseek`]).toBe('number');
  });

  it('新开的站点能补上首轮历史（按站点记账，不被别站点的标志挡住）', async () => {
    // 真事故形态：先只开着 DeepSeek → 首轮跑完打标；之后才打开豆包标签页。
    // 旧实现只有一个全局标志 → 豆包永远等不到自动遍历（历史一条都导不出来）。
    const tabs: { id: number; url: string }[] = [{ id: 7, url: 'https://chat.deepseek.com/a/chat/s/abc' }];
    const historyTabs: number[] = [];
    const { fireAlarm, store } = loadBackground({
      tabs,
      sendMessage: async (id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_HISTORY') {
          historyTabs.push(id);
          return { ok: true, delivered: 2, viaHost: 2, viaDl: 0, skipped: [], siteLabel: 'x' };
        }
        if (m.type === 'EXPORT_HISTORY_ITEM') return { ok: true, via: 'host' };
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await fireAlarm('webchat-exporter-auto-v1');
    expect(historyTabs).toEqual([7]);

    // 用户这时才打开豆包
    tabs.push({ id: 9, url: 'https://www.doubao.com/chat/abc' });
    await fireAlarm('webchat-exporter-auto-v1');

    // 只补豆包这一次，DeepSeek 不再重复遍历
    expect(historyTabs).toEqual([7, 9]);
    expect(typeof store[`${DONE_KEY_PREFIX}v2:doubao`]).toBe('number');
  });

  it('历史遍历分轮：一轮只采一批 → 存断点 → 续采把已处理标题带回去', async () => {
    // 真事故：190 个会话一口气点 4 分钟，SW 撑不住 → 每 5 分钟起一轮、每轮都跑不完，
    // 浏览器扩展日志里连着 6 条 history 任务全卡在 running。
    const calls: { type: string; maxItems?: number; budgetMs?: number; skipLabels?: string[] }[] = [];
    let round = 0;
    const { fireAlarm, store, createdAlarms } = loadBackground({
      tabs: [TAB],
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string; maxItems?: number; budgetMs?: number; skipLabels?: string[] };
        if (m.type === 'EXPORT_HISTORY') {
          calls.push(m);
          round += 1;
          if (round === 1) {
            return {
              ok: true, delivered: 1, viaHost: 1, viaDl: 0, skipped: [],
              processedLabels: ['会话A', '会话B'], more: true, siteLabel: 'DeepSeek',
            };
          }
          return {
            ok: true, delivered: 1, viaHost: 1, viaDl: 0, skipped: [],
            processedLabels: ['会话C'], more: false, siteLabel: 'DeepSeek',
          };
        }
        if (m.type === 'EXPORT_HISTORY_ITEM') return { ok: true, via: 'host' };
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await fireAlarm('webchat-exporter-auto-v1');

    // 单轮有上限（不然一轮就是几分钟）
    // 0.5.2：条数从 25 降到 8，且必须同时带**时间预算**——
    // 25 条 × 每条最多 15 秒 > MV3 SW 5 分钟上限，每轮都被杀，断点永远写不进去。
    expect(calls[0].maxItems).toBe(8);
    expect(calls[0].budgetMs).toBe(20000);
    expect(calls[0].skipLabels).toEqual([]);
    // 没采完 → 断点落盘 + 排了续采
    expect((store['webchatExporter:historyProgress:v1:deepseek'] as { labels: string[] }).labels).toEqual(['会话A', '会话B']);
    expect(createdAlarms.some((a) => a.name === 'webchat-exporter-history-continue')).toBe(true);
    // 没采完不能记「这个站点已跑完」
    expect(store[`${DONE_KEY_PREFIX}v2:deepseek`]).toBeUndefined();

    await fireAlarm('webchat-exporter-history-continue');

    // 续采把断点带回去（不重复点已处理的会话）
    expect(calls[1].skipLabels).toEqual(['会话A', '会话B']);
    // 采完 → 清断点 + 记该站点已完成
    expect((store['webchatExporter:historyProgress:v1:deepseek'] as { labels: string[] }).labels).toEqual([]);
    expect(typeof store[`${DONE_KEY_PREFIX}v2:deepseek`]).toBe('number');
  });

  it('上一轮还在跑 → 不叠第二轮（叠起来会互相抢同一个侧栏，谁都跑不完）', async () => {
    const attempts: number[] = [];
    const { fireAlarm, store } = loadBackground({
      tabs: [TAB],
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_HISTORY') {
          attempts.push(1);
          return {
            ok: true, delivered: 0, viaHost: 0, viaDl: 0, skipped: [],
            processedLabels: ['会话A'], more: true, siteLabel: 'DeepSeek',
          };
        }
        if (m.type === 'EXPORT_HISTORY_ITEM') return { ok: true, via: 'host' };
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await fireAlarm('webchat-exporter-auto-v1');
    expect(attempts).toHaveLength(1);

    // 模拟「上一轮还挂着」：running 标记是刚刚写的
    store['webchatExporter:historyRunning:v1:deepseek'] = Date.now();
    await fireAlarm('webchat-exporter-auto-v1');

    expect(attempts).toHaveLength(1); // 没有叠第二轮

    // 标记过期（SW 被杀等）→ 允许重来，不能永久卡住
    store['webchatExporter:historyRunning:v1:deepseek'] = Date.now() - 10 * 60 * 1000;
    await fireAlarm('webchat-exporter-auto-v1');
    expect(attempts).toHaveLength(2);
  });

  it('遍历失败不记「已跑过」：下一轮还会再试（否则历史永远补不上）', async () => {
    const attempts: number[] = [];
    const { fireAlarm, store } = loadBackground({
      tabs: [TAB],
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_HISTORY') {
          attempts.push(1);
          // 侧栏没认出来 —— 这种失败不该烧掉首轮机会
          return { ok: false, reason: '没在侧栏找到历史会话列表' };
        }
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await fireAlarm('webchat-exporter-auto-v1');
    await fireAlarm('webchat-exporter-auto-v1');

    expect(attempts).toHaveLength(2);
    expect(store[`${DONE_KEY_PREFIX}v2:deepseek`]).toBeUndefined();
  });

  it('弹窗手动点「导出全部历史对话」不受首轮标志限制（随时能再跑一次）', async () => {
    const autoTasks: string[] = [];
    const { send, fireAlarm } = loadBackground({
      tabs: [TAB],
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_HISTORY') {
          autoTasks.push('history');
          return { ok: true, delivered: 3, viaHost: 3, viaDl: 0, skipped: [], siteLabel: 'DeepSeek' };
        }
        if (m.type === 'EXPORT_HISTORY_ITEM') return { ok: true, via: 'host' };
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await fireAlarm('webchat-exporter-auto-v1');   // 自动首轮跑过一次
    const manual = await send({ type: 'EXPORT_HISTORY' }); // 用户手动再跑

    expect(autoTasks).toEqual(['history', 'history']);
    expect(manual.ok).toBe(true);
    expect(manual.message).toContain('历史对话导出 3 份');
  });

  it('Service Worker 被杀后重启（内存清空、storage 保留）→ 不会又去点一遍侧栏', async () => {
    // 这才是真正的回归场景：QQ 浏览器实测每轮都有一条 history 任务，
    // 因为旧标志是 SW 内存变量，SW 一被杀就归零 → 「首轮」变成「每轮」。
    const historyCalls: string[] = [];
    const makeSend = () => async (_id: number, msg: unknown) => {
      const m = msg as { type: string };
      if (m.type === 'EXPORT_HISTORY') {
        historyCalls.push('history');
        return { ok: true, delivered: 1, viaHost: 1, viaDl: 0, skipped: [], siteLabel: 'DeepSeek' };
      }
      if (m.type === 'EXPORT_HISTORY_ITEM') return { ok: true, via: 'host' };
      return payload({ unchanged: true });
    };
    const sharedStore: Record<string, unknown> = {};

    // 第 1 个 SW 实例：跑一轮历史
    const first = loadBackground({
      tabs: [TAB],
      sendMessage: makeSend(),
      store: sharedStore,
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });
    await first.fireAlarm('webchat-exporter-auto-v1');
    expect(historyCalls).toHaveLength(1);

    // SW 被杀 → 新实例（全新内存，同一个 storage）
    const second = loadBackground({
      tabs: [TAB],
      sendMessage: makeSend(),
      store: sharedStore,
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });
    await second.fireAlarm('webchat-exporter-auto-v1');

    expect(historyCalls).toHaveLength(1); // 没有第二次历史遍历
  });
});

// 2026-11-17 第二个真缺陷：「无新增」的记账时机错了。
// 旧实现里内容脚本读到消息就把指纹写进页面 localStorage —— 投递失败的那一轮也把指纹
// 记成了「已见」，下一轮判「无新增」跳过，那段内容就永远导不出来。
// 0.4.0 改成：内容脚本只把指纹带回来，由后台在**交付成功之后**才记账。
describe('0.4.0 增量签名记账时机', () => {
  const SIG_KEY = 'webchatExporter:sig:v2:deepseek:/a/chat/s/abc';
  const SIG = 'user:第一问\nassistant:第一答';

  it('投递失败 → 不记账 → 下一轮还会重导（不再被「无新增」永久跳过）', async () => {
    const { send, store, downloads } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload({ sig: SIG, sigKey: SIG_KEY }),
      // 本机接收端不可用 + 下载也失败 → 交付彻底失败
      runtime: null,
      download: async () => { throw new Error('net::ERR_INVALID_URL'); },
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: false });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('写入浏览器下载目录失败');
    // 关键：指纹没写进去
    expect(store[SIG_KEY]).toBeUndefined();
    expect(downloads).toHaveLength(1);
  });

  it('投递成功 → 记账 → 下一轮同样的内容判「无新增」并跳过', async () => {
    const { send, store } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload({ sig: SIG, sigKey: SIG_KEY }),
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    const first = await send({ type: 'EXPORT_CURRENT', force: false });
    expect(first.ok).toBe(true);
    expect(store[SIG_KEY]).toBe(SIG);

    const second = await send({ type: 'EXPORT_CURRENT', force: false });
    expect(second.unchanged).toBe(true);
  });

  it('手动强制导出（force=true）→ 无视「无新增」照样导出', async () => {
    const { send } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload({ sig: SIG, sigKey: SIG_KEY }),
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await send({ type: 'EXPORT_CURRENT', force: false });
    const forced = await send({ type: 'EXPORT_CURRENT', force: true });

    expect(forced.ok).toBe(true);
    expect(forced.unchanged).not.toBe(true);
  });

  it('历史条目交付成功 → 同样记账（不会下一轮当新增重复导）', async () => {
    const { send, store } = loadBackground({
      tabs: [TAB],
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\h.md' }) }),
    });

    const res = await send({
      type: 'EXPORT_HISTORY_ITEM',
      payload: { site: 'deepseek', messages: [{ role: 'user', text: '历史一问' }], sig: SIG, sigKey: SIG_KEY },
    });

    expect(res.ok).toBe(true);
    expect(store[SIG_KEY]).toBe(SIG);
  });
});

// 2026-11-16 第二起实测事故：0.2.0 已加载（扩展页显示 0.2.0）、应用也在跑（8206 在监听、
// 用同一令牌 POST /export 能落盘），但点导出仍然弹「新建下载任务」——说明 postToHost 在
// 扩展侧就失败了，而三条失败路径（缺权限 / 读不到 runtime.json / 连不上端口）全被静默
// catch 成 null，用户只能看到文件跑进下载目录。这里钉住「弹窗一打开就能看到卡在哪一步」。
describe('本机接收端自证（probeHost）', () => {
  it('runtime.json 可读且 /ping 200 → host.ok=true 且带端口', async () => {
    const pings: string[] = [];
    const { send } = loadBackground({
      tabs: [TAB],
      runtime: { port: 8206, token: 'tok_1' },
      permissions: true,
      fetch: async (url) => {
        pings.push(url);
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
    });

    const res = await send({ type: 'GET_STATUS' });

    expect(res.ok).toBe(true);
    expect(res.host).toMatchObject({ ok: true, step: 'ok', port: 8206 });
    expect(pings).toEqual(['http://127.0.0.1:8206/ping']);
  });

  it('扩展缺 127.0.0.1 访问权限 → step=permission，并给出「关掉再打开」的可执行动作', async () => {
    const { send } = loadBackground({ tabs: [TAB], runtime: { port: 8206, token: 'tok_1' }, permissions: false });

    const res = await send({ type: 'GET_STATUS' });

    expect(res.host?.ok).toBe(false);
    expect(res.host?.step).toBe('permission');
    expect(res.host?.reason).toContain('关掉再打开');
  });

  it('读不到 runtime.json → step=runtime，且 reason 带出真实错误（不是「未知原因」）', async () => {
    const { send } = loadBackground({ tabs: [TAB], runtime: null });

    const res = await send({ type: 'GET_STATUS' });

    expect(res.host?.ok).toBe(false);
    expect(res.host?.step).toBe('runtime');
    expect(res.host?.reason).toContain('HTTP 404');
  });

  it('连不上端口（fetch 抛 Failed to fetch）→ step=ping，并说清「应用没运行或浏览器拦了本机地址」', async () => {
    const { send } = loadBackground({
      tabs: [TAB],
      runtime: { port: 8206, token: 'tok_1' },
      permissions: true,
      fetch: async () => { throw new TypeError('Failed to fetch'); },
    });

    const res = await send({ type: 'GET_STATUS' });

    expect(res.host?.ok).toBe(false);
    expect(res.host?.step).toBe('ping');
    expect(res.host?.port).toBe(8206);
    expect(res.host?.reason).toContain('Failed to fetch');
    expect(res.host?.reason).toContain('应用没在运行');
  });
});

// 2026-11-17：导出成功但内容只有 AI 回答、缺用户提问。插件侧改为「没认出提问就附一份
// 页面结构诊断」，由应用写到本机独立目录。这里钉住：诊断确实随请求送出、且弹窗说清落点。
describe('缺用户提问时的诊断附带', () => {
  it('带 diag → 请求体里有诊断，消息里给出诊断文件落点', async () => {
    const posts: string[] = [];
    const { send, downloads } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload({ diag: { site: 'deepseek', counted: { user: 0, assistant: 2 } } }),
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async (_url, init) => {
        posts.push(String(init?.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            path: 'C:\\Users\\LHQ\\Downloads\\chat-exports\\deepseek\\a.md',
            diagPath: 'C:\\Data\\webchat-verify\\a.json',
          }),
        };
      },
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: true });

    expect(res.ok).toBe(true);
    expect(res.message).toContain('C:\\Data\\webchat-verify\\a.json');
    expect(res.message).toContain('没认出');
    expect(downloads).toHaveLength(0);
    const body = JSON.parse(posts[0]) as { diag?: { counted: { user: number } } };
    expect(body.diag?.counted.user).toBe(0);
  });

  it('有用户提问（不需要诊断）→ 请求体里不出现 diag 字段', async () => {
    const posts: string[] = [];
    const { send } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload(),
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async (_url, init) => {
        posts.push(String(init?.body));
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) };
      },
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: true });

    expect(res.ok).toBe(true);
    expect(res.message).not.toContain('没认出');
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(posts[0]), 'diag')).toBe(false);
  });
});

// ── 2026-11-17 用户三条实测反馈的回归（QQ 浏览器） ────────────────────────────
// ① 豆包导出 2 份重复下载 → 根因：0.3.0 指纹写在页面 localStorage（sig:v1），
//    0.4.0 改写扩展 storage（sig:v2）→ 升级后第一轮「旧账读不到」→ 老会话全当新增重导。
// ② 豆包历史会话一条没导 → 根因：findSupportedTab() 只取**第一个**匹配 tab，
//    DeepSeek 排在前面 → 豆包标签页从未被遍历。
// ③ DeepSeek 74 个会话只导 29 个 → 根因：listSidebarItems 默认 max=30，虚拟列表一屏就满。
describe('0.5.0 三处实测缺陷的回归', () => {
  const SIG_KEY = 'webchatExporter:sig:v2:deepseek:/a/chat/s/abc';
  const SIG = 'user:第一问\nassistant:第一答';

  it('① 旧账兜底：内容脚本带回 0.3.0 的旧指纹 → 判「无新增」跳过，不再重复导', async () => {
    const { send, store, downloads } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload({
        sig: SIG,
        sigKey: SIG_KEY,
        legacySig: SIG,
        legacySigKey: 'webchatExporter:sig:v1:deepseek:/a/chat/s/abc',
      }),
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: false });

    expect(res.unchanged).toBe(true);
    expect(downloads).toHaveLength(0);
    // 关键：旧账命中后要把账迁到新键，之后就彻底不再重导
    expect(store[SIG_KEY]).toBe(SIG);
  });

  it('① 旧指纹与当前内容不同 → 正常导出（别把「有旧账」误判成「无新增」）', async () => {
    const { send, downloads } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload({
        sig: SIG,
        sigKey: SIG_KEY,
        legacySig: 'user:完全不同的旧内容',
        legacySigKey: 'webchatExporter:sig:v1:deepseek:/a/chat/s/abc',
      }),
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    const res = await send({ type: 'EXPORT_CURRENT', force: false });

    expect(res.unchanged).not.toBe(true);
    expect(downloads).toHaveLength(0);
  });

  it('② 历史遍历跑**所有**受支持站点的标签页（不再只跑第一个 → 豆包被跳过）', async () => {
    const historyHosts: number[] = [];
    const { fireAlarm } = loadBackground({
      tabs: [
        { id: 1, url: 'https://chat.deepseek.com/a/chat/s/1' },
        { id: 2, url: 'https://www.doubao.com/chat/2' },
        { id: 3, url: 'https://chat.deepseek.com/a/chat/s/3' },
      ],
      sendMessage: async (id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_NOW') return payload({ unchanged: true });
        if (m.type === 'EXPORT_HISTORY') {
          historyHosts.push(id);
          return { ok: true, delivered: 1, viaHost: 1, viaDl: 0, skipped: [], siteLabel: 'x' };
        }
        if (m.type === 'EXPORT_HISTORY_ITEM') return { ok: true, via: 'host' };
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await fireAlarm('webchat-exporter-auto-v1');

    // 每个站点各遍历一次：DeepSeek 只取第一个 tab（同站点开两个 tab 点两遍侧栏没意义），
    // 豆包这个独立站点必须遍历到——旧实现只跑 tabs[0]，豆包永远是 0 份。
    expect(historyHosts.sort()).toEqual([1, 2]);
    expect(historyHosts).not.toContain(3);
  });

  it('② 只开了一个站点的标签页 → 只遍历那一个，不报错', async () => {
    const historyHosts: number[] = [];
    const { fireAlarm } = loadBackground({
      tabs: [{ id: 9, url: 'https://www.doubao.com/chat/9' }],
      sendMessage: async (id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_NOW') return payload({ unchanged: true });
        if (m.type === 'EXPORT_HISTORY') {
          historyHosts.push(id);
          return { ok: true, delivered: 1, viaHost: 1, viaDl: 0, skipped: [], siteLabel: '豆包' };
        }
        if (m.type === 'EXPORT_HISTORY_ITEM') return { ok: true, via: 'host' };
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await fireAlarm('webchat-exporter-auto-v1');

    expect(historyHosts).toEqual([9]);
  });

  it('③ 审计快照随导出一起送出（应用据此逐条比对导出文档 vs 原对话）', async () => {
    const posts: string[] = [];
    const { send } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload({
        auditSource: [
          { role: 'user', text: '支付接口为什么超时？' },
          { role: 'assistant', text: '连接池 pool_size 过小。' },
        ],
      }),
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async (_url, init) => {
        posts.push(String(init?.body));
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) };
      },
    });

    await send({ type: 'EXPORT_CURRENT', force: true });

    const body = JSON.parse(posts[0]) as { auditSource?: { role: string; text: string }[] };
    expect(Array.isArray(body.auditSource)).toBe(true);
    expect(body.auditSource).toHaveLength(2);
    expect(body.auditSource?.[0]).toEqual({ role: 'user', text: '支付接口为什么超时？' });
  });

  it('① 历史条目已见过（v2 账命中）→ 跳过不落盘，不再重复导出', async () => {
    const posts: string[] = [];
    const { send } = loadBackground({
      tabs: [TAB],
      store: { [SIG_KEY]: SIG },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async (_url, init) => {
        posts.push(String(init?.body));
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\h.md' }) };
      },
    });

    const res = await send({
      type: 'EXPORT_HISTORY_ITEM',
      payload: { site: 'deepseek', messages: [{ role: 'user', text: '第一问' }], sig: SIG, sigKey: SIG_KEY },
    });

    expect(res.ok).toBe(true);
    expect((res as { duplicate?: boolean }).duplicate).toBe(true);
    expect(posts).toHaveLength(0); // 关键：没有再推给本机（没有新文件落盘）
  });

  it('① 历史条目命中 0.3.0 旧账 → 跳过，且把旧账迁到 v2（下一轮连旧账都不用读）', async () => {
    const posts: string[] = [];
    const store: Record<string, unknown> = {};
    const { send } = loadBackground({
      tabs: [TAB],
      store,
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async (_url, init) => {
        posts.push(String(init?.body));
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\h.md' }) };
      },
    });

    const res = await send({
      type: 'EXPORT_HISTORY_ITEM',
      payload: {
        site: 'deepseek',
        messages: [{ role: 'user', text: '第一问' }],
        sig: SIG,
        sigKey: SIG_KEY,
        legacySig: SIG,
        legacySigKey: 'webchatExporter:sig:v1:deepseek:/a/chat/s/abc',
      },
    });

    expect(res.ok).toBe(true);
    expect((res as { duplicate?: boolean }).duplicate).toBe(true);
    expect(posts).toHaveLength(0);
    expect(store[SIG_KEY]).toBe(SIG);
  });

  it('① 历史条目没见过 → 正常交付并记账', async () => {
    const posts: string[] = [];
    const store: Record<string, unknown> = {};
    const { send } = loadBackground({
      tabs: [TAB],
      store,
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async (_url, init) => {
        posts.push(String(init?.body));
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\h.md' }) };
      },
    });

    const res = await send({
      type: 'EXPORT_HISTORY_ITEM',
      payload: { site: 'deepseek', messages: [{ role: 'user', text: '新内容' }], sig: SIG, sigKey: SIG_KEY },
    });

    expect(res.ok).toBe(true);
    expect(posts).toHaveLength(1);
    expect(store[SIG_KEY]).toBe(SIG);
  });
});

// ── 0.5.2（2026-11-17 实测：导出停不下来）────────────────────────────────
// 真根因不是「采集逻辑写错」，而是「单轮跑不完 + 断点不落 + 没有出口」三件套：
// 25 条 × 每条最多 15 秒 > MV3 Service Worker 5 分钟上限 → 每轮半路被杀 →
// 断点写不进去 → 下一轮从第 1 条重来 → 每 5 分钟再叠一轮，永远结束不了。
describe('0.5.2 停不下来的四道闸门', () => {
  it('每条交付成功 → 立即落断点（不等轮末，SW 半路被杀也不丢进度）', async () => {
    const { send, store } = loadBackground({
      tabs: [TAB],
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\h.md' }) }),
    });

    await send({
      type: 'EXPORT_HISTORY_ITEM',
      payload: {
        ...payload(),
        label: '会话甲',
        sig: 'sig_0502',
        sigKey: 'webchatExporter:sig:v2:deepseek:/a/chat/s/x',
      },
    });

    expect(
      (store['webchatExporter:historyProgress:v1:deepseek'] as { labels: string[] }).labels,
    ).toEqual(['会话甲']);
  });

  it('连续 3 轮「零新增」→ 熔断：记该站点已采完并停止续采，不再无限点侧栏', async () => {
    const { fireAlarm, store } = loadBackground({
      tabs: [TAB],
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_NOW') return payload({ unchanged: true });
        if (m.type === 'EXPORT_HISTORY') {
          return {
            ok: true, delivered: 0, viaHost: 0, viaDl: 0, skipped: [],
            processedLabels: ['会话A'], more: true, siteLabel: 'DeepSeek',
          };
        }
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
    });

    await fireAlarm('webchat-exporter-auto-v1');
    expect(store['webchatExporter:historyStreak:v1:deepseek']).toBe(1);

    await fireAlarm('webchat-exporter-history-continue');
    await fireAlarm('webchat-exporter-history-continue');

    // 熔断后：断点清空 + 记「已完成」→ 之后 runHistorySites 直接跳过这个站点
    expect(
      (store['webchatExporter:historyProgress:v1:deepseek'] as { labels: string[] }).labels,
    ).toEqual([]);
    expect(typeof store[`${DONE_KEY_PREFIX}v2:deepseek`]).toBe('number');
  });

  it('v1 完成标记被认账并迁移到 v2（升级后不整站重跑）', async () => {
    const hosts: number[] = [];
    const { fireAlarm, store } = loadBackground({
      tabs: [TAB],
      sendMessage: async (id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_NOW') return payload({ unchanged: true });
        if (m.type === 'EXPORT_HISTORY') {
          hosts.push(id);
          return { ok: true, delivered: 1, viaHost: 1, viaDl: 0, skipped: [], siteLabel: 'DeepSeek' };
        }
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
    });
    // 模拟 0.5.0 留下的旧账
    store['webchatExporter:historyDoneAt:deepseek'] = 1700000000000;

    await fireAlarm('webchat-exporter-auto-v1');

    expect(hosts).toEqual([]); // 认旧账 → 不再遍历
    expect(typeof store[`${DONE_KEY_PREFIX}v2:deepseek`]).toBe('number'); // 顺手迁到 v2
  });
});

// ── 0.5.3（2026-11-17 用户要求「重导前先清空旧导出」）──────────────────────
// 为什么必须成对做：抽取层补结构后同一段对话的文本变了 → 内容指纹（sig）也变了 →
// 去重账全部对不上 → 重导会在导出目录再落一份。只清文件不清账 = 重导不出来；
// 只清账不清文件 = 文件越堆越多。这里钉住「要么一起成功，要么一起不做」。
describe('0.5.3 清空旧导出并重新导出', () => {
  const CLEAR_URL_OK = async (url: string) => {
    if (String(url).includes('/clear')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, deleted: 12, deletedAudit: 12, sites: ['deepseek', 'doubao'] }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\h.md' }) };
  };

  it('应用不可用 → 不清任何账、不重导，并说明「已中止」（避免只清账不清文件）', async () => {
    const store: Record<string, unknown> = {};
    const asked: string[] = [];
    const { send } = loadBackground({
      tabs: [TAB],
      store,
      sendMessage: async (_id, msg) => {
        asked.push((msg as { type: string }).type);
        return payload({ unchanged: true });
      },
      runtime: null, // 应用没启动 / 没同步 runtime.json
    });
    store['webchatExporter:sig:v2:deepseek:/a/chat/s/abc'] = 'sig_old';

    const res = await send({ type: 'RESET_EXPORTS' });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('已中止');
    expect(store['webchatExporter:sig:v2:deepseek:/a/chat/s/abc']).toBe('sig_old'); // 账没被动
    expect(asked).toEqual([]); // 也没开始重导
  });

  it('应用可用 → 先删文件、再清去重账与历史进度、然后立刻重导', async () => {
    const store: Record<string, unknown> = {};
    const asked: string[] = [];
    const { send } = loadBackground({
      tabs: [TAB],
      store,
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string };
        asked.push(m.type);
        if (m.type === 'CLEAR_LEGACY_SIG') return { ok: true, cleared: 2 };
        if (m.type === 'EXPORT_HISTORY') {
          return {
            ok: true, delivered: 5, viaHost: 5, viaDl: 0, skipped: [],
            processedLabels: ['会话A'], more: false, siteLabel: 'DeepSeek',
          };
        }
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: CLEAR_URL_OK,
    });
    // 预置旧账：v2 指纹 / 历史已完成 / 续采断点 / 熔断计数 / 正在跑
    store['webchatExporter:sig:v2:deepseek:/a/chat/s/abc'] = 'sig_old';
    store[`${DONE_KEY_PREFIX}v2:deepseek`] = 1700000000000;
    store['webchatExporter:historyProgress:v1:deepseek'] = { labels: ['会话A'], at: 1 };
    store['webchatExporter:historyStreak:v1:deepseek'] = 2;
    store['webchatExporter:historyRunning:v1:deepseek'] = 1700000000000;

    const res = await send({ type: 'RESET_EXPORTS' });

    expect(res.ok).toBe(true);
    expect(res.message).toContain('已清空旧导出 12 份');
    expect(res.message).toContain('重置去重账 5 项');
    expect(res.message).toContain('已重新导出 5 份');
    // 五类账全部被重置（漏一类就会出现「清了文件但插件记得导过」）
    expect(store['webchatExporter:sig:v2:deepseek:/a/chat/s/abc']).toBe('');
    // 「已完成」标记会被重导那一轮重新写上（这正是要的效果：清完→重跑一遍→再记完成），
    // 所以判的是「不是原来那个时间戳」，而不是「空」
    expect(store[`${DONE_KEY_PREFIX}v2:deepseek`]).not.toBe(1700000000000);
    expect(typeof store[`${DONE_KEY_PREFIX}v2:deepseek`]).toBe('number');
    expect((store['webchatExporter:historyProgress:v1:deepseek'] as { labels: string[] }).labels).toEqual([]);
    expect(store['webchatExporter:historyStreak:v1:deepseek']).toBeFalsy();
    expect(store['webchatExporter:historyRunning:v1:deepseek']).toBeFalsy();
    // 顺序：先让页面清旧指纹，再遍历（旧指纹不清，重导会命中「无新增」直接跳过）
    expect(asked.indexOf('CLEAR_LEGACY_SIG')).toBeLessThan(asked.indexOf('EXPORT_HISTORY'));
    // 任务记录这类「不是导出账」的键不许被顺手清掉
    expect(Object.keys(store).some((k) => k.startsWith('webchatExporter:tasks:v1'))).toBe(true);
  });

  it('应用说「有文件没删掉」→ 报失败且不清账（不留「文件半删、账已清」的错位）', async () => {
    const store: Record<string, unknown> = { 'webchatExporter:sig:v2:deepseek:/a': 'sig_old' };
    const { send } = loadBackground({
      tabs: [TAB],
      store,
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async (url) => {
        if (String(url).includes('/clear')) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ ok: false, deleted: 3, deletedAudit: 0, sites: ['deepseek'], error: '有 1 项没删掉：deepseek/a.md：EBUSY' }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\h.md' }) };
      },
    });

    const res = await send({ type: 'RESET_EXPORTS' });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('EBUSY');
    expect(store['webchatExporter:sig:v2:deepseek:/a']).toBe('sig_old');
  });
});

// ── 0.5.5（2026-11-17 用户：「A B 全做，不过 B 要等用户无操作后执行」）─────────
// A：每轮巡检都留一条可见账——「插件没跑」和「跑了但没新增」必须能分开，
//    否则用户看到「最近一次导出 21:59」只能靠猜（当天就为此白排查了一轮）。
// B：历史会话不能只遍历一次就永久罢手（`historyDoneAt:v2` 一置上，用户不开的会话
//    永远导不到）。现在改成「用户空闲时按站点补跑」，且必须自带三道闸门：
//    只在 idle 跑 / 每站点 6 小时一次 / 读不到 idle 状态就一律不跑。
describe('0.5.5 A：每轮巡检留可见账', () => {
  it('全部「无新增」也写一条账（这是 A 的全部意义：没动作也要看得见）', async () => {
    const { fireAlarm, store } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload({ unchanged: true }),
    });

    await fireAlarm('webchat-exporter-auto-v1');

    const rec = store[LAST_AUTO_KEY] as LastAuto;
    expect(typeof rec.at).toBe('number');
    expect(rec.exported).toBe(0);
    expect(rec.idleRounds).toBe(1);
  });

  it('连续两轮无新增 → idleRounds 累加（界面才能说「已连续 N 轮无新增」）', async () => {
    const { fireAlarm, store } = loadBackground({
      tabs: [TAB],
      sendMessage: async (_id, msg) => ((msg as { type: string }).type === 'EXPORT_HISTORY'
        ? { ok: true, delivered: 0, viaHost: 0, viaDl: 0, skipped: [], siteLabel: 'DeepSeek' }
        : payload({ unchanged: true })),
    });

    await fireAlarm('webchat-exporter-auto-v1');
    // 清掉「已完成」标记，让第二轮也真正跑一遍（否则第二轮连遍历都不跑）
    delete store[`${DONE_KEY_PREFIX}v2:deepseek`];
    await fireAlarm('webchat-exporter-auto-v1');

    expect((store[LAST_AUTO_KEY] as LastAuto).idleRounds).toBe(2);
  });

  it('有导出 → 账里记份数且 idleRounds 归零（刚干过活不能算「连续空转」）', async () => {
    let round = 0;
    const { fireAlarm, store } = loadBackground({
      tabs: [TAB],
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_HISTORY') return { ok: true, delivered: 0, viaHost: 0, viaDl: 0, skipped: [], siteLabel: 'DeepSeek' };
        round += 1;
        return payload(round === 1 ? {} : { unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    });

    await fireAlarm('webchat-exporter-auto-v1'); // 第一轮：真导出一份
    const first = store[LAST_AUTO_KEY] as LastAuto;
    expect(first.exported).toBe(1);
    expect(first.idleRounds).toBe(0);

    delete store[`${DONE_KEY_PREFIX}v2:deepseek`];
    await fireAlarm('webchat-exporter-auto-v1'); // 第二轮：无新增
    expect((store[LAST_AUTO_KEY] as LastAuto).idleRounds).toBe(1);
  });

  it('GET_STATUS 把「最近检查」带回弹窗（没有账时返回 null，不冒充刚查过）', async () => {
    const empty = loadBackground({ tabs: [TAB] });
    const before = await empty.send({ type: 'GET_STATUS' });
    expect(before.lastAuto).toBeNull();

    const { fireAlarm, send } = loadBackground({
      tabs: [TAB],
      sendMessage: async () => payload({ unchanged: true }),
    });
    await fireAlarm('webchat-exporter-auto-v1');

    const after = await send({ type: 'GET_STATUS' });
    expect(typeof after.lastAuto?.at).toBe('number');
    expect(after.lastAuto?.exported).toBe(0);
  });
});

// 「导全了没有」的分母：只报「导出 N 份」永远答不了这个问题
//（2026-11-17 用户质疑「DeepSeek 历史会话没有全部导出」时，手上只有 200 这个数，
//  没有「侧栏一共有多少个会话」可比对）。
describe('0.5.5 C：历史导出报出对账分母', () => {
  it('内容脚本回执带 sidebarItems → 任务消息里出现「侧栏识别到 N 条会话」', async () => {
    const { send } = loadBackground({
      tabs: [TAB],
      sendMessage: async (_id, msg) => ((msg as { type: string }).type === 'EXPORT_HISTORY'
        ? {
          ok: true, delivered: 8, viaHost: 8, viaDl: 0, skipped: [],
          processedLabels: ['会话1', '会话2'], more: true, sidebarItems: 340, siteLabel: 'DeepSeek',
        }
        : payload({ unchanged: true })),
      runtime: { port: 8206, token: 'tok_1' },
    });

    const res = await send({ type: 'EXPORT_HISTORY' });

    expect(res.ok).toBe(true);
    expect(res.message).toContain('侧栏识别到 340 条会话');
    expect(res.message).toContain('已处理 2 条');
  });

  it('内容脚本没带这个数（旧版页面脚本）→ 消息里不出现半截话', async () => {
    const { send } = loadBackground({
      tabs: [TAB],
      sendMessage: async (_id, msg) => ((msg as { type: string }).type === 'EXPORT_HISTORY'
        ? { ok: true, delivered: 1, viaHost: 1, viaDl: 0, skipped: [], siteLabel: 'DeepSeek' }
        : payload({ unchanged: true })),
      runtime: { port: 8206, token: 'tok_1' },
    });

    const res = await send({ type: 'EXPORT_HISTORY' });

    expect(res.ok).toBe(true);
    expect(res.message).not.toContain('侧栏识别到');
  });
});

// 2026-11-17 豆包真事故：57 份导出里 42 份是同一个会话。
// 根因是「旧内容被记到新路径上」——路径键（sigKey 用 pathname）永远对不上，
// 所以必须再加一层与路径无关的「内容键」。
describe('0.5.5 D：内容级去重（同一段对话只落一份）', () => {
  const CONTENT_KEY = 'webchatExporter:contentKey:v1:doubao:abc12345def67890:120';

  it('同一段内容换个路径再来 → 跳过，不再落盘', async () => {
    const posts: string[] = [];
    const { send, store } = loadBackground({
      tabs: [{ id: 9, url: 'https://www.doubao.com/chat/9' }],
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async (_url, init) => {
        posts.push(String(init?.body));
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\d.md' }) };
      },
    });

    const first = await send({
      type: 'EXPORT_HISTORY_ITEM',
      payload: {
        site: 'doubao', messages: [{ role: 'user', text: '同一段内容' }],
        sig: 'sig_same', sigKey: 'webchatExporter:sig:v2:doubao:/chat/one',
        contentKey: CONTENT_KEY,
      },
    });
    expect(first.ok).toBe(true);
    expect(posts).toHaveLength(1);
    expect(store[CONTENT_KEY]).toBe('1');

    // 换成另一个路径（真机形态：URL 已经跳到下一条，内容还是上一条）
    const second = await send({
      type: 'EXPORT_HISTORY_ITEM',
      payload: {
        site: 'doubao', messages: [{ role: 'user', text: '同一段内容' }],
        sig: 'sig_same', sigKey: 'webchatExporter:sig:v2:doubao:/chat/two',
        contentKey: CONTENT_KEY,
      },
    });

    expect(second.ok).toBe(true);
    expect((second as { duplicate?: boolean }).duplicate).toBe(true);
    expect(posts).toHaveLength(1); // 关键：没有第二份文件
  });

  it('内容不同 → 照常交付（别把内容键做成「整站只导一份」）', async () => {
    const posts: string[] = [];
    const { send } = loadBackground({
      tabs: [{ id: 9, url: 'https://www.doubao.com/chat/9' }],
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async (_url, init) => {
        posts.push(String(init?.body));
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\d.md' }) };
      },
    });

    for (const [i, key] of ['k1', 'k2'].entries()) {
      await send({
        type: 'EXPORT_HISTORY_ITEM',
        payload: {
          site: 'doubao', messages: [{ role: 'user', text: `第 ${i} 段内容` }],
          sig: `sig_${i}`, sigKey: `webchatExporter:sig:v2:doubao:/chat/${i}`,
          contentKey: `${CONTENT_KEY}${key}`,
        },
      });
    }

    expect(posts).toHaveLength(2);
  });

  it('「清空并重新导出」必须把内容键一起清掉（否则整批被挡成跳过）', async () => {
    const store: Record<string, unknown> = { [CONTENT_KEY]: '1' };
    const { send } = loadBackground({
      tabs: [TAB],
      store,
      runtime: { port: 8206, token: 'tok_1' },
      sendMessage: async (_id, msg) => ((msg as { type: string }).type === 'EXPORT_HISTORY'
        ? { ok: true, delivered: 1, viaHost: 1, viaDl: 0, skipped: [], siteLabel: 'DeepSeek' }
        : payload({ unchanged: true })),
      fetch: async (url) => (String(url).includes('/clear')
        ? { ok: true, status: 200, json: async () => ({ ok: true, deleted: 1, deletedAudit: 0, sites: ['doubao'] }) }
        : { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\h.md' }) }),
    });

    await send({ type: 'RESET_EXPORTS' });

    expect(store[CONTENT_KEY]).toBe('');
  });

  /**
   * 断点必须是**多重集**：豆包 42 个会话标题完全一样，
   * 用集合存标题 → 同名会话被当成「已处理」永久跳过 → 历史导不全。
   */
  it('两个同名会话各交付一次 → 断点里出现两次同名', async () => {
    const { send, store } = loadBackground({
      tabs: [{ id: 9, url: 'https://www.doubao.com/chat/9' }],
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\d.md' }) }),
    });

    for (const i of [1, 2]) {
      await send({
        type: 'EXPORT_HISTORY_ITEM',
        payload: {
          site: 'doubao',
          label: '让agent优先读自建记忆库的方法 - 豆包',
          messages: [{ role: 'user', text: `第 ${i} 个会话` }],
          sig: `sig_multi_${i}`,
          sigKey: `webchatExporter:sig:v2:doubao:/chat/${i}`,
          contentKey: `${CONTENT_KEY}multi${i}`,
        },
      });
    }

    const labels = (store['webchatExporter:historyProgress:v1:doubao'] as { labels: string[] }).labels;
    expect(labels).toEqual([
      '让agent优先读自建记忆库的方法 - 豆包',
      '让agent优先读自建记忆库的方法 - 豆包',
    ]);
  });
});

describe('0.5.5 B：只在用户无操作时补跑历史', () => {
  const seen = () => {
    const calls: string[] = [];
    return {
      calls,
      sendMessage: async (_id: number, msg: unknown) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_HISTORY') {
          calls.push('history');
          return { ok: true, delivered: 1, viaHost: 1, viaDl: 0, skipped: [], siteLabel: 'DeepSeek', more: false };
        }
        if (m.type === 'EXPORT_HISTORY_ITEM') return { ok: true, via: 'host' };
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\exports\\a.md' }) }),
    };
  };

  it('空闲 + 该站点已「跑完」→ 仍然补跑一次（这就是「历史没全部导出」的解法）', async () => {
    const h = seen();
    const { fireAlarm, store } = loadBackground({ tabs: [TAB], idle: 'idle', ...h });
    // 模拟 0.5.4 留下的状态：首轮跑完，之后永不遍历
    store[`${DONE_KEY_PREFIX}v2:deepseek`] = 1700000000000;

    await fireAlarm(REFRESH_ALARM);

    expect(h.calls).toEqual(['history']); // 绕过了「已完成」
    expect(typeof store['webchatExporter:historyRefreshAt:v1:deepseek']).toBe('number');
  });

  it('用户正在操作（active）→ 一下都不点页面', async () => {
    const h = seen();
    const { fireAlarm, store } = loadBackground({ tabs: [TAB], idle: 'active', ...h });

    await fireAlarm(REFRESH_ALARM);

    expect(h.calls).toEqual([]);
    expect(store[`${DONE_KEY_PREFIX}v2:deepseek`]).toBeUndefined();
  });

  it('读不到空闲状态（老内核 / 没授 idle 权限）→ 一律不补跑，宁可不跑', async () => {
    const h = seen();
    const { fireAlarm, send } = loadBackground({ tabs: [TAB], ...h }); // 不传 idle = 沙箱里没有 chrome.idle

    await fireAlarm(REFRESH_ALARM);
    expect(h.calls).toEqual([]);

    const status = await send({ type: 'GET_STATUS' });
    expect(status.idle).toBeNull(); // 界面上要说清「不支持空闲检测」
  });

  it('空闲但 6 小时内已补跑过 → 不重复点侧栏', async () => {
    const h = seen();
    const { fireAlarm, store } = loadBackground({ tabs: [TAB], idle: 'idle', ...h });
    store['webchatExporter:historyRefreshAt:v1:deepseek'] = Date.now() - 60 * 60 * 1000; // 1 小时前

    await fireAlarm(REFRESH_ALARM);

    expect(h.calls).toEqual([]);
    // 也不能把时间戳刷新成「刚刚」——否则每 6 小时才轮到一次会变成永远轮不到
    expect(Date.now() - (store['webchatExporter:historyRefreshAt:v1:deepseek'] as number))
      .toBeGreaterThan(60 * 60 * 1000 - 5000);
  });

  it('补跑失败不 6 小时死等：时间戳是「开始补跑」时写的，失败后下一小时还会再试', async () => {
    const calls: string[] = [];
    const { fireAlarm, store } = loadBackground({
      tabs: [TAB],
      idle: 'idle',
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_HISTORY') {
          calls.push('history');
          return { ok: false, reason: '没在侧栏找到历史会话列表' };
        }
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
    });

    await fireAlarm(REFRESH_ALARM);
    expect(calls).toHaveLength(1);
    // 节流是「6 小时内最多一次」，失败也记账（否则失败会变成每小时猛点）；
    // 但也不能把站点标成「已完成」——否则这次失败会永久封死该站点
    expect(store[`${DONE_KEY_PREFIX}v2:deepseek`]).toBeUndefined();

    // 6 小时后再来一次：还会试
    store['webchatExporter:historyRefreshAt:v1:deepseek'] = Date.now() - 7 * 60 * 60 * 1000;
    await fireAlarm(REFRESH_ALARM);
    expect(calls).toHaveLength(2);
  });

  it('补跑也写「最近检查」账，并标明这一轮是空闲补跑', async () => {
    const h = seen();
    const { fireAlarm, store } = loadBackground({ tabs: [TAB], idle: 'idle', ...h });

    await fireAlarm(REFRESH_ALARM);

    const rec = store[LAST_AUTO_KEY] as LastAuto;
    expect(rec.source).toBe('idle');
    expect(rec.historyExported).toBe(1);
  });

  it('补跑没采完 → 排续采（浏览器空闲时也该把整站采完，而不是每 6 小时只采一批）', async () => {
    const { fireAlarm, createdAlarms } = loadBackground({
      tabs: [TAB],
      idle: 'idle',
      sendMessage: async (_id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'EXPORT_HISTORY') {
          return {
            ok: true, delivered: 1, viaHost: 1, viaDl: 0, skipped: [],
            processedLabels: ['会话A'], more: true, siteLabel: 'DeepSeek',
          };
        }
        if (m.type === 'EXPORT_HISTORY_ITEM') return { ok: true, via: 'host' };
        return payload({ unchanged: true });
      },
      runtime: { port: 8206, token: 'tok_1' },
    });

    await fireAlarm(REFRESH_ALARM);

    expect(createdAlarms.some((a) => a.name === 'webchat-exporter-history-continue')).toBe(true);
  });
});