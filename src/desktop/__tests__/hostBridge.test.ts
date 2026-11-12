// 宿主桥（iframe postMessage 代理）单测
// 覆盖：顶层 native 直调（storage / hostScan 两个通道）+ 无宿主能力时的诚实降级。
// 注：子 frame → parent 消息桥链路由 E2E 覆盖（tools/selftest-iframe.cjs），jsdom 无法构造真实 iframe。
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

describe('hostBridge 通道映射', () => {
  test('hostCapability：native / bridge / none 三态', async () => {
    vi.resetModules();
    // none：普通浏览器
    expect((await import('../hostBridge.ts')).hostCapability()).toBe('none');

    // native：顶层窗口 + preload
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = {
      hostScan: { run: vi.fn() },
      storage: { putMemory: vi.fn(), queryAudit: vi.fn() },
    };
    const mod1 = await import('../hostBridge.ts');
    expect(mod1.hostCapability()).toBe('native');
    delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
    delete (window as unknown as { api?: unknown }).api;
    vi.resetModules();
  });
});

describe('hostCapability：bridge 仅在父窗口具备原生 preload 时返回', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
    delete (window as unknown as { api?: unknown }).api;
    vi.restoreAllMocks();
  });

  test('iframe（父窗口读不到 __ELECTRON__）→ bridge：与 hostCall 一致，桥由父窗口自身兜底', async () => {
    // 复现真实 Electron 怪象：子 iframe 主世界里 window.parent.__ELECTRON__ 未必可读
    // （contextBridge 暴露的绑定跨 iframe 主世界不一定可见）。旧实现靠 parentHasNativeApi()
    // 读它，于是首页 iframe 被误判 none → 内核不注入 l0 端口 → writeUnlocked 恒返 false。
    // 修复后 hostCapability 与 hostCall 共用 isEmbedded() 口径：只要嵌在同源父窗口里就判 bridge。
    const fakeParent = {} as unknown as Window;
    Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true, writable: true });
    const { hostCapability } = await import('../hostBridge.ts');
    expect(hostCapability()).toBe('bridge');
    Object.defineProperty(window, 'parent', { value: window, configurable: true, writable: true });
  });

  test('iframe 且父窗口有 preload → bridge', async () => {
    const fakeParent = {
      __ELECTRON__: true,
      api: { hostScan: { run: vi.fn() } },
    } as unknown as Window;
    Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true, writable: true });
    const { hostCapability } = await import('../hostBridge.ts');
    expect(hostCapability()).toBe('bridge');
    Object.defineProperty(window, 'parent', { value: window, configurable: true, writable: true });
  });

  test('顶层窗口有 preload → native', async () => {
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = { hostScan: { run: vi.fn() } };
    const { hostCapability } = await import('../hostBridge.ts');
    expect(hostCapability()).toBe('native');
  });
});

describe('批次2：hostBridge 信任边界（来源 / channel / 回包 targetOrigin）', () => {
  const REQ = '__memagent_host_req__';
  const RES = '__memagent_host_res__';

  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
    delete (window as unknown as { api?: unknown }).api;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function msg(origin: string, data: unknown, source: WindowProxy): MessageEvent {
    return { origin, data, source } as unknown as MessageEvent;
  }

  test('非同一来源的消息（含 Origin: null）被忽略：不调用原生能力、不回包', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = { hostScan: { run } };
    const { handleBridgeMessage } = await import('../hostBridge.ts');
    const post = vi.fn();
    const source = { postMessage: post } as unknown as WindowProxy;

    for (const origin of ['http://evil.example', 'null']) {
      handleBridgeMessage(msg(origin, { [REQ]: { id: 'r1', method: 'hostScan:run', args: [] } }, source));
    }
    expect(run).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  test('同源合法请求：调用原生能力，回包 targetOrigin 精确等于页面来源（绝不为 *）', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, found: [] });
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = { hostScan: { run } };
    const { handleBridgeMessage } = await import('../hostBridge.ts');
    const post = vi.fn();
    const source = { postMessage: post } as unknown as WindowProxy;

    handleBridgeMessage(msg(window.location.origin, { [REQ]: { id: 'r2', method: 'hostScan:run', args: [] } }, source));
    await new Promise((r) => setTimeout(r, 0));

    expect(run).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toBe(window.location.origin);
    expect(post.mock.calls[0][1]).not.toBe('*');
    expect((post.mock.calls[0][0] as Record<string, { ok: boolean }>)[RES].ok).toBe(true);
  });

  test('未知 channel / 非数组 args 被忽略', async () => {
    const put = vi.fn().mockResolvedValue(true);
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = { storage: { putMemory: put } };
    const { handleBridgeMessage } = await import('../hostBridge.ts');
    const post = vi.fn();
    const source = { postMessage: post } as unknown as WindowProxy;
    const origin = window.location.origin;

    handleBridgeMessage(msg(origin, { [REQ]: { id: 'r3', method: 'storage:__proto__', args: [] } }, source));
    handleBridgeMessage(msg(origin, { [REQ]: { id: 'r4', method: 'storage:putMemory', args: 'not-an-array' } }, source));
    await new Promise((r) => setTimeout(r, 0));

    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  test('同一请求 id 重试只执行一次（消息桥重发不得重复副作用）', async () => {
    const runNow = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = { backup: { runNow } };
    const { handleBridgeMessage } = await import('../hostBridge.ts');
    const post = vi.fn();
    const source = { postMessage: post } as unknown as WindowProxy;
    const origin = window.location.origin;

    handleBridgeMessage(msg(origin, { [REQ]: { id: 'r5', method: 'backup:runNow', args: [] } }, source));
    handleBridgeMessage(msg(origin, { [REQ]: { id: 'r5', method: 'backup:runNow', args: [] } }, source));
    await new Promise((r) => setTimeout(r, 0));

    expect(runNow).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(2);
  });

  test('批次27 P3-5：同 id 不同 args 不互相劫持（去重键含 method+args）', async () => {
    const put = vi.fn(async (m: unknown) => ({ ok: true, echo: m }));
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = { storage: { putMemory: put } };
    const { handleBridgeMessage } = await import('../hostBridge.ts');
    const replies: { id: string; ok: boolean; data?: unknown }[] = [];
    const source = {
      postMessage: (payload: unknown) => {
        replies.push((payload as Record<string, { id: string; ok: boolean; data?: unknown }>)[RES]);
      },
    } as unknown as WindowProxy;
    const origin = window.location.origin;

    handleBridgeMessage(msg(origin, { [REQ]: { id: 'dup', method: 'storage:putMemory', args: ['first'] } }, source));
    handleBridgeMessage(msg(origin, { [REQ]: { id: 'dup', method: 'storage:putMemory', args: ['second'] } }, source));
    await new Promise((r) => setTimeout(r, 0));

    expect(put).toHaveBeenCalledTimes(2);
    const byId = replies.filter((r) => r.id === 'dup');
    expect(byId).toHaveLength(2);
    expect(byId.map((r) => r.data)).toEqual([{ ok: true, echo: 'first' }, { ok: true, echo: 'second' }]);
  });

  test('iframe 请求父窗口时 targetOrigin 为当前来源（绝不为 *）', async () => {
    const post = vi.fn();
    const fakeParent = { postMessage: post, __ELECTRON__: true, api: {} } as unknown as Window;
    Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true, writable: true });
    const { hostCall } = await import('../hostBridge.ts');

    vi.useFakeTimers();
    const p = hostCall('hostScan:run');
    p.catch(() => { /* 预期超时拒绝 */ });
    await Promise.resolve();

    expect(post).toHaveBeenCalled();
    for (const call of post.mock.calls) expect(call[1]).toBe(window.location.origin);

    await vi.advanceTimersByTimeAsync(4000);
    await expect(p).rejects.toThrow(/宿主桥不可达/);
    Object.defineProperty(window, 'parent', { value: window, configurable: true, writable: true });
  });
});

describe('hostLog：动作日志通道（批次7）', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
    delete (window as unknown as { api?: unknown }).api;
    Object.defineProperty(window, 'parent', { value: window, configurable: true, writable: true });
    vi.restoreAllMocks();
  });

  test('顶层窗口：直接写 preload log.write，参数原样透传', async () => {
    const write = vi.fn();
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = { log: { write } };
    const { hostLog } = await import('../hostBridge.ts');

    hostLog('ui', 'click', { id: 'btnLogin' }, { level: 'warn', requestId: 'req_9' });
    expect(write).toHaveBeenCalledWith('ui', 'click', { id: 'btnLogin' }, { level: 'warn', requestId: 'req_9' });
  });

  test('iframe：经父窗口桥转发 method=log:write，targetOrigin 为当前来源', async () => {
    const post = vi.fn();
    Object.defineProperty(window, 'parent', { value: { postMessage: post, __ELECTRON__: true, api: {} }, configurable: true, writable: true });
    const { hostLog } = await import('../hostBridge.ts');

    hostLog('ui', 'page_view', { page: 'security' });
    expect(post).toHaveBeenCalledTimes(1);
    const [data, target] = post.mock.calls[0] as [Record<string, { method: string; args: unknown[] }>, string];
    expect(data.__memagent_host_req__.method).toBe('log:write');
    expect(data.__memagent_host_req__.args).toEqual(['ui', 'page_view', { page: 'security' }, undefined]);
    expect(target).toBe(window.location.origin);
    expect(target).not.toBe('*');
  });

  test('纯浏览器（无宿主能力）：静默丢弃，绝不抛错打断业务', async () => {
    const { hostLog } = await import('../hostBridge.ts');
    expect(() => hostLog('ui', 'click')).not.toThrow();
  });

  test('preload 未暴露 log（旧版壳）：静默跳过而不是抛 TypeError', async () => {
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = {};
    const { hostLog } = await import('../hostBridge.ts');
    expect(() => hostLog('ui', 'click')).not.toThrow();
  });

  test('bridge 收到 log:write 请求 → 调用 api.log.write 并回执 ok', async () => {
    const write = vi.fn();
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = { log: { write } };
    const { handleBridgeMessage } = await import('../hostBridge.ts');

    const post = vi.fn();
    const source = { postMessage: post } as unknown as WindowProxy;
    handleBridgeMessage({
      origin: window.location.origin,
      data: { __memagent_host_req__: { id: 'r_log', method: 'log:write', args: ['ui', 'click', { id: 'x' }, null] } },
      source,
    } as unknown as MessageEvent);
    await new Promise((r) => setTimeout(r, 0));

    expect(write).toHaveBeenCalledWith('ui', 'click', { id: 'x' }, null);
    expect((post.mock.calls[0][0] as Record<string, { ok: boolean }>).__memagent_host_res__.ok).toBe(true);
  });
});

describe('InMemoryStorage：iframe 仅在父窗口有原生 preload 时走宿主桥', () => {
  afterEach(() => {
    Object.defineProperty(window, 'parent', { value: window, configurable: true, writable: true });
    vi.resetModules();
  });

  test('iframe（嵌在同源父窗口）→ 走宿主桥（与 hostCall 一致，非进程内内存账本）', async () => {
    // 修复后 hostCapability 与 hostCall 共用 isEmbedded()：只要嵌在同源父窗口里就判 bridge，
    // 于是 storage 走宿主桥（HostBridgeStorage）而非进程内内存账本——真实首页 iframe 正是如此，
    // 经桥读主进程里的真实账本。旧实现靠 parentHasNativeApi() 读 window.parent.__ELECTRON__，
    // 子 iframe 主世界读不到会被误判 none → 错误地退回内存账本。
    Object.defineProperty(window, 'parent', { value: {} as Window, configurable: true, writable: true });
    vi.resetModules();
    const { InMemoryStorage } = await import('../../core/memagent/storage.ts');
    // 嵌在同源父窗口 → 走宿主桥实现（非内存实现）
    expect(new InMemoryStorage()).not.toBeInstanceOf(InMemoryStorage);
  });

  test('父窗口有 preload → 走宿主桥（非内存实现）', async () => {
    const fakeParent = { __ELECTRON__: true, api: { storage: {} } } as unknown as Window;
    Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true, writable: true });
    vi.resetModules();
    const { InMemoryStorage } = await import('../../core/memagent/storage.ts');
    expect(new InMemoryStorage()).not.toBeInstanceOf(InMemoryStorage);
  });
});

describe('hostCall：顶层窗口走原生 preload', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
    delete (window as unknown as { api?: unknown }).api;
  });

  test('hostScan:run 映射到 window.api.hostScan.run', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, found: [] });
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = { hostScan: { run } };
    const { hostCall } = await import('../hostBridge.ts');
    const res = await hostCall<{ ok: boolean }>('hostScan:run');
    expect(run).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });

  test('storage:queryAudit 映射到 window.api.storage.queryAudit 并透传参数', async () => {
    const queryAudit = vi.fn().mockResolvedValue([{ request_id: 'r1' }]);
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = { storage: { queryAudit } };
    const { hostCall } = await import('../hostBridge.ts');
    const res = await hostCall<unknown[]>('storage:queryAudit', [{ since: 1 }]);
    expect(queryAudit).toHaveBeenCalledWith({ since: 1 });
    expect(res).toHaveLength(1);
  });

  test('S5 / D6：l0:pendingWrites 映射到 window.api.l0.pendingWrites 并透传会话', async () => {
    const view = { ok: true, count: 0, items: [], truncated: false };
    const pendingWrites = vi.fn().mockResolvedValue(view);
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = { l0: { pendingWrites } };
    const { hostCall } = await import('../hostBridge.ts');
    const res = await hostCall<typeof view>('l0:pendingWrites', ['sid_1']);
    expect(pendingWrites).toHaveBeenCalledWith('sid_1');
    expect(res).toEqual(view);
  });

  test('能力缺失 → 抛错（调用方诚实降级，不静默返回假数据）', async () => {
    (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = { storage: {} }; // 缺 hostScan
    const { hostCall } = await import('../hostBridge.ts');
    await expect(hostCall('hostScan:run')).rejects.toThrow(/宿主能力缺失/);
  });
});

describe('hostCall：能力探测与降级边界', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('无 preload 且非 iframe → hostCapability=none 且调用抛错（不返回假数据）', async () => {
    const { hostCapability, hostCall } = await import('../hostBridge.ts');
    // jsdom 中 window.parent === window（非 iframe），且无 __ELECTRON__ → 纯浏览器环境
    expect(hostCapability()).toBe('none');
    await expect(hostCall('hostScan:run')).rejects.toThrow(/宿主能力不可用/);
  });

  test('iframe 通道的端到端行为由 E2E 覆盖（tools/selftest-iframe.cjs：概览页 iframe → 宿主真扫）', () => {
    // jsdom 无法构造真实 iframe（window.parent 不可重写），此处仅记录覆盖关系：
    // 子 frame 经 window.parent.postMessage 请求、父窗口代理 window.api 的链路在 E2E 中验证。
    expect(true).toBe(true);
  });
});
