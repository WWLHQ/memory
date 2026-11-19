// 阶段 A · 参数页「后台常驻」卡片单测：
// 浏览器模式诚实降级 / 徽标显示主进程真值 / 两个开关只发改动字段 /
// 无常驻则自启禁用（联动）/ 保存失败不许显示成功 / 配置已开但系统未写入必须提示。
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AppShellCard } from '../AppShellCard.tsx';

type View = {
  ok: boolean; keepInTray: boolean; autoStart: boolean; platform: string;
  applied: boolean | null; trayActive: boolean; autostartNote: string; error?: string;
};

const base = (over: Partial<View> = {}): View => ({
  ok: true,
  keepInTray: true,
  autoStart: true,
  platform: 'win32',
  applied: true,
  trayActive: true,
  autostartNote: '',
  ...over,
});

function setHost(opts: {
  state?: () => Promise<unknown>;
  set?: (patch: Record<string, unknown>) => Promise<unknown>;
} = {}) {
  (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
  (window as unknown as { api: unknown }).api = {
    appShell: {
      state: opts.state ?? (async () => base()),
      set: opts.set ?? (async (patch: Record<string, unknown>) => {
        // 主进程口径：关掉常驻会连带把自启收敛为 false（applyShellConstraints）
        const keep = patch.keepInTray;
        const auto = patch.autoStart;
        const keepInTray = keep === undefined ? true : Boolean(keep);
        const autoStart = keepInTray === false ? false : (auto === undefined ? true : Boolean(auto));
        return base({ keepInTray, autoStart, trayActive: keepInTray });
      }),
    },
  };
}

function clearHost() {
  delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
  delete (window as unknown as { api?: unknown }).api;
}

afterEach(() => { clearHost(); vi.restoreAllMocks(); });

describe('AppShellCard', () => {
  test('浏览器模式：说明由主进程执行，不渲染任何开关', () => {
    render(<AppShellCard />);
    expect(screen.getByTestId('app-shell-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('as-keep-pick')).toBeNull();
    expect(screen.queryByTestId('as-auto-pick')).toBeNull();
  });

  test('载入后两个开关都显示主进程真值', async () => {
    setHost({ state: async () => base({ keepInTray: true, autoStart: false, applied: false, trayActive: true }) });
    render(<AppShellCard />);
    await waitFor(() => expect(screen.getByTestId('as-keep-pick')).toBeTruthy());
    expect(screen.getByTestId('as-keep-state').textContent).toContain('关窗只隐藏');
    expect(screen.getByTestId('as-auto-state').textContent).toContain('不开机自启');
    expect(screen.getByTestId('as-auto-st').textContent).toContain('系统未写入');
  });

  test('点「不启用」托盘常驻：只发 keepInTray，且回执连同自启一起收敛', async () => {
    const set = vi.fn(async (patch: Record<string, unknown>) => base({
      keepInTray: Boolean(patch.keepInTray), autoStart: false, trayActive: false,
    }));
    setHost({ set });
    render(<AppShellCard />);
    await waitFor(() => expect(screen.getByTestId('as-keep-pick')).toBeTruthy());

    await userEvent.click(screen.getByTestId('as-keep-pick').querySelector('[data-value="off"]') as HTMLElement);

    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0][0]).toEqual({ keepInTray: false });
    expect(screen.getByTestId('as-keep-state').textContent).toContain('关窗即退出');
    // 联动：自启被收起，且按钮变成不可点（否则又会出现「自启但没托盘」的死锁组合）
    expect(screen.getByTestId('as-auto-state').textContent).toContain('需先开启托盘常驻');
    expect((screen.getByTestId('as-auto-pick').querySelector('[data-value="on"]') as HTMLButtonElement).disabled).toBe(true);
  });

  test('无常驻时自启按钮不可点（联动前置）', async () => {
    setHost({ state: async () => base({ keepInTray: false, autoStart: false, trayActive: false }) });
    render(<AppShellCard />);
    await waitFor(() => expect(screen.getByTestId('as-auto-pick')).toBeTruthy());
    expect((screen.getByTestId('as-auto-pick').querySelector('[data-value="on"]') as HTMLButtonElement).disabled).toBe(true);
  });

  test('保存失败：如实报错，不假装已生效', async () => {
    setHost({
      set: async () => ({ ...base({ keepInTray: true, autoStart: true }), ok: false, error: '写盘失败：EACCES' }),
    });
    render(<AppShellCard />);
    await waitFor(() => expect(screen.getByTestId('as-auto-pick')).toBeTruthy());
    await userEvent.click(screen.getByTestId('as-auto-pick').querySelector('[data-value="off"]') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('app-shell-err').textContent).toContain('EACCES'));
    // 真值没变：仍显示「开机自启已开」
    expect(screen.getByTestId('as-auto-state').textContent).toContain('开机自启已开');
  });

  test('配置已开但系统未写入 → 明确提示需重新保存', async () => {
    setHost({ state: async () => base({ autoStart: true, applied: false }) });
    render(<AppShellCard />);
    await waitFor(() => expect(screen.getByTestId('as-auto-mismatch')).toBeTruthy());
  });

  test('无法确认（开发态/非 Windows）：显示原因，不写死成「已生效」', async () => {
    setHost({
      state: async () => base({ applied: null, autostartNote: '开发态不写系统登录项：打包装机后才会真正生效' }),
    });
    render(<AppShellCard />);
    await waitFor(() => expect(screen.getByTestId('as-auto-note')).toBeTruthy());
    expect(screen.getByTestId('as-auto-st').textContent).toContain('无法确认');
    expect(screen.queryByTestId('as-auto-mismatch')).toBeNull();
  });
});
