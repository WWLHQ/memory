// 阶段 B（无头自动采集）纯逻辑层单测。
//
// 只测判据，不碰 Electron、不连站点：真正的风险不在「能不能起窗口」，
// 而在「这一轮到底该采哪几条 / 什么样算采过 / 登录失效怎么判 / 空正文会不会进库」。
// 这些判据一旦判错，失败方式是静默的（库里悄悄多出空记忆、或永远不再采），所以必须有测试钉住。
import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AUTO_DEFAULT_INTERVAL, AUTO_DIR_NAME, AUTO_MAX_INTERVAL, AUTO_MIN_INTERVAL, DEFAULT_AUTO_CONFIG,
  SITE_ENTRY_URL, appendLedger, autoConfigPath, autoLedgerPath, buildDriverScript, judgeSite,
  normalizeAutoConfig, normalizeAutoState, parseAutoPatch, parseDriverResult, pickNewChats,
  readAutoConfig, readAutoState, writeAutoConfig, writeAutoState,
  type DriverChat,
} from '../webchatAutoConfig.ts';
import { WEBCHAT_SITES } from '../../shared/webchatSites.ts';

const temps: string[] = [];
function tempDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `mam-auto-${tag}-`));
  temps.push(d);
  return d;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

// ── 配置 ────────────────────────────────────────────────────────────────────

describe('默认配置', () => {
  test('默认关闭 + 60 分钟 + 只选 deepseek（单站实测过才敢默认开）', () => {
    expect(DEFAULT_AUTO_CONFIG).toEqual({ enabled: false, intervalMinutes: 60, perRound: 3, sites: ['deepseek'] });
    expect(AUTO_DEFAULT_INTERVAL).toBe(60);
  });

  test('上下限是 15–1440 分钟（不是随便取的：低于 15 分钟等于自找风控）', () => {
    expect(AUTO_MIN_INTERVAL).toBe(15);
    expect(AUTO_MAX_INTERVAL).toBe(1440);
  });
});

describe('配置容错', () => {
  test('非对象输入 → 全默认', () => {
    for (const raw of [null, undefined, 0, 'x', [], true]) {
      expect(normalizeAutoConfig(raw)).toEqual(DEFAULT_AUTO_CONFIG);
    }
  });

  test('周期夹取到区间内，不做整体丢弃', () => {
    expect(normalizeAutoConfig({ intervalMinutes: 1 }).intervalMinutes).toBe(AUTO_MIN_INTERVAL);
    expect(normalizeAutoConfig({ intervalMinutes: 99999 }).intervalMinutes).toBe(AUTO_MAX_INTERVAL);
    expect(normalizeAutoConfig({ intervalMinutes: 30 }).intervalMinutes).toBe(30);
  });

  test('周期取整 + 非有限数回落默认', () => {
    expect(normalizeAutoConfig({ intervalMinutes: 29.6 }).intervalMinutes).toBe(30);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '30', null]) {
      expect(normalizeAutoConfig({ intervalMinutes: bad }).intervalMinutes).toBe(AUTO_DEFAULT_INTERVAL);
    }
  });

  test('enabled 必须是真布尔：字符串 "true" 不当 true（否则配置文件手改成 "false" 会变成已启用）', () => {
    expect(normalizeAutoConfig({ enabled: 'false' }).enabled).toBe(false);
    expect(normalizeAutoConfig({ enabled: 'true' }).enabled).toBe(false);
    expect(normalizeAutoConfig({ enabled: true }).enabled).toBe(true);
  });

  test('站点白名单过滤 + 去重；全非法时给空数组而不是回默认（用户明确不要任何站点要尊重）', () => {
    expect(normalizeAutoConfig({ sites: ['deepseek', 'nope', 'deepseek', 42] }).sites).toEqual(['deepseek']);
    expect(normalizeAutoConfig({ sites: ['nope'] }).sites).toEqual([]);
    expect(normalizeAutoConfig({ sites: 'deepseek' }).sites).toEqual(['deepseek']);
  });
});

describe('配置落盘', () => {
  test('没有文件 → 默认；写了再读得到同一份', () => {
    const d = tempDir('cfg');
    expect(readAutoConfig(d)).toEqual(DEFAULT_AUTO_CONFIG);
    const next = writeAutoConfig(d, { enabled: true, intervalMinutes: 30, perRound: 3, sites: ['deepseek', 'kimi'] });
    expect(next).toEqual({ enabled: true, intervalMinutes: 30, perRound: 3, sites: ['deepseek', 'kimi'] });
    expect(readAutoConfig(d)).toEqual(next);
    expect(autoConfigPath(d)).toContain(AUTO_DIR_NAME);
  });

  test('落盘时也会夹取（写入口是最后一道闸门，不能指望调用方先校验）', () => {
    const d = tempDir('clamp');
    expect(writeAutoConfig(d, { enabled: true, intervalMinutes: 3, perRound: 3, sites: ['deepseek'] }).intervalMinutes).toBe(AUTO_MIN_INTERVAL);
  });

  test('坏 JSON → 回落默认，绝不抛（启动主路径要用）', () => {
    const d = tempDir('broken');
    writeAutoConfig(d, DEFAULT_AUTO_CONFIG);
    writeFileSync(autoConfigPath(d), '{ this is not json', 'utf8');
    expect(readAutoConfig(d)).toEqual(DEFAULT_AUTO_CONFIG);
  });
});

describe('配置补丁校验', () => {
  test('非对象 / 空对象一律拒绝（空补丁要报错，不能静默成功）', () => {
    for (const raw of [null, 'x', 0, [], {}]) {
      expect(parseAutoPatch(raw).ok).toBe(false);
    }
  });

  test('类型不对要给出可读原因，不静默忽略', () => {
    const r1 = parseAutoPatch({ enabled: 'yes' });
    expect(r1.ok).toBe(false);
    const r2 = parseAutoPatch({ intervalMinutes: '30' });
    expect(r2.ok).toBe(false);
    const r3 = parseAutoPatch({ sites: 'deepseek' });
    expect(r3.ok).toBe(false);
  });

  test('周期越界 → 报错而不是夹取（用户手填的值不能悄悄变形）', () => {
    expect(parseAutoPatch({ intervalMinutes: 5 }).ok).toBe(false);
    expect(parseAutoPatch({ intervalMinutes: 5000 }).ok).toBe(false);
    expect(parseAutoPatch({ intervalMinutes: 45 }).ok).toBe(true);
  });

  test('未收录站点 → 整个补丁拒绝并点名是哪个', () => {
    const r = parseAutoPatch({ sites: ['deepseek', 'nope'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('nope');
  });

  test('合法补丁只带传进来的字段（不把整份配置回写，避免并发覆盖）', () => {
    const r = parseAutoPatch({ enabled: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch).toEqual({ enabled: true });
  });

  test('站点去重', () => {
    const r = parseAutoPatch({ sites: ['kimi', 'kimi', 'deepseek'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.sites).toEqual(['kimi', 'deepseek']);
  });
});

// ── 站点入口页与插件真源一致性 ──────────────────────────────────────────────

describe('站点入口页', () => {
  /** 从插件 core.js 里抠 key → hosts[0]：插件是站点知识的真源，主进程这份只能跟它对齐 */
  function coreSites(): Map<string, string> {
    const text = readFileSync(
      join(process.cwd(), 'browser-extension', 'webchat-exporter', 'shared', 'core.js'), 'utf8',
    );
    const out = new Map<string, string>();
    const re = /key:\s*'([a-z0-9_-]+)',\s*label:\s*'[^']*',\s*hosts:\s*\[\s*'([^']+)'/g;
    for (const m of text.matchAll(re)) out.set(m[1], m[2]);
    // 抠不到就等于测试自己失效：宁可红，也不要「零条断言全绿」
    expect(out.size).toBeGreaterThanOrEqual(WEBCHAT_SITES.length);
    return out;
  }

  test('每个站点都有入口页（漏填就是「选中了却打不开」，必须红）', () => {
    for (const s of WEBCHAT_SITES) {
      expect(SITE_ENTRY_URL[s.key], `站点 ${s.key} 缺入口页`).toBeTruthy();
    }
  });

  test('入口页域名与插件 core.js 的 hosts[0] 一致（两边漂了立刻红）', () => {
    for (const [key, host] of coreSites()) {
      const url = SITE_ENTRY_URL[key];
      expect(url, `站点 ${key} 缺入口页`).toBeTruthy();
      expect(new URL(url).host, `站点 ${key} 的入口页域名与插件不一致`).toBe(host);
      expect(new URL(url).protocol).toBe('https:');
    }
  });

  test('入口页不带路径与查询串（第一站就是站点首页，深链交给站点自己跳）', () => {
    for (const [key, url] of Object.entries(SITE_ENTRY_URL)) {
      const u = new URL(url);
      expect(u.pathname, `${key} 入口页不该带路径`).toBe('/');
      expect(u.search, `${key} 入口页不该带查询串`).toBe('');
    }
  });

  test('没有多余站点（入口页表里不该出现词表外的 key）', () => {
    const known = new Set(WEBCHAT_SITES.map((s) => s.key));
    for (const key of Object.keys(SITE_ENTRY_URL)) expect(known.has(key)).toBe(true);
  });
});

// ── 采集账状态 ──────────────────────────────────────────────────────────────

describe('采集账状态', () => {
  test('非对象输入 → 空账', () => {
    for (const raw of [null, undefined, 0, 'x', []]) {
      expect(normalizeAutoState(raw)).toEqual({ doneKeys: {}, cursors: {}, lastRound: null });
    }
  });

  test('doneKeys 只收「字符串键 → 有限数字值」，脏数据整条丢弃', () => {
    const s = normalizeAutoState({
      doneKeys: { 'deepseek:abc': 1, bad: 'yesterday', '': 3, nan: Number.NaN },
    });
    expect(s.doneKeys).toEqual({ 'deepseek:abc': 1 });
  });

  test('lastRound 缺 results / 缺 at 就当没有（UI 靠它显示「上次」，结构不对会渲染崩）', () => {
    expect(normalizeAutoState({ lastRound: { at: 1 } }).lastRound).toBeNull();
    expect(normalizeAutoState({ lastRound: { results: [] } }).lastRound).toBeNull();
    const ok = normalizeAutoState({ lastRound: { at: 5, trigger: 'manual', results: [] } });
    expect(ok.lastRound).toEqual({ at: 5, trigger: 'manual', results: [] });
  });

  test('落盘往返；坏 JSON → 空账不抛', () => {
    const d = tempDir('st');
    expect(readAutoState(d)).toEqual({ doneKeys: {}, cursors: {}, lastRound: null });
    const next = writeAutoState(d, { doneKeys: { 'deepseek:k1': 111 }, cursors: {}, lastRound: null });
    expect(readAutoState(d)).toEqual(next);
    writeFileSync(join(d, AUTO_DIR_NAME, 'state.json'), 'nope', 'utf8');
    expect(readAutoState(d)).toEqual({ doneKeys: {}, cursors: {}, lastRound: null });
  });

  test('账本是追加，不是覆盖（要能回看一轮轮的结果）', () => {
    const d = tempDir('ledger');
    appendLedger(d, { at: 1, trigger: 'startup', results: [] });
    appendLedger(d, { at: 2, trigger: 'timer', results: [] });
    const lines = readFileSync(autoLedgerPath(d), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).at).toBe(2);
  });
});

// ── 页内驱动脚本 ────────────────────────────────────────────────────────────

describe('页内驱动脚本 · 结构', () => {
  test('站点名与上限被真实写进脚本（不是模板里的占位没替换）', () => {
    const src = buildDriverScript({ siteKey: 'deepseek', maxChats: 2 });
    expect(src).toContain('"deepseek"');
    // 上限不再是「只点前 N 条」，而是「最多收 N 条新的 + 最多走几步」
    expect(src).toContain('const maxNew = 2;');
    expect(src).toContain('const maxAttempts = 2;');
    // 注入回退：core.js 没注入必须显式返回原因，而不是静默空结果
    expect(src).toContain('WebchatExporterCore');
    expect(src).toContain('core.js 未注入');
  });

  test('站点名走 JSON.stringify 注入：带引号也逃不出字符串（不拼裸字符串）', () => {
    const evil = "x'); process.exit(1); ('";
    const src = buildDriverScript({ siteKey: evil, maxChats: 1 });
    expect(src).toContain(`"x'); process.exit(1); ('"`);
    // 整段仍是「先 const siteKey = ..., 再跑逻辑」的结构，没有被提前闭合
    expect(src).toContain('const siteKey = "x\'); process.exit(1); (\'";');
  });

  test('等待预算可注入且被夹到最小 300ms', () => {
    expect(buildDriverScript({ siteKey: 'deepseek', maxChats: 1, chatWaitMs: 800 })).toContain('Date.now() + 800');
    expect(buildDriverScript({ siteKey: 'deepseek', maxChats: 1, chatWaitMs: 1 })).toContain('Date.now() + 300');
  });
});

// ── 驱动脚本真跑（假 DOM + 假 core.js） ─────────────────────────────────────
//
// 为什么必须真跑：这段脚本是字符串，TypeScript 一眼都看不到它。
// 只做 `toContain` 断言等于没测——上一轮真正的问题（把「跳了但没正文」误判成「没跳转」）
// 恰恰在逻辑里，不在文案里。所以这里用假 document / 假 core 把三种切换结果各跑一遍。
describe('页内驱动脚本 · 三态真跑', () => {
  /** 造一个最小页面：listSidebarItems 给出 n 条、click 按场景改状态 */
  function makePage(
    scenario: 'content' | 'no-nav' | 'nav-no-content' | 'headless' | 'headless-late' | 'missing-user' = 'content',
    n = 3,
  ): {
    doc: unknown; loc: { href: string; pathname: string }; msgs: () => number; clicks: () => number;
    topReached: () => boolean; topHits: () => number;
  } {
    const state = {
      msgs: [] as Array<{ role: string; text: string }>,
      href: 'https://chat.deepseek.com/',
      clicks: 0,
      topReached: false,
      topHits: 0,
    };
    const loc = { get href(): string { return state.href; }, get pathname(): string { return new URL(state.href).pathname; } };
    // 场景 headless：点击后首条是助手（模拟虚拟列表停在底部、第一条用户没渲染）；滚到顶后补出用户首条
    // querySelector 必须按选择器匹配语义返回：只有消息类选择器命中滚动锚点，
    // 其余（如登录页探测的 input[type="password"]）返回 null——无差别返回真值会把登录页探测误判成命中。
    const scrollEl = {
      scrollHeight: 1000,
      clientHeight: 300,
      set scrollTop(v: number) { if (v === 0) { state.topReached = true; state.topHits += 1; } },
      get scrollTop(): number { return state.topReached ? 0 : 100; },
    };
    const doc = {
      querySelector: (sel: string) => (String(sel).includes('message') ? scrollEl : null),
      querySelectorAll: (): unknown[] => [scrollEl],
    };
    const core = {
      listSidebarItems: () => Array.from({ length: n }, (_v, i) => ({
        label: `会话${i + 1}`,
        el: {
          click(): void {
            state.clicks += 1;
            if (scenario === 'content') {
              state.href = `https://chat.deepseek.com/a/chat/s/0000000${state.clicks}`;
              state.msgs = [{ role: 'user', text: `第${state.clicks}条` }, { role: 'assistant', text: '答' }];
            } else if (scenario === 'headless') {
              state.href = `https://chat.deepseek.com/a/chat/s/0000000${state.clicks}`;
              // 底部视角：虚拟列表只渲染后半段，首条是助手（顶上的用户提问还没进来）
              state.msgs = [{ role: 'assistant', text: '答' }, { role: 'user', text: `第${state.clicks}条第2问` }];
            } else if (scenario === 'headless-late' || scenario === 'missing-user') {
              state.href = `https://chat.deepseek.com/a/chat/s/0000000${state.clicks}`;
              // 更坏的底部视角：当前只挂着助手，用户提问一条都没渲染
              state.msgs = [{ role: 'assistant', text: '答' }];
            } else if (scenario === 'nav-no-content') {
              state.href = `https://chat.deepseek.com/a/chat/s/0000000${state.clicks}`;
            }
          },
        },
      })),
      describeSidebar: () => ({ semantic: 11, groupRows: 11, groups: [], anchors: [{ href: '/a/chat/s/1', text: '会话1' }], messageAreaRows: 0 }),
      // headless：滚到顶后把首条用户补回来；headless-late：第一次滚顶还没挂上，轮询第二次才补出
      extractMessages: () => {
        const withHead = [{ role: 'user', text: `第${state.clicks}条第1问` }, { role: 'user', text: `第${state.clicks}条第2问` }, { role: 'assistant', text: '答' }];
        if (scenario === 'missing-user') return [{ role: 'assistant', text: '答' }];
        if (scenario === 'headless' && state.topReached && state.clicks > 0) return withHead;
        if (scenario === 'headless-late' && state.topHits >= 2 && state.clicks > 0) return withHead;
        return state.msgs;
      },
      signature: (ms: Array<{ role: string; text: string }>) => ms.map((m) => `${m.role}:${m.text}`).join('\n'),
      contentKey: (site: string, sig: string) => `key:${site}:${sig}`,
      formatMarkdown: () => '## 用户\n第1条',
      findScrollAncestor: () => doc.querySelectorAll()[0],
      SITES: [{ key: 'deepseek', label: 'DeepSeek' }],
    };
    // core.js 只经由 globalThis 取（脚本里就是 globalThis.WebchatExporterCore）；
    // document / location 在 jsdom 里是只读 getter，不能覆盖，所以走参数注入（参数会遮蔽同名全局）
    (globalThis as unknown as { WebchatExporterCore: unknown }).WebchatExporterCore = core;
    return {
      doc, loc, msgs: () => state.msgs.length, clicks: () => state.clicks,
      topReached: () => state.topReached, topHits: () => state.topHits,
    };
  }

  /** 真跑脚本：document / location 作为形参注入，脚本内部同名引用被遮蔽 */
  function runner(page: { doc: unknown; loc: unknown }) {
    return async (src: string): Promise<Record<string, unknown>> => {
      // eslint-disable-next-line no-new-func
      const fn = new Function('document', 'location', `return ${src}`) as (
        d: unknown, l: unknown,
      ) => Promise<Record<string, unknown>>;
      return await fn(page.doc, page.loc);
    };
  }

  afterEach(() => {
    delete (globalThis as unknown as { WebchatExporterCore?: unknown }).WebchatExporterCore;
  });

  test('点开后内容真的变了 → 拿到会话，why 为空，key/正文都在', async () => {
    const page = makePage('content');
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 2, chatWaitMs: 1200 }));
    const chats = r.chats as Array<{ title: string; markdown: string; key: string }>;
    const steps = r.steps as Array<{ why: string; msgs: number }>;
    expect(chats).toHaveLength(2);
    expect(chats[0].title).toBe('会话1');
    expect(chats[0].markdown).toContain('## 用户');
    expect(chats[0].key).toContain('key:deepseek:');
    expect(steps.every((s) => s.why === '')).toBe(true);
  });

  test('点了但页面没切换 → why=click-no-nav（不是「没抽到」这种糊成一片的话）', async () => {
    const page = makePage('no-nav');
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 2, chatWaitMs: 600 }));
    expect((r.chats as unknown[]).length).toBe(0);
    const steps = r.steps as Array<{ why: string; urlBefore: string; urlAfter: string }>;
    expect(steps).toHaveLength(2);
    expect(steps[0].why).toBe('click-no-nav');
    expect(steps[0].urlAfter).toBe(steps[0].urlBefore);
  });

  test('地址跳了但正文读不到 → why=nav-no-content（与 click-no-nav 必须区分开）', async () => {
    const page = makePage('nav-no-content');
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 1, chatWaitMs: 600 }));
    expect((r.chats as unknown[]).length).toBe(0);
    const steps = r.steps as Array<{ why: string; urlBefore: string; urlAfter: string }>;
    expect(steps[0].why).toBe('nav-no-content');
    expect(steps[0].urlAfter).not.toBe(steps[0].urlBefore);
  });

  test('侧栏体检按对象回传（这一段曾经被当成字符串，导致 UI 永远显示「诊断：(空)」）', async () => {
    const page = makePage('no-nav');
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 1, chatWaitMs: 300 }));
    const diag = r.diag as { semantic: number; groupRows: number };
    expect(diag.semantic).toBe(11);
    expect(diag.groupRows).toBe(11);
  });

  test('一条都没抽到 → 带页面快照（url/title/visibility/HTML），供离线下查结构', async () => {
    const page = makePage('nav-no-content');
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 1, chatWaitMs: 300 }));
    const dbg = r.debug as { url: string; title: string; visibility: string; html: string } | null;
    expect(dbg).toBeTruthy();
    expect(dbg?.url).toContain('chat.deepseek.com');
    expect(typeof dbg?.visibility).toBe('string');
    expect(typeof dbg?.html).toBe('string');
  });

  test('正常抽到内容时不留快照（不能每轮往盘上写几百 KB）', async () => {
    const page = makePage('content');
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 1, chatWaitMs: 800 }));
    expect(r.debug).toBeNull();
  });

  test('登录页：一条都不点，needRelogin=true（2026-11-19 弹 5 个外链窗口的真因）', async () => {
    let clicks = 0;
    const loc = { href: 'https://chat.deepseek.com/', pathname: '/' };
    const doc = {
      querySelector: (): null => null,
      querySelectorAll: (): unknown[] => [],
      body: { innerText: '忘记密码 立即注册 验证码登录 用户协议 隐私政策' },
    };
    (globalThis as unknown as { WebchatExporterCore: unknown }).WebchatExporterCore = {
      listSidebarItems: () => ['忘记密码', '立即注册', '用户协议', '浙ICP备2023025'].map((label) => ({
        label, el: { click(): void { clicks += 1; } },
      })),
      describeSidebar: () => ({ semantic: 0, groupRows: 18, groups: [], anchors: [], messageAreaRows: 0 }),
      extractMessages: () => [],
      signature: () => '',
      formatMarkdown: () => '', contentKey: () => '', SITES: [],
    };
    const r = await runner({ doc, loc })(buildDriverScript({ siteKey: 'deepseek', maxChats: 10, chatWaitMs: 300 }));
    expect(r.needRelogin).toBe(true);
    expect((r.steps as unknown[]).length).toBe(0);
    expect((r.chats as unknown[]).length).toBe(0);
    expect(clicks).toBe(0);
  });

  test('登录页 URL（forgot_password）也算：即使文案没命中也不点', async () => {
    let clicks = 0;
    const loc = { href: 'https://chat.deepseek.com/forgot_password', pathname: '/forgot_password' };
    const doc = { querySelector: (): null => null, querySelectorAll: (): unknown[] => [], body: { innerText: '' } };
    (globalThis as unknown as { WebchatExporterCore: unknown }).WebchatExporterCore = {
      listSidebarItems: () => [{ label: '返回登录', el: { click(): void { clicks += 1; } } }],
      describeSidebar: () => ({ semantic: 0, groupRows: 2, groups: [], anchors: [], messageAreaRows: 0 }),
      extractMessages: () => [], signature: () => '', formatMarkdown: () => '', contentKey: () => '', SITES: [],
    };
    const r = await runner({ doc, loc })(buildDriverScript({ siteKey: 'deepseek', maxChats: 10, chatWaitMs: 300 }));
    expect(r.needRelogin).toBe(true);
    expect(clicks).toBe(0);
  });

  test('非登录页也过滤外链/页脚条目：只留真正的会话条目', async () => {
    const clicked: string[] = [];
    const loc = { href: 'https://chat.deepseek.com/', pathname: '/', host: 'chat.deepseek.com' };
    const doc = { querySelector: (): null => null, querySelectorAll: (): unknown[] => [], body: { innerText: '' } };
    const mk = (label: string, href: string, target = ''): Record<string, unknown> => ({
      label,
      el: {
        click(): void { clicked.push(label); },
        closest: () => ({ getAttribute: () => target, href }),
      },
    });
    (globalThis as unknown as { WebchatExporterCore: unknown }).WebchatExporterCore = {
      listSidebarItems: () => [
        mk('真实会话', 'https://chat.deepseek.com/a/chat/s/1'),
        mk('用户协议', 'https://cdn.deepseek.com/policies/zh-CN/deepseek-terms-of-use.html'),
        mk('浙ICP备2023025', 'https://beian.miit.gov.cn/'),
        mk('反馈表', 'https://xxx.feishu.cn/share/base/form/x', '_blank'),
      ],
      describeSidebar: () => ({ semantic: 4, groupRows: 4, groups: [], anchors: [], messageAreaRows: 0 }),
      extractMessages: () => [], signature: () => '', formatMarkdown: () => '', contentKey: () => '', SITES: [],
    };
    const r = await runner({ doc, loc })(buildDriverScript({ siteKey: 'deepseek', maxChats: 10, chatWaitMs: 300 }));
    expect(r.needRelogin).toBe(false);
    expect(r.items).toEqual(['真实会话']);
    expect(clicked).toEqual(['真实会话']);
  });

  test('core.js 没注入 → 明确报原因，不返回空结果装正常', async () => {
    const page = { doc: {}, loc: {} };
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 1 }));
    expect(r.diagText).toContain('core.js 未注入');
    expect((r.items as unknown[]).length).toBe(0);
  });

  // ── 2026-11-19 采集停滞事故的回归锁 ──────────────────────────────────────
  // 事故：每轮固定从侧栏第 1 条点满 N 条，最新几条采过之后永远 no_new，其余 190+ 条从未被点。
  // 修法：页面内拿 skipKeys 判「已采」，命中就往下继续找，直到收满 maxChats 条新的或用完 maxAttempts。

  /** 侧栏 4 条里前 2 条已采过：key 由 contentKey(sig) 决定，这里按同一算法反推出来 */
  const keyOf = (n: number) => `key:deepseek:user:第${n}条\nassistant:答`;

  test('顶部 2 条已采过 → 跳过它们往下采到第 3、4 条（不再卡死在前 N 条）', async () => {
    const page = makePage('content', 4);
    const r = await runner(page)(buildDriverScript({
      // maxAttempts 必须大于 maxChats：否则点满 2 次（都在账里）就停，等于旧的停死行为
      siteKey: 'deepseek', maxChats: 2, maxAttempts: 4, chatWaitMs: 600, skipKeys: [keyOf(1), keyOf(2)],
    }));
    const chats = r.chats as Array<{ title: string; key: string }>;
    expect(chats.map((c) => c.title)).toEqual(['会话3', '会话4']);
    expect(chats.map((c) => c.key)).toEqual([keyOf(3), keyOf(4)]);
    expect(r.skipped).toBe(2);
    expect(r.attempts).toBe(4);
  });

  test('走完侧栏 → reachedEnd=true，nextStart=条目总数（补齐历史据此收尾）', async () => {
    const page = makePage('content', 4);
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 10, maxAttempts: 10, chatWaitMs: 600 }));
    expect((r.chats as unknown[]).length).toBe(4);
    expect(r.reachedEnd).toBe(true);
    expect(r.nextStart).toBe(4);
  });

  test('步数用完就停，并回报 nextStart（下批从这条接着走，不从头重扫）', async () => {
    const page = makePage('content', 6);
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 10, maxAttempts: 2, chatWaitMs: 600 }));
    expect((r.chats as unknown[]).length).toBe(2);
    expect(r.reachedEnd).toBe(false);
    expect(r.nextStart).toBe(2);
  });

  test('startAt 已失效（无游标对账）：即使传 4 也从侧栏顶部扫，不再有位置状态', async () => {
    const page = makePage('content', 6);
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 2, maxAttempts: 10, startAt: 4, chatWaitMs: 600 }));
    expect((r.chats as Array<{ title: string }>).map((c) => c.title)).toEqual(['会话1', '会话2']);
    expect(r.attempts).toBe(2);
  });

  test('驱动产出的每条会话都带稳定 ID，且按 <ID>.md 跳过键去重', async () => {
    const page = makePage('content', 3);
    const r = await runner(page)(buildDriverScript({
      siteKey: 'deepseek', maxChats: 5, maxAttempts: 5, chatWaitMs: 600, skipKeys: ['00000002.md'],
    }));
    const chats = r.chats as Array<{ id: string; title: string }>;
    expect(chats.map((c) => c.id)).toEqual(['00000001', '00000003']);
    expect(chats.map((c) => c.title)).toEqual(['会话1', '会话3']);
    expect(r.skipped).toBe(1);
  });

  test('首条不是用户（虚拟列表停在底部）→ 滚到顶补抽，首条用户找回来', async () => {
    const page = makePage('headless', 1);
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 1, chatWaitMs: 600 }));
    const chats = r.chats as Array<{ messages: Array<{ role: string; text: string }> }>;
    // 滚到顶后首条是用户，且补出来的「第1问」在最前，后面接着原本的「第2问」
    expect(chats[0].messages[0]).toEqual({ role: 'user', text: '第1条第1问' });
    expect(chats[0].messages[1]).toEqual({ role: 'user', text: '第1条第2问' });
    expect(page.topReached()).toBe(true);
  });

  test('滚顶一次没挂上用户提问 → 轮询重试后补回来', async () => {
    const page = makePage('headless-late', 1);
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 1, chatWaitMs: 600 }));
    const chats = r.chats as Array<{ messages: Array<{ role: string; text: string }> }>;
    expect(chats).toHaveLength(1);
    expect(chats[0].messages[0]).toEqual({ role: 'user', text: '第1条第1问' });
    expect(page.topHits()).toBeGreaterThanOrEqual(2);
  });

  test('滚顶后仍没有用户提问 → 不产出会话，step 标 missing-user（绝不落坏文件）', async () => {
    const page = makePage('missing-user', 1);
    const r = await runner(page)(buildDriverScript({ siteKey: 'deepseek', maxChats: 1, chatWaitMs: 600 }));
    expect(r.chats).toEqual([]);
    const steps = r.steps as Array<{ why: string }>;
    expect(steps).toHaveLength(1);
    expect(steps[0].why).toBe('missing-user');
    expect(r.attempts).toBe(1);
    expect(r.skipped).toBe(0);
  });
});

// ── 页面回传结果解析 ────────────────────────────────────────────────────────

describe('页面结果解析', () => {
  // 故意放宽成 unknown：本组测的就是「页面回传的脏数据」（类型系统挡不住运行时脏值）
  const chat = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    title: '标题', url: 'https://chat.deepseek.com/a/1', path: '/a/1',
    messages: [{ role: 'user', text: '你好' }], key: 'deepseek:abc', sig: 'sig', markdown: '## 用户\n你好',
    ...over,
  });

  test('非对象 → null（不伪造空结果）', () => {
    for (const raw of [null, undefined, 0, 'x']) expect(parseDriverResult(raw)).toBeNull();
  });

  test('空正文的会话被丢掉：不许往库里塞空记忆', () => {
    const r = parseDriverResult({ items: ['a'], diag: '', chats: [chat({ markdown: '   ' })] });
    expect(r?.chats).toEqual([]);
  });

  test('只有助手没有用户的会话被丢掉（第二道闸，坏文件不许进落盘层）', () => {
    const r = parseDriverResult({
      items: ['a'], diag: '',
      chats: [chat({ messages: [{ role: 'assistant', text: '答' }], markdown: '## 助手\n答' })],
    });
    expect(r?.chats).toEqual([]);
  });

  test('没有消息的会话被丢掉（正文与消息必须同时成立）', () => {
    const r = parseDriverResult({ items: ['a'], diag: '', chats: [chat({ messages: [] })] });
    expect(r?.chats).toEqual([]);
  });

  test('缺 key 的会话被丢掉（没有指纹就判不了「采过没」）', () => {
    const r = parseDriverResult({ items: ['a'], diag: '', chats: [chat({ key: '' })] });
    expect(r?.chats).toEqual([]);
  });

  test('混入坏条目时，好的照留（单条失败不打断整轮）', () => {
    const r = parseDriverResult({
      items: ['a', 42, null], diag: { semantic: 3, groupRows: 4 }, chats: [chat({ markdown: '' }), chat({ key: 'k2' })],
    });
    expect(r?.items).toEqual(['a']);
    expect(r?.diag).toMatchObject({ semantic: 3, groupRows: 4 });
    expect(r?.chats.map((c) => c.key)).toEqual(['k2']);
  });

  test('侧栏体检是对象就按对象收（当年按字符串收，真结构被丢成「(空)」）', () => {
    const r = parseDriverResult({
      items: ['a'],
      diag: { semantic: 11, groupRows: 11, groups: [{ cls: 'c08e6e93', count: 11, sample: '会话' }], anchors: [{ href: '/a/chat/s/1', text: '会话1' }], messageAreaRows: 0 },
    });
    expect(r?.diag).toEqual({
      semantic: 11, groupRows: 11, messageAreaRows: 0,
      groups: [{ cls: 'c08e6e93', count: 11, sample: '会话' }],
      anchors: [{ href: '/a/chat/s/1', text: '会话1' }],
    });
  });

  test('diagText 单独收自由文本（core.js 没注入这类）', () => {
    const r = parseDriverResult({ items: [], diag: null, diagText: 'core.js 未注入' });
    expect(r?.diag).toBeNull();
    expect(r?.diagText).toBe('core.js 未注入');
  });

  test('快照只收有 HTML 的；正文超长按上限截断', () => {
    const big = 'x'.repeat(500_000);
    const r = parseDriverResult({ items: [], debug: { url: 'u', title: 't', visibility: 'visible', html: big } });
    expect(r?.debug?.html.length).toBe(300_000);
    expect(parseDriverResult({ items: [], debug: { url: 'u', html: '' } })?.debug).toBeNull();
  });

  test('steps 逐条收：脏数据逐条丢弃，不整块炸掉', () => {
    const r = parseDriverResult({
      items: ['a'],
      steps: [{ title: '会话1', urlBefore: 'u1', urlAfter: 'u2', msgs: 0, containers: 7, why: 'nav-no-content' }, null, 'x'],
    });
    expect(r?.steps).toHaveLength(1);
    expect(r?.steps[0]).toMatchObject({ why: 'nav-no-content', containers: 7 });
  });

  test('缺 url/path/sig 不致命（各站点路由形态不同），缺正文才致命', () => {
    const r = parseDriverResult({ items: ['a'], chats: [chat({ url: undefined, path: undefined, sig: undefined })] });
    expect(r?.chats[0]).toMatchObject({ url: '', path: '', sig: '' });
  });

  test('消息里非字符串字段被过滤', () => {
    const r = parseDriverResult({
      items: [], chats: [chat({ messages: [{ role: 'user', text: 1 }, { role: 'user', text: 'ok' }] })],
    });
    expect(r?.chats[0].messages).toEqual([{ role: 'user', text: 'ok' }]);
  });
});

// ── 去重与判定 ──────────────────────────────────────────────────────────────

describe('本轮该采哪几条', () => {
  const mk = (key: string): DriverChat => ({
    title: key, id: '', url: '', path: '', messages: [{ role: 'user', text: 'x' }], key, sig: '', markdown: '## 用户\nx',
  });

  test('已采过的剔掉（重跑不重复入库）', () => {
    const out = pickNewChats([mk('a'), mk('b')], { a: 1 });
    expect(out.map((c) => c.key)).toEqual(['b']);
  });

  test('本轮内重复只留第一条（同一会话在侧栏出现两次）', () => {
    const out = pickNewChats([mk('a'), mk('a'), mk('b')], {});
    expect(out.map((c) => c.key)).toEqual(['a', 'b']);
  });

  test('账里记 0 也算采过（不要用真值判断，时间戳可能是 0）', () => {
    const out = pickNewChats([mk('a')], { a: 0 });
    expect(out).toEqual([]);
  });
});

describe('单站结果判定', () => {
  const parsed = (
    items: string[],
    chats: DriverChat[] = [],
    steps: Array<{ why: string; containers?: number }> = [],
    diag: { semantic?: number; groupRows?: number } | null = null,
    needRelogin = false,
  ): ReturnType<typeof parseDriverResult> => ({
    items,
    chats,
    steps: steps.map((s, i) => ({
      title: `会话${i + 1}`, urlBefore: 'u1', urlAfter: s.why === 'nav-no-content' ? 'u2' : 'u1',
      msgs: 0, containers: s.containers ?? 0, why: s.why,
    })),
    diag: diag ? { semantic: diag.semantic ?? 0, groupRows: diag.groupRows ?? 0, groups: [], anchors: [], messageAreaRows: 0 } : null,
    diagText: '',
    needRelogin,
    nextStart: 0,
    attempts: 0,
    skipped: 0,
    reachedEnd: false,
    debug: null,
  });
  const one: DriverChat = {
    title: 't', id: '', url: '', path: '', messages: [{ role: 'user', text: 'x' }], key: 'k', sig: '', markdown: 'm',
  };

  test('有错误 → error，且原因原样带出（不吞异常）', () => {
    expect(judgeSite('deepseek', parsed(['a']), 1, 'net::ERR_CONNECTION_CLOSED')).toMatchObject({
      status: 'error', exported: 0, reason: 'net::ERR_CONNECTION_CLOSED',
    });
  });

  test('页面没回传 → error（不是 need_relogin：不能把解析失败说成登录失效）', () => {
    expect(judgeSite('deepseek', null, 0)).toMatchObject({ status: 'error', scanned: 0 });
  });

  test('侧栏一条都没识别到 → need_relogin，且带侧栏体检数字（不再只说「(空)」）', () => {
    const r = judgeSite('deepseek', parsed([], [], [], { semantic: 0, groupRows: 2 }), 0);
    expect(r.status).toBe('need_relogin');
    expect(r.reason).toContain('语义条目 0');
  });

  test('点了没跳转 → dom_changed，说明里点明「地址都没变」', () => {
    const r = judgeSite('deepseek', parsed(['a', 'b'], [], [{ why: 'click-no-nav' }, { why: 'click-no-nav' }]), 0);
    expect(r).toMatchObject({ status: 'dom_changed', scanned: 2, exported: 0 });
    expect(r.reason).toContain('地址都没变');
  });

  test('跳了但没正文 → dom_changed，说明里点明「地址跳过去了但正文一条都没读到」+ 容器数', () => {
    const r = judgeSite('deepseek', parsed(['a'], [], [{ why: 'nav-no-content', containers: 7 }]), 0);
    expect(r.status).toBe('dom_changed');
    expect(r.reason).toContain('地址跳过去了但正文一条都没读到');
    expect(r.reason).toContain('7 个');
  });

  test('混合失败 → 分别计数（不把两种故障并成一句「失败了」）', () => {
    const r = judgeSite('deepseek', parsed(['a', 'b', 'c'], [], [
      { why: 'click-no-nav' }, { why: 'nav-no-content' }, { why: 'error:boom' },
    ]), 0);
    expect(r.reason).toContain('1 条点了没跳转');
    expect(r.reason).toContain('1 条跳过去没读到正文');
    expect(r.reason).toContain('1 条报错');
  });

  test('登录页即使扫到 12 条也判 need_relogin，不误报成 dom_changed 让人去改选择器', () => {
    const r = judgeSite('deepseek', parsed(['忘记密码', '用户协议'], [], [], null, true), 0);
    expect(r.status).toBe('need_relogin');
    expect(r.reason).toContain('本轮没有点击任何条目');
    expect(r.reason).toContain('重新登录');
  });

  test('一条都没点到 → 说明里讲清是「没点到」，不是「抽不到」', () => {
    const r = judgeSite('deepseek', parsed(['a'], [], []), 0);
    expect(r.reason).toContain('一条会话都没点到');
  });

  test('抽到内容但一条都没入库 → no_new；入库了 → exported', () => {
    expect(judgeSite('deepseek', parsed(['a'], [one]), 0)).toMatchObject({ status: 'no_new', scanned: 1, exported: 0 });
    expect(judgeSite('deepseek', parsed(['a'], [one]), 1)).toMatchObject({ status: 'exported', scanned: 1, exported: 1 });
  });

  test('成功时不带 reason（UI 那格写「无异常」，不许出现空字符串原因）', () => {
    expect(judgeSite('deepseek', parsed(['a'], [one]), 1).reason).toBeUndefined();
  });

  test('点开的全被去重命中 → no_new，不能报成 dom_changed（别让人去改没坏的选择器）', () => {
    // 侧栏最新几条采过之后每轮都会走到这里：抽到了正文、但 key 全在账里
    const p = { ...parsed(['a', 'b'])!, attempts: 2, skipped: 2, reachedEnd: true };
    const r = judgeSite('deepseek', p, 0);
    expect(r.status).toBe('no_new');
    expect(r.reason).toContain('已在账里');
    // 反面对照：真的没抽到正文（attempts 有、skipped=0）仍然必须是 dom_changed
    const bad = { ...parsed(['a', 'b'], [], [{ why: 'click-no-nav' }])!, attempts: 2, skipped: 0 };
    expect(judgeSite('deepseek', bad, 0).status).toBe('dom_changed');
  });
});
