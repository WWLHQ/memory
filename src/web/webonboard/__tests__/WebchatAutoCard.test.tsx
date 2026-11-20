// 阶段 B · 参数页「网页会话自动采集」卡片单测。
//
// 这张卡是插件降级之后**唯一**的自动采集开关，所以判据要砸在「失败时用户能不能发现问题」上：
// 浏览器模式必须诚实降级、登录失效必须有显眼的重新登录入口、结果表必须有分母（扫到/导出）、
// 正在采集时按钮必须禁用、保存失败不许假装已生效。
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { WebchatAutoCard } from '../WebchatAutoCard.tsx';

type SiteResult = {
  site: string; status: string; scanned: number; exported: number;
  skipped?: number; missing?: number; reason?: string;
};
type View = {
  ok: boolean; error?: string;
  config: { enabled: boolean; intervalMinutes: number; perRound: number; sites: string[] };
  running: boolean;
  lastRound: { at: number; trigger: string; results: SiteResult[] } | null;
  nextAt: number | null;
  loginWindows: string[];
  sites: Array<{ key: string; label: string }>;
  blocked: string;
};

const SITES = [
  { key: 'deepseek', label: 'DeepSeek' },
  { key: 'kimi', label: 'Kimi' },
];

const base = (over: Partial<View> = {}): View => ({
  ok: true,
  config: { enabled: true, intervalMinutes: 60, perRound: 3, sites: ['deepseek'] },
  running: false,
  lastRound: null,
  nextAt: new Date('2026-11-18T23:30:00+08:00').getTime(),
  loginWindows: [],
  sites: SITES,
  blocked: '',
  ...over,
});

const TEST_DIR = 'C:\\Users\\LHQ\\Downloads\\chat-exports\\deepseek';

function setHost(opts: {
  state?: () => Promise<unknown>;
  set?: (patch: Record<string, unknown>) => Promise<unknown>;
  run?: () => Promise<unknown>;
  sweep?: () => Promise<unknown>;
  login?: (site: string) => Promise<unknown>;
  exportGet?: () => Promise<unknown>;
  exportOpen?: () => Promise<unknown>;
  exportSet?: () => Promise<unknown>;
} = {}) {
  (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
  (window as unknown as { api: unknown }).api = {
    webchatAuto: {
      state: opts.state ?? (async () => base()),
      set: opts.set ?? (async (patch: Record<string, unknown>) => base({
        config: { enabled: true, intervalMinutes: 60, perRound: 3, sites: ['deepseek'], ...patch },
      })),
      run: opts.run ?? (async () => ({ ok: true, state: base() })),
      sweep: opts.sweep ?? (async () => ({ ok: true, state: base() })),
      login: opts.login ?? (async () => ({ ok: true })),
    },
    chatExports: {
      get: opts.exportGet ?? (async () => ({ ok: true, dir: TEST_DIR })),
      open: opts.exportOpen ?? (async () => ({ ok: true, path: TEST_DIR })),
      set: opts.exportSet ?? (async () => ({ ok: true, dir: TEST_DIR })),
    },
  };
}

function clearHost() {
  delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
  delete (window as unknown as { api?: unknown }).api;
}

afterEach(() => { clearHost(); vi.restoreAllMocks(); });

describe('WebchatAutoCard · 环境降级', () => {
  test('浏览器模式：说明为什么没有，且不渲染任何开关', async () => {
    render(<WebchatAutoCard />);
    expect(screen.getByTestId('webchat-auto-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('wa-enable-pick')).toBeNull();
    expect(screen.queryByTestId('wa-run-btn')).toBeNull();
  });
});

describe('WebchatAutoCard · 真值展示', () => {
  test('已启用 + 有下次时间：徽标与文案都来自主进程回执', async () => {
    setHost({ state: async () => base({ config: { enabled: true, intervalMinutes: 30, perRound: 3, sites: ["deepseek"] } }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-enable-pick')).toBeTruthy());
    expect(screen.getByTestId('wa-enable-st').textContent).toContain('已启用');
    expect(screen.getByTestId('wa-interval-st').textContent).toContain('30 分钟');
    expect(screen.getByTestId('wa-next').textContent).not.toContain('未排程');
    // 30 分钟那颗按钮必须是选中态（否则用户看不出当前周期）
    const btn = screen.getByTestId('wa-interval-pick').querySelector('[data-value="30"]') as HTMLElement;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  test('未启用：不排程，明确写「未排程」而不是留空或显示上次时间', async () => {
    setHost({ state: async () => base({ config: { enabled: false, intervalMinutes: 60, perRound: 3, sites: ["deepseek"] }, nextAt: null }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-enable-pick')).toBeTruthy());
    expect(screen.getByTestId('wa-enable-st').textContent).toContain('已停用');
    expect(screen.getByTestId('wa-next').textContent).toContain('未排程');
    // 停用不等于不能手动采：按钮仍可点
    expect((screen.getByTestId('wa-run-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  test('blocked 有值时原样显示（例如接收端没起来），不静默吞掉', async () => {
    setHost({ state: async () => base({ blocked: '本机接收端未就绪：自动采集已暂停' }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('webchat-auto-blocked').textContent).toContain('接收端未就绪'));
  });

  test('从没采过时「上次」写人话，不用破折号冒充读数', async () => {
    setHost({ state: async () => base({ lastRound: null }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-last-at')).toBeTruthy());
    expect(screen.getByTestId('wa-last-at').textContent).toBe('上次：还没有采过');
  });

  test('已启用但主进程还没排出下次时间 → 「等待排程」，不显示成未排程也不是空白', async () => {
    setHost({ state: async () => base({ config: { enabled: true, intervalMinutes: 60, perRound: 3, sites: ["deepseek"] }, nextAt: null }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-next')).toBeTruthy());
    expect(screen.getByTestId('wa-next').textContent).toContain('等待排程');
  });
});

describe('WebchatAutoCard · 只发改动字段', () => {
  test('点「不启用」：patch 只有 enabled', async () => {
    const set = vi.fn(async (patch: Record<string, unknown>) => base({
      config: { enabled: Boolean(patch.enabled), intervalMinutes: 60, perRound: 3, sites: ["deepseek"] },
    }));
    setHost({ set });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-enable-pick')).toBeTruthy());

    await userEvent.click(screen.getByTestId('wa-enable-pick').querySelector('[data-value="off"]') as HTMLElement);

    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0][0]).toEqual({ enabled: false });
    expect(screen.getByTestId('wa-enable-st').textContent).toContain('已停用');
  });

  test('点周期：patch 只有 intervalMinutes', async () => {
    const set = vi.fn(async (patch: Record<string, unknown>) => base({
      config: { enabled: true, intervalMinutes: Number(patch.intervalMinutes), perRound: 3, sites: ["deepseek"] },
    }));
    setHost({ set });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-interval-pick')).toBeTruthy());

    await userEvent.click(screen.getByTestId('wa-interval-pick').querySelector('[data-value="120"]') as HTMLElement);

    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0][0]).toEqual({ intervalMinutes: 120 });
    expect(screen.getByTestId('wa-interval-st').textContent).toContain('120 分钟');
  });

  test('点站点：加站 / 取消站都发完整的 sites 数组（主进程按整表覆盖）', async () => {
    const set = vi.fn(async (patch: Record<string, unknown>) => base({
      config: { enabled: true, intervalMinutes: 60, perRound: 3, sites: patch.sites as string[] },
    }));
    setHost({ set });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-site-kimi')).toBeTruthy());

    await userEvent.click(screen.getByTestId('wa-site-kimi'));
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0][0]).toEqual({ sites: ['deepseek', 'kimi'] });

    await userEvent.click(screen.getByTestId('wa-site-deepseek'));
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
    expect(set.mock.calls[1][0]).toEqual({ sites: ['kimi'] });
  });
});

describe('WebchatAutoCard · 采集进行中', () => {
  test('主进程说在跑 → 按钮禁用并显示「正在采集」', async () => {
    setHost({ state: async () => base({ running: true }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-run-btn')).toBeTruthy());
    expect((screen.getByTestId('wa-run-btn') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('wa-run-st').textContent).toContain('正在采集');
  });

  test('点「立即采一轮」：回执的 state 覆盖页面（不靠前端自己猜结果）', async () => {
    const run = vi.fn(async () => ({
      ok: true,
      state: base({
        lastRound: {
          at: new Date('2026-11-18T22:10:00+08:00').getTime(), trigger: 'manual',
          results: [{ site: 'deepseek', status: 'exported', scanned: 4, exported: 2 }],
        },
      }),
    }));
    setHost({ run });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-run-btn')).toBeTruthy());

    await userEvent.click(screen.getByTestId('wa-run-btn'));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('wa-row-deepseek')).toBeTruthy());
    expect(screen.getByTestId('wa-row-deepseek').textContent).toContain('已导出');
    expect(screen.getByTestId('wa-last-at').textContent).toContain('22:10');
  });
});

describe('WebchatAutoCard · 登录失效', () => {
  test('need_relogin：既有显眼告警，也有「重新登录」按钮，点了带站点名开登录窗', async () => {
    const login = vi.fn(async (site: string) => ({ ok: true, echo: site }));
    setHost({
      state: async () => base({
        lastRound: {
          at: Date.now(), trigger: 'timer',
          results: [{ site: 'deepseek', status: 'need_relogin', scanned: 0, exported: 0, reason: '侧栏未识别到会话' }],
        },
      }),
      login,
    });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-need-relogin')).toBeTruthy());
    expect(screen.getByTestId('wa-need-relogin').textContent).toContain('登录已失效');

    await userEvent.click(screen.getByTestId('wa-relogin-btn'));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login.mock.calls[0][0]).toBe('deepseek');
  });

  test('没有 need_relogin 时不出现告警与按钮（不许常驻干扰）', async () => {
    setHost({
      state: async () => base({
        lastRound: { at: Date.now(), trigger: 'timer', results: [{ site: 'deepseek', status: 'no_new', scanned: 3, exported: 0 }] },
      }),
    });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-row-deepseek')).toBeTruthy());
    expect(screen.queryByTestId('wa-need-relogin')).toBeNull();
    expect(screen.queryByTestId('wa-relogin-btn')).toBeNull();
  });

  test('打开登录窗失败 → 报错，不假装成功', async () => {
    setHost({
      state: async () => base({
        lastRound: { at: Date.now(), trigger: 'timer', results: [{ site: 'deepseek', status: 'need_relogin', scanned: 0, exported: 0 }] },
      }),
      login: async () => ({ ok: false, error: '起窗口失败：E_DISPLAY' }),
    });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-relogin-btn')).toBeTruthy());
    await userEvent.click(screen.getByTestId('wa-relogin-btn'));
    await waitFor(() => expect(screen.getByTestId('webchat-auto-err').textContent).toContain('E_DISPLAY'));
  });
});

describe('WebchatAutoCard · 本轮结果表', () => {
  test('每个站点一行，带「扫到 / 导出」分母与失败原因', async () => {
    setHost({
      state: async () => base({
        lastRound: {
          at: Date.now(), trigger: 'timer',
          results: [
            { site: 'deepseek', status: 'exported', scanned: 5, exported: 2 },
            { site: 'kimi', status: 'dom_changed', scanned: 3, exported: 0, reason: '识别到 3 条会话但一条正文都没抽到' },
          ],
        },
      }),
    });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-row-kimi')).toBeTruthy());

    const ds = screen.getByTestId('wa-row-deepseek').querySelectorAll('td');
    expect(ds[0].textContent).toBe('DeepSeek');
    expect(ds[1].textContent).toBe('已导出');
    expect(ds[2].textContent).toBe('5');
    expect(ds[3].textContent).toBe('0');
    expect(ds[4].textContent).toBe('2');
    expect(ds[5].textContent).toBe('0');
    expect(ds[6].textContent).toBe('无异常');

    const km = screen.getByTestId('wa-row-kimi');
    expect(km.textContent).toContain('页面结构变了');
    expect(km.textContent).toContain('一条正文都没抽到');
  });

  test('没有上一轮结果时不渲染空表', async () => {
    setHost({ state: async () => base({ lastRound: null }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-run-btn')).toBeTruthy());
    expect(screen.queryByTestId('wa-results')).toBeNull();
  });
});

describe('WebchatAutoCard · 登录窗口常驻入口', () => {
  test('登录正常（无 need_relogin）时也有打开登录窗按钮：每个站点一个', async () => {
    setHost({ state: async () => base({ lastRound: null }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-login-open-deepseek')).toBeTruthy());
    expect(screen.getByTestId('wa-login-open-kimi')).toBeTruthy();
    // 没有 need_relogin，也绝不该出现旧的临时按钮（两条入口混淆）
    expect(screen.queryByTestId('wa-relogin-btn')).toBeNull();
    expect(screen.getByTestId('wa-login-win-status').textContent).toContain('无');
  });

  test('点常驻「打开登录窗」：带站点名调 webchatAuto:login', async () => {
    const login = vi.fn(async (_site: string) => ({ ok: true }));
    setHost({ state: async () => base({ lastRound: null }), login });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-login-open-deepseek')).toBeTruthy());

    await userEvent.click(screen.getByTestId('wa-login-open-kimi'));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login.mock.calls[0][0]).toBe('kimi');
  });

  test('主进程回执 loginWindows：徽标与状态行显示已打开站点（不用破折号）', async () => {
    setHost({ state: async () => base({ lastRound: null, loginWindows: ['deepseek'] }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-login-win-count').textContent).toContain('已打开 1 个'));
    expect(screen.getByTestId('wa-login-win-status').textContent).toContain('DeepSeek');
    // 已开站点按钮文案变成「重新打开」，提示点了是聚焦已有窗口
    expect(screen.getByTestId('wa-login-open-deepseek').textContent).toContain('重新打开');
    expect(screen.getByTestId('wa-login-open-kimi').textContent).toContain('打开登录窗');
  });

  test('打开登录窗失败：报错且状态不假装已开', async () => {
    setHost({
      state: async () => base({ lastRound: null }),
      login: async () => ({ ok: false, error: '起窗口失败：E_DISPLAY' }),
    });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-login-open-deepseek')).toBeTruthy());
    await userEvent.click(screen.getByTestId('wa-login-open-deepseek'));
    await waitFor(() => expect(screen.getByTestId('webchat-auto-err').textContent).toContain('E_DISPLAY'));
  });
});

describe('WebchatAutoCard · 导出文件保存目录', () => {
  test('显示主进程给的目录（不硬编码），打开/更改按钮可用', async () => {
    const dirFromHost = 'D:\\My Data\\chat-exports\\deepseek';
    setHost({ exportGet: async () => ({ ok: true, dir: dirFromHost }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-export-dir-path').textContent).toBe(dirFromHost));
    expect((screen.getByTestId('wa-export-dir-open') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('wa-export-dir-change') as HTMLButtonElement).disabled).toBe(false);
  });

  test('点「打开目录」调 chatExports:open', async () => {
    const open = vi.fn(async () => ({ ok: true, path: TEST_DIR }));
    setHost({ exportOpen: open });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-export-dir-open')).toBeTruthy());

    await userEvent.click(screen.getByTestId('wa-export-dir-open'));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  });

  test('打开失败：显示主进程原因，不假装成功', async () => {
    setHost({ exportOpen: async () => ({ ok: false, error: '目录不存在：D:\\gone' }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-export-dir-open')).toBeTruthy());
    await userEvent.click(screen.getByTestId('wa-export-dir-open'));
    await waitFor(() => expect(screen.getByTestId('wa-export-dir-err').textContent).toContain('目录不存在'));
  });

  test('目录不存在（ok=false 但仍回 dir）：仍显示路径，让用户能改回来', async () => {
    setHost({ exportGet: async () => ({ ok: false, dir: TEST_DIR, error: `目录不存在：${TEST_DIR}` }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-export-dir-path').textContent).toBe(TEST_DIR));
    expect(screen.getByTestId('wa-export-dir-err').textContent).toContain('目录不存在');
    // 关键：读了失败也要给「更改路径」按钮，否则用户卡死在一个不存在的路径上
    expect(screen.getByTestId('wa-export-dir-change')).toBeTruthy();
  });

  test('点「更改路径」调 chatExports:set，成功后回显新目录', async () => {
    const newDir = 'E:\\new\\chat-exports';
    const set = vi.fn(async () => ({ ok: true, dir: newDir }));
    setHost({ exportSet: set });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-export-dir-change')).toBeTruthy());

    await userEvent.click(screen.getByTestId('wa-export-dir-change'));

    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('wa-export-dir-path').textContent).toBe(newDir));
  });

  test('更改对话框取消：不回显、不报错、现状不变', async () => {
    setHost({ exportSet: async () => ({ ok: false, canceled: true }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-export-dir-path').textContent).toBe(TEST_DIR));
    await userEvent.click(screen.getByTestId('wa-export-dir-change'));
    // 取消后仍是原路径，且没有错误条
    await waitFor(() => expect((screen.getByTestId('wa-export-dir-change') as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId('wa-export-dir-path').textContent).toBe(TEST_DIR);
    expect(screen.queryByTestId('wa-export-dir-err')).toBeNull();
  });

  test('更改失败：显示原因，路径仍是旧的（不假装已改）', async () => {
    setHost({ exportSet: async () => ({ ok: false, error: '保存配置失败：EACCES' }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-export-dir-change')).toBeTruthy());
    await userEvent.click(screen.getByTestId('wa-export-dir-change'));
    await waitFor(() => expect(screen.getByTestId('wa-export-dir-err').textContent).toContain('EACCES'));
    expect(screen.getByTestId('wa-export-dir-path').textContent).toBe(TEST_DIR);
  });
});

describe('WebchatAutoCard · 失败路径', () => {
  test('保存失败：显示主进程原因，且徽标仍是旧真值', async () => {
    setHost({
      state: async () => base({ config: { enabled: true, intervalMinutes: 60, perRound: 3, sites: ["deepseek"] } }),
      set: async () => ({ ...base({ config: { enabled: true, intervalMinutes: 60, perRound: 3, sites: ["deepseek"] } }), ok: false, error: '写盘失败：EACCES' }),
    });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-enable-pick')).toBeTruthy());

    await userEvent.click(screen.getByTestId('wa-enable-pick').querySelector('[data-value="off"]') as HTMLElement);

    await waitFor(() => expect(screen.getByTestId('webchat-auto-err').textContent).toContain('EACCES'));
    expect(screen.getByTestId('wa-enable-st').textContent).toContain('已启用');
  });
});

describe('WebchatAutoCard · 补齐历史', () => {
  test('点「补齐历史会话」→ 调 webchatAuto:sweep（不能错调成只采 10 条的 run）', async () => {
    const sweep = vi.fn(async () => ({
      ok: true,
      state: base({
        lastRound: {
          at: Date.parse('2026-11-19T19:40:00+08:00'), trigger: 'sweep',
          results: [{ site: 'deepseek', status: 'exported', scanned: 200, exported: 30 }],
        },
      }),
    }));
    const run = vi.fn(async () => ({ ok: true, state: base() }));
    setHost({ sweep, run });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-sweep-btn')).toBeTruthy());

    await userEvent.click(screen.getByTestId('wa-sweep-btn'));

    await waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));
    expect(run).not.toHaveBeenCalled();
    // 结果表照常回显本轮真值（30/200），不是前端自己算的
    await waitFor(() => expect(screen.getByTestId('wa-row-deepseek').textContent).toContain('已导出'));
    expect(screen.getByTestId('wa-row-deepseek').textContent).toContain('30');
  });

  test('补齐历史失败：如实报错，不假装已经在补', async () => {
    setHost({ sweep: async () => ({ ok: false, error: '补齐历史失败：本机接收端未就绪' }) });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-sweep-btn')).toBeTruthy());
    const before = screen.getByTestId('wa-enable-st').textContent;

    await userEvent.click(screen.getByTestId('wa-sweep-btn'));

    await waitFor(() => expect(screen.getByTestId('webchat-auto-err').textContent).toContain('接收端未就绪'));
    // 失败回执只有 { ok:false, error }、没有 config：绝不能被当成新状态覆盖掉已加载的配置，
    // 否则整块设置区会消失（2026-11-19 单元测试抓到的真实崩溃路径）
    expect(screen.getByTestId('wa-enable-st').textContent).toBe(before);
  });

  test('补齐历史按钮上写明「只补还没采过的」，避免被当成重新全量导出', async () => {
    setHost({});
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-sweep-hint')).toBeTruthy());
    expect(screen.getByTestId('wa-sweep-hint').textContent).toContain('还没采过');
  });
});

describe('WebchatAutoCard · 每轮导出条数', () => {
  test('perRound 显示当前值，点「10 条」调用 apply({perRound:10})', async () => {
    let applied: Record<string, unknown> | null = null;
    setHost({
      state: async () => base({ config: { enabled: true, intervalMinutes: 60, perRound: 3, sites: ['deepseek'] } }),
      set: async (patch) => { applied = patch; return { ok: true, state: base({ config: { enabled: true, intervalMinutes: 60, perRound: 10, sites: ['deepseek'] } }) }; },
    });
    render(<WebchatAutoCard />);
    await waitFor(() => expect(screen.getByTestId('wa-per-round-pick')).toBeTruthy());
    expect(screen.getByTestId('wa-per-round-st').textContent).toContain('3 条');

    await userEvent.click(screen.getByTestId('wa-per-round-pick').querySelector('[data-value="10"]') as HTMLElement);

    await waitFor(() => expect(applied).toEqual({ perRound: 10 }));
    await waitFor(() => expect(screen.getByTestId('wa-per-round-st').textContent).toContain('10 条'));
  });
});
