// 网页版对话接入引导卡单测：
// 口径：目录与插件路径都读真实 IPC，不硬编码；一键增加插件按钮走 webchatExt:*；
// 立即采集带登录会话；采集进行中关闭页面提示未完成任务；回执只给人话计数（UI 铁律）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 's_test',
}));

const gotoFn = vi.fn();
vi.mock('../../shared/shellNavigate.ts', () => ({
  requestShellView: (...args: unknown[]) => gotoFn(...args),
}));

import { WebChatExportCard } from '../WebChatExportCard.tsx';
import { HOST_ACCEPTED_ERROR_PREFIX } from '../../../desktop/hostBridge.ts';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };
const EXT_PATH = 'D:\\ext\\webchat-exporter';

const writeText = vi.fn(() => Promise.resolve());
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText },
});

function mockHost(opts: {
  dir?: unknown;
  ext?: unknown;
  trigger?: unknown;
  open?: unknown;
  set?: unknown;
  extFolder?: unknown;
  extBrowser?: unknown;
  follow?: unknown;
  sites?: unknown;
  status?: unknown;
  audit?: unknown;
  purgePreview?: unknown;
  purgeRun?: unknown;
} = {}) {
  w.__ELECTRON__ = true;
  // get 要能反映「设置/跟随之上的新状态」：卡片在改目录后会重读一次刷新对齐状态，
  // 若 get 恒返回旧值，测试就会误判成「改路径没生效」。
  let after: unknown = null;
  const getFn = vi.fn(() => Promise.resolve(after ?? opts.dir ?? { ok: true, dir: 'D:\\data\\chat-exports' }));
  const openFn = vi.fn(() => Promise.resolve(opts.open ?? { ok: true, path: 'D:\\data\\chat-exports' }));
  const setFn = vi.fn(() => {
    const res = (opts.set ?? { ok: true, dir: 'D:\\new\\chat-exports' }) as { ok?: boolean; dir?: string };
    if (res.ok && res.dir) after = { ok: true, dir: res.dir, pluginDir: null, aligned: null };
    return Promise.resolve(res);
  });
  const followFn = vi.fn(() => {
    const res = (opts.follow ?? { ok: true, dir: 'D:\\new\\chat-exports' }) as { ok?: boolean; dir?: string };
    if (res.ok && res.dir) after = { ok: true, dir: res.dir, pluginDir: res.dir, aligned: true };
    return Promise.resolve(res);
  });
  const extFn = vi.fn(() => Promise.resolve(opts.ext ?? { ok: true, path: EXT_PATH }));
  const extFolderFn = vi.fn(() => Promise.resolve(opts.extFolder ?? { ok: true, path: EXT_PATH }));
  const extBrowserFn = vi.fn(() => Promise.resolve(opts.extBrowser ?? { ok: true }));
  const triggerFn = vi.fn(() => opts.trigger ?? Promise.resolve({ ok: true, collected: 2, deduped: 1, roleSkipped: 0, skipped: [], ts: 1 }));
  const sitesFn = vi.fn(() => Promise.resolve(opts.sites ?? { ok: true, sites: [], total: 0 }));
  const statusFn = vi.fn(() => Promise.resolve(opts.status ?? { ok: true, todayCount: 0, day: '', last: null, recent: [] }));
  const auditFn = vi.fn(() => Promise.resolve(opts.audit ?? { ok: true, summary: { sessions: 0, sessionsWithSnapshot: 0, sourceMessages: 0, exportedMessages: 0, matched: 0, missing: 0, extra: 0, truncated: 0, rewritten: 0, roleMismatch: 0, accuracy: null }, diffCount: 0 }));
  const purgePreviewFn = vi.fn(() => Promise.resolve(opts.purgePreview ?? { ok: true, preview: { total: 0, by_site: {}, by_layer: {}, with_l0_cipher: 0, tombstones: 0, sample_ids: [] } }));
  const purgeRunFn = vi.fn(() => Promise.resolve(opts.purgeRun ?? { ok: true, report: { total: 0, purged: 0, failed: 0, vector_failed: 0 }, backup_dir: 'D:\\backup\\webchat-purge' }));
  w.api = {
    chatExports: { get: getFn, open: openFn, set: setFn, follow: followFn, sites: sitesFn },
    webchatExport: { status: statusFn },
    webchatAudit: { run: auditFn },
    webchatPurge: { preview: purgePreviewFn, run: purgeRunFn },
    webchatExt: { get: extFn, openFolder: extFolderFn, openBrowser: extBrowserFn },
    collector: { triggerNow: triggerFn },
  };
  return { getFn, openFn, setFn, followFn, extFn, extFolderFn, extBrowserFn, triggerFn, sitesFn, statusFn, auditFn, purgePreviewFn, purgeRunFn };
}

beforeEach(() => {
  delete w.__ELECTRON__;
  delete w.api;
  writeText.mockClear();
});

afterEach(() => {
  delete w.__ELECTRON__;
  delete w.api;
  vi.restoreAllMocks();
});

describe('WebChatExportCard（网页版对话接入引导）', () => {
  it('三步引导改为自带插件：开发者模式 + 加载已解压扩展，不再推荐第三方插件', async () => {
    mockHost();
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-export-dir-path')).toBeInTheDocument());
    const step1 = screen.getByTestId('webchat-step-1').textContent ?? '';
    expect(step1).toContain('开发者模式');
    expect(step1).toContain('加载已解压的扩展程序');
    expect(step1).not.toContain('AI Chat Archiver');
    expect(step1).not.toContain('Chat2File');
    expect(screen.getByTestId('webchat-step-2').textContent).toContain('小米 MiMO');
    expect(screen.getByTestId('webchat-ext-card').textContent).toContain('一键增加插件');
  });

  it('插件目录来自 webchatExt:get 真值，并提供一键打开扩展页/目录与复制路径', async () => {
    const { extFn, extBrowserFn, extFolderFn } = mockHost();
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-ext-path').textContent).toBe(EXT_PATH));
    expect(extFn).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('webchat-ext-open-edge'));
    await waitFor(() => expect(extBrowserFn).toHaveBeenCalledWith('edge'));
    // 打开期间两个浏览器按钮都禁用（避免连点把两次注入叠在一起）
    await waitFor(() => expect(screen.getByTestId('webchat-ext-open-qq')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('webchat-ext-open-qq'));
    await waitFor(() => expect(extBrowserFn).toHaveBeenCalledWith('qq'));
    fireEvent.click(screen.getByTestId('webchat-ext-open-folder'));
    await waitFor(() => expect(extFolderFn).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('webchat-ext-copy-path'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(EXT_PATH));
  });

  it('插件目录读取失败 → 诚实显示原因，不伪造插件路径', async () => {
    mockHost({ ext: { ok: false, error: '插件目录不存在：D:\\missing' } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-ext-err').textContent).toContain('插件目录不存在'));
    expect(screen.queryByTestId('webchat-ext-path')).toBeNull();
  });

  it('常驻回退提示：明说浏览器会拦自动跳转，并给出 Ctrl+L / Ctrl+V / 回车三步', async () => {
    mockHost();
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-ext-fallback-hint')).toBeInTheDocument());
    const hint = screen.getByTestId('webchat-ext-fallback-hint').textContent ?? '';
    expect(hint).toContain('地址会自动进剪贴板');
    expect(hint).toContain('Ctrl+L');
    expect(hint).toContain('Ctrl+V');
    expect(hint).toContain('回车');
  });

  it('正在打开时按钮禁用并显示进行中文案，结束后恢复（避免连点叠注入）', async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const { extBrowserFn } = mockHost({ extBrowser: pending });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-ext-open-edge')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-ext-open-edge'));
    await waitFor(() => expect(screen.getByTestId('webchat-ext-open-edge').textContent).toBe('正在打开 Edge…'));
    expect(screen.getByTestId('webchat-ext-open-qq')).toBeDisabled();
    expect(extBrowserFn).toHaveBeenCalledTimes(1);
    // 打开中再点一次不应该再发一次 IPC
    fireEvent.click(screen.getByTestId('webchat-ext-open-edge'));
    expect(extBrowserFn).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await waitFor(() => expect(screen.getByTestId('webchat-ext-open-edge').textContent).toBe('一键打开 Edge 扩展页'));
    expect(screen.getByTestId('webchat-ext-open-qq')).not.toBeDisabled();
  });

  it('插件落点与采集目录不一致 → 当场提示 + 一键「跟随插件位置」，跟随后转为已对齐', async () => {
    const mismatch = { ok: true, dir: 'C:\\data\\chat-exports', pluginDir: 'D:\\DL\\chat-exports', aligned: false };
    const aligned = { ok: true, dir: 'D:\\DL\\chat-exports', pluginDir: 'D:\\DL\\chat-exports', aligned: true };
    let calls = 0;
    const getFn = vi.fn(() => Promise.resolve(calls++ === 0 ? mismatch : aligned));
    w.__ELECTRON__ = true;
    const followFn = vi.fn(() => Promise.resolve({ ok: true, dir: 'D:\\DL\\chat-exports' }));
    w.api = {
      chatExports: { get: getFn, open: vi.fn(), set: vi.fn(), follow: followFn },
      webchatExt: { get: vi.fn(() => Promise.resolve({ ok: true, path: EXT_PATH })), openFolder: vi.fn(), openBrowser: vi.fn() },
      collector: { triggerNow: vi.fn() },
    };
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-dir-mismatch')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-plugin-dir').textContent).toBe('D:\\DL\\chat-exports');
    expect(screen.getByTestId('webchat-dir-mismatch').textContent).toContain('0 条');
    fireEvent.click(screen.getByTestId('webchat-dir-follow'));
    await waitFor(() => expect(followFn).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('webchat-dir-aligned')).toBeInTheDocument());
    expect(screen.queryByTestId('webchat-dir-mismatch')).toBeNull();
  });

  it('两边本来就一致 → 只显示一句「已对齐」，不弹多余提示', async () => {
    mockHost({ dir: { ok: true, dir: 'D:\\DL\\chat-exports', pluginDir: 'D:\\DL\\chat-exports', aligned: true } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-dir-aligned')).toBeInTheDocument());
    expect(screen.queryByTestId('webchat-dir-mismatch')).toBeNull();
  });

  it('探不到插件落点（pluginDir 为 null）→ 不显示任何对齐提示，也不假装一致', async () => {
    mockHost({ dir: { ok: true, dir: 'D:\\data\\chat-exports', pluginDir: null, aligned: null } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-export-dir-path')).toBeInTheDocument());
    expect(screen.queryByTestId('webchat-dir-aligned')).toBeNull();
    expect(screen.queryByTestId('webchat-dir-mismatch')).toBeNull();
  });

  it('一键打开失败 → 显示人话原因，不冒充成功', async () => {
    mockHost({ extBrowser: { ok: false, error: '打开扩展页失败：浏览器未安装' } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-ext-path')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-ext-open-edge'));
    await waitFor(() => expect(screen.getByTestId('webchat-ext-action-err').textContent).toContain('浏览器未安装'));
  });

  it('目录来自 chatExports:get 真值，不硬编码；提供复制与打开入口', async () => {
    const { getFn } = mockHost();
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-export-dir-path')).toBeInTheDocument());
    expect(getFn).toHaveBeenCalled();
    expect(screen.getByTestId('webchat-export-dir-path').textContent).toBe('D:\\data\\chat-exports');
    expect(screen.getByTestId('webchat-copy-dir')).toBeInTheDocument();
    expect(screen.getByTestId('webchat-open-dir')).toBeInTheDocument();
  });

  it('目录读取失败 → 诚实显示原因，不伪造路径', async () => {
    mockHost({ dir: { ok: false, error: '目录不存在：D:\\x' } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-export-dir-err')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-export-dir-err').textContent).toContain('目录不存在');
    expect(screen.queryByTestId('webchat-export-dir-path')).toBeNull();
  });

  it('立即采集：带登录会话调用 triggerNow([], sid)，回执给人话计数', async () => {
    const { triggerFn } = mockHost();
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-trigger-now')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-trigger-now'));
    await waitFor(() => expect(screen.getByTestId('webchat-receipt')).toBeInTheDocument());
    expect(triggerFn).toHaveBeenCalledWith([], 's_test');
    expect(screen.getByTestId('webchat-receipt-collected').textContent).toBe('2');
    expect(screen.getByTestId('webchat-receipt').textContent).toContain('幂等跳过 1 条');
  });

  it('采集中关闭页面 → 注册 unload 警告且文案说明有未完成任务；完成后注销', async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const originalAdd = window.addEventListener.bind(window);
    const originalRemove = window.removeEventListener.bind(window);
    const handlers: Array<(event: BeforeUnloadEvent) => unknown> = [];
    const removed: unknown[] = [];
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
      if (type === 'beforeunload' && typeof listener === 'function') {
        handlers.push(listener as (event: BeforeUnloadEvent) => unknown);
      }
      return originalAdd(type, listener, opts);
    }) as typeof window.addEventListener);
    const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | EventListenerOptions) => {
      if (type === 'beforeunload' && typeof listener === 'function') {
        removed.push(listener);
      }
      return originalRemove(type, listener, opts);
    }) as typeof window.removeEventListener);

    mockHost({ trigger: pending });
    render(<WebChatExportCard />);
    fireEvent.click(screen.getByTestId('webchat-trigger-now'));
    await waitFor(() => expect(screen.getByTestId('webchat-trigger-now').textContent).toBe('采集中…'));
    addSpy.mockRestore();

    expect(handlers.length).toBeGreaterThan(0);
    const preventDefault = vi.fn();
    const fake = { preventDefault, returnValue: '' } as unknown as BeforeUnloadEvent;
    handlers[handlers.length - 1]?.(fake);
    expect(preventDefault).toHaveBeenCalled();
    expect(fake.returnValue).toContain('未完成');

    finish({ ok: true, collected: 1, deduped: 0, roleSkipped: 0, skipped: [], ts: 1 });
    await waitFor(() => expect(screen.getByTestId('webchat-trigger-now').textContent).toBe('立即采集'));
    /**
     * 注销断言改成「真的调 removeEventListener 移除了同一个 handler」。
     * 旧写法 `window.dispatchEvent(new Event('beforeunload'))` 会把**同一 jsdom 里
     * 其他测试文件残留的监听器**一并触发 → 单跑必绿、全量并发偶发红（门禁抖一次）。
     * 断言「移除了谁」比「全局有没有人 preventDefault」精确，也不会被邻居污染。
     */
    expect(removed).toContain(handlers[handlers.length - 1]);
    removeSpy.mockRestore();
  });

  it('采集 0 条且无幂等命中 → 提示确认插件已导出（不假装成功）', async () => {
    mockHost({ trigger: { ok: true, collected: 0, deduped: 0, roleSkipped: 0, skipped: [], ts: 1 } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-trigger-now')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-trigger-now'));
    await waitFor(() => expect(screen.getByTestId('webchat-receipt')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-receipt').textContent).toContain('目录里没有新内容');
  });

  it('采到 0 条且导出目录一个文件都没有 → 明说「先去导出」，并解释跳过计数与网页导出无关', async () => {
    // 真实场景（2026-11-16）：采到 0 条 · 幂等跳过 3484 条，用户以为采集坏了。
    // 实际是 chat-exports 目录空的（插件一次都没导出成功），3484 来自本地 agent 日志去重。
    mockHost({ trigger: { ok: true, collected: 0, deduped: 3484, roleSkipped: 327, skipped: [], ts: 1 } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-trigger-now')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-trigger-now'));
    await waitFor(() => expect(screen.getByTestId('webchat-no-exports')).toBeInTheDocument());
    const text = screen.getByTestId('webchat-no-exports').textContent ?? '';
    expect(text).toContain('导出目录里还没有任何文件');
    expect(text).toContain('和网页导出的文件是两回事');
  });

  it('导出目录里已有文件 → 不出现「还没有任何文件」提示（不误报）', async () => {
    mockHost({
      trigger: { ok: true, collected: 0, deduped: 5, roleSkipped: 0, skipped: [], ts: 1 },
      sites: { ok: true, sites: [{ site: 'deepseek', count: 2 }], total: 2 },
    });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-trigger-now')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-trigger-now'));
    await waitFor(() => expect(screen.getByTestId('webchat-receipt')).toBeInTheDocument());
    expect(screen.queryByTestId('webchat-no-exports')).toBeNull();
  });

  it('未登录等 gate 拒绝（ok:false）→ 显示「采集未执行」与原因', async () => {
    mockHost({ trigger: { ok: false, error: '未登录或会话已过期' } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-trigger-now')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-trigger-now'));
    await waitFor(() => expect(screen.getByTestId('webchat-trigger-err')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-trigger-err').textContent).toContain('未登录');
    expect(screen.getByTestId('webchat-trigger-err').textContent).toContain('采集未执行');
  });

  it('宿主已受理但结果没取回 → 说「采集已开始」，绝不再说「采集未执行」', async () => {
    // 回归 2026-11-16：桥的 3 秒探测窗口把实测 4013ms 的采集判成「父窗口没装桥」，
    // 界面因此说「采集未执行」——可采集其实已经跑完。真实情况必须分开表述。
    const rejected = Promise.reject(
      new Error(`${HOST_ACCEPTED_ERROR_PREFIX}，但 3 分钟内没有返回结果：任务可能仍在后台进行，稍后刷新查看`),
    );
    rejected.catch(() => { /* 防止点击前的未消费窗口触发 unhandled 警告 */ });
    mockHost({ trigger: rejected });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-trigger-now')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-trigger-now'));
    await waitFor(() => expect(screen.getByTestId('webchat-trigger-err')).toBeInTheDocument());
    const text = screen.getByTestId('webchat-trigger-err').textContent ?? '';
    expect(text).toContain('采集已开始，但结果没取回');
    expect(text).not.toContain('采集未执行');
  });

  it('验收按钮发壳层导航意图（layered），不在 iframe 内裸跳（裸跳会让壳层 tab 状态脱节）', async () => {
    mockHost();
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-verify-link')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-verify-link'));
    expect(gotoFn).toHaveBeenCalledWith('layered');
    expect(screen.getByTestId('webchat-verify-link').tagName).toBe('BUTTON');
  });

  it('更改路径：成功后目录即时更新为新值', async () => {
    const { setFn } = mockHost();
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-change-dir')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-change-dir'));
    await waitFor(() => expect(screen.getByTestId('webchat-export-dir-path').textContent).toBe('D:\\new\\chat-exports'));
    expect(setFn).toHaveBeenCalled();
    expect(screen.queryByTestId('webchat-dir-err')).toBeNull();
  });

  it('更改路径：用户取消（canceled）不报错、目录保持不变', async () => {
    mockHost({ set: { ok: false, canceled: true } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-change-dir')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-change-dir'));
    await waitFor(() => expect(screen.getByTestId('webchat-export-dir-path').textContent).toBe('D:\\data\\chat-exports'));
    expect(screen.queryByTestId('webchat-dir-err')).toBeNull();
  });

  it('更改路径：失败（目录不可用/保存失败）→ 诚实显示原因，目录保持原值', async () => {
    mockHost({ set: { ok: false, error: '目录不可用：EACCES' } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-change-dir')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-change-dir'));
    await waitFor(() => expect(screen.getByTestId('webchat-dir-err')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-dir-err').textContent).toContain('目录不可用');
    expect(screen.getByTestId('webchat-export-dir-path').textContent).toBe('D:\\data\\chat-exports');
  });
});

// ── 2026-11-16 用户 5 条改造：来源区分 / 目录改名 / 首次验收 / 换机失效 ──────────

describe('WebChatExportCard（2026-11-16 改造）', () => {
  it('顶部说明用用户指定原文：内置插件自动读取 + 5 分钟自动入库 + 重复去重', async () => {
    mockHost();
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-export-dir-path')).toBeInTheDocument());
    const text = screen.getByTestId('webchat-export-card').textContent ?? '';
    expect(text).toContain('内置插件安装好后它会自动读取当前网页已显示的对话（含你的提问与 AI 回答）');
    // 2026-11-16 起落点改为「应用自己写进导出和同步目录」，文案必须跟着说，不能再写「下载目录的 chat-exports」
    expect(text).toContain('直接写进下面的「导出和同步目录」');
    expect(text).toContain('本机服务没启动时插件会兜底存到浏览器下载目录');
    expect(text).toContain('记忆采集器每 5 分钟自动扫描入库，重复内容自动去重');
  });

  it('「导出目录」改名为「导出和同步目录」（插件写这里、采集器也扫这里）', async () => {
    mockHost();
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-export-dir')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-export-dir').textContent).toContain('导出和同步目录');
  });

  it('导出来源列出七家网站（DeepSeek / 豆包 / 千问 …），并显示目录里实际已有的来源与条数', async () => {
    mockHost({
      sites: { ok: true, total: 4, sites: [{ site: 'deepseek', count: 3 }, { site: 'doubao', count: 1 }] },
    });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-site-count-deepseek')).toBeInTheDocument());

    const step2 = screen.getByTestId('webchat-step-2').textContent ?? '';
    expect(step2).toContain('DeepSeek');
    expect(step2).toContain('豆包');
    expect(step2).toContain('千问');
    // 来源计数用人话站点名，不倒英文 key
    expect(screen.getByTestId('webchat-site-count-deepseek').textContent).toContain('DeepSeek');
    expect(screen.getByTestId('webchat-site-count-doubao').textContent).toContain('豆包');
    expect(screen.getByTestId('webchat-site-stats').textContent).toContain('共 4 个文件');
  });

  it('目录里还没有导出文件 → 明说「还没有导出文件」并指路，不编来源', async () => {
    mockHost({ sites: { ok: true, sites: [], total: 0 } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-site-none')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-site-none').textContent).toContain('还没有导出文件');
  });

  it('「首次安装采集验收」在立即采集之前，说明清楚只点这一次', async () => {
    mockHost();
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-step-3')).toBeInTheDocument());
    const card = screen.getByTestId('webchat-export-card').textContent ?? '';
    expect(card).toContain('首次安装采集验收');
    const step3 = screen.getByTestId('webchat-step-3').textContent ?? '';
    expect(step3).toContain('先点一次「立即采集」');
    expect(step3).toContain('每 5 分钟自动扫描');
  });

  it('换机/目录被删（有路径但本机不存在）→ 明说这台电脑上没有，并给「跟随插件位置」', async () => {
    const stale = { ok: false, dir: 'E:\\旧电脑\\chat-exports', pluginDir: 'D:\\DL\\chat-exports', aligned: false };
    const fixed = { ok: true, dir: 'D:\\DL\\chat-exports', pluginDir: 'D:\\DL\\chat-exports', aligned: true };
    let calls = 0;
    w.__ELECTRON__ = true;
    const followFn = vi.fn(() => Promise.resolve({ ok: true, dir: 'D:\\DL\\chat-exports' }));
    w.api = {
      chatExports: {
        get: vi.fn(() => Promise.resolve(calls++ === 0 ? stale : fixed)),
        open: vi.fn(), set: vi.fn(), follow: followFn,
        sites: vi.fn(() => Promise.resolve({ ok: true, sites: [], total: 0 })),
      },
      webchatExt: { get: vi.fn(() => Promise.resolve({ ok: true, path: EXT_PATH })), openFolder: vi.fn(), openBrowser: vi.fn() },
      collector: { triggerNow: vi.fn() },
    };
    render(<WebChatExportCard />);

    await waitFor(() => expect(screen.getByTestId('webchat-dir-missing')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-dir-missing').textContent).toContain('这台电脑上没有这个目录');
    // 有探测到插件落点 → 给一键对齐，而不是让用户自己去找路径
    fireEvent.click(screen.getByTestId('webchat-dir-follow-missing'));
    await waitFor(() => expect(followFn).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('webchat-dir-aligned')).toBeInTheDocument());
    expect(screen.queryByTestId('webchat-dir-missing')).toBeNull();
  });

  it('换机且没探测到浏览器下载目录 → 只让用户「更改路径」，不给假的跟随按钮', async () => {
    mockHost({ dir: { ok: false, dir: 'E:\\旧电脑\\chat-exports', pluginDir: null, aligned: null } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-dir-missing')).toBeInTheDocument());
    expect(screen.queryByTestId('webchat-dir-follow-missing')).toBeNull();
    expect(screen.getByTestId('webchat-change-dir')).toBeInTheDocument();
  });
});

// ── 0.3.0 壳层「网页导出状态」行（2026-11-17 用户实测：导出无感知，要在应用里看得见） ──
describe('WebChatExportCard 网页导出状态', () => {
  it('收到过导出 → 显示最近一次站点/时间/今日份数，并说明「无新增跳过属正常」', async () => {
    const { statusFn } = mockHost({
      status: { ok: true, todayCount: 3, day: '2026-11-17', last: { at: 1, site: 'doubao', file: 'x.md', bytes: 100 }, recent: [] },
    });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-export-status-ok')).toBeInTheDocument());
    const text = screen.getByTestId('webchat-export-status-ok').textContent ?? '';
    expect(text).toContain('豆包');
    expect(text).toContain('今日');
    expect(text).toContain('3');
    expect(text).toContain('没新增会被跳过');
    expect(statusFn).toHaveBeenCalled();
  });

  it('还没收到过导出 → 诚实空态 + 给「等下一轮 / 强推一次」指引，不编造记录', async () => {
    mockHost({ status: { ok: true, todayCount: 0, day: '', last: null, recent: [] } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-export-status-none')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-export-status-none').textContent).toContain('导出当前对话');
    expect(screen.queryByTestId('webchat-export-status-ok')).toBeNull();
  });
});

// ── 导出完整性核对（2026-11-17 用户诉求：导出文档和原对话有无差异、有没有遗漏、正确率多少） ──
describe('WebChatExportCard 导出完整性核对', () => {
  it('核对按钮存在且点了会跑一次审计', async () => {
    const { auditFn } = mockHost();
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-audit-run')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-audit-run'));
    await waitFor(() => expect(auditFn).toHaveBeenCalled());
  });

  it('有比对结果 → 显示逐字一致率与各类差异计数（人话，不渲染 JSON）', async () => {
    mockHost({
      audit: {
        ok: true,
        diffCount: 2,
        summary: {
          sessions: 5, sessionsWithSnapshot: 4, sourceMessages: 120, exportedMessages: 118,
          matched: 115, missing: 3, extra: 1, truncated: 1, rewritten: 0, roleMismatch: 1,
          accuracy: 115 / 120,
        },
      },
    });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-audit-run')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-audit-run'));

    await waitFor(() => expect(screen.getByTestId('webchat-audit-accuracy')).toBeInTheDocument());
    const acc = screen.getByTestId('webchat-audit-accuracy').textContent ?? '';
    expect(acc).toContain('95.8%');
    expect(acc).toContain('115');
    expect(acc).toContain('120');
    const diffs = screen.getByTestId('webchat-audit-diffs').textContent ?? '';
    expect(diffs).toContain('遗漏 3 条');
    expect(diffs).toContain('多余 1 条');
    expect(diffs).toContain('截断 1 条');
    expect(diffs).toContain('角色判错 1 条');
    // UI 铁律：整页不许出现 JSON 原文
    expect(screen.getByTestId('webchat-export-card').textContent ?? '').not.toContain('"sessions"');
  });

  it('还没有可比对的快照 → 说清「上线前的导出拿不到原对话」，不假装能核对', async () => {
    mockHost({
      audit: {
        ok: true,
        diffCount: 0,
        summary: {
          sessions: 3, sessionsWithSnapshot: 0, sourceMessages: 0, exportedMessages: 90,
          matched: 0, missing: 0, extra: 0, truncated: 0, rewritten: 0, roleMismatch: 0,
          accuracy: null,
        },
      },
    });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-audit-run')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-audit-run'));

    await waitFor(() => expect(screen.getByTestId('webchat-audit-none')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-audit-none').textContent).toContain('拿不到原对话');
    expect(screen.queryByTestId('webchat-audit-accuracy')).toBeNull();
  });

  it('核对失败 → 显示人话原因，不冒充成功', async () => {
    mockHost({ audit: { ok: false, error: '审计失败：目录读不到' } });
    render(<WebChatExportCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-audit-run')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webchat-audit-run'));
    await waitFor(() => expect(screen.getByTestId('webchat-audit-err')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-audit-err').textContent).toContain('目录读不到');
    expect(screen.queryByTestId('webchat-audit-summary')).toBeNull();
  });
});

// ── ⑤ 清理旧格式网页导出条目（2026-11-17：重导后旧条目要按来源清掉） ──────────
describe('WebChatExportCard 清理旧格式网页导出条目', () => {
  it('预览：只读统计条数与来源分布，带原文密文与墓碑各自单列（人话，不渲染 JSON）', async () => {
    const { purgePreviewFn } = mockHost({
      purgePreview: {
        ok: true,
        preview: {
          total: 1261,
          by_site: { deepseek: 1058, doubao: 203 },
          by_layer: { L1: 1261 },
          with_l0_cipher: 40,
          tombstones: 7,
          sample_ids: ['mem_a'],
        },
      },
    });
    render(<WebChatExportCard />);
    fireEvent.click(screen.getByTestId('webchat-purge-preview-btn'));

    await waitFor(() => expect(screen.getByTestId('webchat-purge-preview')).toBeInTheDocument());
    expect(purgePreviewFn).toHaveBeenCalledWith(null, 's_test');
    const box = screen.getByTestId('webchat-purge-preview').textContent ?? '';
    expect(box).toContain('1261');
    expect(screen.getByTestId('webchat-purge-site-deepseek').textContent).toContain('DeepSeek');
    expect(screen.getByTestId('webchat-purge-site-deepseek').textContent).toContain('1058');
    expect(screen.getByTestId('webchat-purge-site-doubao').textContent).toContain('豆包');
    expect(screen.getByTestId('webchat-purge-l0').textContent).toContain('只能从备份恢复');
    expect(screen.getByTestId('webchat-purge-tombstones').textContent).toContain('不在本次清理范围');
    // UI 铁律：整页不许出现 JSON 原文
    expect(screen.getByTestId('webchat-export-card').textContent ?? '').not.toContain('"total"');
  });

  it('没有旧条目 → 明说「没有需要清理的」，不给一个会白跑的执行按钮', async () => {
    mockHost({
      purgePreview: { ok: true, preview: { total: 0, by_site: {}, by_layer: {}, with_l0_cipher: 0, tombstones: 0, sample_ids: [] } },
    });
    render(<WebChatExportCard />);
    fireEvent.click(screen.getByTestId('webchat-purge-preview-btn'));
    await waitFor(() => expect(screen.getByTestId('webchat-purge-none')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-purge-none').textContent).toContain('没有需要清理的旧格式网页导出条目');
    expect(screen.queryByTestId('webchat-purge-run')).toBeDisabled();
  });

  it('口令门禁：没逐字输入 PURGE 时执行按钮禁用，绝不偷跑删除', async () => {
    const { purgeRunFn } = mockHost();
    render(<WebChatExportCard />);
    const run = screen.getByTestId('webchat-purge-run');
    expect(run).toBeDisabled();
    fireEvent.change(screen.getByTestId('webchat-purge-confirm'), { target: { value: 'purge' } });
    expect(run).not.toBeDisabled(); // 大小写不敏感（用户手输，不必较真大小写）
    fireEvent.change(screen.getByTestId('webchat-purge-confirm'), { target: { value: 'REJUDGE' } });
    expect(run).toBeDisabled();
    expect(purgeRunFn).not.toHaveBeenCalled();
  });

  it('执行：带口令与会话调 webchatPurge:run，回执给人话计数与备份位置', async () => {
    const { purgeRunFn } = mockHost({
      purgeRun: {
        ok: true,
        report: { total: 1261, purged: 1261, failed: 0, vector_failed: 0 },
        backup_dir: 'D:\\backup\\webchat-purge-2026',
      },
    });
    render(<WebChatExportCard />);
    fireEvent.change(screen.getByTestId('webchat-purge-confirm'), { target: { value: 'PURGE' } });
    fireEvent.click(screen.getByTestId('webchat-purge-run'));

    await waitFor(() => expect(screen.getByTestId('webchat-purge-receipt')).toBeInTheDocument());
    expect(purgeRunFn).toHaveBeenCalledWith('PURGE', null, 's_test');
    expect(screen.getByTestId('webchat-purge-purged').textContent).toBe('1261');
    expect(screen.getByTestId('webchat-purge-receipt').textContent).toContain('清理前的备份');
    expect(screen.getByTestId('webchat-purge-backup').textContent).toBe('D:\\backup\\webchat-purge-2026');
    // 执行成功清空口令，避免口令留在输入框里被再点一次
    expect((screen.getByTestId('webchat-purge-confirm') as HTMLInputElement).value).toBe('');
  });

  it('部分失败 / 索引未摘除 → 如实分开说，不合并成一个「成功」', async () => {
    mockHost({
      purgeRun: { ok: true, report: { total: 10, purged: 8, failed: 2, vector_failed: 1 }, backup_dir: 'D:\\b' },
    });
    render(<WebChatExportCard />);
    fireEvent.change(screen.getByTestId('webchat-purge-confirm'), { target: { value: 'PURGE' } });
    fireEvent.click(screen.getByTestId('webchat-purge-run'));
    await waitFor(() => expect(screen.getByTestId('webchat-purge-receipt')).toBeInTheDocument());
    const text = screen.getByTestId('webchat-purge-receipt').textContent ?? '';
    expect(text).toContain('失败 2 条');
    expect(text).toContain('1 条索引未同步摘除');
  });

  it('执行被拒（未登录 / 非管理员 / 备份失败）→ 显示人话原因，不出成功回执', async () => {
    mockHost({ purgeRun: { ok: false, error: '需要管理员权限' } });
    render(<WebChatExportCard />);
    fireEvent.change(screen.getByTestId('webchat-purge-confirm'), { target: { value: 'PURGE' } });
    fireEvent.click(screen.getByTestId('webchat-purge-run'));
    await waitFor(() => expect(screen.getByTestId('webchat-purge-err')).toBeInTheDocument());
    expect(screen.getByTestId('webchat-purge-err').textContent).toContain('需要管理员权限');
    expect(screen.queryByTestId('webchat-purge-receipt')).toBeNull();
  });
});
